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

import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReaderStore } from '@/stores/readerStore';
import { updateReadingProgress } from '@/services/books.service';
import { SegmentRenderer } from './SegmentRenderer';
import { ChevronLeft, ChevronRight, Home, ArrowLeft, Settings, List } from 'lucide-react';
import { clsx } from 'clsx';
import { useScrollProgress } from '@/hooks/useScrollProgress';
import { saveReadingProgressSnapshot } from '@/utils/readingProgress';
import type { ReadingProgressState, ReadingProgressSnapshot } from '@/utils/readingProgress';
import type { ChapterResponse } from '@/types/chapter';
import { createProgressSaver } from '@/utils/progressPersistence';
import type { ProgressSaveStatus } from '@/utils/progressPersistence';
import { captureReaderAnchor } from '@/utils/readerAnchor';

interface ContentCanvasProps {
  bookId: string;
  chapter: ChapterResponse;
  layoutKey: string;
  // 滚动容器的 ref（从 ReaderPage 传入）
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  // 章节切换回调
  onPrevChapter?: () => void;
  onNextChapter?: () => void;
  hasPrevChapter?: boolean;
  hasNextChapter?: boolean;
  // 进度恢复参数
  initialPercentage: number; // 初始滚动百分比 (0-1)
  isChapterSwitch: boolean;  // 是否为章节切换（跳过百分比恢复）
  // 移动端按钮回调（从 ReaderPage 传入）
  onToggleToc?: () => void;
  onToggleSettings?: () => void;
}

export const ContentCanvas: React.FC<ContentCanvasProps> = ({
  bookId,
  chapter,
  layoutKey,
  scrollContainerRef,
  onPrevChapter,
  onNextChapter,
  hasPrevChapter = false,
  hasNextChapter = false,
  initialPercentage = 0,
  isChapterSwitch = false,
  onToggleToc,
  onToggleSettings,
}) => {
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);
  const [saveStatus, setSaveStatus] = useState<ProgressSaveStatus>('idle');
  const mountedRef = useRef(false);
  const cachedPercentageRef = useRef(initialPercentage);
  const navigatingRef = useRef(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const saver = useMemo(() => createProgressSaver<ReadingProgressSnapshot>({
    writeLocal: (snapshot) => saveReadingProgressSnapshot(bookId, snapshot),
    writeRemote: (snapshot) => updateReadingProgress(bookId, {
      current_chapter_index: snapshot.chapterIndex,
      current_segment_index: snapshot.segmentIndex,
      progress_percentage: Math.round(snapshot.percentage * 1000) / 10,
      state: snapshot.state,
    }),
    onStatus: setSaveStatus,
  }), [bookId]);

  const recordProgress = useCallback((percentage: number, state: ReadingProgressState = 'in_progress') => {
    const container = scrollContainerRef.current;
    const anchor = container ? captureReaderAnchor(container) : null;
    const segmentIndex = anchor ? Number(anchor.segmentIndex) : useReaderStore.getState().currentSegmentIndex;
    const snapshot: ReadingProgressSnapshot = {
      chapterIndex: chapter.index,
      segmentIndex: Math.max(0, segmentIndex),
      percentage,
      state,
      timestamp: Date.now(),
    };
    cachedPercentageRef.current = percentage;
    useReaderStore.getState().setCurrentSegmentIndex(snapshot.segmentIndex);
    saver.record(snapshot);
  }, [chapter.index, saver, scrollContainerRef]);

  useScrollProgress(scrollContainerRef, recordProgress, {
    initialPercentage, isChapterSwitch, layoutKey,
  });

  useEffect(() => {
    mountedRef.current = true;
    const flush = () => { void saver.flush(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [saver]);

  const changeChapter = useCallback(async (next: boolean) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    setIsNavigating(true);
    recordProgress(cachedPercentageRef.current, next ? 'completed' : 'in_progress');
    await saver.flush();
    if (mountedRef.current) {
      if (next) onNextChapter?.();
      else onPrevChapter?.();
      navigatingRef.current = false;
      setIsNavigating(false);
    }
  }, [recordProgress, saver, onNextChapter, onPrevChapter]);
  const handlePrevChapter = () => { void changeChapter(false); };
  const handleNextChapter = () => { void changeChapter(true); };

  if (!chapter) {
    return null;
  }

  return (
    <div
      ref={contentRef}
      className="min-h-[100dvh]"
      // 使用 CSS 变量控制样式
      style={{
        fontFamily: 'var(--reader-font-family)',
        fontSize: 'var(--reader-font-size)',
        lineHeight: 'var(--reader-line-height)',
      }}
    >
      {/* 阅读容器：限制最大宽度，居中 */}
      <div style={{ maxWidth: 'var(--reader-width, 768px)' }} className="mx-auto px-6 py-12 md:px-12 md:py-16 lg:px-16 lg:py-20 min-h-[100dvh]">
        {/* 进度保存指示器 */}
        {saveStatus !== 'idle' && (
          <div role="status" className="pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-4 right-2 max-w-[75vw] text-xs text-gray-600 bg-white/95 dark:text-gray-200 dark:bg-gray-800/95 backdrop-blur px-2 py-1 rounded shadow-sm z-30">
            {saveStatus === 'pending' ? '保存中…' : saveStatus === 'saved' ? '进度已保存' : saveStatus === 'local-only' ? '已保存到本机，服务器保存失败' : '进度保存失败，请稍后重试'}
          </div>
        )}

        {/* 章节导航 - 固定在顶部 */}
        <div data-reader-navigation className="sticky top-0 z-10 -mx-6 px-4 md:-mx-12 md:px-12 py-3 bg-stone-50/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 flex items-center justify-between text-sm safe-area-top">
          {/* 移动端：左侧按钮组（返回、目录） */}
          <div className="flex md:hidden items-center gap-1">
            <button
              onClick={() => {
                if (bookId) navigate(`/book/${bookId}`);
                else navigate('/');
              }}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
              aria-label="返回书籍主页"
              title="返回书籍主页"
            >
              <ArrowLeft size={18} />
            </button>
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
              aria-label="返回书架"
            >
              <Home size={18} />
            </button>
            {onToggleToc && (
              <button
                onClick={onToggleToc}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                aria-label="目录"
              >
                <List size={18} />
              </button>
            )}
          </div>

          {/* 桌面端/移动端中间：上一章按钮 */}
          <button
            onClick={handlePrevChapter}
            disabled={!hasPrevChapter || isNavigating}
            className={clsx(
              'flex items-center gap-1 px-2 md:px-3 py-1.5 rounded-lg transition-colors',
              hasPrevChapter
                ? 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            )}
          >
            <ChevronLeft size={16} />
            <span className="hidden sm:inline">上一章</span>
          </button>

          {/* 章节信息 */}
          <span className="text-gray-400 dark:text-gray-500 text-xs">
            第 {chapter.index + 1} 章
          </span>

          {/* 桌面端/移动端中间：下一章按钮 */}
          <button
            onClick={handleNextChapter}
            disabled={!hasNextChapter || isNavigating}
            className={clsx(
              'flex items-center gap-1 px-2 md:px-3 py-1.5 rounded-lg transition-colors',
              hasNextChapter
                ? 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            )}
          >
            <span className="hidden sm:inline">下一章</span>
            <ChevronRight size={16} />
          </button>

          {/* 移动端：右侧按钮组（设置） */}
          <div className="flex md:hidden items-center gap-1">
            {onToggleSettings && (
              <button
                onClick={onToggleSettings}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                aria-label="设置"
              >
                <Settings size={18} />
              </button>
            )}
          </div>
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
            disabled={!hasPrevChapter || isNavigating}
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
            disabled={!hasNextChapter || isNavigating}
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
