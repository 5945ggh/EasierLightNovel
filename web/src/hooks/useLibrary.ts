/**
 * 书架管理 Hook
 * 封装书籍列表查询、上传、删除等操作
 * 支持自动轮询处理中的书籍
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBooks, uploadBook, deleteBook, updateBookMetadata, uploadBookCover } from '@/services/books.service';
import { ProcessingStatus } from '@/types/common';
import type { BookDetail, BookUpdate } from '@/types/book';

export const useLibrary = () => {
  const queryClient = useQueryClient();

  // 1. 获取书籍列表
  const booksQuery = useQuery({
    queryKey: ['books'],
    queryFn: () => getBooks(0, 100),
    // 智能轮询：如果列表中有任何书籍处于处理中状态，每 2 秒刷新一次
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const isProcessing = data.some((book) =>
        book.status === ProcessingStatus.PENDING ||
        book.status === ProcessingStatus.PROCESSING
      );
      return isProcessing ? 2000 : false;
    },
    // 添加重试配置，失败时不会无限重试
    retry: 1,
    // 数据默认保持 5 分钟新鲜
    staleTime: 5 * 60 * 1000,
  });

  // 2. 上传书籍 Mutation
  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadBook(file),
    onSuccess: () => {
      // 上传成功后立即刷新列表，并取消轮询等待下一次自然触发
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });

  // 3. 删除书籍 Mutation
  const deleteMutation = useMutation({
    mutationFn: (bookId: string) => deleteBook(bookId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });

  // 4. 更新书籍元数据 Mutation
  const updateMetadataMutation = useMutation({
    mutationFn: ({ bookId, data }: { bookId: string; data: BookUpdate }) =>
      updateBookMetadata(bookId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });

  // 5. 上传封面 Mutation
  const uploadCoverMutation = useMutation({
    mutationFn: ({ bookId, file }: { bookId: string; file: File }) =>
      uploadBookCover(bookId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });

  return {
    books: booksQuery.data ?? [],
    isLoading: booksQuery.isLoading,
    isError: booksQuery.isError,
    error: booksQuery.error,
    uploadBook: uploadMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
    deleteBook: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    updateBookMetadata: updateMetadataMutation.mutateAsync,
    isUpdating: updateMetadataMutation.isPending,
    uploadBookCover: uploadCoverMutation.mutateAsync,
    isUploadingCover: uploadCoverMutation.isPending,
  };
};
