/**
 * API 客户端配置
 */

import axios from 'axios';
import type { AxiosRequestConfig as RawAxiosRequestConfig } from 'axios';

/**
 * API 响应基础类型
 */
export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
}

/**
 * API 错误类型
 */
export interface ApiError {
  message: string;
  code?: string | number;
  status?: number;
  details?: unknown;
}

/**
 * 创建 axios 实例
 */
const rawApiClient = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * 响应拦截器 - 自动解包 data
 */
rawApiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const apiError: ApiError = {
      message: error.message || '请求失败',
      status: error.response?.status,
      details: error.response?.data,
    };

    // 特殊错误处理
    if (error.response?.status === 404) {
      apiError.message = '资源不存在';
    } else if (error.response?.status === 400) {
      apiError.message = '请求参数错误';
    } else if (error.response?.status === 500) {
      apiError.message = '服务器内部错误';
    }

    console.error('API Error:', apiError);
    return Promise.reject(apiError);
  }
);

/**
 * 请求拦截器 - 可用于添加 token 等
 */
rawApiClient.interceptors.request.use(
  (config) => {
    // 可在此处添加认证 token
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`;
    // }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * 导出类型安全的 API 客户端
 * 由于拦截器自动解包 response.data，get/post 等方法直接返回数据类型
 */
export const apiClient = rawApiClient as unknown as {
  get: <T>(url: string, config?: RawAxiosRequestConfig) => Promise<T>;
  post: <T>(url: string, data?: unknown, config?: RawAxiosRequestConfig) => Promise<T>;
  put: <T>(url: string, data?: unknown, config?: RawAxiosRequestConfig) => Promise<T>;
  patch: <T>(url: string, data?: unknown, config?: RawAxiosRequestConfig) => Promise<T>;
  delete: <T>(url: string, config?: RawAxiosRequestConfig) => Promise<T>;
  getUri: (config?: RawAxiosRequestConfig) => string;
  interceptors: typeof rawApiClient.interceptors;
};

export default apiClient;
