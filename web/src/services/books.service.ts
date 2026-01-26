/**
 * 书籍相关 API 服务
 */

import apiClient from './api-client';
import type {
  BookDetail,
  BookListItem,
  BookUpdate,
  ChapterListItem,
  ChapterResponse,
  VocabularyBaseFormsResponse,
  UserProgressResponse,
  UserProgressUpdate,
  HighlightResponse,
} from '@/types';

/**
 * 上传 EPUB 书籍
 * @param file EPUB 文件
 * @returns 书籍详情
 */
export const uploadBook = async (file: File): Promise<BookDetail> => {
  const formData = new FormData();
  formData.append('file', file);

  return apiClient.post<BookDetail>('/books/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

/**
 * 获取书架列表
 * @param skip 跳过数量
 * @param limit 限制数量
 * @returns 书籍列表
 */
export const getBooks = async (skip = 0, limit = 100): Promise<BookListItem[]> => {
  return apiClient.get<BookListItem[]>('/books', {
    params: { skip, limit },
  });
};

/**
 * 获取书籍详情
 * @param bookId 书籍 ID
 * @returns 书籍详情
 */
export const getBookDetail = async (bookId: string): Promise<BookDetail> => {
  return apiClient.get<BookDetail>(`/books/${bookId}`);
};

/**
 * 修改书籍元数据
 * @param bookId 书籍 ID
 * @param data 更新数据
 * @returns 书籍详情
 */
export const updateBookMetadata = async (
  bookId: string,
  data: BookUpdate
): Promise<BookDetail> => {
  return apiClient.patch<BookDetail>(`/books/${bookId}`, data);
};

/**
 * 上传书籍封面
 * @param bookId 书籍 ID
 * @param file 图片文件
 * @returns 书籍详情
 */
export const uploadBookCover = async (bookId: string, file: File): Promise<BookDetail> => {
  const formData = new FormData();
  formData.append('file', file);

  return apiClient.post<BookDetail>(`/books/${bookId}/cover`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

/**
 * 删除书籍
 * @param bookId 书籍 ID
 * @returns 成功标识
 */
export const deleteBook = async (bookId: string): Promise<{ ok: boolean }> => {
  return apiClient.delete<{ ok: boolean }>(`/books/${bookId}`);
};

/**
 * 获取书籍章节目录（不含正文）
 * @param bookId 书籍 ID
 * @returns 章节列表
 */
export const getChapterList = async (bookId: string): Promise<ChapterListItem[]> => {
  return apiClient.get<ChapterListItem[]>(`/books/${bookId}/toc`);
};

/**
 * 获取章节内容（含分词 + 划线）
 * @param bookId 书籍 ID
 * @param chapterIndex 章节索引
 * @returns 章节内容
 */
export const getChapterContent = async (
  bookId: string,
  chapterIndex: number
): Promise<ChapterResponse> => {
  return apiClient.get<ChapterResponse>(
    `/books/${bookId}/chapters/${chapterIndex}`
  );
};

/**
 * 获取生词原型集合（轻量，用于渲染高亮）
 * @param bookId 书籍 ID
 * @returns 生词原型集合
 */
export const getVocabulariesBaseForms = async (
  bookId: string
): Promise<VocabularyBaseFormsResponse> => {
  return apiClient.get<VocabularyBaseFormsResponse>(
    `/books/${bookId}/vocabularies/base_forms`
  );
};

/**
 * 获取阅读进度
 * @param bookId 书籍 ID
 * @returns 阅读进度
 */
export const getReadingProgress = async (bookId: string): Promise<UserProgressResponse> => {
  return apiClient.get<UserProgressResponse>(`/books/${bookId}/progress`);
};

/**
 * 更新阅读进度
 * @param bookId 书籍 ID
 * @param data 进度数据
 * @returns 更新后的进度
 */
export const updateReadingProgress = async (
  bookId: string,
  data: UserProgressUpdate
): Promise<UserProgressResponse> => {
  return apiClient.put<UserProgressResponse>(`/books/${bookId}/progress`, data);
};

/**
 * 获取书籍划线列表
 * @param bookId 书籍 ID
 * @param chapterIndex 可选，筛选指定章节的划线
 * @returns 划线列表
 */
export const getBookHighlights = async (
  bookId: string,
  chapterIndex?: number
): Promise<HighlightResponse[]> => {
  return apiClient.get<HighlightResponse[]>(`/books/${bookId}/highlights`, {
    params: chapterIndex !== undefined ? { chapter_index: chapterIndex } : undefined,
  });
};
