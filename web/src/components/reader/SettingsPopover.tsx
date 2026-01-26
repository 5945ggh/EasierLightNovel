/**
 * SettingsPopover - 设置面板
 * 悬浮在左侧 Dock 旁边，提供阅读设置选项
 */

import React, { useMemo } from 'react';
import { useSettingsStore, type Theme, type FuriganaMode } from '@/stores/settingsStore';
import { Minus, Plus, Eye, EyeOff, MousePointer2 } from 'lucide-react';
import { clsx } from 'clsx';

// 按钮样式选项（静态常量，避免重复创建）
const FONT_SIZE_OPTIONS = [
  { value: 1.5, label: '小', title: '紧凑' },
  { value: 1.8, label: '中', title: '标准' },
  { value: 2.2, label: '大', title: '宽松' },
] as const;

const THEME_OPTIONS = [
  { t: 'light' as Theme, bg: 'bg-white', border: 'border-gray-200', label: '白', text: 'text-gray-900' },
  { t: 'sepia' as Theme, bg: 'bg-[#f4ecd8]', border: 'border-[#e6dbbf]', label: '羊', text: 'text-[#5b4636]' },
  { t: 'dark' as Theme, bg: 'bg-gray-900', border: 'border-gray-700', label: '黒', text: 'text-white' },
] as const;

const FURIGANA_OPTIONS = [
  { value: 'always' as FuriganaMode, label: <Eye size={16} />, title: '总是显示' },
  { value: 'hover' as FuriganaMode, label: <MousePointer2 size={16} />, title: '悬停显示' },
  { value: 'hidden' as FuriganaMode, label: <EyeOff size={16} />, title: '隐藏' },
] as const;

interface SegmentControlProps<T extends string | number> {
  options: ReadonlyArray<{ value: T; label: React.ReactNode; title: string }>;
  value: T;
  onChange: (val: T) => void;
}

// 分段控制器组件（memo 避免不必要的重渲染）
const SegmentControl = React.memo(
  <T extends string | number>({ options, value, onChange }: SegmentControlProps<T>) => (
    <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-full">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          title={opt.title}
          onClick={() => onChange(opt.value)}
          className={clsx(
            'flex-1 flex items-center justify-center py-1.5 text-sm rounded-md transition-all',
            value === opt.value
              ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm font-medium'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
) as <T extends string | number>(props: SegmentControlProps<T>) => React.ReactElement;

(Object.assign(SegmentControl, { displayName: 'SegmentControl' }));

export const SettingsPopover: React.FC = () => {
  const {
    fontSize,
    setFontSize,
    lineHeight,
    setLineHeight,
    theme,
    setTheme,
    furiganaMode,
    setFuriganaMode,
  } = useSettingsStore();

  // 使用 useCallback 稳定回调函数引用
  const handleFontSizeChange = useMemo(
    () => (delta: number) => setFontSize(fontSize + delta),
    [fontSize, setFontSize]
  );

  return (
    <div className="absolute left-full ml-2 bottom-[-10px] w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-4 z-50 animate-in slide-in-from-left-2 fade-in duration-200">
      <div className="space-y-5">
        {/* 1. 字号控制 */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 font-medium">
            <span>文字サイズ</span>
            <span>{fontSize}px</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleFontSizeChange(-1)}
              disabled={fontSize <= 12}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="减小字号"
            >
              <Minus size={16} />
            </button>
            <input
              type="range"
              min="12"
              max="32"
              step="1"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <button
              onClick={() => handleFontSizeChange(1)}
              disabled={fontSize >= 32}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="增大字号"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* 2. 行高 */}
        <div className="space-y-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            行間
          </span>
          <SegmentControl
            value={lineHeight}
            onChange={setLineHeight}
            options={FONT_SIZE_OPTIONS}
          />
        </div>

        {/* 3. 主题选择 */}
        <div className="space-y-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            テーマ
          </span>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((item) => (
              <button
                key={item.t}
                onClick={() => setTheme(item.t)}
                className={clsx(
                  'h-10 rounded-lg border flex items-center justify-center text-xs transition-all',
                  item.bg,
                  item.border,
                  item.text,
                  theme === item.t ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:brightness-95 dark:hover:brightness-110'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* 4. 注音模式 */}
        <div className="space-y-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            ふりがな
          </span>
          <SegmentControl
            value={furiganaMode}
            onChange={setFuriganaMode}
            options={FURIGANA_OPTIONS}
          />
        </div>
      </div>
    </div>
  );
};
