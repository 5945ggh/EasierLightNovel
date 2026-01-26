/**
 * 划线相关 API 服务
 */

import apiClient from './api-client';
import type { HighlightCreate, HighlightResponse } from '@/types';

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
