/**
 * LeftDock - 左侧固定导航栏（桌面端）/ 底部 Tab 栏（移动端）
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

// Tab 按钮配置（桌面端）
const TAB_BUTTONS: { tab: SidebarTab; icon: React.ComponentType<{ size?: number }>; label: string }[] = [
  { tab: 'dictionary', icon: BookOpen, label: '词典' },
  { tab: 'ai', icon: Sparkles, label: 'AI分析' },
  { tab: 'vocabulary', icon: Bookmark, label: '生词本' },
  { tab: 'highlights', icon: Highlighter, label: '高亮列表' },
];

// 移动端底部 Tab 配置（不包含目录和设置，它们在顶部）
const MOBILE_TAB_BUTTONS: { tab: SidebarTab; icon: React.ComponentType<{ size?: number }>; label: string }[] = [
  { tab: 'dictionary', icon: BookOpen, label: '词典' },
  { tab: 'ai', icon: Sparkles, label: 'AI' },
  { tab: 'vocabulary', icon: Bookmark, label: '生词' },
  { tab: 'highlights', icon: Highlighter, label: '高亮' },
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

  // 监听移动端设置按钮切换事件
  useEffect(() => {
    const handleToggleEvent = () => {
      setShowSettings(prev => !prev);
    };
    window.addEventListener('toggle-reader-settings', handleToggleEvent);
    return () => window.removeEventListener('toggle-reader-settings', handleToggleEvent);
  }, []);

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
    <>
      {/* 桌面端：左侧固定导航栏 */}
      <aside className="hidden md:flex h-screen w-16 flex-shrink-0 flex-col items-center py-6 z-40 select-none border-r border-gray-200 dark:border-gray-700 bg-stone-50 dark:bg-gray-900">
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

      {/* 移动端：设置弹窗（全屏遮罩） */}
      {showSettings && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end justify-center">
          {/* 遮罩层 */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowSettings(false)}
          />
          {/* 设置面板 */}
          <div className="relative bottom-0 mb-16 w-[95%] max-w-sm bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-4 animate-in slide-in-from-bottom duration-300 ease-out max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">阅读设置</h3>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X size={18} />
              </button>
            </div>
            <SettingsPopover />
          </div>
        </div>
      )}

      {/* 移动端：底部固定 Tab 栏（抽屉打开时隐藏） */}
      <nav className={clsx(
        'md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 z-50 flex items-center justify-around px-2 safe-area-bottom transition-transform duration-300',
        isSidebarOpen && 'translate-y-full'
      )}>
        {MOBILE_TAB_BUTTONS.map(({ tab, icon: Icon, label }) => {
          const isActive = isSidebarOpen && activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => handleTabToggle(tab)}
              className={clsx(
                'flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-lg transition-all min-w-0 flex-1',
                isActive
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              <Icon size={isActive ? 22 : 20} />
              <span className="text-[10px] font-medium truncate">{label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
});

LeftDock.displayName = 'LeftDock';
