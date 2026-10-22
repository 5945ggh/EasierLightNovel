/**
 * TocModal - 目录模态框
 * 显示章节列表，支持点击跳转
 * 使用 React Portal 挂载到 document.body，避免被父级容器裁剪
 */

import React, { useEffect, useRef, useState, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import type { ChapterListItem } from '@/types/chapter';
import type { ChapterProgressResponse } from '@/types/progress';
import type { ReadingProgressSnapshot } from '@/utils/readingProgress';

interface TocModalProps {
  isOpen: boolean;
  onClose: () => void;
  chapters: ChapterListItem[];
  currentIndex: number | null;
  onChapterSelect: (index: number) => void;
  chapterProgressByIndex?: ReadonlyMap<number, ReadingProgressSnapshot | ChapterProgressResponse>;
}

export const TocModal: React.FC<TocModalProps> = ({
  isOpen,
  onClose,
  chapters,
  currentIndex,
  onChapterSelect,
  chapterProgressByIndex,
}) => {
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const close = useCallback(() => {
    setQuery('');
    onCloseRef.current();
  }, []);
  const visibleChapters = chapters.filter((chapter) => chapter.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    const currentChapter = dialog?.querySelector<HTMLButtonElement>('[aria-current="page"]');
    (currentChapter ?? dialog?.querySelector<HTMLElement>('input, button'))?.focus({ preventScroll: true });
    currentChapter?.scrollIntoView({ block: 'center' });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={close}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full mx-4 max-w-md max-h-[70vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 id={titleId} className="text-lg font-bold text-slate-900 dark:text-slate-100">目次</h2>
          <button
            onClick={close}
            aria-label="关闭目录"
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X size={20} strokeWidth={1.5} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <div className="px-4 pt-3">
          <input type="search" aria-label="筛选章节标题" placeholder="筛选章节标题" value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm text-slate-900 dark:text-slate-100" />
        </div>
        {/* 章节列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {visibleChapters.length === 0 && <p className="px-4 py-6 text-sm text-slate-500" role="status">没有匹配的章节</p>}
          <ul className="space-y-1">
            {visibleChapters.map((chapter) => (
              <li key={chapter.index}>
                <button
                  onClick={() => {
                    onChapterSelect(chapter.index);
                    close();
                  }}
                  aria-current={chapter.index === currentIndex ? 'page' : undefined}
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
                    <span className="min-w-0 flex-1">
                      <span className="block line-clamp-1">{chapter.title}</span>
                      {(() => {
                        const progress = chapterProgressByIndex?.get(chapter.index);
                        if (!progress) return <span className="block mt-1 text-xs text-slate-400">未开始</span>;
                        const percentage = 'percentage' in progress ? progress.percentage * 100 : progress.progress_percentage;
                        return <span className="block mt-1 text-xs opacity-70">{progress.state === 'completed' ? '已完成 · ' : ''}上次停留 {Math.round(Math.max(0, Math.min(100, percentage)))}%</span>;
                      })()}
                    </span>
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
