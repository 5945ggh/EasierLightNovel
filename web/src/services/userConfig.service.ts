/**
 * 用户配置 API 服务
 */

import apiClient from './api-client';
import type {
  UserConfigResponse,
  ConfigUpdateResponse,
} from '@/types/userConfig';

/**
 * 获取用户配置
 */
export const getUserConfig = async (): Promise<UserConfigResponse> => {
  return apiClient.get<UserConfigResponse>('/user-config');
};

/**
 * 更新用户配置
 */
export const updateUserConfig = async (
  config: Record<string, unknown>
): Promise<ConfigUpdateResponse> => {
  return apiClient.post<ConfigUpdateResponse>('/user-config', { config });
};
