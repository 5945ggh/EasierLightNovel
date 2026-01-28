/**
 * 配置服务
 * 管理应用配置，包括后端地址、限制值、功能开关等
 */

import axios from 'axios';

/**
 * 后端配置
 */
export interface BackendConfig {
  host: string;
  port: number;
  url: string;
}

/**
 * 划线样式信息
 */
export interface HighlightStyleInfo {
  color: string;
  name: string;
}

/**
 * 功能开关
 */
export interface FeatureFlags {
  ai_analysis: boolean;
  dictionary: boolean;
}

/**
 * 配置限制
 */
export interface ConfigLimits {
  max_target_length: number;
  max_context_length: number;
  max_upload_size: number;
  query_default_limit: number;
  query_max_limit: number;
}

/**
 * 公共配置响应（与后端 Schema 对应）
 */
export interface PublicConfig {
  version: string;
  backend: BackendConfig;
  limits: ConfigLimits;
  features: FeatureFlags;
  highlight_styles: Record<string, HighlightStyleInfo>;
}

/**
 * 配置状态（内存中存储）
 */
let configState: PublicConfig | null = null;
let initPromise: Promise<PublicConfig | null> | null = null;

/**
 * 默认配置（降级使用）
 */
const DEFAULT_CONFIG: PublicConfig = {
  version: '0.0.0',
  backend: {
    host: '127.0.0.1',
    port: 8010,
    url: 'http://127.0.0.1:8010',
  },
  limits: {
    max_target_length: 512,
    max_context_length: 2048,
    max_upload_size: 52428800,
    query_default_limit: 100,
    query_max_limit: 500,
  },
  features: {
    ai_analysis: true,
    dictionary: true,
  },
  highlight_styles: {
    default: { color: '#3b82f6', name: '默认' },
    vocab: { color: '#eab308', name: '生词' },
    grammar: { color: '#ef4444', name: '语法' },
    favorite: { color: '#ec4899', name: '收藏' },
  },
};

/**
 * 获取初始 API 基础 URL
 * 开发环境使用 Vite 代理 (/api)，生产环境使用当前 origin
 */
function getInitialBaseURL(): string {
  if (import.meta.env.DEV) {
    return '/api';
  }
  // 生产环境：使用当前页面的 origin + /api
  return `${window.location.origin}/api`;
}

/**
 * 初始化配置
 * 在应用启动时调用，从后端获取配置信息
 *
 * @returns 配置对象，失败时返回默认配置
 */
export async function initConfig(): Promise<PublicConfig> {
  // 如果已经在初始化，返回同一个 Promise
  if (initPromise) {
    return initPromise.then((cfg) => cfg ?? DEFAULT_CONFIG);
  }

  // 如果已经初始化过，直接返回
  if (configState) {
    return configState;
  }

  initPromise = (async () => {
    const baseURL = getInitialBaseURL();

    try {
      const response = await axios.get<PublicConfig>(`${baseURL}/config`, {
        timeout: 5000, // 5秒超时
      });

      configState = response.data;
      console.log('[Config] 配置加载成功:', configState);
      return configState;
    } catch (error) {
      console.warn('[Config] 配置加载失败，使用默认配置:', error);

      // 降级处理：使用默认配置
      // 检查是否是网络错误（后端未启动）
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK') {
          console.warn('[Config] 后端服务未启动，部分功能可能不可用');
        }
      }

      configState = DEFAULT_CONFIG;
      return configState;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise.then((cfg) => cfg ?? DEFAULT_CONFIG);
}

/**
 * 获取当前配置
 * 必须在 initConfig() 之后调用
 *
 * @returns 配置对象
 */
export function getConfig(): PublicConfig {
  if (!configState) {
    console.warn('[Config] 配置未初始化，返回默认配置');
    return DEFAULT_CONFIG;
  }
  return configState;
}

/**
 * 获取后端 URL
 * 用于需要直接访问后端的情况（如 WebSocket）
 *
 * @returns 后端完整 URL
 */
export function getBackendUrl(): string {
  const config = getConfig();
  return config.backend.url;
}

/**
 * 获取后端配置
 *
 * @returns 后端配置对象
 */
export function getBackendConfig(): BackendConfig {
  const config = getConfig();
  return config.backend;
}

/**
 * 获取配置限制
 *
 * @returns 配置限制对象
 */
export function getConfigLimits(): ConfigLimits {
  const config = getConfig();
  return config.limits;
}

/**
 * 获取功能开关
 *
 * @returns 功能开关对象
 */
export function getFeatures(): FeatureFlags {
  const config = getConfig();
  return config.features;
}

/**
 * 获取划线样式配置
 *
 * @returns 划线样式配置对象
 */
export function getHighlightStyles(): Record<string, HighlightStyleInfo> {
  const config = getConfig();
  return config.highlight_styles;
}

/**
 * 检查功能是否启用
 *
 * @param feature 功能名称
 * @returns 是否启用
 */
export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  const features = getFeatures();
  return features[feature] ?? false;
}

/**
 * 配置是否已初始化
 *
 * @returns 是否已初始化
 */
export function isConfigReady(): boolean {
  return configState !== null;
}

/**
 * 重置配置（主要用于测试）
 */
export function resetConfig(): void {
  configState = null;
  initPromise = null;
}
