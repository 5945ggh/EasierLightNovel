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
  const initialScrollDoneRef = useRef(false);
  const prevChapterIndexRef = useRef<number | null>(null);
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
      let offsetRatio = 0;
      if (segmentEl) {
        const rect = segmentEl.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const segmentTop = rect.top + scrollTop;
        const documentHeight = document.documentElement.scrollHeight;
        offsetRatio = Math.min(Math.max(segmentTop / documentHeight, 0), 1);
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

        if (!isNaN(idx)) {
          updateCurrentSegment(idx);
        }
      }
    };

    observerRef.current = new IntersectionObserver(callback, {
      root: null,
      rootMargin: '-40% 0px -40% 0px',
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
  }, [chapter, bookId, updateCurrentSegment]);

  // 2. 章节变化时重置滚动状态
  useEffect(() => {
    if (chapter) {
      initialScrollDoneRef.current = false;
    }
  }, [chapter?.index]);

  // 3. 滚动到上次阅读位置
  useEffect(() => {
    if (!chapter || initialScrollDoneRef.current) return;

    const isChapterSwitch =
      prevChapterIndexRef.current !== null &&
      prevChapterIndexRef.current !== chapter.index;

    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 章节切换：滚动到页面最顶部
        if (isChapterSwitch) {
          window.scrollTo({ top: 0, behavior: 'instant' });
          requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: 'instant' });
          });
          initialScrollDoneRef.current = true;
          prevChapterIndexRef.current = chapter.index;
          return;
        }

        // 首次加载：恢复阅读位置
        const el = containerRef.current?.querySelector(
          `[data-segment-index="${currentSegmentIndex}"]`
        );
        if (!el) {
          prevChapterIndexRef.current = chapter.index;
          return;
        }

        el.scrollIntoView({ block: 'start' });

        if (segmentOffset > 0) {
          requestAnimationFrame(() => {
            const documentHeight = document.documentElement.scrollHeight;
            const targetScrollTop = segmentOffset * documentHeight;
            window.scrollTo({ top: targetScrollTop, behavior: 'instant' });
            initialScrollDoneRef.current = true;
            prevChapterIndexRef.current = chapter.index;
          });
        } else {
          initialScrollDoneRef.current = true;
          prevChapterIndexRef.current = chapter.index;
        }
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
        let offsetRatio = 0;
        if (segmentEl) {
          const rect = segmentEl.getBoundingClientRect();
          const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
          const segmentTop = rect.top + scrollTop;
          const documentHeight = document.documentElement.scrollHeight;
          offsetRatio = Math.min(Math.max(segmentTop / documentHeight, 0), 1);
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
