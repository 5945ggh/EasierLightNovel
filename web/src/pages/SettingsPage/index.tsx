/**
 * 设置页面
 * 支持修改 config/user.json 中的所有配置项
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings as SettingsIcon,
  Save,
  RotateCw,
  Check,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { getUserConfig, updateUserConfig } from '@/services/userConfig.service';
import type { UserConfigResponse, ConfigGroupInfo, ConfigFieldInfo } from '@/types/userConfig';
import { SENSITIVE_FIELDS, RESTART_REQUIRED_FIELDS } from '@/types/userConfig';
import clsx from 'clsx';
import AnkiImportPanel from './AnkiImportPanel';

export const SettingsPage: React.FC = () => {
  const [configData, setConfigData] = useState<UserConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<string[]>([]);

  // 本地编辑状态（key: value）
  const [editedConfig, setEditedConfig] = useState<Record<string, unknown>>({});
  // 敏感字段可见性状态
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());

  const getGroupSectionId = (group: ConfigGroupInfo) => `group:${group.group}`;

  const applyConfigData = useCallback((data: UserConfigResponse) => {
    setConfigData(data);
    setActiveSection((current) => {
      const currentGroupExists = data.schema_info.some((group) => getGroupSectionId(group) === current);
      return current === 'anki' || currentGroupExists
        ? current
        : data.schema_info[0] ? getGroupSectionId(data.schema_info[0]) : 'anki';
    });
  }, []);

  // 加载配置
  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUserConfig();
      applyConfigData(data);
    } catch (err) {
      setError('加载配置失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [applyConfigData]);

  useEffect(() => {
    let isMounted = true;

    getUserConfig()
      .then((data) => {
        if (isMounted) applyConfigData(data);
      })
      .catch((err) => {
        if (isMounted) {
          setError('加载配置失败');
          console.error(err);
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [applyConfigData]);

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
      'w-full px-3 py-2 border rounded-lg outline-none transition-all dark:bg-slate-800 dark:text-slate-100',
      'focus:ring-2 focus:ring-slate-blue-500 focus:border-slate-blue-500',
      modified && 'border-slate-blue-400 bg-slate-blue-50/60 dark:bg-slate-800/90 dark:border-slate-blue-500',
      !modified && 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800'
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
          <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-slate-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-blue-600" />
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
      const rawVal = value ?? field.default;
      const arrayValue = Array.isArray(rawVal) ? rawVal : [];
      const displayValue = arrayValue.join(', ');
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
          value={(value as number) ?? (field.default as number) ?? ''}
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
      const displayValue = isVisible ? ((value as string) ?? '') : '****';
      return (
        <div className="flex gap-2">
          <input
            type={isVisible ? 'text' : 'password'}
            value={displayValue}
            onChange={(e) => updateFieldValue(field.key, e.target.value)}
            placeholder={field.default as string ?? ''}
            className={inputClassName}
          />
          <button
            type="button"
            onClick={() => toggleFieldVisibility(field.key)}
            className="p-2 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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
        value={(value as string) ?? (field.default as string) ?? ''}
        onChange={(e) => updateFieldValue(field.key, e.target.value)}
        placeholder={field.default as string ?? ''}
        className={inputClassName}
      />
    );
  };

  // 渲染配置分组
  const renderGroup = (group: ConfigGroupInfo) => {
    const hasModifications = isGroupModified(group);

    return (
      <section
        aria-labelledby={`config-group-${group.group}`}
        className={clsx(
          'overflow-hidden rounded-xl border bg-white dark:bg-slate-900',
          hasModifications ? 'border-slate-blue-400 dark:border-slate-blue-500 shadow-md' : 'border-slate-200 dark:border-slate-800'
        )}
      >
        <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
          <div className="flex items-start gap-3">
            {hasModifications && (
              <span className="mt-2 size-2 shrink-0 rounded-full bg-slate-blue-500" aria-label="包含未保存修改" />
            )}
            <div>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h2 id={`config-group-${group.group}`} className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                  {group.label}
                </h2>
                <span className="text-sm text-slate-500 dark:text-slate-400">{group.fields.length} 项</span>
              </div>
              {group.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{group.description}</p>}
            </div>
          </div>
        </header>

        <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
          {group.fields.map((field) => (
            <div
              key={field.key}
              className={clsx(
                'grid grid-cols-1 gap-4 rounded-lg p-3 md:grid-cols-3',
                isFieldModified(field.key) && 'bg-slate-blue-50/50 dark:bg-slate-800/40'
              )}
            >
              <div className="md:col-span-1">
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  {field.key}
                  {isFieldModified(field.key) && (
                    <span className="ml-2 text-xs text-slate-blue-600 dark:text-slate-blue-400">(已修改)</span>
                  )}
                </label>
                {field.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{field.description}</p>
                )}
              </div>

              <div className="md:col-span-2">
                {renderFieldInput(field)}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-500">
        <RotateCw size={32} className="animate-spin text-slate-blue-600 dark:text-slate-blue-400" />
      </div>
    );
  }

  if (error && !configData) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center text-red-500">
          <AlertTriangle size={48} className="mx-auto mb-4" strokeWidth={1.5} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const hasChanges = Object.keys(editedConfig).length > 0;
  const activeGroup = configData?.schema_info.find((group) => getGroupSectionId(group) === activeSection);

  return (
    <div className="min-h-full p-4 text-slate-800 transition-colors dark:text-slate-100 sm:p-6 lg:p-8">
      {/* 重启提示弹窗 */}
      {showRestartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
            onClick={() => setShowRestartModal(false)}
          />
          <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-scale-in">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-amber-100 dark:bg-amber-950/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <RotateCw size={32} className="text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
                需要重启后端服务
              </h2>
              <p className="text-slate-600 dark:text-slate-400">
                配置已保存，但某些配置需要重启后端才能生效。
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 mb-6">
              <p className="text-sm text-slate-700 dark:text-slate-200 mb-2">已修改的配置：</p>
              <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
                {pendingChanges.map((field) => (
                  <li key={field} className="flex items-center gap-2">
                    <Check size={14} className="text-emerald-500" />
                    <code className="text-xs bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">
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
              className="w-full px-4 py-3 bg-slate-blue-600 hover:bg-slate-blue-700 text-white rounded-xl font-medium transition-colors"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      {/* 头部 */}
      <header className="mx-auto mb-8 max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl text-white shadow-lg">
                <SettingsIcon size={24} />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100 sm:text-2xl">
                  系统设置
                </h1>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  修改 config/user.json 配置
                </p>
              </div>
            </div>
          {/* 操作按钮 */}
          <div className="flex items-center gap-3 self-start sm:self-auto">
            {hasChanges && (
              <button
                onClick={handleReset}
                disabled={saving}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                重置
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className={clsx(
                'flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors',
                hasChanges && !saving
                  ? 'bg-slate-blue-700 text-white shadow-sm hover:bg-slate-blue-800'
                  : 'cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
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

      <section className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8" aria-label="设置内容">
        <aside className="hidden border-r border-slate-200 pr-6 dark:border-slate-800 lg:block">
          <div className="sticky top-8">
            <nav aria-label="设置分类" className="space-y-1">
              {configData?.schema_info.map((group) => {
                const sectionId = getGroupSectionId(group);
                const isActive = activeSection === sectionId;
                const hasModifications = isGroupModified(group);

                return (
                  <button
                    key={group.group}
                    type="button"
                    onClick={() => setActiveSection(sectionId)}
                    aria-current={isActive ? 'page' : undefined}
                    className={clsx(
                      'flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-blue-500',
                      isActive
                        ? 'bg-slate-blue-100 text-slate-blue-800 dark:bg-slate-blue-900/40 dark:text-slate-blue-200'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                    )}
                  >
                    <span className={clsx('mt-1.5 size-1.5 shrink-0 rounded-full', hasModifications ? 'bg-slate-blue-500' : 'bg-transparent')} aria-hidden="true" />
                    <span className="min-w-0 flex-1 leading-5">{group.label}</span>
                    <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{group.fields.length}</span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setActiveSection('anki')}
                aria-current={activeSection === 'anki' ? 'page' : undefined}
                className={clsx(
                  'w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-blue-500',
                  activeSection === 'anki'
                    ? 'bg-slate-blue-100 text-slate-blue-800 dark:bg-slate-blue-900/40 dark:text-slate-blue-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                )}
              >
                Anki 词汇基线
              </button>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <label className="mb-5 block lg:hidden">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">设置分类</span>
            <select
              value={activeSection ?? ''}
              onChange={(event) => setActiveSection(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-blue-500 focus:ring-2 focus:ring-slate-blue-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-slate-blue-900"
            >
              {configData?.schema_info.map((group) => (
                <option key={group.group} value={getGroupSectionId(group)}>{group.label}</option>
              ))}
              <option value="anki">Anki 词汇基线</option>
            </select>
          </label>

          {activeGroup ? renderGroup(activeGroup) : <AnkiImportPanel className="m-0 max-w-none" />}
        </div>
      </section>

      {/* 底部提示 */}
      <footer className="mx-auto mt-8 max-w-7xl text-center text-sm text-slate-500 dark:text-slate-400">
        <p>配置文件保存位置: config/user.json</p>
        <p className="mt-1">修改后自动保存，部分配置需要重启后端服务</p>
      </footer>
    </div>
  );
};

export default SettingsPage;
