/**
 * 生词本相关类型定义
 */

/**
 * 生词基础信息
 */
export interface VocabularyBase {
  word: string;           // 表层形
  reading?: string;       // 读音
  base_form: string;      // 原型
  part_of_speech?: string; // 词性
  definition?: string;    // 释义 json
}

/**
 * 添加生词请求
 */
export interface VocabularyCreate extends VocabularyBase {
  book_id: string;
  context_sentences?: string[];  // 例句列表
}

/**
 * 生词响应
 */
export interface VocabularyResponse extends VocabularyBase {
  id: number;
  book_id: string;
  definition?: string;
  status: number;
  next_review_at?: string | null;
  context_sentences?: string[] | null;
  created_at: string;
  updated_at?: string | null;
}

/**
 * 生词原型集合响应（轻量级）
 */
export interface VocabularyBaseFormsResponse {
  base_forms: string[];   // 去重后的生词原型列表
}
