/**
 * 书籍主页 / 阅读工作台
 * 承载书籍元数据、阅读进度、完整章节目录、继续阅读主按钮以及学习地图入口
 */

import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BookOpen,
  Map as MapIcon,
  Edit,
  Trash2,
  Loader2,
  AlertCircle,
  Clock,
  ImageOff,
  BrainCircuit,
  ChevronRight,
  Sparkles,
  BarChart3,
  BookmarkCheck,
} from 'lucide-react';
import clsx from 'clsx';

// Services
import {
  getBookDetail,
  getChapterList,
  getReadingProgress,
  getChapterProgresses,
  deleteBook,
  updateBookMetadata,
  uploadBookCover,
} from '@/services/books.service';
import {
  clearReadingProgressSnapshot,
  isLocalChapterSnapshotNewer,
  isLocalSnapshotNewer,
  loadReadingProgressStore,
} from '@/utils/readingProgress';
import { ProcessingStatus } from '@/types/common';
import type { ChapterProgressResponse } from '@/types/progress';
import type { ReadingProgressSnapshot } from '@/utils/readingProgress';

// Components
import { EditBookModal } from '@/components/library/EditBookModal';
import { ConfirmModal } from '@/components/common/ConfirmModal';

export const BookHomePage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [imgError, setImgError] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // 1. 书籍详情
  const {
    data: book,
    isLoading: isBookLoading,
    isError: isBookError,
    error: bookError,
    refetch: refetchBook,
  } = useQuery({
    queryKey: ['book-detail', bookId],
    queryFn: () => getBookDetail(bookId!),
    enabled: !!bookId,
  });

  // 2. 章节目录 (TOC)
  const {
    data: chapterList,
    isLoading: isTocLoading,
    isError: isTocError,
    error: tocError,
  } = useQuery({
    queryKey: ['toc', bookId],
    queryFn: () => getChapterList(bookId!),
    enabled: !!bookId && book?.status === ProcessingStatus.COMPLETED,
  });

  // 3. 服务端阅读进度
  const {
    data: serverProgress,
    isLoading: isProgressLoading,
    isError: isProgressError,
    error: progressError,
  } = useQuery({
    queryKey: ['progress', bookId],
    queryFn: () => getReadingProgress(bookId!),
    enabled: !!bookId && book?.status === ProcessingStatus.COMPLETED,
    retry: false,
  });

  // 4. 已保存的章节检查点（只返回轻量位置数据）
  const {
    data: chapterProgresses,
    isLoading: isChapterProgressLoading,
    isError: isChapterProgressError,
    error: chapterProgressError,
  } = useQuery({
    queryKey: ['chapter-progress', bookId],
    queryFn: () => getChapterProgresses(bookId!),
    enabled: !!bookId && book?.status === ProcessingStatus.COMPLETED,
    retry: false,
  });

  // 读取本地进度 Snapshot 并对比优先级
  const localStore = useMemo(
    () => (bookId ? loadReadingProgressStore(bookId) : null),
    [bookId]
  );
  const localSnapshot = localStore?.resume ?? null;

  const chapterProgressByIndex = useMemo(() => {
    const serverByIndex = new Map(chapterProgresses?.map((progress) => [progress.chapter_index, progress]));
    const merged = new Map<number, ReadingProgressSnapshot | ChapterProgressResponse>();

    serverByIndex.forEach((progress, chapterIndex) => {
      merged.set(chapterIndex, progress);
    });

    Object.entries(localStore?.chapters ?? {}).forEach(([chapterIndex, localProgress]) => {
      const parsedIndex = Number(chapterIndex);
      const serverProgress = serverByIndex.get(parsedIndex);
      if (!serverProgress || isLocalChapterSnapshotNewer(localProgress, serverProgress)) {
        merged.set(parsedIndex, localProgress);
      }
    });

    return merged;
  }, [chapterProgresses, localStore]);

  const activeProgress = useMemo(() => {
    const preferLocal = isLocalSnapshotNewer(localSnapshot, serverProgress);

    if (preferLocal && localSnapshot) {
      return {
        chapter_index: localSnapshot.chapterIndex,
        segment_index: localSnapshot.segmentIndex,
        percentage: localSnapshot.percentage * 100,
        updated_at: new Date(localSnapshot.timestamp).toLocaleString('zh-CN'),
        isLocal: true,
      };
    }

    if (serverProgress) {
      return {
        chapter_index: serverProgress.current_chapter_index,
        segment_index: serverProgress.current_segment_index,
        percentage: serverProgress.progress_percentage ?? 0,
        updated_at: serverProgress.updated_at
          ? new Date(serverProgress.updated_at).toLocaleString('zh-CN')
          : null,
        isLocal: false,
      };
    }

    return null;
  }, [localSnapshot, serverProgress]);

  // 算法：计算总体阅读进度 (基于章节数组中的真实位置)
  const progressStats = useMemo(() => {
    if (!chapterList || chapterList.length === 0 || !activeProgress) {
      return {
        currentChapter: null,
        currentTocIndex: -1,
        inChapterPercentage: 0,
        overallPercentage: 0,
        hasProgress: false,
      };
    }

    const currentTocIndex = chapterList.findIndex(
      (ch) => ch.index === activeProgress.chapter_index
    );

    if (currentTocIndex === -1) {
      return {
        currentChapter: chapterList[0] ?? null,
        currentTocIndex: 0,
        inChapterPercentage: 0,
        overallPercentage: 0,
        hasProgress: false,
      };
    }

    const currentChapter = chapterList[currentTocIndex];
    const inChapterPercentage = Math.max(0, Math.min(100, activeProgress.percentage));

    // 总体进度 = (当前章节在目录中的位置 + 当前章节百分比 / 100) / 章节总数 * 100
    const rawOverall = ((currentTocIndex + inChapterPercentage / 100) / chapterList.length) * 100;
    const overallPercentage = Math.min(100, Math.max(0, Math.round(rawOverall * 10) / 10));

    const hasMeaningfulProgress =
      currentTocIndex > 0 ||
      activeProgress.segment_index > 0 ||
      inChapterPercentage > 0;

    return {
      currentChapter,
      currentTocIndex,
      inChapterPercentage: Math.round(inChapterPercentage * 10) / 10,
      overallPercentage,
      hasProgress: hasMeaningfulProgress,
    };
  }, [chapterList, activeProgress]);

  // 处理确认删除书籍
  const handleConfirmDelete = async () => {
    if (!bookId) return;
    setDeleteError(null);
    try {
      setIsDeleting(true);
      await deleteBook(bookId);
      clearReadingProgressSnapshot(bookId);
      setIsConfirmDeleteOpen(false);
      navigate('/');
    } catch (err) {
      console.error('Failed to delete book:', err);
      setDeleteError('删除失败，请检查连接后重试。');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenDeleteModal = () => {
    setDeleteError(null);
    setIsConfirmDeleteOpen(true);
  };

  const handleCloseDeleteModal = () => {
    setDeleteError(null);
    setIsConfirmDeleteOpen(false);
  };

  // 处理保存元数据
  const handleSaveMetadata = async (data: { title: string; author: string; coverFile?: File }) => {
    if (!bookId) return;
    try {
      setIsUpdating(true);
      if (data.coverFile) {
        await uploadBookCover(bookId, data.coverFile);
      }
      await updateBookMetadata(bookId, { title: data.title, author: data.author });
      await queryClient.invalidateQueries({ queryKey: ['book-detail', bookId] });
      setIsEditModalOpen(false);
    } catch (err) {
      console.error('Failed to update book:', err);
      alert('保存失败，请重试');
      throw err;
    } finally {
      setIsUpdating(false);
    }
  };

  // --- 各种异常/加载状态 ---

  if (!bookId) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
        <AlertCircle size={40} className="text-red-500 mb-2" strokeWidth={1.5} />
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">缺少书籍 ID</h2>
        <Link to="/" className="mt-4 text-sm text-slate-blue-600 dark:text-slate-blue-400 hover:underline">
          返回书架
        </Link>
      </div>
    );
  }

  const isLoading = isBookLoading || isTocLoading || isProgressLoading || isChapterProgressLoading;

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
        <Loader2 size={36} className="animate-spin text-slate-blue-600 dark:text-slate-blue-400 mb-3" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">正在载入书籍工作台...</p>
      </div>
    );
  }

  if (isBookError || !book) {
    const errorMsg = (bookError as { message?: string })?.message || '书籍不存在或已被删除';
    return (
      <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
        <AlertCircle size={48} className="text-red-500 mb-3" strokeWidth={1.5} />
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">无法获取书籍信息</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6">{errorMsg}</p>
        <div className="flex gap-3">
          <button
            onClick={() => refetchBook()}
            className="px-4 py-2 bg-slate-blue-600 text-white text-sm font-medium rounded-xl hover:bg-slate-blue-700 transition-colors"
          >
            重试
          </button>
          <Link
            to="/"
            className="px-4 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm font-medium rounded-xl hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            返回书架
          </Link>
        </div>
      </div>
    );
  }

  if (isTocError || isProgressError || isChapterProgressError) {
    const requestError = tocError || progressError || chapterProgressError;
    const errorMsg =
      (requestError as { message?: string })?.message ||
      '目录或阅读进度暂时无法加载，请重试。';

    return (
      <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
        <AlertCircle size={48} className="text-red-500 mb-3" strokeWidth={1.5} />
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">书籍工作台加载失败</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6">{errorMsg}</p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              if (isTocError) void queryClient.invalidateQueries({ queryKey: ['toc', bookId] });
              if (isProgressError) void queryClient.invalidateQueries({ queryKey: ['progress', bookId] });
              if (isChapterProgressError) {
                void queryClient.invalidateQueries({ queryKey: ['chapter-progress', bookId] });
              }
            }}
            className="px-4 py-2 bg-slate-blue-600 text-white text-sm font-medium rounded-xl hover:bg-slate-blue-700 transition-colors"
          >
            重试
          </button>
          <Link
            to="/"
            className="px-4 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm font-medium rounded-xl hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            返回书架
          </Link>
        </div>
      </div>
    );
  }

  // 处理解析中与解析失败状态
  if (book.status !== ProcessingStatus.COMPLETED) {
    const isProcessing = book.status === ProcessingStatus.PROCESSING || book.status === ProcessingStatus.PENDING;
    const isFailed = book.status === ProcessingStatus.FAILED;

    return (
      <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
        {/* 确认删除 Modal */}
        <ConfirmModal
          isOpen={isConfirmDeleteOpen}
          title="确认删除书籍？"
          message="确定要删除这本书吗？相应的阅读记录和生词本数据也将同步清除。"
          confirmText="彻底删除"
          cancelText="取消"
          isDanger={true}
          isLoading={isDeleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onClose={handleCloseDeleteModal}
        />

        <header className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <Link to="/" className="flex items-center text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
              <ArrowLeft size={18} strokeWidth={1.5} className="mr-1.5" />
              返回书架
            </Link>
            <span className="text-xs text-slate-400 dark:text-slate-500">书籍 ID: {book.id.slice(0, 8)}</span>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-12 text-center">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col items-center">
            {/* 封面 preview */}
            <div className="w-32 aspect-[2/3] bg-gray-100 rounded-lg overflow-hidden shadow-inner mb-6 relative">
              {book.cover_url && !imgError ? (
                <img
                  src={book.cover_url}
                  alt={book.title}
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300">
                  <BookOpen size={36} />
                </div>
              )}
            </div>

            <h1 className="text-xl font-bold text-gray-800 mb-1">{book.title}</h1>
            <p className="text-sm text-gray-500 mb-6">{book.author || '佚名'}</p>

            {isProcessing && (
              <div className="w-full max-w-sm bg-blue-50 border border-blue-100 rounded-xl p-4 flex flex-col items-center">
                <Loader2 size={28} className="animate-spin text-blue-600 mb-2" />
                <p className="text-sm font-semibold text-blue-900">书籍正在解析中...</p>
                <p className="text-xs text-blue-700 mt-1">
                  {book.pdf_progress_stage
                    ? `解析阶段: ${book.pdf_progress_stage} (${book.pdf_progress_current ?? 0}/${book.pdf_progress_total ?? 0})`
                    : '解析完成后即可进入阅读工作台。'}
                </p>
              </div>
            )}

            {isFailed && (
              <div className="w-full max-w-md bg-red-50 border border-red-100 rounded-xl p-4 flex flex-col items-center text-left">
                <div className="flex items-center gap-2 text-red-700 font-semibold text-sm mb-1">
                  <AlertCircle size={18} />
                  <span>解析失败</span>
                </div>
                <p className="text-xs text-red-600 leading-relaxed mb-4">
                  {book.error_message || '文件格式不支持或内容损坏，请重新上传。'}
                </p>
                <button
                  onClick={handleOpenDeleteModal}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  <Trash2 size={13} />
                  <span>删除此书</span>
                </button>
              </div>
            )}

            <div className="mt-8">
              <Link
                to="/"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                <ArrowLeft size={16} />
                <span>返回书架</span>
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const toc = chapterList ?? [];

  return (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-x-hidden transition-colors">
      {/* 确认删除 Modal */}
      <ConfirmModal
        isOpen={isConfirmDeleteOpen}
        title="确认删除书籍？"
        message="确定要删除这本书吗？相应的阅读记录和生词本数据也将同步清除。"
        confirmText="彻底删除"
        cancelText="取消"
        isDanger={true}
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={handleConfirmDelete}
        onClose={handleCloseDeleteModal}
      />

      {/* 顶部导航 */}
      <header className="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <Link
            to="/"
            className="flex items-center text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors shrink-0"
          >
            <ArrowLeft size={18} strokeWidth={1.5} className="mr-1.5" />
            <span>返回书架</span>
          </Link>

          <h1 className="text-sm sm:text-base font-semibold text-slate-800 dark:text-slate-100 truncate text-center flex-1 max-w-xl">
            {book.title}
          </h1>

          <div className="flex items-center gap-2 shrink-0">
            {/* 学习地图快捷入口 */}
            <Link
              to={`/study/map/${book.id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-blue-700 dark:text-slate-blue-300 bg-slate-blue-50 dark:bg-slate-800 hover:bg-slate-blue-100 dark:hover:bg-slate-700 rounded-xl transition-colors border border-slate-blue-100 dark:border-slate-700"
            >
              <MapIcon size={14} strokeWidth={1.5} className="text-slate-blue-600 dark:text-slate-blue-400" />
              <span className="hidden sm:inline">学习地图</span>
            </Link>

            {/* 编辑按钮 */}
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              title="编辑元数据"
              aria-label="编辑元数据"
            >
              <Edit size={16} strokeWidth={1.5} />
            </button>

            {/* 删除按钮 */}
            <button
              onClick={handleOpenDeleteModal}
              disabled={isDeleting}
              className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-xl transition-colors"
              title="删除书籍"
              aria-label="删除书籍"
            >
              <Trash2 size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      {/* 编辑元数据 Modal */}
      {isEditModalOpen && (
        <EditBookModal
          book={book}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSave={handleSaveMetadata}
          isSaving={isUpdating}
        />
      )}

      {/* 主体工作台内容 */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* 顶部 Hero 区域：书籍信息 + 阅读进度 */}
        <section className="bg-white rounded-2xl border border-gray-200/90 p-5 sm:p-7 shadow-sm">
          <div className="flex flex-col md:flex-row gap-6 items-start">
            {/* 左侧：封面 */}
            <div className="w-28 sm:w-36 aspect-[2/3] shrink-0 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl overflow-hidden shadow-md border border-gray-100 relative self-center md:self-start">
              {book.cover_url && !imgError ? (
                <img
                  src={book.cover_url}
                  alt={book.title}
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 p-2">
                  <ImageOff size={32} strokeWidth={1.5} />
                  <span className="text-[10px] text-gray-400 mt-1">无封面</span>
                </div>
              )}
            </div>

            {/* 右侧：信息与阅读进度 */}
            <div className="flex-1 min-w-0 w-full flex flex-col justify-between self-stretch">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="px-2 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 rounded-md border border-blue-100">
                    {toc.length > 0 ? `${toc.length} 章节` : 'EPUB/PDF'}
                  </span>
                  {progressStats.hasProgress && (
                    <span className="px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 rounded-md border border-emerald-100 flex items-center gap-1">
                      <BookmarkCheck size={12} />
                      <span>正在阅读</span>
                    </span>
                  )}
                </div>

                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 leading-snug line-clamp-2">
                  {book.title}
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                  作者: <span className="text-gray-700 font-medium">{book.author || '佚名'}</span>
                </p>
              </div>

              {/* 进度控制面板 */}
              <div className="mt-6 pt-5 border-t border-gray-100">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* 进度数值与进度条 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between mb-1.5 text-xs sm:text-sm">
                      <span className="font-semibold text-gray-800">
                        {progressStats.hasProgress
                          ? `上次读到：第 ${ (progressStats.currentChapter?.index ?? 0) + 1 } 章 · ${progressStats.currentChapter?.title || '未命名章节'}`
                          : '尚未开始阅读'}
                      </span>
                      <span className="font-bold text-blue-600 ml-2">
                        {progressStats.overallPercentage}%
                      </span>
                    </div>

                    {/* 总体进度条 */}
                    <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-500"
                        style={{ width: `${progressStats.overallPercentage}%` }}
                      />
                    </div>

                    {/* 进度详情 */}
                    <div className="flex items-center justify-between mt-2 text-[11px] text-gray-400">
                      <span>
                        {progressStats.hasProgress
                          ? `当前章节进度: ${progressStats.inChapterPercentage}%`
                          : '准备开启阅读体验'}
                      </span>
                      {activeProgress?.updated_at && (
                        <span className="flex items-center gap-1 text-gray-400">
                          <Clock size={11} />
                          {activeProgress.updated_at}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 主按钮: 继续阅读 / 开始阅读 */}
                  <div className="shrink-0">
                    <button
                      onClick={() => navigate(`/read/${book.id}`)}
                      className="w-full sm:w-auto min-w-[140px] px-6 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl transition-all shadow-md shadow-blue-500/20 hover:shadow-lg flex items-center justify-center gap-2 group cursor-pointer"
                    >
                      <BookOpen size={18} className="transition-transform group-hover:scale-110" />
                      <span>{progressStats.hasProgress ? '继续阅读' : '开始阅读'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 下方双栏布局：章节目录 + 学习工作台入口 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 左侧/中栏：章节目录 (8 cols) */}
          <section className="lg:col-span-8 bg-white rounded-2xl border border-gray-200/90 p-5 shadow-sm flex flex-col">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <BarChart3 size={18} className="text-blue-600" />
                <h2 className="text-base font-semibold text-gray-900">章节目录</h2>
                <span className="text-xs text-gray-400">({toc.length} 章)</span>
              </div>
              {progressStats.hasProgress && (
                <span className="text-xs text-gray-500">
                  当前处于第 {progressStats.currentTocIndex + 1} 章
                </span>
              )}
            </div>

            {toc.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">书籍尚未成功解析出章节</p>
              </div>
            ) : (
              <div className="max-h-[560px] overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
                {toc.map((ch, idx) => {
                  const isCurrent =
                    progressStats.hasProgress && activeProgress?.chapter_index === ch.index;
                  const checkpoint = chapterProgressByIndex.get(ch.index);
                  const checkpointPercentage = checkpoint
                    ? Math.round(Math.max(
                      0,
                      Math.min(
                        100,
                        'progress_percentage' in checkpoint
                          ? checkpoint.progress_percentage
                          : checkpoint.percentage * 100
                      )
                    ) * 10) / 10
                    : null;

                  return (
                    <button
                      key={ch.index}
                      onClick={() => navigate(`/read/${book.id}?chapter=${ch.index}`)}
                      className={clsx(
                        'w-full text-left px-3.5 py-2.5 rounded-xl text-sm transition-all flex items-center justify-between group border',
                        isCurrent
                          ? 'bg-blue-50/80 border-blue-200 text-blue-900 font-medium shadow-sm'
                          : 'bg-white hover:bg-gray-50/80 border-transparent hover:border-gray-200/60 text-gray-700'
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-2">
                        <span
                          className={clsx(
                            'text-xs tabular-nums font-semibold w-7 text-right shrink-0',
                            isCurrent ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'
                          )}
                        >
                          {idx + 1}.
                        </span>
                        <span className="truncate" title={ch.title}>
                          {ch.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isCurrent && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-600 text-white rounded-full">
                            当前 ({progressStats.inChapterPercentage}%)
                          </span>
                        )}
                        <span className={clsx(
                          'text-[10px] tabular-nums',
                          checkpointPercentage === null ? 'text-gray-400' : 'text-emerald-600'
                        )}>
                          {checkpointPercentage === null ? '未开始' : `${checkpointPercentage}%`}
                        </span>
                        <ChevronRight
                          size={15}
                          className={clsx(
                            'transition-transform group-hover:translate-x-0.5',
                            isCurrent ? 'text-blue-500' : 'text-gray-300 group-hover:text-gray-500'
                          )}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* 右侧：学习地图与学习中心入口 (4 cols) */}
          <aside className="lg:col-span-4 space-y-4">
            {/* 学习地图入口 */}
            <div className="bg-gradient-to-br from-indigo-50/70 to-blue-50/40 rounded-2xl border border-indigo-100 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2.5 text-indigo-900 font-semibold text-base mb-2">
                  <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-sm">
                    <MapIcon size={18} />
                  </div>
                  <span>书籍学习地图</span>
                </div>

                <p className="text-xs text-gray-600 leading-relaxed mb-4">
                  全书词汇难易度分布、已知/未知词分布与各章节推荐学习词汇。
                </p>

              </div>

              <Link
                to={`/study/map/${book.id}`}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl text-center transition-all shadow-sm flex items-center justify-center gap-1.5"
              >
                <Sparkles size={14} />
                <span>进入学习地图</span>
              </Link>
            </div>

            {/* 学习中心入口 */}
            <div className="bg-white rounded-2xl border border-gray-200/90 p-5 shadow-sm">
              <div className="flex items-center gap-2.5 text-gray-900 font-semibold text-sm mb-2">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <BrainCircuit size={18} />
                </div>
                <span>生词与复习</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed mb-4">
                查看整本书积累的生词本、复习笔记与全局学习统计。
              </p>
              <Link
                to="/study"
                className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold rounded-xl text-center transition-colors flex items-center justify-center gap-1"
              >
                <span>前往学习中心</span>
                <ChevronRight size={14} />
              </Link>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};
