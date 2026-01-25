/**
 * API 客户端配置
 */

import axios, { AxiosError, AxiosResponse } from 'axios';

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
export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * 响应拦截器 - 自动解包 data
 */
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response.data,
  (error: AxiosError<unknown>) => {
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
apiClient.interceptors.request.use(
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

export default apiClient;
