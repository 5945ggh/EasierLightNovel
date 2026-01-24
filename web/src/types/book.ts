// 书籍处理状态 - 与后端 API 保持一致
export type BookStatus = 'pending' | 'processing' | 'completed' | 'failed';

// 书籍摘要信息 (用于书架列表) - 对应后端 BookDetail
export interface BookSummary {
  id: string;                    // UUID (32位十六进制字符串)
  title: string;
  author: string | null;
  cover_url: string | null;      // 相对路径: /static/books/{book_id}/images/...
  status: BookStatus;
  error_message: string | null;  // 仅当 status === 'failed' 时有值
  total_chapters: number;
  created_at: string;            // ISO 8601 格式时间戳
}

// 书籍详情 (目前与摘要相同，阅读器内容需要单独 API 获取)
export interface BookDetail extends BookSummary {
  // TODO: !!!阅读器相关字段，后续添加章节内容等!!!
}
