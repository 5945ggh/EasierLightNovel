/**
 * 章节和分词相关类型定义
 */

/**
 * 振假名部分
 */
export interface RubyPart {
  text: string;
  ruby?: string;
}

/**
 * 分词 Token 数据
 */
export interface TokenData {
  s: string;              // surface (表层形)
  r?: string;             // reading (读音)
  b?: string;             // base_form (原型)
  p?: string;             // part_of_speech (词性)
  gap?: boolean;          // 是否有间隔
  RUBY?: RubyPart[];      // 振假名 parts
}

/**
 * 内容段基类
 */
export interface SegmentBase {
  type: string;
}

/**
 * 文本段
 */
export interface TextSegment extends SegmentBase {
  type: 'text';
  text?: string;          // 未分词时的原始文本
  tokens?: TokenData[];   // 分词后的 token 列表
}

/**
 * 图片段
 */
export interface ImageSegment extends SegmentBase {
  type: 'image';
  src: string;            // 图片 URL
  alt: string;            // 替代文本
}

/**
 * 内容段联合类型
 */
export type ContentSegment = TextSegment | ImageSegment;

/**
 * 章节列表项
 */
export interface ChapterListItem {
  index: number;
  title: string;
}

/**
 * 章节划线数据（本章范围）
 */
export interface ChapterHighlightData {
  id: number;
  start_segment_index: number;
  start_token_idx: number;
  end_segment_index: number;
  end_token_idx: number;
  style_category: string;
}

/**
 * 章节内容响应
 */
export interface ChapterResponse {
  index: number;
  title: string;
  segments: ContentSegment[];
  highlights: ChapterHighlightData[];
}
