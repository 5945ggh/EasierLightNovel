/**
 * LeftDock - 左侧固定导航栏
 * 提供返回书架、目录、设置等快捷操作
 */

import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, List, Settings, X } from 'lucide-react';
import { clsx } from 'clsx';
import { SettingsPopover } from './SettingsPopover';

interface LeftDockProps {
  onToggleToc: () => void;
}

interface DockButtonProps {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  active?: boolean;
}

// DockButton 组件提取到外部，使用 memo 避免不必要的重渲染
const DockButton = memo<DockButtonProps>(({ icon: Icon, label, onClick, active }) => (
  <button
    onClick={onClick}
    title={label}
    className={clsx(
      'p-3 rounded-xl transition-all duration-200 group relative flex items-center justify-center',
      active
        ? 'bg-blue-100 text-blue-600'
        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100'
    )}
  >
    <Icon size={22} strokeWidth={2} />
    <span className="absolute left-full ml-3 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
      {label}
    </span>
  </button>
));

DockButton.displayName = 'DockButton';

export const LeftDock: React.FC<LeftDockProps> = memo(({ onToggleToc }) => {
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭设置面板（使用 useCallback 稳定引用）
  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
      setShowSettings(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClickOutside]);

  // 使用 useCallback 稳定回调引用
  const handleNavigateHome = useCallback(() => navigate('/'), [navigate]);
  const handleToggleSettings = useCallback(() => setShowSettings(prev => !prev), []);

  return (
    <aside className="h-screen w-16 flex-shrink-0 flex flex-col items-center py-6 z-40 select-none border-r border-gray-200 dark:border-gray-700 bg-stone-50 dark:bg-gray-900">
      {/* 顶部导航 */}
      <div className="space-y-4 flex flex-col items-center">
        <DockButton icon={Home} label="返回书架" onClick={handleNavigateHome} />
      </div>

      {/* 中间区域 - 目录 */}
      <div className="flex-1 w-full flex flex-col items-center justify-center gap-6">
        <DockButton icon={List} label="目录" onClick={onToggleToc} />
      </div>

      {/* 底部设置区 */}
      <div className="relative space-y-4 flex flex-col items-center" ref={settingsRef}>
        <DockButton
          icon={showSettings ? X : Settings}
          label="阅读设置"
          active={showSettings}
          onClick={handleToggleSettings}
        />
        {showSettings ? <SettingsPopover /> : null}
      </div>
    </aside>
  );
});

LeftDock.displayName = 'LeftDock';
