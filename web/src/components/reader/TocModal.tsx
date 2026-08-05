/**
 * TocModal - 目录模态框
 * 显示章节列表，支持点击跳转
 * 使用 React Portal 挂载到 document.body，避免被父级容器裁剪
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import type { ChapterListItem } from '@/types/chapter';

interface TocModalProps {
  isOpen: boolean;
  onClose: () => void;
  chapters: ChapterListItem[];
  currentIndex: number | null;
  onChapterSelect: (index: number) => void;
}

export const TocModal: React.FC<TocModalProps> = ({
  isOpen,
  onClose,
  chapters,
  currentIndex,
  onChapterSelect,
}) => {
  // ESC 键关闭模态框
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // 禁用背景滚动
  useEffect(() => {
    if (!isOpen) return;

    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[70vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">目次</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X size={20} strokeWidth={1.5} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {/* 章节列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          <ul className="space-y-1">
            {chapters.map((chapter) => (
              <li key={chapter.index}>
                <button
                  onClick={() => {
                    onChapterSelect(chapter.index);
                    onClose();
                  }}
                  className={clsx(
                    'w-full text-left px-4 py-3 rounded-xl transition-all text-sm',
                    chapter.index === currentIndex
                      ? 'bg-slate-blue-100 dark:bg-slate-blue-900/30 text-slate-blue-600 dark:text-slate-blue-400 font-medium'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 dark:text-slate-500 w-6 flex-shrink-0">
                      {chapter.index + 1}
                    </span>
                    <span className="line-clamp-1">{chapter.title}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* 底部统计 */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-400 dark:text-slate-500 text-center">
          全 {chapters.length} 章
        </div>
      </div>
    </div>,
    document.body
  );
};
