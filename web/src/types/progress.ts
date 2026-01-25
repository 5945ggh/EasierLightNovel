/**
 * 阅读进度相关类型定义
 */

/**
 * 阅读进度基础
 */
export interface UserProgressBase {
  current_chapter_index: number;
  current_segment_index: number;
  current_segment_offset: number;
}

/**
 * 更新阅读进度请求
 */
export interface UserProgressUpdate extends UserProgressBase {}

/**
 * 阅读进度响应
 */
export interface UserProgressResponse extends UserProgressBase {
  book_id: string;
  updated_at?: string | null;
}
