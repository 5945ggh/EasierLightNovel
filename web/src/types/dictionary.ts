/**
 * 词典相关类型定义
 */

/**
 * 释义条目
 */
export interface SenseEntry {
  pos: string[];          // 词性列表
  definitions: string[];  // 释义列表
}

/**
 * 字典条目
 */
export interface DictEntry {
  id: string;             // JMDict IDSeq
  kanji: string[];        // 汉字形式列表
  reading: string[];      // 读音列表
  senses: SenseEntry[];   // 释义列表
  pitch_accent?: number[] | null; // 音调核位置列表（预留）
}

/**
 * 字典查询结果
 */
export interface DictResult {
  query: string;
  found: boolean;
  is_exact_match: boolean;
  entries: DictEntry[];
  error?: string | null;
}
