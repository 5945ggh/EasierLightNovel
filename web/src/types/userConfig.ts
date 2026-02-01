/**
 * 用户配置相关类型定义
 */

/** 字段类型 */
export type ConfigFieldType = 'string' | 'integer' | 'number' | 'boolean' | 'array';

/** 单个配置字段的元信息 */
export interface ConfigFieldInfo {
  key: string;                    // 字段键名（如 'backend.host'）
  type: ConfigFieldType;          // 字段类型
  default?: unknown;              // 默认值
  description: string;            // 字段描述
  enum?: string[];                // 枚举值（如有）
  minimum?: number;               // 最小值
  maximum?: number;               // 最大值
}

/** 配置分组信息 */
export interface ConfigGroupInfo {
  group: string;                  // 分组名称（如 'backend'）
  label: string;                  // 分组显示标签
  description: string;            // 分组描述
  fields: ConfigFieldInfo[];      // 该分组的字段列表
}

/** 用户配置响应 */
export interface UserConfigResponse {
  config: Record<string, unknown>;        // 当前配置值（敏感字段已掩码）
  schema_info: ConfigGroupInfo[];         // 配置 schema 信息
  restart_required: boolean;              // 是否需要重启后端
}

/** 更新用户配置请求 */
export interface UserConfigUpdate {
  config: Record<string, unknown>;        // 要更新的配置（支持部分更新）
}

/** 配置更新响应 */
export interface ConfigUpdateResponse {
  success: boolean;
  message: string;
  restart_required: boolean;              // 是否需要重启后端
  updated_fields: string[];               // 已更新的字段列表
}

/** 敏感字段集合（用于 UI 判断） */
export const SENSITIVE_FIELDS = new Set([
  'llm.api_key',
  'pdf.mineru_api_token',
]);

/** 需要重启的字段集合 */
export const RESTART_REQUIRED_FIELDS = new Set([
  'backend.host',
  'backend.port',
  'cors.allowed_origins',
  'paths.data_dir',
  'paths.temp_upload_dir',
  'tokenizer.mode',
  'dictionary.memory_mode',
  'dictionary.load_kanji_dict',
]);
