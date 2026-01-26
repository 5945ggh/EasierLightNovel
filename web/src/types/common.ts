/**
 * 通用类型定义
 */

/**
 * 书籍处理状态
 */
export const ProcessingStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type ProcessingStatus = (typeof ProcessingStatus)[keyof typeof ProcessingStatus];

/**
 * 划线样式分类
 */
export const HighlightStyle = {
  DEFAULT: 'default',
  VOCAB: 'vocab',
  GRAMMAR: 'grammar',
  FAVORITE: 'favorite',
} as const;

export type HighlightStyle = (typeof HighlightStyle)[keyof typeof HighlightStyle];
