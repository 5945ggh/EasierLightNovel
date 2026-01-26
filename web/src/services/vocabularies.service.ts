/**
 * 生词本相关 API 服务
 */

import apiClient from './api-client';
import type {
  VocabularyCreate,
  VocabularyResponse,
  VocabularyBaseFormsResponse,
} from '@/types';

/**
 * 添加生词到生词本
 * @param data 生词数据
 * @returns 生词响应
 */
export const addVocabulary = async (data: VocabularyCreate): Promise<VocabularyResponse> => {
  return apiClient.post<VocabularyResponse>('/vocabularies', data);
};

/**
 * 获取书籍的生词列表（完整数据）
 * @param bookId 书籍 ID
 * @returns 生词列表
 */
export const getBookVocabularies = async (bookId: string): Promise<VocabularyResponse[]> => {
  return apiClient.get<VocabularyResponse[]>(`/vocabularies/book/${bookId}`);
};

/**
 * 获取单个生词记录
 * @param vocabularyId 生词记录 ID
 * @returns 生词响应
 */
export const getVocabulary = async (vocabularyId: number): Promise<VocabularyResponse> => {
  return apiClient.get<VocabularyResponse>(`/vocabularies/${vocabularyId}`);
};

/**
 * 删除生词
 * @param vocabularyId 生词记录 ID
 * @returns 成功标识
 */
export const deleteVocabulary = async (vocabularyId: number): Promise<{ ok: boolean }> => {
  return apiClient.delete<{ ok: boolean }>(`/vocabularies/${vocabularyId}`);
};
