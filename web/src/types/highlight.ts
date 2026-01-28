/**
 * 划线相关类型定义
 */

/**
 * 划线基础属性
 */
export interface HighlightBase {
  style_category: string;
  selected_text: string;  // 选中的纯文本内容，用于校验或回显
}

/**
 * 创建划线请求
 */
export interface HighlightCreate extends HighlightBase {
  book_id: string;
  chapter_index: number;
  start_segment_index: number;
  start_token_idx: number;
  end_segment_index: number;
  end_token_idx: number;
}

/**
 * 划线响应
 */
export interface HighlightResponse extends HighlightCreate {
  id: number;
  created_at: string;
  /** 是否有对应的积累本数据 */
  has_Archive: boolean;
}
