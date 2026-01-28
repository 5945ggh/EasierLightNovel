/**
 * ContentCanvas - 组织组件
 * 负责章节内容的渲染布局、滚动监听和进度保存
 *
 * 性能优化：使用 selector 订阅特定状态
 * 进度保存：章节切换前强制保存，避免进度丢失
 * 样式：使用 CSS 变量实现动态字体设置
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useReaderStore } from '@/stores/readerStore';
import { updateReadingProgress } from '@/services/books.service';
import { SegmentRenderer } from './SegmentRenderer';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

// 进度恢复的默认偏移（段落顶部距离视口顶部的百分比）
const DEFAULT_RESTORE_OFFSET = 0.15; // 15% 位置，既不遮挡标题也不太靠下

// IntersectionObserver 配置：只有当段落进入视口中心区域时才触发
const OBSERVER_ROOT_MARGIN = '-45% 0px -45% 0px'; // 只检测视口中间 10% 的区域

interface ContentCanvasProps {
  // 章节切换回调
  onPrevChapter?: () => void;
  onNextChapter?: () => void;
  hasPrevChapter?: boolean;
  hasNextChapter?: boolean;
}

export const ContentCanvas: React.FC<ContentCanvasProps> = ({
  onPrevChapter,
  onNextChapter,
  hasPrevChapter = false,
  hasNextChapter = false,
}) => {
  // 使用 selector 订阅特定状态，避免不必要的重渲染
  const chapter = useReaderStore((s) => s.chapter);
  const bookId = useReaderStore((s) => s.bookId);
  const currentSegmentIndex = useReaderStore((s) => s.currentSegmentIndex);
  const segmentOffset = useReaderStore((s) => s.segmentOffset);
  const setCurrentSegmentIndex = useReaderStore((s) => s.setCurrentSegmentIndex);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveProgressTimeoutRef = useRef<number | null>(null);
  const scrollRestoredRef = useRef(false);
  const lastProcessedChapterRef = useRef<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 立即保存进度（不经过 debounce）
  const flushProgress = useCallback(() => {
    if (saveProgressTimeoutRef.current) {
      clearTimeout(saveProgressTimeoutRef.current);
      saveProgressTimeoutRef.current = null;
    }

    if (bookId && chapter && currentSegmentIndex >= 0) {
      const segmentEl = containerRef.current?.querySelector(
        `[data-segment-index="${currentSegmentIndex}"]`
      );
      // 计算段落相对于视口的位置偏移
      // offsetRatio 表示：段落顶部在视口中的位置比例（0 = 在视口顶部，1 = 在视口底部）
      let offsetRatio = DEFAULT_RESTORE_OFFSET;
      if (segmentEl) {
        const rect = segmentEl.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        // rect.top 是段落顶部相对于视口顶部的距离（可能为负，表示在视口上方）
        // 我们保存的是段落顶部在视口中的相对位置（0-1）
        const relativePosition = rect.top / viewportHeight;
        // 限制在 0-1 范围内，避免极端值
        offsetRatio = Math.min(Math.max(relativePosition, 0), 1);
      }

      setIsSaving(true);
      return updateReadingProgress(bookId, {
        current_chapter_index: chapter.index,
        current_segment_index: currentSegmentIndex,
        current_segment_offset: Math.round(offsetRatio * 10000),
      })
        .then(() => {
          setIsSaving(false);
        })
        .catch((err) => {
          console.error('Failed to save progress:', err);
          setIsSaving(false);
        });
    }
    return Promise.resolve();
  }, [bookId, chapter, currentSegmentIndex]);

  // Debounce 保存进度到后端
  const updateCurrentSegment = useCallback(
    (idx: number) => {
      setCurrentSegmentIndex(idx);

      if (saveProgressTimeoutRef.current) {
        clearTimeout(saveProgressTimeoutRef.current);
      }

      saveProgressTimeoutRef.current = setTimeout(() => {
        flushProgress();
      }, 1000);
    },
    [setCurrentSegmentIndex, flushProgress]
  );

  // 章节切换前先保存进度
  const handlePrevChapter = useCallback(() => {
    flushProgress().then(() => {
      onPrevChapter?.();
    });
  }, [flushProgress, onPrevChapter]);

  const handleNextChapter = useCallback(() => {
    flushProgress().then(() => {
      onNextChapter?.();
    });
  }, [flushProgress, onNextChapter]);

  // 1. 初始化 IntersectionObserver 监听滚动
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
          updateCurrentSegment(idx);
        }
      }
    };

    observerRef.current = new IntersectionObserver(callback, {
      root: null,
      rootMargin: OBSERVER_ROOT_MARGIN, // 只检测视口中心区域
      threshold: 0,
    });

    const rafId = requestAnimationFrame(() => {
      const elements = containerRef.current?.querySelectorAll('[data-segment-index]');
      elements?.forEach((el) => observerRef.current?.observe(el));
    });

    return () => {
      cancelAnimationFrame(rafId);
      observerRef.current?.disconnect();
      if (saveProgressTimeoutRef.current) {
        clearTimeout(saveProgressTimeoutRef.current);
      }
    };
  }, [chapter, bookId, updateCurrentSegment, currentSegmentIndex]);

  // 2. 章节变化时重置滚动状态
  useEffect(() => {
    if (chapter?.index !== undefined) {
      scrollRestoredRef.current = false;
    }
  }, [chapter?.index]);

  // 3. 滚动到上次阅读位置或章节顶部
  useEffect(() => {
    if (!chapter || scrollRestoredRef.current) return;

    const currentChapterIndex = chapter.index;
    const isChapterSwitch =
      lastProcessedChapterRef.current !== null &&
      lastProcessedChapterRef.current !== currentChapterIndex;

    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 章节切换：滚动到页面最顶部
        if (isChapterSwitch) {
          window.scrollTo({ top: 0, behavior: 'instant' });
          scrollRestoredRef.current = true;
          lastProcessedChapterRef.current = currentChapterIndex;
          return;
        }

        // 首次加载：恢复阅读位置
        const el = containerRef.current?.querySelector(
          `[data-segment-index="${currentSegmentIndex}"]`
        );
        if (!el) {
          // 如果找不到目标段落，默认滚动到顶部
          window.scrollTo({ top: 0, behavior: 'instant' });
          scrollRestoredRef.current = true;
          lastProcessedChapterRef.current = currentChapterIndex;
          return;
        }

        // 获取段落顶部在视口中的目标位置（如果没有保存的偏移，使用默认值）
        const targetOffset = segmentOffset > 0 ? segmentOffset : DEFAULT_RESTORE_OFFSET;
        const viewportHeight = window.innerHeight;
        const targetOffsetPixels = targetOffset * viewportHeight;

        // 先滚动到段落顶部
        el.scrollIntoView({ block: 'start', behavior: 'instant' });

        // 然后向上滚动，使段落顶部位于目标位置
        requestAnimationFrame(() => {
          const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
          const targetScrollTop = Math.max(0, currentScrollTop - targetOffsetPixels);
          window.scrollTo({ top: targetScrollTop, behavior: 'instant' });
          scrollRestoredRef.current = true;
          lastProcessedChapterRef.current = currentChapterIndex;
        });
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, [chapter, currentSegmentIndex, segmentOffset]);

  // 4. 组件卸载时保存进度
  useEffect(() => {
    const container = containerRef.current;
    return () => {
      if (saveProgressTimeoutRef.current) {
        clearTimeout(saveProgressTimeoutRef.current);
      }
      if (bookId && chapter && currentSegmentIndex >= 0) {
        const segmentEl = container?.querySelector(
          `[data-segment-index="${currentSegmentIndex}"]`
        );
        // 计算段落相对于视口的位置偏移
        let offsetRatio = DEFAULT_RESTORE_OFFSET;
        if (segmentEl) {
          const rect = segmentEl.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const relativePosition = rect.top / viewportHeight;
          offsetRatio = Math.min(Math.max(relativePosition, 0), 1);
        }

        updateReadingProgress(bookId, {
          current_chapter_index: chapter.index,
          current_segment_index: currentSegmentIndex,
          current_segment_offset: Math.round(offsetRatio * 10000),
        }).catch(console.error);
      }
    };
  }, [bookId, chapter, currentSegmentIndex]);

  if (!chapter) {
    return null;
  }

  return (
    <div
      ref={containerRef}
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
