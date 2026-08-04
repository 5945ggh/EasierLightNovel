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
export interface UserProgressUpdate extends UserProgressBase {
  /** Optional completion signal for an explicit next-chapter action. */
  state?: ChapterProgressState;
}

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

export type ChapterProgressState = 'in_progress' | 'completed';

export interface ChapterProgressUpdate {
  current_segment_index: number;
  progress_percentage: number;
  state?: ChapterProgressState;
}

export interface ChapterProgressResponse extends ChapterProgressUpdate {
  id: number;
  book_id: string;
  chapter_id: number;
  chapter_index: number;
  state: ChapterProgressState;
  updated_at?: string | null;
}
