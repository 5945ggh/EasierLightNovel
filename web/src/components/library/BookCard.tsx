/**
 * 书籍卡片组件
 * 展示单本书籍的封面、信息和状态
 * 支持点击进入阅读页、显示处理状态、编辑、删除操作
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Trash2, BookOpen, AlertCircle, Loader2, ImageOff, Edit } from 'lucide-react';
import clsx from 'clsx';
import { ProcessingStatus } from '@/types/common';
import type { BookDetail } from '@/types/book';

interface BookCardProps {
  book: BookDetail;
  onDelete: (id: string) => void;
  onEdit?: (book: BookDetail) => void;
  isDeleting?: boolean;
}

export const BookCard: React.FC<BookCardProps> = ({ book, onDelete, onEdit, isDeleting = false }) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [imgError, setImgError] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // 图片加载状态重置（当 book.cover_url 变化时）
  React.useEffect(() => {
    setImgError(false);
  }, [book.cover_url]);

  // 点击外部关闭菜单
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  // 处理点击卡片主体
  const handleCardClick = () => {
    if (book.status === ProcessingStatus.COMPLETED && !isDeleting) {
      navigate(`/read/${book.id}`);
    }
  };

  // 状态辅助函数
  const isProcessing = book.status === ProcessingStatus.PROCESSING || book.status === ProcessingStatus.PENDING;
  const isFailed = book.status === ProcessingStatus.FAILED;

  // PDF 进度信息
  const getPdfProgressMessage = () => {
    const stage = book.pdf_progress_stage;

    if (!stage) return null;

    const { pdf_progress_current: current, pdf_progress_total: total } = book;

    const stageMessages: Record<string, string> = {
      uploading: '上传 PDF 到解析服务...',
      processing: (total ?? 0) > 0 ? `解析页面 ${current}/${total}...` : '解析中...',
      downloading: '下载解析结果...',
      parsing: '解析内容...',
    };

    return stageMessages[stage] || '处理中...';
  };

  const pdfProgressMessage = getPdfProgressMessage();
  const isPdf = !!book.pdf_progress_stage; // 是否为 PDF（通过进度字段判断）

  return (
    <div
      className={clsx(
        'group relative flex flex-col w-full bg-white rounded-xl shadow-sm',
        'hover:shadow-lg hover:-translate-y-1',
        'transition-all duration-300 ease-out',
        'border border-gray-100 overflow-hidden',
        isDeleting && 'opacity-50 pointer-events-none'
      )}
    >
      {/* 封面区域 (保持 2:3 比例) */}
      <div
        onClick={handleCardClick}
        className={clsx(
          'relative w-full aspect-[2/3] bg-gradient-to-br from-gray-50 to-gray-100',
          'overflow-hidden',
          isProcessing || isFailed ? 'cursor-default' : 'cursor-pointer'
        )}
      >
        {/* 封面图片 */}
        {book.cover_url && !imgError ? (
          <img
            src={book.cover_url}
            alt={book.title}
            className='w-full h-full object-cover transition-transform duration-500 group-hover:scale-105'
            loading='lazy'
            onError={() => setImgError(true)}
          />
        ) : (
          <div className='w-full h-full flex items-center justify-center text-gray-300'>
            {imgError ? (
              // 图片加载失败时显示
              <ImageOff size={48} strokeWidth={1} />
            ) : (
              <BookOpen size={48} strokeWidth={1} />
            )}
          </div>
        )}

        {/* 状态遮罩层: 处理中 */}
        {isProcessing && (
          <div className='absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center text-white'>
            <Loader2 className='animate-spin mb-3' size={28} />
            <span className='text-sm font-medium tracking-wide'>处理中...</span>
            <span className='text-[10px] mt-1 opacity-70'>
              {pdfProgressMessage || '正在解析'}
            </span>
          </div>
        )}

        {/* 状态遮罩层: 失败 */}
        {isFailed && (
          <div className='absolute inset-0 bg-red-500/90 flex flex-col items-center justify-center text-white px-4 text-center'>
            <AlertCircle className='mb-2' size={24} />
            <span className='text-sm font-medium'>解析失败</span>
            {book.error_message && (
              <span className='text-[10px] mt-1.5 opacity-90 line-clamp-2 max-w-full'>
                {book.error_message}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 信息区域 */}
      <div className='p-3 flex-1 flex flex-col' ref={menuRef}>
        <h3
          className='font-bold text-gray-800 line-clamp-2 text-sm leading-tight mb-1'
          title={book.title}
        >
          {book.title}
        </h3>
        <p className='text-xs text-gray-500 line-clamp-1'>
          {book.author || '佚名'}
        </p>

        {/* 底部元数据 */}
        <div className='mt-auto pt-3 flex items-center justify-between text-[10px] text-gray-400'>
          <span className={clsx(isProcessing && 'text-amber-500')}>
            {isProcessing
              ? '处理中'
              : book.total_chapters > 0
                ? `${book.total_chapters} 章节`
                : isPdf ? 'PDF' : 'EPUB'}
          </span>

          {/* 更多操作按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className='p-1.5 hover:bg-gray-100 rounded-full transition-colors'
            aria-label='更多操作'
          >
            <MoreVertical size={14} />
          </button>
        </div>

        {/* 下拉菜单 */}
        {menuOpen && (
          <div className='absolute right-2 bottom-12 z-20 w-32 bg-white rounded-lg shadow-xl border border-gray-100 py-1.5 animate-fade-in'>
            {/* 编辑按钮 */}
            {onEdit && (
              <button
                onClick={() => {
                  onEdit(book);
                  setMenuOpen(false);
                }}
                className='w-full flex items-center px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 text-left transition-colors border-b border-gray-100'
              >
                <Edit size={13} className='mr-2 flex-shrink-0' />
                编辑信息
              </button>
            )}
            {/* 删除按钮 */}
            <button
              onClick={() => {
                onDelete(book.id);
                setMenuOpen(false);
              }}
              className='w-full flex items-center px-3 py-2 text-xs text-red-600 hover:bg-red-50 text-left transition-colors'
            >
              <Trash2 size={13} className='mr-2 flex-shrink-0' />
              删除书籍
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
