/**
 * ReaderPage - 页面入口
 * 负责数据获取、状态编排和路由处理
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, Home, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';

// Services & Stores
import {
  getChapterContent,
  getVocabulariesBaseForms,
  getReadingProgress,
  getChapterProgresses,
  getBookDetail,
  getChapterList,
  getBookHighlights,
} from '@/services/books.service';
import { getBookVocabularies } from '@/services/vocabularies.service';
import { useReaderStore } from '@/stores/readerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ProcessingStatus } from '@/types/common';

// Components
import { ContentCanvas } from '@/components/reader/ContentCanvas';
import { LeftDock } from '@/components/reader/LeftDock';
import { TocModal } from '@/components/reader/TocModal';
import { SelectionMenu } from '@/components/reader/SelectionMenu';
import { TokenPopover } from '@/components/reader/TokenPopover';
import { ReaderSidebar } from '@/components/reader/ReaderSidebar';
import { MobileGuide } from '@/components/reader/MobileGuide';
import {
  isLocalSnapshotNewer,
  isLocalChapterSnapshotNewer,
  loadReadingProgressStore,
  parseChapterQuery,
  resolveInitialReaderPosition,
} from '@/utils/readingProgress';
import type { ChapterProgressResponse } from '@/types/progress';
import type { ReadingProgressSnapshot } from '@/utils/readingProgress';

export const ReaderPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawQueryChapter = searchParams.get('chapter');
  const currentBookId = bookId ?? null;

  // 滚动容器的 ref（传递给 ContentCanvas 用于进度监听）
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // TOC 模态框状态
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [explicitChapterRequest, setExplicitChapterRequest] = useState<{
    bookId: string | null;
    index: number | null;
  }>({ bookId: currentBookId, index: null });
  const explicitChapterIndex =
    explicitChapterRequest.bookId === currentBookId
      ? explicitChapterRequest.index
      : null;
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  // 设置 Store
  const { theme, furiganaMode, fontSize, lineHeight, fontFamily } = useSettingsStore();

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // 计算实际应用的主题（处理 system 主题）
  const resolvedTheme = useMemo(() => {
    if (theme === 'system') {
      return systemPrefersDark ? 'dark' : 'light';
    }
    if (theme === 'sepia') return 'sepia';
    return theme;
  }, [theme, systemPrefersDark]);

  // 主题样式映射
  const themeStyles = useMemo(() => ({
    light: 'bg-stone-50 text-gray-900',
    dark: 'bg-gray-900 text-gray-100',
    sepia: 'bg-[#f4ecd8] text-[#5b4636]',
  }), []);

  // Store Actions
  const {
    bookId: storeBookId,
    chapterIndex: storeChapterIndex,
    setBookId,
    setChapter,
    setChapterIndex,
    setVocabularySet,
    setVocabularies,
    setCurrentSegmentIndex,
    setAllHighlights,
    setAllChapterList,
    pendingChapterIndex,
    pendingScrollTarget,
    clearPendingChapter,
    isSidebarOpen,
    resetReader,
  } = useReaderStore();

  // 1. 初始化：重置 Store 并设置 ID
  useEffect(() => {
    resetReader();
    if (bookId) {
      setBookId(bookId);
    }
    return () => {
      resetReader();
    };
  }, [bookId, resetReader, setBookId]);

  // 2. Query: 获取章节目录（TOC）- 优先获取，用于确定有效索引
  const { data: chapterList, isLoading: isTocLoading } = useQuery({
    queryKey: ['toc', bookId],
    queryFn: () => getChapterList(bookId!),
    enabled: !!bookId,
    retry: false,
  });

  // 3. Query: 获取书籍详情
  const { data: bookDetail } = useQuery({
    queryKey: ['book-detail', bookId],
    queryFn: () => getBookDetail(bookId!),
    enabled: !!bookId,
    staleTime: Infinity,
  });

  // 4. Query: 获取阅读进度
  const { data: progressData, isLoading: isProgressLoading } = useQuery({
    queryKey: ['progress', bookId],
    queryFn: () => getReadingProgress(bookId!),
    enabled: !!bookId,
    retry: false,
  });

  const {
    data: chapterProgresses,
    isLoading: isChapterProgressLoading,
  } = useQuery({
    queryKey: ['chapter-progress', bookId],
    queryFn: () => getChapterProgresses(bookId!),
    enabled: !!bookId,
    retry: false,
  });

  const localStore = useMemo(
    () => (bookId ? loadReadingProgressStore(bookId) : null),
    [bookId]
  );
  const localProgress = localStore?.resume ?? null;

  const localProgressAsResponse = useMemo(
    () =>
      localProgress
        ? {
            current_chapter_index: localProgress.chapterIndex,
            current_segment_index: localProgress.segmentIndex,
            progress_percentage: localProgress.percentage * 100,
            book_id: bookId ?? '',
            updated_at: new Date(localProgress.timestamp).toISOString(),
          }
        : null,
    [localProgress, bookId]
  );

  const shouldPreferLocalProgress = useMemo(
    () => isLocalSnapshotNewer(localProgress, progressData),
    [localProgress, progressData]
  );

  const persistedProgress = useMemo(() => {
    if (shouldPreferLocalProgress && localProgressAsResponse) {
      return localProgressAsResponse;
    }

    if (progressData) {
      return progressData;
    }

    return localProgressAsResponse;
  }, [shouldPreferLocalProgress, localProgressAsResponse, progressData]);

  const chapterProgressByIndex = useMemo(() => {
    const serverByIndex = new Map(
      (chapterProgresses ?? []).map((progress) => [progress.chapter_index, progress])
    );
    const merged = new Map<number, ReadingProgressSnapshot | ChapterProgressResponse>();

    serverByIndex.forEach((progress, chapterIndex) => {
      merged.set(chapterIndex, progress);
    });

    Object.entries(localStore?.chapters ?? {}).forEach(([chapterIndex, localChapterProgress]) => {
      const parsedIndex = Number(chapterIndex);
      const serverChapterProgress = serverByIndex.get(parsedIndex);
      if (!serverChapterProgress || isLocalChapterSnapshotNewer(localChapterProgress, serverChapterProgress)) {
        merged.set(parsedIndex, localChapterProgress);
      }
    });

    return merged;
  }, [chapterProgresses, localStore]);

  const parsedQueryChapter = useMemo(
    () => parseChapterQuery(rawQueryChapter, chapterList?.map((chapter) => chapter.index) ?? []),
    [chapterList, rawQueryChapter]
  );

  // 进度数据变化时不需要额外处理，仅用于触发后续计算
  // 5. 确定初始章节索引（使用派生状态而非 effect + setState）
  const targetChapterIndex = useMemo(() => {
    if (!chapterList || chapterList.length === 0) return null;

    // 优先读取 URL Query 中的 chapter 参数
    if (parsedQueryChapter !== null) return parsedQueryChapter;

    // 检查进度中的章节索引是否在 TOC 中存在
    const progressIndex = persistedProgress?.current_chapter_index;
    const isValidProgressIndex =
      progressIndex !== undefined &&
      chapterList.some((ch) => ch.index === progressIndex);

    return isValidProgressIndex ? progressIndex : chapterList[0].index;
  }, [persistedProgress, chapterList, parsedQueryChapter]);

  const scopedChapterIndex = storeBookId === currentBookId ? storeChapterIndex : null;
  const scopedPendingChapterIndex = storeBookId === currentBookId ? pendingChapterIndex : null;
  const currentChapterIndex =
    explicitChapterIndex ??
    scopedPendingChapterIndex ??
    parsedQueryChapter ??
    scopedChapterIndex ??
    targetChapterIndex;

  const isExplicitChapterRequest =
    explicitChapterIndex !== null || scopedPendingChapterIndex !== null;
  const selectedChapterProgress =
    currentChapterIndex === null ? null : chapterProgressByIndex.get(currentChapterIndex) ?? null;

  // 6. Query: 获取章节内容（只有当 currentChapterIndex 不为 null 时才执行）
  const {
    data: chapterData,
    isLoading: isChapterLoading,
    error: chapterError,
    refetch: refetchChapter,
  } = useQuery({
    queryKey: ['chapter', bookId, currentChapterIndex],
    queryFn: () => getChapterContent(bookId!, currentChapterIndex!),
    enabled: !!bookId && currentChapterIndex !== null,
    staleTime: Infinity,
  });

  // 7. Query: 获取词汇收藏（完整数据，包含 ID 用于删除）
  const { data: vocabulariesData } = useQuery({
    queryKey: ['vocabularies-full', bookId],
    queryFn: () => getBookVocabularies(bookId!),
    enabled: !!bookId,
  });

  // 同时获取轻量的 base_forms 用于快速判断
  const { data: vocabBaseFormsData } = useQuery({
    queryKey: ['vocabularies-base-forms', bookId],
    queryFn: () => getVocabulariesBaseForms(bookId!),
    enabled: !!bookId,
  });

  // 获取整本书的高亮数据（用于高亮列表跨章节显示）
  const { data: allHighlightsData } = useQuery({
    queryKey: ['all-highlights', bookId],
    queryFn: () => getBookHighlights(bookId!),
    enabled: !!bookId,
  });

  // URL 章节和目录切换只读取该章节检查点；无明确章节时才使用书籍级恢复点。
  const initialPosition = useMemo(
    () => resolveInitialReaderPosition({
      targetChapterIndex,
      isExplicitChapterRequest: parsedQueryChapter !== null || isExplicitChapterRequest,
      selectedChapterProgress,
      persistedProgress,
    }),
    [
      isExplicitChapterRequest,
      parsedQueryChapter,
      persistedProgress,
      selectedChapterProgress,
      targetChapterIndex,
    ]
  );
  const initialPercentage = initialPosition.percentage;
  const initialSegmentIndex = initialPosition.segmentIndex;

  // 8. 同步数据到 Store
  useEffect(() => {
    if (chapterData && currentChapterIndex !== null) {
      // 先设置 chapterIndex，确保 setChapter 能正确过滤 allHighlights
      setChapterIndex(currentChapterIndex);
      setChapter(chapterData);
      setCurrentSegmentIndex(initialSegmentIndex);
    }
  }, [chapterData, currentChapterIndex, initialSegmentIndex, setChapter, setChapterIndex, setCurrentSegmentIndex]);

  useEffect(() => {
    if (vocabBaseFormsData) {
      setVocabularySet(vocabBaseFormsData.base_forms);
    }
  }, [vocabBaseFormsData, setVocabularySet]);

  useEffect(() => {
    if (vocabulariesData) {
      setVocabularies(vocabulariesData);
    }
  }, [vocabulariesData, setVocabularies]);

  // 同步整本书的高亮数据到 store
  useEffect(() => {
    if (allHighlightsData) {
      setAllHighlights(allHighlightsData);
    }
  }, [allHighlightsData, setAllHighlights]);

  // 同步章节列表到 store
  useEffect(() => {
    if (chapterList) {
      setAllChapterList(chapterList);
    }
  }, [chapterList, setAllChapterList]);

  // 章节切换完成后，滚动到目标位置
  useEffect(() => {
    if (!pendingScrollTarget || !chapterData) {
      return;
    }

    const scrollTimer = window.setTimeout(() => {
      const selector = `[data-segment-index="${pendingScrollTarget.segmentIndex}"][data-token-index="${pendingScrollTarget.tokenIndex}"]`;
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('ring-2', 'ring-indigo-500');
        window.setTimeout(() => {
          element.classList.remove('ring-2', 'ring-indigo-500');
        }, 2000);
      }

      clearPendingChapter();
    }, 300);

    return () => {
      window.clearTimeout(scrollTimer);
    };
  }, [pendingScrollTarget, chapterData, clearPendingChapter]);

  // 章节切换函数
  const handlePrevChapter = useCallback(() => {
    if (!chapterList || currentChapterIndex === null) return;

    // 找到当前章节在 TOC 中的位置
    const currentIndex = chapterList.findIndex((ch) => ch.index === currentChapterIndex);
    if (currentIndex > 0) {
      const nextIndex = chapterList[currentIndex - 1].index;
      setExplicitChapterRequest({ bookId: currentBookId, index: nextIndex });
      setCurrentSegmentIndex(0);
      setChapterIndex(nextIndex);
    }
  }, [chapterList, currentBookId, currentChapterIndex, setCurrentSegmentIndex, setChapterIndex]);

  const handleNextChapter = useCallback(() => {
    if (!chapterList || currentChapterIndex === null) return;

    // 找到当前章节在 TOC 中的位置
    const currentIndex = chapterList.findIndex((ch) => ch.index === currentChapterIndex);
    if (currentIndex >= 0 && currentIndex < chapterList.length - 1) {
      const nextIndex = chapterList[currentIndex + 1].index;
      setExplicitChapterRequest({ bookId: currentBookId, index: nextIndex });
      setCurrentSegmentIndex(0);
      setChapterIndex(nextIndex);
    }
  }, [chapterList, currentBookId, currentChapterIndex, setCurrentSegmentIndex, setChapterIndex]);

  // 章节选择处理 - 移到所有条件返回之前
  const handleChapterSelect = useCallback((index: number) => {
    setExplicitChapterRequest({ bookId: currentBookId, index });
    setCurrentSegmentIndex(0);
    setChapterIndex(index);
  }, [currentBookId, setCurrentSegmentIndex, setChapterIndex]);

  // 判断是否有上一章/下一章
  const hasPrevChapter =
    chapterList && currentChapterIndex !== null
      ? chapterList.findIndex((ch) => ch.index === currentChapterIndex) > 0
      : false;
  const hasNextChapter =
    chapterList && currentChapterIndex !== null
      ? chapterList.findIndex((ch) => ch.index === currentChapterIndex) <
        chapterList.length - 1
      : false;

  // 获取当前章节信息
  const currentChapterInfo = chapterList?.find((ch) => ch.index === currentChapterIndex);

  // --- 渲染状态处理 ---

  // 加载中
  if (isTocLoading || isProgressLoading || isChapterProgressLoading) {
    return (
      <div className={clsx('flex min-h-[100dvh] w-full items-center justify-center', themeStyles[resolvedTheme])}>
        <div className="flex flex-col items-center gap-4 text-gray-500 dark:text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>加载阅读器...</p>
        </div>
      </div>
    );
  }

  // 没有章节
  if (chapterList && chapterList.length === 0) {
    return (
      <div className={clsx('flex min-h-[100dvh] w-full flex-col items-center justify-center px-4', themeStyles[resolvedTheme])}>
        <div className="flex flex-col items-center gap-4 text-orange-500">
          <AlertCircle className="h-12 w-12" />
          <p className="text-lg font-medium">没有可用的章节</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md text-center">
            这本书尚未解析出任何章节。请返回书架删除后重新上传，或联系管理员。
          </p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="mt-6 flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
        >
          <Home size={16} />
          返回书架
        </button>
      </div>
    );
  }

  // 章节加载中
  if (isChapterLoading) {
    return (
      <div className={clsx('flex min-h-[100dvh] w-full items-center justify-center', themeStyles[resolvedTheme])}>
        <div className="flex flex-col items-center gap-4 text-gray-500 dark:text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>加载章节内容...</p>
          {currentChapterInfo && (
            <p className="text-sm text-gray-400 dark:text-gray-500">{currentChapterInfo.title}</p>
          )}
        </div>
      </div>
    );
  }

  // 书籍状态检查
  if (bookDetail && bookDetail.status !== ProcessingStatus.COMPLETED) {
    const statusMessages: Record<string, string> = {
      [ProcessingStatus.PENDING]: '等待解析...',
      [ProcessingStatus.PROCESSING]: '正在解析中...',
      [ProcessingStatus.FAILED]: bookDetail.error_message || '解析失败',
    };

    return (
      <div className={clsx('flex min-h-[100dvh] w-full flex-col items-center justify-center px-4', themeStyles[resolvedTheme])}>
        <div className="flex flex-col items-center gap-4 text-gray-500 dark:text-gray-400">
          <AlertCircle className="h-10 w-10" />
          <p>书籍尚未就绪</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            {statusMessages[bookDetail.status] || bookDetail.status}
          </p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
        >
          返回书架
        </button>
      </div>
    );
  }

  // 错误状态
  if (chapterError) {
    const errorMsg = (chapterError as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '未知错误';

    return (
      <div className={clsx('flex min-h-[100dvh] w-full flex-col items-center justify-center px-4', themeStyles[resolvedTheme])}>
        <div className="flex flex-col items-center gap-4 text-red-500">
          <AlertCircle className="h-12 w-12" />
          <p className="text-lg font-medium">章节加载失败</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center max-w-md">
            {currentChapterIndex !== null
              ? `第 ${currentChapterIndex + 1} 章加载失败: ${errorMsg}`
              : '无法加载章节内容'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            可用章节索引: {chapterList?.map((ch) => ch.index).join(', ') || '无'}
          </p>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={() => refetchChapter()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center gap-2"
          >
            <RefreshCw size={16} />
            重试
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium"
          >
            <Home size={16} />
            返回书架
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'flex min-h-[100dvh] h-[100dvh] w-full overflow-hidden transition-colors duration-300',
        themeStyles[resolvedTheme],
        `theme-${resolvedTheme}`,
        resolvedTheme === 'dark' && 'dark'
      )}
      style={{
        '--reader-font-size': `${fontSize}px`,
        '--reader-line-height': String(lineHeight),
        '--reader-font-family': fontFamily,
      } as React.CSSProperties}
    >
      {/* 左侧 Dock */}
      <LeftDock onToggleToc={() => setIsTocOpen(!isTocOpen)} />

      {/* 中间阅读区 */}
      <main className={clsx(
        'flex-1 relative h-full flex flex-col min-w-0 transition-all duration-300',
        themeStyles[resolvedTheme],
        isSidebarOpen && 'md:mr-80'
      )}>
        <div
          ref={scrollContainerRef}
          className={clsx(
            'h-full w-full overflow-y-auto scroll-smooth',
            `furigana-mode-${furiganaMode}`,
            `theme-${resolvedTheme}`
          )}
        >
          <ContentCanvas
            key={currentChapterIndex ?? 'default'}
            scrollContainerRef={scrollContainerRef}
            onPrevChapter={handlePrevChapter}
            onNextChapter={handleNextChapter}
            hasPrevChapter={hasPrevChapter}
            hasNextChapter={hasNextChapter}
            initialPercentage={initialPercentage}
            isChapterSwitch={false}
            onToggleToc={() => setIsTocOpen(!isTocOpen)}
            onToggleSettings={() => {
              // 触发 LeftDock 中的设置面板切换
              const event = new CustomEvent('toggle-reader-settings');
              window.dispatchEvent(event);
            }}
          />
        </div>

        {/* 悬浮组件层 */}
        <SelectionMenu />
        <TokenPopover />
      </main>

      {/* TOC 模态框 */}
      {chapterList && (
        <TocModal
          isOpen={isTocOpen}
          onClose={() => setIsTocOpen(false)}
          chapters={chapterList}
          currentIndex={currentChapterIndex}
          onChapterSelect={handleChapterSelect}
        />
      )}

      {/* 侧边栏 */}
      <ReaderSidebar key={isSidebarOpen ? 'reader-sidebar-open' : 'reader-sidebar-closed'} />

      {/* 移动端引导（仅首次显示） */}
      <MobileGuide />
    </div>
  );
};
