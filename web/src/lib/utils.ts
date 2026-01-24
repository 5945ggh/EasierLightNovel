import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 Tailwind CSS 类名
 * 解决 Tailwind 类名冲突问题（如 `px-2 px-4`）
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
