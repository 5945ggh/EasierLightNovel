/**
 * AI 服务
 *
 * 调用后端 API 进行日语文本分析
 */

import apiClient from './api-client';
import { JLPTLevel } from '@/types';
import type {
  AIAnalysisRequest,
  AIAnalysisResult,
  GrammarPoint,
} from '@/types';

/**
 * Mock 开关 - 强制使用 Mock 模式（开发调试用）
 */
const FORCE_MOCK_MODE = false;

/**
 * Mock 延迟时间 (ms)
 */
const MOCK_DELAY = 1000;

/**
 * Mock 语法点数据
 */
const MOCK_GRAMMAR_POINTS: Record<string, { explain: string; level: JLPTLevel }> = {
  '〜ている': { explain: '表示动作的持续或结果的状态。', level: JLPTLevel.N5 },
  '〜てある': { explain: '表示某人为了某种目的而做完某事，其结果的状态仍然保留。', level: JLPTLevel.N4 },
  '〜ておく': { explain: '表示为了将来做准备而预先做某事。', level: JLPTLevel.N4 },
  '〜てしまう': { explain: '表示动作的彻底完成或表示遗憾、无可挽回的心情。', level: JLPTLevel.N4 },
  '〜てくる': { explain: '表示动作由远及近，或状态开始并持续。', level: JLPTLevel.N5 },
  '〜ていく': { explain: '表示动作由近及远，或状态继续下去。', level: JLPTLevel.N5 },
  '〜たり〜たり': { explain: '表示列举动作或状态，例："有时做...有时做..."。', level: JLPTLevel.N5 },
  '〜ばかり': { explain: '表示刚刚做完某事，或总是做某事。', level: JLPTLevel.N3 },
};

/**
 * Mock 翻译
 */
function mockTranslate(text: string): string {
  if (text.includes('食べ')) return '吃 / 食用';
  if (text.includes('行')) return '去 / 走';
  if (text.includes('来')) return '来 / 到来';
  if (text.includes('見')) return '看 / 见';
  if (text.includes('聞')) return '听 / 询问';
  return `[Mock 翻译] "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}"`;
}

/**
 * Mock 语法点提取
 */
function mockExtractGrammarPoints(text: string): GrammarPoint[] {
  const points: GrammarPoint[] = [];

  for (const [key, data] of Object.entries(MOCK_GRAMMAR_POINTS)) {
    if (text.includes(key.replace('〜', '')) || text.includes(key.replace('〜', 'て'))) {
      points.push({
        target_text: text,
        pattern: key,
        level: data.level,
        explanation: data.explain,
      });
    }
  }

  if (points.length === 0) {
    points.push({
      target_text: text,
      pattern: 'Mock 提示',
      explanation: '当前为 Mock 模式，真实 AI 分析功能待接入。',
    });
  }

  return points.slice(0, 3);
}

/**
 * Mock AI 分析
 */
async function mockAnalyze(req: AIAnalysisRequest): Promise<AIAnalysisResult> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY));

  return {
    translation: mockTranslate(req.target_text),
    grammar_analysis: mockExtractGrammarPoints(req.target_text),
    vocabulary_nuance: [],
    cultural_notes: undefined,
  };
}

/**
 * 调用 AI 分析接口
 * @param req 分析请求
 * @returns 分析结果
 */
export const analyzeAI = async (
  req: AIAnalysisRequest
): Promise<AIAnalysisResult> => {
  if (FORCE_MOCK_MODE) {
    return mockAnalyze(req);
  }

  try {
    return await apiClient.post<AIAnalysisResult>('/ai/analyze', req);
  } catch (error) {
    console.warn('AI API 调用失败，回退到 Mock 模式:', error);
    return mockAnalyze(req);
  }
};

/**
 * 检查是否为 Mock 模式
 */
export const isMockMode = (): boolean => FORCE_MOCK_MODE;
