/**
 * LeftDock - 左侧固定导航栏
 * 提供返回书架、目录、侧边栏切换、设置等快捷操作
 */

import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, List, Settings, X, BookOpen, Sparkles, Bookmark, Highlighter } from 'lucide-react';
import { clsx } from 'clsx';
import { SettingsPopover } from './SettingsPopover';
import { useReaderStore, type SidebarTab } from '@/stores/readerStore';

interface LeftDockProps {
  onToggleToc: () => void;
}

// Tab 按钮配置
const TAB_BUTTONS: { tab: SidebarTab; icon: React.ComponentType<{ size?: number }>; label: string }[] = [
  { tab: 'dictionary', icon: BookOpen, label: '词典' },
  { tab: 'ai', icon: Sparkles, label: 'AI分析' },
  { tab: 'vocabulary', icon: Bookmark, label: '生词本' },
  { tab: 'highlights', icon: Highlighter, label: '高亮列表' },
];

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

  // 侧边栏状态
  const isSidebarOpen = useReaderStore((s) => s.isSidebarOpen);
  const activeTab = useReaderStore((s) => s.activeTab);
  const setIsSidebarOpen = useReaderStore((s) => s.setIsSidebarOpen);
  const setActiveTab = useReaderStore((s) => s.setActiveTab);

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

  // 处理侧边栏 Tab 切换
  const handleTabToggle = useCallback((tab: SidebarTab) => {
    if (isSidebarOpen && activeTab === tab) {
      // 如果当前 tab 已打开，则关闭侧边栏
      setIsSidebarOpen(false);
    } else {
      // 否则打开侧边栏并切换到对应 tab
      setActiveTab(tab);
      setIsSidebarOpen(true);
    }
  }, [isSidebarOpen, activeTab, setActiveTab, setIsSidebarOpen]);

  return (
    <aside className="h-screen w-16 flex-shrink-0 flex flex-col items-center py-6 z-40 select-none border-r border-gray-200 dark:border-gray-700 bg-stone-50 dark:bg-gray-900">
      {/* 顶部导航 */}
      <div className="space-y-4 flex flex-col items-center">
        <DockButton icon={Home} label="返回书架" onClick={handleNavigateHome} />
      </div>

      {/* 中间区域 - 侧边栏 Tab 按钮 */}
      <div className="flex-1 w-full flex flex-col items-center justify-center gap-3">
        {TAB_BUTTONS.map(({ tab, icon: Icon, label }) => (
          <DockButton
            key={tab}
            icon={Icon}
            label={label}
            active={isSidebarOpen && activeTab === tab}
            onClick={() => handleTabToggle(tab)}
          />
        ))}
      </div>

      {/* 底部区域 - 目录和设置 */}
      <div className="space-y-4 flex flex-col items-center">
        <DockButton icon={List} label="目录" onClick={onToggleToc} />
        <div className="relative" ref={settingsRef}>
          <DockButton
            icon={showSettings ? X : Settings}
            label="阅读设置"
            active={showSettings}
            onClick={handleToggleSettings}
          />
          {showSettings ? <SettingsPopover /> : null}
        </div>
      </div>
    </aside>
  );
});

LeftDock.displayName = 'LeftDock';
