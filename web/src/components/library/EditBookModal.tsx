import React, { useState, useEffect } from 'react';
import type { BookSummary } from '../../types/book';
import { X, Upload, Loader2, Save } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateBookMetadata, updateBookCover } from '../../lib/api';
import { cn } from '../../lib/utils';

interface EditBookModalProps {
  book: BookSummary | null;
  isOpen: boolean;
  onClose: () => void;
}

export const EditBookModal: React.FC<EditBookModalProps> = ({ book, isOpen, onClose }) => {
  const queryClient = useQueryClient();

  // 表单状态
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');

  // 当 book 变化时初始化表单
  useEffect(() => {
    if (book) {
      setTitle(book.title);
      setAuthor(book.author || '');
      setPreviewUrl(book.cover_url || '');
      setCoverFile(null);
    }
  }, [book]);

  // 处理封面选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setCoverFile(file);
      setPreviewUrl(URL.createObjectURL(file)); // 本地预览
    }
  };

  // 提交 Mutation
  const mutation = useMutation({
    mutationFn: async () => {
      if (!book) return;

      const promises = [];

      // 1. 如果文本有变化，更新文本
      if (title !== book.title || author !== (book.author || '')) {
        promises.push(updateBookMetadata(book.id, { title, author }));
      }

      // 2. 如果选了新封面，上传封面
      if (coverFile) {
        promises.push(updateBookCover(book.id, coverFile));
      }

      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      onClose();
    },
    onError: (err) => {
      console.error('Update failed', err);
      alert('Failed to update book details.');
    }
  });

  // 清理预览 URL
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if (!isOpen || !book) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-zinc-100">
          <h2 className="text-lg font-bold text-zinc-800">Edit Book Details</h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded-full transition">
            <X size={20} className="text-zinc-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">

          {/* Cover Image Input */}
          <div className="flex justify-center mb-6">
            <div className="relative group w-32 h-48 bg-zinc-100 rounded-lg overflow-hidden border border-zinc-200 shadow-sm cursor-pointer">
              {previewUrl ? (
                <img src={previewUrl} alt="Cover preview" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-300">
                  <Upload size={32} />
                </div>
              )}

              {/* Overlay for upload */}
              <label className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                <span className="text-white opacity-0 group-hover:opacity-100 font-medium text-xs bg-black/50 px-2 py-1 rounded backdrop-blur-md">
                  Change Cover
                </span>
              </label>
            </div>
          </div>

          {/* Text Inputs */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Author</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-zinc-50 flex justify-end gap-3 border-t border-zinc-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-600 font-medium hover:text-zinc-900 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 text-sm font-medium shadow-sm"
          >
            {mutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};
