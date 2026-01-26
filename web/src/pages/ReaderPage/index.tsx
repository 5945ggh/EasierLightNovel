/**
 * ReaderPage - 页面入口
 * 负责数据获取、状态编排和路由处理
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, Home, RefreshCw } from 'lucide-react';

// Services & Stores
import {
  getChapterContent,
  getVocabulariesBaseForms,
  getReadingProgress,
  getBookDetail,
  getChapterList,
} from '@/services/books.service';
import { useReaderStore } from '@/stores/readerStore';
import { ProcessingStatus } from '@/types/common';

// Components
import { ContentCanvas } from '@/components/reader/ContentCanvas';

export const ReaderPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  // 本地状态：当前章节索引（初始为 null，等待 TOC 或进度数据）
  const [currentChapterIndex, setCurrentChapterIndex] = useState<number | null>(null);

  // Store Actions
  const {
    setBookId,
    setChapter,
    setVocabularySet,
    setCurrentSegmentIndex,
    setSegmentOffset,
    resetReader,
  } = useReaderStore();

  // 1. 初始化：重置 Store 并设置 ID
  useEffect(() => {
    resetReader();
    if (bookId) {
      setBookId(bookId);
    }
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

  // 5. 确定初始章节索引
  useEffect(() => {
    if (!chapterList || chapterList.length === 0) return;

    // 检查进度中的章节索引是否在 TOC 中存在
    const progressIndex = progressData?.current_chapter_index;
    const isValidProgressIndex =
      progressIndex !== undefined &&
      chapterList.some((ch) => ch.index === progressIndex);

    if (isValidProgressIndex) {
      setCurrentChapterIndex(progressIndex!);
    } else {
      // 进度无效或不存在，使用 TOC 第一个章节
      setCurrentChapterIndex(chapterList[0].index);
    }
  }, [progressData, chapterList]);

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

  // 7. Query: 获取生词本
  const { data: vocabData } = useQuery({
    queryKey: ['vocabularies', bookId],
    queryFn: () => getVocabulariesBaseForms(bookId!),
    enabled: !!bookId,
  });

  // 8. 同步数据到 Store
  useEffect(() => {
    if (chapterData) {
      setChapter(chapterData);
      // 如果进度数据中的章节索引匹配，设置段落索引和偏移
      if (progressData?.current_chapter_index === currentChapterIndex) {
        setCurrentSegmentIndex(progressData.current_segment_index ?? 0);
        // current_segment_offset 从后端返回的是整数（0~10000），需要转换为百分比（0~1）
        const offset = progressData.current_segment_offset ?? 0;
        setSegmentOffset(offset / 10000);
      } else {
        setCurrentSegmentIndex(0);
        setSegmentOffset(0);
      }
    }
  }, [chapterData, progressData, currentChapterIndex, setChapter, setCurrentSegmentIndex, setSegmentOffset]);

  useEffect(() => {
    if (vocabData) {
      setVocabularySet(vocabData.base_forms);
    }
  }, [vocabData, setVocabularySet]);

  // 章节切换函数
  const handlePrevChapter = useCallback(() => {
    if (!chapterList || currentChapterIndex === null) return;

    // 找到当前章节在 TOC 中的位置
    const currentIndex = chapterList.findIndex((ch) => ch.index === currentChapterIndex);
    if (currentIndex > 0) {
      // 切换章节时重置为从顶部开始阅读
      setCurrentSegmentIndex(0);
      setSegmentOffset(0);
      setCurrentChapterIndex(chapterList[currentIndex - 1].index);
    }
  }, [chapterList, currentChapterIndex, setCurrentSegmentIndex, setSegmentOffset]);

  const handleNextChapter = useCallback(() => {
    if (!chapterList || currentChapterIndex === null) return;

    // 找到当前章节在 TOC 中的位置
    const currentIndex = chapterList.findIndex((ch) => ch.index === currentChapterIndex);
    if (currentIndex >= 0 && currentIndex < chapterList.length - 1) {
      // 切换章节时重置为从顶部开始阅读
      setCurrentSegmentIndex(0);
      setSegmentOffset(0);
      setCurrentChapterIndex(chapterList[currentIndex + 1].index);
    }
  }, [chapterList, currentChapterIndex, setCurrentSegmentIndex, setSegmentOffset]);

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
  if (isTocLoading || isProgressLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-stone-50">
        <div className="flex flex-col items-center gap-4 text-stone-500">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>加载阅读器...</p>
        </div>
      </div>
    );
  }

  // 没有章节
  if (chapterList && chapterList.length === 0) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-stone-50 px-4">
        <div className="flex flex-col items-center gap-4 text-orange-500">
          <AlertCircle className="h-12 w-12" />
          <p className="text-lg font-medium">没有可用的章节</p>
          <p className="text-sm text-gray-500 max-w-md text-center">
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
      <div className="flex h-screen w-full items-center justify-center bg-stone-50">
        <div className="flex flex-col items-center gap-4 text-stone-500">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>加载章节内容...</p>
          {currentChapterInfo && (
            <p className="text-sm text-gray-400">{currentChapterInfo.title}</p>
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
      <div className="flex h-screen w-full flex-col items-center justify-center bg-stone-50 px-4">
        <div className="flex flex-col items-center gap-4 text-gray-500">
          <AlertCircle className="h-10 w-10" />
          <p>书籍尚未就绪</p>
          <p className="text-sm text-gray-400">
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
    const errorMsg = (chapterError as any)?.response?.data?.detail || '未知错误';

    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-stone-50 px-4">
        <div className="flex flex-col items-center gap-4 text-red-500">
          <AlertCircle className="h-12 w-12" />
          <p className="text-lg font-medium">章节加载失败</p>
          <p className="text-sm text-gray-500 text-center max-w-md">
            {currentChapterIndex !== null
              ? `第 ${currentChapterIndex + 1} 章加载失败: ${errorMsg}`
              : '无法加载章节内容'}
          </p>
          <p className="text-xs text-gray-400">
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
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium"
          >
            <Home size={16} />
            返回书架
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* 主阅读画布 */}
      <ContentCanvas
        onPrevChapter={handlePrevChapter}
        onNextChapter={handleNextChapter}
        hasPrevChapter={hasPrevChapter}
        hasNextChapter={hasNextChapter}
      />
    </div>
  );
};
