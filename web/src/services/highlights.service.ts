/**
 * 划线相关 API 服务
 */

import apiClient from './api-client';
import type { HighlightCreate, HighlightResponse, AIAnalysisResult, ArchiveItemResponse } from '@/types';
import { getBooks } from './books.service';

/**
 * 创建划线
 * @param data 划线数据
 * @returns 划线响应
 */
export const createHighlight = async (data: HighlightCreate): Promise<HighlightResponse> => {
  return apiClient.post<HighlightResponse>('/highlights', data);
};

/**
 * 获取单个划线记录
 * @param highlightId 划线记录 ID
 * @returns 划线响应
 */
export const getHighlight = async (highlightId: number): Promise<HighlightResponse> => {
  return apiClient.get<HighlightResponse>(`/highlights/${highlightId}`);
};

/**
 * 删除划线
 * @param highlightId 划线记录 ID
 * @returns 成功标识
 */
export const deleteHighlight = async (highlightId: number): Promise<{ ok: boolean }> => {
  return apiClient.delete<{ ok: boolean }>(`/highlights/${highlightId}`);
};

/**
 * 保存 AI 分析到积累本
 * @param highlightId 划线记录 ID
 * @param data AI 分析结果
 * @returns 积累本条目
 */
export const saveAIAnalysis = async (highlightId: number, data: AIAnalysisResult): Promise<ArchiveItemResponse> => {
  return apiClient.put<ArchiveItemResponse>(`/highlights/${highlightId}/ai-analysis`, data);
};

/**
 * 获取划线对应的积累本条目
 * @param highlightId 划线记录 ID
 * @returns 积累本条目
 */
export const getArchiveItem = async (highlightId: number): Promise<ArchiveItemResponse> => {
  return apiClient.get<ArchiveItemResponse>(`/highlights/${highlightId}/archive`);
};

/**
 * 获取所有划线（前端聚合，跨书籍）
 * @returns 所有划线列表（带书名）
 */
export const getAllHighlights = async (): Promise<Array<HighlightResponse & { book_title: string }>> => {
  const books = await getBooks();
  const bookMap = new Map(books.map(b => [b.id, b.title]));

  const results = await Promise.allSettled(
    books.map(book => apiClient.get<HighlightResponse[]>(`/books/${book.id}/highlights`))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<HighlightResponse[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .map(h => ({ ...h, book_title: bookMap.get(h.book_id) || '未知书籍' }));
};
