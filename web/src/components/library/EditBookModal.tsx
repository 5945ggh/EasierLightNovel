/**
 * 编辑书籍元数据弹窗
 * 支持修改标题、作者和上传封面
 */

import React, { useRef, useState, useEffect } from 'react';
import { X, Upload, Loader2, Image as ImageIcon } from 'lucide-react';
import clsx from 'clsx';
import type { BookDetail } from '@/types/book';

interface EditBookModalProps {
  book: BookDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { title: string; author: string; coverFile?: File }) => Promise<void>;
  isSaving?: boolean;
}

export const EditBookModal: React.FC<EditBookModalProps> = ({
  book,
  isOpen,
  onClose,
  onSave,
  isSaving = false,
}) => {
  const [title, setTitle] = useState(() => book?.title ?? '');
  const [author, setAuthor] = useState(() => book?.author ?? '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(() => book?.cover_url ?? null);
  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 处理封面上传选择（只做本地预览，不立即上传）
  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];

      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        alert('请选择图片文件');
        return;
      }

      // 创建本地预览
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target?.result as string);
      };
      reader.readAsDataURL(file);

      // 保存待上传的文件，等点击保存时才上传
      setPendingCoverFile(file);
    }

    // 清空 input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 处理保存（此时才真正上传封面）
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedTitle = title.trim();
    const trimmedAuthor = author.trim();

    if (!trimmedTitle) {
      alert('书名不能为空');
      return;
    }

    await onSave({
      title: trimmedTitle,
      author: trimmedAuthor,
      coverFile: pendingCoverFile ?? undefined,
    });
    onClose();
  };

  // ESC 键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, onClose]);

  if (!isOpen || !book) return null;

  const hasNewCover = pendingCoverFile !== null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
      {/* 背景遮罩 */}
      <div
        className='absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in'
        onClick={onClose}
      />

      {/* 弹窗内容 */}
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='edit-book-modal-title'
        className='relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-md animate-fade-in overflow-hidden text-slate-800 dark:text-slate-100'
      >
        {/* 头部 */}
        <div className='flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800'>
          <h2 id='edit-book-modal-title' className='text-lg font-bold text-slate-800 dark:text-slate-100'>
            编辑书籍信息
          </h2>
          <button
            onClick={onClose}
            className='p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors'
            disabled={isSaving}
          >
            <X size={20} strokeWidth={1.5} className='text-slate-500 dark:text-slate-400' />
          </button>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSave} className='p-6 space-y-5'>
          {/* 封面预览与上传 */}
          <div className='flex gap-4'>
            {/* 封面预览 */}
            <div className='flex-shrink-0 w-24 h-36 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 relative'>
              {previewUrl ? (
                <>
                  <img
                    src={previewUrl}
                    alt='封面预览'
                    className='w-full h-full object-cover'
                  />
                  {/* 新封面标记 */}
                  {hasNewCover && (
                    <div className='absolute top-1 right-1 w-2 h-2 bg-slate-blue-500 rounded-full' />
                  )}
                </>
              ) : (
                <div className='w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600'>
                  <ImageIcon size={32} strokeWidth={1.5} />
                </div>
              )}
            </div>

            {/* 封面上传按钮 */}
            <div className='flex-1 flex flex-col justify-between'>
              <div>
                <label className='block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1'>
                  封面图片
                </label>
                <p className='text-xs text-slate-500 dark:text-slate-400 mb-3'>
                  支持 JPG、PNG 格式，建议比例 2:3
                </p>
                {hasNewCover && (
                  <p className='text-xs text-slate-blue-600 dark:text-slate-blue-400 mb-2'>
                    新封面将在保存后上传
                  </p>
                )}
              </div>
              <input
                type='file'
                ref={fileInputRef}
                className='hidden'
                accept='image/jpeg,image/png,image/webp'
                onChange={handleCoverChange}
                disabled={isSaving}
              />
              <button
                type='button'
                onClick={() => fileInputRef.current?.click()}
                disabled={isSaving}
                className='flex items-center justify-center gap-2 w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              >
                <Upload size={16} strokeWidth={1.5} />
                <span>{hasNewCover ? '更换图片' : '选择图片'}</span>
              </button>
            </div>
          </div>

          {/* 书名输入 */}
          <div>
            <label htmlFor='title' className='block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5'>
              书名 <span className='text-red-500'>*</span>
            </label>
            <input
              id='title'
              type='text'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='输入书名'
              className='w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-lg focus:ring-2 focus:ring-slate-blue-500 focus:border-slate-blue-500 outline-none transition-all'
              disabled={isSaving}
              maxLength={200}
            />
          </div>

          {/* 作者输入 */}
          <div>
            <label htmlFor='author' className='block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5'>
              作者
            </label>
            <input
              id='author'
              type='text'
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder='输入作者名'
              className='w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-lg focus:ring-2 focus:ring-slate-blue-500 focus:border-slate-blue-500 outline-none transition-all'
              disabled={isSaving}
              maxLength={100}
            />
          </div>

          {/* 底部按钮 */}
          <div className='flex gap-3 pt-2'>
            <button
              type='button'
              onClick={onClose}
              disabled={isSaving}
              className='flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition-colors disabled:opacity-50'
            >
              取消
            </button>
            <button
              type='submit'
              disabled={isSaving}
              className={clsx(
                'flex-1 px-4 py-2.5 rounded-lg font-medium text-white transition-colors flex items-center justify-center gap-2 active:scale-[0.98]',
                isSaving
                  ? 'bg-slate-blue-400 cursor-not-allowed'
                  : 'bg-slate-blue-600 hover:bg-slate-blue-700'
              )}
            >
              {isSaving ? (
                <>
                  <Loader2 size={16} className='animate-spin' />
                  <span>保存中...</span>
                </>
              ) : (
                '保存'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
