/**
 * API 服务统一导出
 */

// API 客户端
export { default as apiClient } from './api-client';
export type { ApiError, ApiResponse } from './api-client';

// 书籍服务
export * from './books.service';

// 生词本服务
export * from './vocabularies.service';

// 划线服务
export * from './highlights.service';

// 词典服务
export * from './dictionary.service';

// AI 服务
export * from './ai.service';
