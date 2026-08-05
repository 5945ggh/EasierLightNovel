/**
 * 主题同步 Hook
 * 负责全站系统的 Dark / Light 模式同步
 * 注意：Sepia (羊皮纸) 主题专属于阅读器页面，非阅读页面在 Sepia 状态下自动保持为 Clean Light Mode
 */

import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';

export function useThemeSync() {
  const { theme } = useSettingsStore();

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const updateTheme = () => {
      const isDark =
        theme === 'dark' || (theme === 'system' && mediaQuery.matches);

      if (isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    updateTheme();

    mediaQuery.addEventListener('change', updateTheme);
    return () => mediaQuery.removeEventListener('change', updateTheme);
  }, [theme]);
}
