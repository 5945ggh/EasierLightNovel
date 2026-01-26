/**
 * 通用类型定义
 */

/**
 * 书籍处理状态
 */
export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * 划线样式分类
 */
export enum HighlightStyle {
  DEFAULT = 'default',
  VOCAB = 'vocab',
  GRAMMAR = 'grammar',
  FAVORITE = 'favorite',
}
