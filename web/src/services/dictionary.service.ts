/**
 * 词典相关 API 服务
 */

import apiClient from './api-client';
import type { DictResult } from '@/types';

/**
 * 查询日语词典
 * @param query 查询词
 * @returns 字典查询结果
 */
export const searchDictionary = async (query: string): Promise<DictResult> => {
  return apiClient.get<DictResult>('/dictionary/search', {
    params: { query },
  });
};
