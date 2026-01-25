/**
 * AI 服务 (Mock 实现)
 *
 * 注意：当前为 Mock 实现，预留真实 API 接口位置
 * 后续接入真实 API 时，只需将 USE_MOCK_AI 设为 false 即可
 */

import type { AnalyzeTextParams, TextAnalysisResult } from '@/types';

/**
 * Mock 模式存储 key
 */
const MOCK_MODE_KEY = '__USE_MOCK_AI__';

/**
 * 获取 Mock 模式状态
 */
const getMockMode = (): boolean => {
  return (globalThis as any)[MOCK_MODE_KEY] ?? true; // 默认 true
};

/**
 * Mock 延迟时间 (ms) - 模拟真实网络请求
 */
const MOCK_DELAY = 1500;

/**
 * Mock 语法点数据
 */
const MOCK_GRAMMAR_POINTS: Record<string, { explain: string; level: string }> = {
  '〜ている': { explain: '表示动作的持续或结果的状态。', level: 'N5' },
  '〜てある': { explain: '表示某人为了某种目的而做完某事，其结果的状态仍然保留。', level: 'N4' },
  '〜ておく': { explain: '表示为了将来做准备而预先做某事。', level: 'N4' },
  '〜てしまう': { explain: '表示动作的彻底完成或表示遗憾、无可挽回的心情。', level: 'N4' },
  '〜てくる': { explain: '表示动作由远及近，或状态开始并持续。', level: 'N5' },
  '〜ていく': { explain: '表示动作由近及远，或状态继续下去。', level: 'N5' },
  '〜たり〜たり': { explain: '表示列举动作或状态，例："有时做...有时做..."。', level: 'N5' },
  '〜ばかり': { explain: '表示刚刚做完某事，或总是做某事。', level: 'N3' },
  '〜ところ': { explain: '表示动作正在进行、刚完成、即将开始等时机。', level: 'N3' },
  '〜はず': { explain: '表示根据某些情况做出的合理推测。', level: 'N3' },
  '〜わけ': { explain: '表示某种情况的原因或理由。', level: 'N3' },
  '〜もの': { explain: '表示事物的本质、道理，或表示感叹。', level: 'N3' },
  '〜まま': { explain: '表示保持某种状态不变，或按照原样进行。', level: 'N2' },
  '〜っこない': { explain: '表示强烈否定，"绝对不可能..."。', level: 'N2' },
  '〜ざるを得ない': { explain: '表示不得不做某事，别无选择。', level: 'N2' },
  '〜ずにはいられない': { explain: '表示情不自禁地做某事。', level: 'N1' },
};

/**
 * 生成 Mock 翻译结果
 */
function mockTranslate(text: string): string {
  // 简单的 Mock 逻辑 - 根据文本内容返回不同结果
  if (text.includes('食べ')) {
    return '吃 / 食用';
  } else if (text.includes('行')) {
    return '去 / 走';
  } else if (text.includes('来')) {
    return '来 / 到来';
  } else if (text.includes('見')) {
    return '看 / 见';
  } else if (text.includes('聞')) {
    return '听 / 询问';
  }

  // 默认返回通用提示
  return `[Mock 翻译] "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}"`;
}

/**
 * 从文本中提取可能的语法点 (Mock)
 */
function extractGrammarPoints(text: string): Array<{ key: string; explain: string; level?: string }> {
  const points: Array<{ key: string; explain: string; level?: string }> = [];

  for (const [key, data] of Object.entries(MOCK_GRAMMAR_POINTS)) {
    if (text.includes(key.replace('〜', '')) || text.includes(key.replace('〜', 'て'))) {
      points.push({
        key,
        explain: data.explain,
        level: data.level,
      });
    }
  }

  // 如果没有匹配到，返回一个默认提示
  if (points.length === 0) {
    points.push({
      key: 'Mock 提示',
      explain: '当前为 Mock 模式，真实 AI 分析功能待接入。',
      level: '-',
    });
  }

  return points.slice(0, 3); // 最多返回 3 个
}

/**
 * 分析文本（Mock 或真实 API）
 * @param params 分析参数
 * @returns 分析结果
 */
export const analyzeText = async (
  params: AnalyzeTextParams
): Promise<TextAnalysisResult> => {
  if (getMockMode()) {
    // Mock 模式
    await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY));

    return {
      translation: mockTranslate(params.text),
      grammar_points: extractGrammarPoints(params.text),
      summary: params.text.length > 50 ? '[Mock] 这是一段较长的文本...' : undefined,
    };
  }

  // 真实 API 调用 (待接入)
  // return apiClient.post<TextAnalysisResult>('/ai/analyze', params);

  throw new Error('AI 真实 API 尚未接入');
};

/**
 * 检查 Mock 状态
 */
export const isMockMode = (): boolean => getMockMode();

/**
 * 切换 Mock 模式 (仅用于开发调试)
 */
export const setMockMode = (enabled: boolean): void => {
  (globalThis as any)[MOCK_MODE_KEY] = enabled;
};
