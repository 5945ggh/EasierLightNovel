/**
 * useScrollProgress - 阅读进度恢复与保存 Hook
 *
 * 功能：
 * 1. 恢复阅读位置：基于滚动百分比 (0-1)
 * 2. 自动保存：滚动时防抖保存进度
 * 3. 图片加载适配：使用 ResizeObserver 处理动态高度
 *
 * @param containerRef - 滚动容器的 ref
 * @param onProgressChange - 进度变化回调，参数为百分比 (0-1)
 * @param options - 配置选项
 */

import { useEffect, useCallback, useRef } from 'react';

interface UseScrollProgressOptions {
  /** 初始百分比 (0-1)，从后端获取 */
  initialPercentage: number;
  /** 恢复延迟（毫秒），确保 DOM 渲染完成 */
  restoreDelay?: number;
  /** 防抖延迟（毫秒），滚动保存的去抖时间 */
  debounceDelay?: number;
  /** 是否为章节切换（跳过百分比恢复） */
  isChapterSwitch?: boolean;
}

interface UseScrollProgressReturn {
  /** 手动标记恢复完成（用于章节切换后跳过恢复） */
  markRestored: () => void;
  /** 手动设置滚动百分比 */
  scrollToPercentage: (percentage: number) => void;
}

/**
 * 滚动进度 Hook
 *
 * @param containerRef - 滚动容器的 ref（必需，指向 overflow-y-auto 的元素）
 * @param onProgressChange - 进度变化回调，参数为百分比 (0-1)
 * @param options - 配置选项
 */
export const useScrollProgress = (
  containerRef: React.RefObject<HTMLElement | null>,
  onProgressChange: (percentage: number) => void,
  options: UseScrollProgressOptions
): UseScrollProgressReturn => {
  const {
    initialPercentage,
    restoreDelay = 100,
    debounceDelay = 500,
    isChapterSwitch = false,
  } = options;

  const isRestoredRef = useRef(isChapterSwitch);
  const isProgrammaticScrollRef = useRef(false); // 标记是否为程序触发的滚动
  const saveTimeoutRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastSavedPercentageRef = useRef<number>(-1);

  // 手动标记恢复完成
  const markRestored = useCallback(() => {
    isRestoredRef.current = true;
  }, []);

  // 手动滚动到指定百分比
  const scrollToPercentage = useCallback(
    (percentage: number) => {
      const container = containerRef.current;
      if (!container) return;

      const clamped = Math.max(0, Math.min(1, percentage));
      const maxScrollTop = container.scrollHeight - container.clientHeight;
      if (maxScrollTop <= 0) return;

      isProgrammaticScrollRef.current = true;
      container.scrollTop = clamped * maxScrollTop;

      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    },
    [containerRef]
  );

  // 1. 恢复阅读位置
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 章节切换时跳过恢复
    if (isChapterSwitch) {
      isRestoredRef.current = true;
      return;
    }

    // 每次 initialPercentage 变化，都允许重新恢复一次
    isRestoredRef.current = false;

    const p = Math.max(0, Math.min(1, initialPercentage));
    if (p <= 0) {
      isRestoredRef.current = true;
      container.scrollTop = 0;
      lastSavedPercentageRef.current = 0;
      return;
    }

    // 用于追踪恢复尝试次数
    let restoreAttempts = 0;
    const MAX_RESTORE_ATTEMPTS = 50;

    const tryRestore = () => {
      if (isRestoredRef.current) return;

      const maxScrollTop = container.scrollHeight - container.clientHeight;

      if (maxScrollTop <= 0) {
        // 内容高度不足，允许滚动保存
        if (restoreAttempts > 5) {
          isRestoredRef.current = true;
          lastSavedPercentageRef.current = 0;
        }
        restoreAttempts++;
        return;
      }

      const target = p * maxScrollTop;

      isProgrammaticScrollRef.current = true;
      container.scrollTop = target;

      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;

        // 放宽成功阈值：5px 或当前 maxScrollTop 的 1%
        const threshold = Math.max(5, maxScrollTop * 0.01);
        const diff = Math.abs(container.scrollTop - target);

        if (diff < threshold) {
          // 恢复成功
          isRestoredRef.current = true;
          lastSavedPercentageRef.current = p; // 避免刚恢复就触发一次保存
          resizeObserverRef.current?.disconnect();
        } else if (restoreAttempts >= MAX_RESTORE_ATTEMPTS) {
          // 达到最大尝试次数，强制启用滚动保存（避免永久禁用）
          isRestoredRef.current = true;
          lastSavedPercentageRef.current = container.scrollTop / maxScrollTop;
          resizeObserverRef.current?.disconnect();
        } else {
          // 继续尝试
          restoreAttempts++;
          requestAnimationFrame(tryRestore);
        }
      });
    };

    // 观察"内容元素"，不要只观察滚动容器（容器高度通常固定不变）
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = new ResizeObserver(() => {
      // 内容每次变高都再尝试一次（重置尝试计数）
      restoreAttempts = 0;
      setTimeout(tryRestore, restoreDelay);
    });

    // 观察第一个子元素（内容区），而不是滚动容器本身
    const observed = (container.firstElementChild ?? container) as Element;
    resizeObserverRef.current.observe(observed);

    // 初次尝试恢复
    tryRestore();

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [containerRef, initialPercentage, isChapterSwitch, restoreDelay]);

  // 2. 监听滚动并保存进度 —— 始终挂监听，在 handler 内部 gate
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // 未恢复时不监听，避免干扰恢复过程
      if (!isRestoredRef.current) {
        return;
      }
      // 程序触发的滚动不触发保存
      if (isProgrammaticScrollRef.current) {
        return;
      }

      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = window.setTimeout(() => {
        const maxScrollTop = container.scrollHeight - container.clientHeight;
        if (maxScrollTop <= 0) return;

        const safe = Math.max(0, Math.min(1, container.scrollTop / maxScrollTop));

        if (Math.abs(safe - lastSavedPercentageRef.current) > 0.001) {
          lastSavedPercentageRef.current = safe;
          onProgressChange(safe);
        }
      }, debounceDelay);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [containerRef, onProgressChange, debounceDelay]);

  return { markRestored, scrollToPercentage };
};
