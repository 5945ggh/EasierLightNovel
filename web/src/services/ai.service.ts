/**
 * AI 服务
 *
 * 调用后端 API 进行日语文本分析
 */

import apiClient from './api-client';
import type { AIAnalysisRequest, AIAnalysisResult } from '@/types';

/**
 * 调用 AI 分析接口
 * @param req 分析请求
 * @returns 分析结果
 */
export const analyzeAI = async (req: AIAnalysisRequest): Promise<AIAnalysisResult> => {
  return await apiClient.post<AIAnalysisResult>('/ai/analyze', req);
};
