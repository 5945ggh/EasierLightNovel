/**
 * 书籍相关类型定义
 */

import { ProcessingStatus } from './common';

/**
 * 书籍详情 / 列表项
 */
export interface BookDetail {
  id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  status: ProcessingStatus;
  error_message: string | null;
  total_chapters: number;
  created_at: string;
  // PDF 处理进度（可选）
  pdf_progress_stage?: string;
  pdf_progress_current?: number;
  pdf_progress_total?: number;
}

/**
 * 书籍列表项（与 BookDetail 相同）
 */
export type BookListItem = BookDetail;

/**
 * 修改书籍元数据请求
 */
export interface BookUpdate {
  title?: string;
  author?: string;
  cover_url?: string;
}
