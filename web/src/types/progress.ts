/**
 * 阅读进度相关类型定义
 */

/**
 * 阅读进度基础
 */
export interface UserProgressBase {
  current_chapter_index: number;
  current_segment_index: number;
  progress_percentage: number;  // 0-100，用于上传到后端
}

/**
 * 更新阅读进度请求
 */
export type UserProgressUpdate = UserProgressBase;

/**
 * 阅读进度响应
 */
export interface UserProgressResponse {
  current_chapter_index: number;
  current_segment_index: number;
  progress_percentage: number;  // 0-100，当前章节内的滚动百分比
  book_id: string;
  updated_at?: string | null;
}
