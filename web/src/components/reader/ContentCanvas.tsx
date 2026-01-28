/**
 * ContentCanvas - 组织组件
 * 负责章节内容的渲染布局、滚动监听和进度保存
 *
 * 性能优化：使用 selector 订阅特定状态
 * 进度保存：
 *   - 百分比：用于精确恢复滚动位置
 *   - 段落索引：用于快速定位和跨章节跳转
 * 样式：使用 CSS 变量实现动态字体设置
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useReaderStore } from '@/stores/readerStore';
import { updateReadingProgress } from '@/services/books.service';
import { SegmentRenderer } from './SegmentRenderer';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { useScrollProgress } from '@/hooks/useScrollProgress';

// IntersectionObserver 配置：只有当段落进入视口中心区域时才触发
const OBSERVER_ROOT_MARGIN = '-45% 0px -45% 0px'; // 只检测视口中间 10% 的区域

interface ContentCanvasProps {
  // 滚动容器的 ref（从 ReaderPage 传入）
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  // 章节切换回调
  onPrevChapter?: () => void;
  onNextChapter?: () => void;
  hasPrevChapter?: boolean;
  hasNextChapter?: boolean;
  // 进度恢复参数
  initialPercentage: number; // 初始滚动百分比 (0-1)
  isChapterSwitch: boolean;  // 是否为章节切换（跳过百分比恢复）
}

export const ContentCanvas: React.FC<ContentCanvasProps> = ({
  scrollContainerRef,
  onPrevChapter,
  onNextChapter,
  hasPrevChapter = false,
  hasNextChapter = false,
  initialPercentage = 0,
  isChapterSwitch = false,
}) => {
  // 使用 selector 订阅特定状态，避免不必要的重渲染
  const chapter = useReaderStore((s) => s.chapter);
  const bookId = useReaderStore((s) => s.bookId);
  const currentSegmentIndex = useReaderStore((s) => s.currentSegmentIndex);
  const setCurrentSegmentIndex = useReaderStore((s) => s.setCurrentSegmentIndex);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 当前缓存的滚动百分比（用于保存进度）
  const cachedPercentageRef = useRef(initialPercentage);

  // 当 initialPercentage 变化时更新 ref（避免不滚动就切章节把 0 存回去）
  useEffect(() => {
    console.log('[ContentCanvas] Updating cachedPercentageRef:', initialPercentage);
    cachedPercentageRef.current = initialPercentage;
  }, [initialPercentage]);

  // 保存进度的核心函数
  const saveProgress = useCallback((percentage: number): Promise<void> => {
    console.log('[ContentCanvas] saveProgress called:', {
      percentage,
      hasBookId: !!bookId,
      hasChapter: !!chapter,
      currentSegmentIndex,
    });

    if (!bookId || !chapter || currentSegmentIndex < 0) {
      console.log('[ContentCanvas] saveProgress ABORTED - missing required data');
      return Promise.resolve();
    }

    setIsSaving(true);
    // 前端 0-1，后端 0-100（保留一位小数）
    const percentageForBackend = Math.round(percentage * 1000) / 10;

    const payload = {
      current_chapter_index: chapter.index,
      current_segment_index: currentSegmentIndex,
      progress_percentage: percentageForBackend,
    };

    console.log('[ContentCanvas] Calling updateReadingProgress:', payload);

    return updateReadingProgress(bookId, payload)
      .then(() => {
        console.log('[ContentCanvas] Progress saved successfully');
        setIsSaving(false);
      })
      .catch((err) => {
        console.error('[ContentCanvas] Failed to save progress:', err);
        setIsSaving(false);
      });
  }, [bookId, chapter, currentSegmentIndex]);

  // 使用滚动进度 Hook（传入滚动容器 ref）
  useScrollProgress(
    scrollContainerRef,
    (percentage) => {
      cachedPercentageRef.current = percentage;
      saveProgress(percentage);
    },
    {
      initialPercentage,
      isChapterSwitch,
      restoreDelay: 150,
      debounceDelay: 1000,
    }
  );

  // 章节切换前先保存进度
  const handlePrevChapter = useCallback(() => {
    saveProgress(cachedPercentageRef.current).then(() => {
      onPrevChapter?.();
    });
  }, [saveProgress, onPrevChapter]);

  const handleNextChapter = useCallback(() => {
    saveProgress(cachedPercentageRef.current).then(() => {
      onNextChapter?.();
    });
  }, [saveProgress, onNextChapter]);

  // 1. 初始化 IntersectionObserver 监听段落切换
  // 用于更新 currentSegmentIndex，辅助快速定位
  useEffect(() => {
    if (!chapter || !bookId) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    const callback: IntersectionObserverCallback = (entries) => {
      const visibleEntry = entries.find((entry) => entry.isIntersecting);

      if (visibleEntry) {
        const idx = Number(visibleEntry.target.getAttribute('data-segment-index'));

        // 只在段落索引变化时才更新，避免频繁触发
        if (!isNaN(idx) && idx !== currentSegmentIndex) {
          setCurrentSegmentIndex(idx);
        }
      }
    };

    observerRef.current = new IntersectionObserver(callback, {
      root: scrollContainerRef.current, // 使用传入的滚动容器作为 root
      rootMargin: OBSERVER_ROOT_MARGIN,
      threshold: 0,
    });

    const rafId = requestAnimationFrame(() => {
      const elements = contentRef.current?.querySelectorAll('[data-segment-index]');
      elements?.forEach((el) => observerRef.current?.observe(el));
    });

    return () => {
      cancelAnimationFrame(rafId);
      observerRef.current?.disconnect();
    };
  }, [chapter, bookId, currentSegmentIndex, scrollContainerRef, setCurrentSegmentIndex]);

  // 2. 组件卸载时保存进度
  useEffect(() => {
    return () => {
      console.log('[ContentCanvas] Unmounting, saving progress:', {
        hasBookId: !!bookId,
        hasChapter: !!chapter,
        currentSegmentIndex,
        cachedPercentage: cachedPercentageRef.current,
      });
      if (bookId && chapter && currentSegmentIndex >= 0) {
        updateReadingProgress(bookId, {
          current_chapter_index: chapter.index,
          current_segment_index: currentSegmentIndex,
          progress_percentage: Math.round(cachedPercentageRef.current * 1000) / 10,
        })
          .then(() => console.log('[ContentCanvas] Unmount save successful'))
          .catch(err => console.error('[ContentCanvas] Unmount save failed:', err));
      } else {
        console.log('[ContentCanvas] Unmount save SKIPPED - missing data');
      }
    };
  }, [bookId, chapter, currentSegmentIndex]);

  if (!chapter) {
    return null;
  }

  return (
    <div
      ref={contentRef}
      className="min-h-screen"
      // 使用 CSS 变量控制样式
      style={{
        fontFamily: 'var(--reader-font-family)',
        fontSize: 'var(--reader-font-size)',
        lineHeight: 'var(--reader-line-height)',
      }}
    >
      {/* 阅读容器：限制最大宽度，居中 */}
      <div className="max-w-3xl mx-auto px-6 py-12 md:px-12 md:py-16 lg:px-16 lg:py-20 min-h-screen">
        {/* 进度保存指示器 */}
        {isSaving && (
          <div className="fixed top-4 right-4 text-xs text-gray-400 bg-white/80 dark:bg-gray-800/80 backdrop-blur px-2 py-1 rounded shadow-sm z-10">
            保存中...
          </div>
        )}

        {/* 章节导航 - 固定在顶部 */}
        <div className="sticky top-0 z-10 -mx-6 px-6 md:-mx-12 md:px-12 py-3 bg-stone-50/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 flex items-center justify-between text-sm">
          <button
            onClick={handlePrevChapter}
            disabled={!hasPrevChapter}
            className={clsx(
              'flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors',
              hasPrevChapter
                ? 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            )}
          >
            <ChevronLeft size={16} />
            上一章
          </button>

          <span className="text-gray-400 dark:text-gray-500 text-xs">
            第 {chapter.index + 1} 章
          </span>

          <button
            onClick={handleNextChapter}
            disabled={!hasNextChapter}
            className={clsx(
              'flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors',
              hasNextChapter
                ? 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            )}
          >
            下一章
            <ChevronRight size={16} />
          </button>
        </div>

        {/* 章节标题 */}
        <h1 className="text-2xl md:text-3xl font-bold mb-10 pb-4 border-b border-gray-200 dark:border-gray-700">
          {chapter.title}
        </h1>

        {/* 正文渲染 */}
        <div className="reader-content space-y-6">
          {chapter.segments.map((segment, idx) => (
            <SegmentRenderer key={idx} segment={segment} index={idx} />
          ))}
        </div>

        {/* 底部占位 */}
        <div className="h-[50vh]" />

        {/* 章节结束导航 */}
        <div className="flex items-center justify-center gap-4 py-12 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handlePrevChapter}
            disabled={!hasPrevChapter}
            className={clsx(
              'flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-colors',
              hasPrevChapter
                ? 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                : 'bg-gray-50 dark:bg-gray-900 text-gray-300 dark:text-gray-600 cursor-not-allowed'
            )}
          >
            <ChevronLeft size={18} />
            上一章
          </button>

          <button
            onClick={handleNextChapter}
            disabled={!hasNextChapter}
            className={clsx(
              'flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-colors',
              hasNextChapter
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed'
            )}
          >
            下一章
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};
