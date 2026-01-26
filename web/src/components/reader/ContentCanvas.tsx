/**
 * ContentCanvas - 组织组件
 * 负责章节内容的渲染布局、滚动监听和进度保存
 *
 * 性能优化：使用 selector 订阅特定状态
 * 进度保存：章节切换前强制保存，避免进度丢失
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useReaderStore } from '@/stores/readerStore';
import { updateReadingProgress } from '@/services/books.service';
import { SegmentRenderer } from './SegmentRenderer';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

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
  const saveProgressTimeoutRef = useRef<number | null>(null); // 浏览器环境使用 number
  const initialScrollDoneRef = useRef(false);
  const prevChapterIndexRef = useRef<number | null>(null); // 记录上一章索引，用于检测章节切换
  const [isSaving, setIsSaving] = useState(false);

  // 立即保存进度（不经过 debounce）
  const flushProgress = useCallback(() => {
    if (saveProgressTimeoutRef.current) {
      clearTimeout(saveProgressTimeoutRef.current);
      saveProgressTimeoutRef.current = null;
    }

    if (bookId && chapter && currentSegmentIndex >= 0) {
      // 计算段落顶部在文档中的相对位置（百分比 0~1）
      // 后端期望整数，所以乘以 10000 转换（精度为 0.0001）
      const segmentEl = containerRef.current?.querySelector(
        `[data-segment-index="${currentSegmentIndex}"]`
      );
      let offsetRatio = 0;
      if (segmentEl) {
        const rect = segmentEl.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const segmentTop = rect.top + scrollTop; // 段落顶部距离文档顶部的距离
        const documentHeight = document.documentElement.scrollHeight;
        offsetRatio = Math.min(Math.max(segmentTop / documentHeight, 0), 1); // 限制在 0~1 范围
      }

      setIsSaving(true);
      return updateReadingProgress(bookId, {
        current_chapter_index: chapter.index,
        current_segment_index: currentSegmentIndex,
        // 转换为整数发送给后端（0~10000）
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

  // Debounce 保存进度到后端 (避免频繁请求)
  const updateCurrentSegment = useCallback(
    (idx: number) => {
      setCurrentSegmentIndex(idx);

      // 清除之前的定时器
      if (saveProgressTimeoutRef.current) {
        clearTimeout(saveProgressTimeoutRef.current);
      }

      // 设置新的定时器
      saveProgressTimeoutRef.current = setTimeout(() => {
        flushProgress();
      }, 1000); // 停止滚动 1 秒后保存
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

    // 清理旧的 observer
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
      rootMargin: '-40% 0px -40% 0px', // 只有在屏幕中间 20% 区域才算"正在阅读"
      threshold: 0,
    });

    // 等待 DOM 渲染完成后绑定 observer
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (chapter) {
      initialScrollDoneRef.current = false;
    }
  }, [chapter?.index]); // 只在章节索引变化时重置，而非章节对象变化

  // 3. 滚动到上次阅读位置
  useEffect(() => {
    if (!chapter || initialScrollDoneRef.current) return;

    // 检测是否是章节切换（而非首次加载）
    const isChapterSwitch =
      prevChapterIndexRef.current !== null &&
      prevChapterIndexRef.current !== chapter.index;

    // 使用双重 rAF 确保 DOM 完全渲染后再滚动
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 章节切换：滚动到页面最顶部
        if (isChapterSwitch) {
          window.scrollTo({ top: 0, behavior: 'instant' });
          // 再次确保滚动到顶部（处理可能的异步布局）
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

        // 恢复阅读位置：先滚动到段落，再根据百分比调整
        el.scrollIntoView({ block: 'start' });

        // 应用百分比偏移（如果有）
        if (segmentOffset > 0) {
          // 使用双重 rAF 确保 DOM 布局完成
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
    return () => {
      if (saveProgressTimeoutRef.current) {
        clearTimeout(saveProgressTimeoutRef.current);
      }
      // 组件卸载时立即保存当前进度
      if (bookId && chapter && currentSegmentIndex >= 0) {
        // 计算百分比偏移，转换为整数发送给后端
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

        updateReadingProgress(bookId, {
          current_chapter_index: chapter.index,
          current_segment_index: currentSegmentIndex,
          // 转换为整数发送给后端（0~10000）
          current_segment_offset: Math.round(offsetRatio * 10000),
        }).catch(console.error);
      }
    };
  }, [bookId, chapter, currentSegmentIndex]);

  if (!chapter) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50">
        <Loader2 className="h-8 w-8 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="min-h-screen bg-[#Fdfbf7]">
      {/* 沉浸式布局容器：限制最大宽度，居中 */}
      <div className="max-w-3xl mx-auto px-6 py-12 md:px-12 md:py-20 bg-white shadow-sm min-h-screen relative">
        {/* 进度保存指示器 */}
        {isSaving && (
          <div className="fixed top-4 right-4 text-xs text-gray-400 bg-white px-2 py-1 rounded shadow-sm z-10">
            保存中...
          </div>
        )}

        {/* 章节导航 - 固定在顶部 */}
        <div className="sticky top-0 z-10 -mx-6 px-6 md:-mx-12 md:px-12 py-3 bg-white/95 backdrop-blur-sm border-b border-gray-100 flex items-center justify-between text-sm text-gray-500">
          <button
            onClick={handlePrevChapter}
            disabled={!hasPrevChapter}
            className={`
              flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors
              ${
                hasPrevChapter
                  ? 'hover:bg-gray-100 text-gray-700'
                  : 'text-gray-300 cursor-not-allowed'
              }
            `}
          >
            <ChevronLeft size={16} />
            上一章
          </button>

          <span className="text-gray-400">
            第 {chapter.index + 1} 章
          </span>

          <button
            onClick={handleNextChapter}
            disabled={!hasNextChapter}
            className={`
              flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors
              ${
                hasNextChapter
                  ? 'hover:bg-gray-100 text-gray-700'
                  : 'text-gray-300 cursor-not-allowed'
              }
            `}
          >
            下一章
            <ChevronRight size={16} />
          </button>
        </div>

        {/* 章节标题 */}
        <h1 className="text-3xl font-bold text-gray-900 mb-12 pb-4 border-b border-gray-100">
          {chapter.title}
        </h1>

        {/* 正文渲染 */}
        <div className="reader-content">
          {chapter.segments.map((segment, idx) => (
            <SegmentRenderer key={idx} segment={segment} index={idx} />
          ))}
        </div>

        {/* 底部占位，允许最后一段滚到中间 */}
        <div className="h-[50vh]" />

        {/* 章节结束导航 */}
        <div className="flex items-center justify-center gap-4 py-12 border-t border-gray-100">
          <button
            onClick={handlePrevChapter}
            disabled={!hasPrevChapter}
            className={`
              flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-colors
              ${
                hasPrevChapter
                  ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  : 'bg-gray-50 text-gray-300 cursor-not-allowed'
              }
            `}
          >
            <ChevronLeft size={18} />
            上一章
          </button>

          <button
            onClick={handleNextChapter}
            disabled={!hasNextChapter}
            className={`
              flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-colors
              ${
                hasNextChapter
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-100 text-gray-300 cursor-not-allowed'
              }
            `}
          >
            下一章
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};
