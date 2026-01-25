/**
 * 设置 Store - 用户偏好设置（持久化到 localStorage）
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 主题类型
 */
export type Theme = 'light' | 'dark' | 'system';

/**
   * 阅读器设置状态
   */
interface SettingsState {
  // 外观设置
  theme: Theme;
  fontSize: number;           // 字号 (px)
  lineHeight: number;         // 行高倍数
  showRuby: boolean;          // 是否显示注音

  // 布局设置
  showSidebar: boolean;       // 是否默认显示侧边栏

  // 阅读设置
  autoScroll: boolean;        // 是否自动滚动
  scrollSpeed: number;        // 滚动速度
}

/**
   * 设置 Store 操作
   */
interface SettingsActions {
  // 主题相关
  setTheme: (theme: Theme) => void;

  // 字体相关
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setShowRuby: (show: boolean) => void;

  // 布局相关
  setShowSidebar: (show: boolean) => void;

  // 阅读相关
  setAutoScroll: (auto: boolean) => void;
  setScrollSpeed: (speed: number) => void;

  // 重置设置
  resetSettings: () => void;
}

/**
   * 默认设置
   */
const defaultSettings: SettingsState = {
  theme: 'system',
  fontSize: 18,
  lineHeight: 1.8,
  showRuby: true,
  showSidebar: true,
  autoScroll: false,
  scrollSpeed: 1,
};

/**
   * 设置 Store
   */
export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      ...defaultSettings,

      // 主题相关
      setTheme: (theme) => set({ theme }),

      // 字体相关
      setFontSize: (fontSize) => set({ fontSize }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setShowRuby: (showRuby) => set({ showRuby }),

      // 布局相关
      setShowSidebar: (showSidebar) => set({ showSidebar }),

      // 阅读相关
      setAutoScroll: (autoScroll) => set({ autoScroll }),
      setScrollSpeed: (scrollSpeed) => set({ scrollSpeed }),

      // 重置设置
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'lightnovel-settings', // localStorage key
    }
  )
);
