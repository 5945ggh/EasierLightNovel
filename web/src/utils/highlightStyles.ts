/**
 * 划线样式工具函数
 * 从后端配置获取划线样式，并提供颜色转换功能
 */

import { getHighlightStyles, type HighlightStyleInfo } from '@/services/config.service';

/**
 * 划线选项类型
 */
export interface HighlightOption {
  key: string;
  color: string;
  name: string;
}

/**
 * 旧 key 到新 key 的映射（降级兼容）
 * 用于兼容数据库中存储的旧样式 key
 * 后端配置使用彩蛋拼写：bule, yelow, rad, pik
 */
export const LEGACY_STYLE_KEY_MAP: Record<string, string> = {
  // 标准颜色名称 -> 彩蛋拼写
  'blue': 'bule',
  'yellow': 'yelow',
  'red': 'rad',
  'pink': 'pik',
  'green': 'rad',
  'purple': 'pik',
  // 功能性 key -> 彩蛋拼写
  'default': 'bule',
  'vocab': 'yelow',
  'vocabulary': 'yelow',
  'grammar': 'rad',
  'favorite': 'pik',
};

/**
 * 将 hex 颜色转换为带透明度的背景色样式
 * 用于划线高亮的动态背景色
 */
export function hexToBgStyle(hexColor: string, alpha: number = 0.2): { backgroundColor: string } {
  // 确保 hex 颜色格式正确
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha})`,
  };
}

/**
 * 将 hex 颜色转换为边框颜色样式
 * 用于侧边栏高亮卡片的左边框
 */
export function hexToBorderBgStyle(hexColor: string): { borderLeftColor: string } {
  return {
    borderLeftColor: hexColor,
  };
}

/**
 * 获取所有划线样式的配置
 * 返回后端配置的完整样式对象
 */
export function getAllHighlightStyles(): Record<string, HighlightStyleInfo> {
  return getHighlightStyles();
}

/**
 * 根据 style_category 获取样式信息
 * @param styleCategory 样式类别 key
 * @returns 样式信息，如果不存在则返回默认样式
 */
export function getHighlightStyle(category: string): HighlightStyleInfo {
  const styles = getHighlightStyles();
  return styles[category] || styles['blue'] || { color: '#3b82f6', name: '默认' };
}

/**
 * 获取样式信息，包含完整的降级兼容逻辑
 * 这是获取划线样式的推荐函数，优先级：
 * 1. 直接匹配后端配置的 key
 * 2. 通过 LEGACY_STYLE_KEY_MAP 映射旧 key
 * 3. 使用第一个可用的样式作为最终降级
 *
 * @param category 样式类别 key
 * @returns 样式信息 { name, color }
 */
export function getHighlightStyleWithFallback(category: string): HighlightStyleInfo {
  const styles = getHighlightStyles();

  // 1. 直接匹配
  if (styles[category]) {
    return styles[category];
  }

  // 2. 降级兼容：尝试映射旧 key
  const mappedKey = LEGACY_STYLE_KEY_MAP[category];
  if (mappedKey && styles[mappedKey]) {
    return styles[mappedKey];
  }

  // 3. 最终降级：使用第一个可用样式
  const firstKey = Object.keys(styles)[0];
  return styles[firstKey] || { color: '#3b82f6', name: '默认' };
}

/**
 * 获取划线的背景色样式
 * @param styleCategory 样式类别 key
 * @param alpha 透明度 (0-1)
 * @returns CSS 样式对象
 */
export function getHighlightBgStyle(styleCategory: string, alpha: number = 0.2): Record<string, string> {
  const style = getHighlightStyle(styleCategory);
  return hexToBgStyle(style.color, alpha);
}

/**
 * 获取所有可用的划线选项
 * 用于 SelectionMenu 的颜色选择器
 */
export function getHighlightOptions(): Array<{ key: string; color: string; name: string }> {
  const styles = getHighlightStyles();
  return Object.entries(styles).map(([key, info]) => ({
    key,
    color: info.color,
    name: info.name,
  }));
}

/**
 * 获取默认的划线样式 key
 * 用于降级情况
 */
export function getDefaultHighlightKey(): string {
  const styles = getHighlightStyles();
  const keys = Object.keys(styles);
  return keys[0] || 'blue';
}
