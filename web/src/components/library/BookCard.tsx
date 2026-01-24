import React from 'react';
import type { BookSummary } from '../../types/book';
import { Clock, BookOpen, Trash2, Loader2, AlertCircle, Edit2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface BookCardProps {
  book: BookSummary;
  onClick: (id: string) => void;
  onEdit: (book: BookSummary) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

export const BookCard: React.FC<BookCardProps> = ({ book, onClick, onEdit, onDelete }) => {
  const isProcessing = book.status === 'pending' || book.status === 'processing';
  const isFailed = book.status === 'failed';

  return (
    <div
      className="group relative flex flex-col bg-white rounded-lg shadow-sm border border-zinc-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => !isProcessing && !isFailed && onClick(book.id)}
    >
      {/* 封面区域 */}
      <div className="aspect-[2/3] w-full bg-zinc-100 relative overflow-hidden">
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt={book.title}
            className={cn(
              "w-full h-full object-cover transition-transform duration-500 group-hover:scale-105",
              isProcessing && "opacity-50 blur-sm"
            )}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-300">
            <BookOpen size={48} />
          </div>
        )}

        {/* 处理中状态遮罩 */}
        {isProcessing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/10 z-10">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            <span className="text-xs font-medium text-indigo-700 mt-2 bg-white/80 px-2 py-1 rounded">
              Processing...
            </span>
          </div>
        )}

        {/* 失败状态遮罩 */}
        {isFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-50/90 z-10">
            <AlertCircle className="w-8 h-8 text-red-500" />
            <span className="text-xs font-medium text-red-700 mt-2 bg-white/80 px-2 py-1 rounded max-w-[80%] truncate">
              {book.error_message || "Processing failed"}
            </span>
          </div>
        )}
      </div>

      {/* 信息区域 */}
      <div className="p-3 flex-1 flex flex-col">
        <h3 className="font-bold text-zinc-900 line-clamp-2 text-sm mb-1" title={book.title}>
          {book.title || "Untitled Book"}
        </h3>
        <p className="text-xs text-zinc-500 mb-2 truncate">
          {book.author || "Unknown Author"}
        </p>

        <div className="mt-auto flex justify-between items-center pt-2 border-t border-zinc-100">
          {/* 显示章节数量和上传时间 */}
          <div className="flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="flex items-center gap-1">
              <BookOpen size={10} />
              {book.total_chapters} ch
            </span>
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {book.created_at ? new Date(book.created_at).toLocaleDateString() : '-'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Edit Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(book);
              }}
              className="text-zinc-400 hover:text-indigo-600 transition-colors p-1"
              title="Edit metadata"
            >
              <Edit2 size={14} />
            </button>

            {/* Delete Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(book.id, e);
              }}
              className="text-zinc-400 hover:text-red-500 transition-colors p-1"
              title="Delete book"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
