/**
 * AI 相关类型定义
 */

/**
 * 语法点条目
 */
export interface GrammarPoint {
  key: string;          // 语法表达式，如 "〜ている"
  explain: string;      // 语法解释
  level?: string;       // 难度等级 (N5, N4, N3, N2, N1)
}

/**
 * 文本分析结果
 */
export interface TextAnalysisResult {
  translation: string;           // 翻译结果
  grammar_points: GrammarPoint[]; // 语法点分析
  summary?: string;              // 可选：段落摘要
}

/**
 * AI 分析请求参数
 */
export interface AnalyzeTextParams {
  text: string;
  context?: string;      // 上下文（如前后句子）
  bookId?: string;       // 书籍 ID（用于个性化）
}
