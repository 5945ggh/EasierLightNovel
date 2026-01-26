/**
 * AI 相关类型定义
 */

/**
 * JLPT 等级（使用联合类型替代 enum）
 */
export type JLPTLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1';

/**
 * JLPT 等级常量
 */
export const JLPTLevel = {
  N5: 'N5' as const,
  N4: 'N4' as const,
  N3: 'N3' as const,
  N2: 'N2' as const,
  N1: 'N1' as const,
};

/**
 * 语法点
 */
export interface GrammarPoint {
  target_text: string;         // 该语法点对应的原文片段
  pattern: string;             // 语法句型 (如: ～てしまう)
  level?: JLPTLevel;           // JLPT 等级
  explanation: string;         // 针对当前语境的解释
}

/**
 * 词汇语感
 */
export interface VocabularyNuance {
  target_text: string;         // 原文中的词汇形式（含活用变形）
  base_form: string;           // 原型（辞典形）
  conjugation?: string;        // 活用形类型 (e.g., 使役受身形、タ形、テ形等)
  nuance: string;              // 在当前语境下的具体语感、潜台词或修辞效果
}

/**
 * AI 分析请求
 */
export interface AIAnalysisRequest {
  book_id: string;
  chapter_index: number;
  highlight_id?: number;       // 触发此分析的划线 ID
  target_text: string;         // 用户选中的文本（最大 200 字符）
  context_text: string;        // 包含上下文的完整文本片段（最大 1000 字符）
  user_prompt?: string;        // 可选的用户自定义提示
  model_preference?: string;   // 可选的模型偏好
}

/**
 * AI 分析结果
 */
export interface AIAnalysisResult {
  translation: string;         // 选中内容的流畅中文翻译
  grammar_analysis: GrammarPoint[];      // 语法分析列表
  vocabulary_nuance: VocabularyNuance[]; // 词汇语感分析列表
  cultural_notes?: string | null;     // 文化注释（Markdown 格式）
}

/**
 * AI 分析更新（用户修改后保存）
 */
export interface AIAnalysisUpdate {
  translation: string;         // 用户编辑后的翻译
  grammar_analysis: GrammarPoint[];
  vocabulary_nuance: VocabularyNuance[];
  cultural_notes?: string | null;     // 文化注释（Markdown 格式）
}

/**
 * 积累本条目响应
 */
export interface ArchiveItemResponse {
  id: number;
  highlight_id: number;
  user_note?: string;
  ai_analysis?: string;        // JSON 字符串
  in_review_queue: boolean;
  created_at: string;
  updated_at?: string | null;
}
