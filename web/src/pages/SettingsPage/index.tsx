/**
 * 设置页面
 * 支持修改 config/user.json 中的所有配置项
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Settings as SettingsIcon,
  ArrowLeft,
  Save,
  RotateCw,
  Check,
  AlertTriangle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { getUserConfig, updateUserConfig } from '@/services/userConfig.service';
import type { UserConfigResponse, ConfigGroupInfo, ConfigFieldInfo } from '@/types/userConfig';
import { SENSITIVE_FIELDS, RESTART_REQUIRED_FIELDS } from '@/types/userConfig';
import clsx from 'clsx';

export const SettingsPage: React.FC = () => {
  const [configData, setConfigData] = useState<UserConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<string[]>([]);

  // 本地编辑状态（key: value）
  const [editedConfig, setEditedConfig] = useState<Record<string, unknown>>({});
  // 敏感字段可见性状态
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());

  // 加载配置
  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUserConfig();
      setConfigData(data);
      // 默认展开第一个分组
      if (data.schema_info.length > 0) {
        setExpandedGroups(new Set([data.schema_info[0].group]));
      }
    } catch (err) {
      setError('加载配置失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // 切换分组展开/折叠
  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  // 切换敏感字段可见性
  const toggleFieldVisibility = (key: string) => {
    setVisibleFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // 更新字段值
  const updateFieldValue = (key: string, value: unknown) => {
    setEditedConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // 获取字段当前值（优先使用编辑值）
  const getFieldValue = (key: string) => {
    // 如果有编辑值，使用编辑值
    if (key in editedConfig) {
      return editedConfig[key];
    }
    // 否则使用原始配置值
    const keys = key.split('.');
    let value: unknown = configData?.config;
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        return undefined;
      }
    }
    return value;
  };

  // 检查字段是否已修改
  const isFieldModified = (key: string) => {
    return key in editedConfig;
  };

  // 检查分组是否有修改
  const isGroupModified = (group: ConfigGroupInfo) => {
    return group.fields.some((field) => isFieldModified(field.key));
  };

  // 保存配置
  const handleSave = async () => {
    if (!editedConfig || Object.keys(editedConfig).length === 0) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = await updateUserConfig(editedConfig);

      if (result.success) {
        setPendingChanges(result.updated_fields);

        // 检查是否需要重启
        const needsRestart = result.updated_fields.some(
          (field) => RESTART_REQUIRED_FIELDS.has(field)
        );

        if (needsRestart) {
          setShowRestartModal(true);
        } else {
          // 不需要重启，重新加载配置
          setEditedConfig({});
          await loadConfig();
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '保存失败';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  // 重置修改
  const handleReset = () => {
    setEditedConfig({});
    setError(null);
  };

  // 渲染字段输入控件
  const renderFieldInput = (field: ConfigFieldInfo) => {
    const value = getFieldValue(field.key);
    const modified = isFieldModified(field.key);
    const isSensitive = SENSITIVE_FIELDS.has(field.key);
    const isVisible = visibleFields.has(field.key);

    const inputClassName = clsx(
      'w-full px-3 py-2 border rounded-lg outline-none transition-all',
      'focus:ring-2 focus:ring-slate-500 focus:border-slate-500',
      modified && 'border-blue-400 bg-blue-50',
      !modified && 'border-gray-300 bg-white'
    );

    // 布尔类型 - 开关
    if (field.type === 'boolean') {
      return (
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={value as boolean ?? false}
            onChange={(e) => updateFieldValue(field.key, e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-slate-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-600" />
        </label>
      );
    }

    // 枚举类型 - 下拉选择
    if (field.enum && field.enum.length > 0) {
      return (
        <select
          value={value as string ?? field.default ?? ''}
          onChange={(e) => updateFieldValue(field.key, e.target.value)}
          className={inputClassName}
        >
          {field.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    // 数组类型 - 文本输入（逗号分隔）
    if (field.type === 'array') {
      const arrayValue = value as string[] ?? [];
      const displayValue = Array.isArray(arrayValue) ? arrayValue.join(', ') : '';
      return (
        <input
          type="text"
          value={displayValue}
          onChange={(e) => {
            const arr = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            updateFieldValue(field.key, arr);
          }}
          placeholder={Array.isArray(field.default) ? field.default.join(', ') : ''}
          className={inputClassName}
        />
      );
    }

    // 数字/整数类型
    if (field.type === 'number' || field.type === 'integer') {
      return (
        <input
          type="number"
          value={value as number ?? field.default ?? ''}
          onChange={(e) => {
            const num = field.type === 'integer'
              ? parseInt(e.target.value, 10)
              : parseFloat(e.target.value);
            updateFieldValue(field.key, isNaN(num) ? null : num);
          }}
          min={field.minimum}
          max={field.maximum}
          step={field.type === 'integer' ? 1 : 0.1}
          className={inputClassName}
        />
      );
    }

    // 字符串类型（敏感字段处理）
    if (isSensitive) {
      const displayValue = isVisible ? (value as string ?? '') : '****';
      return (
        <div className="flex gap-2">
          <input
            type={isVisible ? 'text' : 'password'}
            value={displayValue}
            onChange={(e) => updateFieldValue(field.key, e.target.value)}
            placeholder={field.default as string ?? ''}
            className={clsx(inputClassName, 'flex-1')}
          />
          <button
            type="button"
            onClick={() => toggleFieldVisibility(field.key)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title={isVisible ? '隐藏' : '显示'}
          >
            {isVisible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      );
    }

    // 默认文本输入
    return (
      <input
        type="text"
        value={value as string ?? field.default ?? ''}
        onChange={(e) => updateFieldValue(field.key, e.target.value)}
        placeholder={field.default as string ?? ''}
        className={inputClassName}
      />
    );
  };

  // 渲染配置分组
  const renderGroup = (group: ConfigGroupInfo) => {
    const isExpanded = expandedGroups.has(group.group);
    const hasModifications = isGroupModified(group);

    return (
      <div
        key={group.group}
        className={clsx(
          'bg-white rounded-xl border transition-all',
          hasModifications ? 'border-blue-400 shadow-md' : 'border-gray-200'
        )}
      >
        {/* 分组标题 */}
        <button
          onClick={() => toggleGroup(group.group)}
          className="w-full flex items-center justify-between px-6 py-4 text-left"
        >
          <div className="flex items-center gap-3">
            {hasModifications && (
              <div className="w-2 h-2 bg-blue-500 rounded-full" />
            )}
            <h3 className="text-lg font-semibold text-gray-800">
              {group.label}
            </h3>
            <span className="text-sm text-gray-500">
              ({group.fields.length} 项)
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp size={20} className="text-gray-400" />
          ) : (
            <ChevronDown size={20} className="text-gray-400" />
          )}
        </button>

        {/* 分组内容 */}
        {isExpanded && (
          <div className="px-6 pb-6 space-y-4">
            {group.description && (
              <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                {group.description}
              </p>
            )}

            {group.fields.map((field) => (
              <div
                key={field.key}
                className={clsx(
                  'grid grid-cols-1 md:grid-cols-3 gap-4 p-3 rounded-lg',
                  isFieldModified(field.key) && 'bg-blue-50/50'
                )}
              >
                {/* 字段标签 */}
                <div className="md:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.key}
                    {isFieldModified(field.key) && (
                      <span className="ml-2 text-xs text-blue-600">(已修改)</span>
                    )}
                  </label>
                  {field.description && (
                    <p className="text-xs text-gray-500">{field.description}</p>
                  )}
                </div>

                {/* 字段输入 */}
                <div className="md:col-span-2">
                  {renderFieldInput(field)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100">
        <RotateCw size={32} className="animate-spin text-slate-500" />
      </div>
    );
  }

  if (error && !configData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center text-red-500">
          <AlertTriangle size={48} className="mx-auto mb-4" />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const hasChanges = Object.keys(editedConfig).length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 p-4 sm:p-6 md:p-10">
      {/* 重启提示弹窗 */}
      {showRestartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowRestartModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-scale-in">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <RotateCw size={32} className="text-amber-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">
                需要重启后端服务
              </h2>
              <p className="text-gray-600">
                配置已保存，但某些配置需要重启后端才能生效。
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-700 mb-2">已修改的配置：</p>
              <ul className="text-sm text-gray-600 space-y-1">
                {pendingChanges.map((field) => (
                  <li key={field} className="flex items-center gap-2">
                    <Check size={14} className="text-green-500" />
                    <code className="text-xs bg-gray-200 px-1.5 py-0.5 rounded">
                      {field}
                    </code>
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={() => {
                setShowRestartModal(false);
                setEditedConfig({});
                loadConfig();
              }}
              className="w-full px-4 py-3 bg-slate-600 hover:bg-slate-700 text-white rounded-xl font-medium transition-colors"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      {/* 头部 */}
      <header className="max-w-5xl mx-auto mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="p-2.5 bg-white hover:bg-gray-50 rounded-xl text-gray-600 border border-gray-200 transition-all shadow-sm"
              title="返回书架"
            >
              <ArrowLeft size={20} />
            </Link>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl text-white shadow-lg">
                <SettingsIcon size={24} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800 tracking-tight">
                  系统设置
                </h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  修改 config/user.json 配置
                </p>
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-3">
            {hasChanges && (
              <button
                onClick={handleReset}
                disabled={saving}
                className="px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl transition-all font-medium text-sm disabled:opacity-50"
              >
                重置
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className={clsx(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all font-medium text-sm',
                hasChanges && !saving
                  ? 'bg-slate-600 hover:bg-slate-700 text-white shadow-md'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              )}
            >
              {saving ? (
                <>
                  <RotateCw size={18} className="animate-spin" />
                  <span>保存中...</span>
                </>
              ) : (
                <>
                  <Save size={18} />
                  <span>保存配置</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 全局错误提示 */}
        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* 修改计数 */}
        {hasChanges && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2">
            <Check size={18} className="text-blue-600" />
            <span className="text-sm text-blue-700">
              已修改 {Object.keys(editedConfig).length} 项配置
            </span>
          </div>
        )}
      </header>

      {/* 配置分组列表 */}
      <main className="max-w-5xl mx-auto space-y-4">
        {configData?.schema_info.map((group) => renderGroup(group))}
      </main>

      {/* 底部提示 */}
      <footer className="max-w-5xl mx-auto mt-8 text-center text-sm text-gray-500">
        <p>配置文件保存位置: config/user.json</p>
        <p className="mt-1">修改后自动保存，部分配置需要重启后端服务</p>
      </footer>
    </div>
  );
};

export default SettingsPage;
