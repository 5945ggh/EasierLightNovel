/**
 * 书架页面
 * 展示所有书籍，支持上传 EPUB/PDF、删除书籍、编辑元数据
 */

import React, { useRef, useState, useEffect } from 'react';
import { Plus, UploadCloud, Library as LibraryIcon, Loader2, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { useLibrary } from '@/hooks/useLibrary';
import { BookCard } from '@/components/library/BookCard';
import { EditBookModal } from '@/components/library/EditBookModal';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { ProcessingStatus } from '@/types/common';
import type { BookDetail } from '@/types/book';

// 上传状态提示组件
const UploadToast: React.FC<{ show: boolean; message: string; type: 'success' | 'error' | 'uploading' }> = ({
  show,
  message,
  type,
}) => {
  if (!show) return null;

  const bgColors = {
    uploading: 'bg-slate-blue-600 dark:bg-slate-blue-700',
    success: 'bg-emerald-600 dark:bg-emerald-700',
    error: 'bg-red-600 dark:bg-red-700',
  };

  const icons = {
    uploading: <Loader2 size={16} className='animate-spin' />,
    success: <CheckCircle size={16} />,
    error: <FileText size={16} />,
  };

  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 ${bgColors[type]} text-white px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium z-50 animate-slide-down`}>
      {icons[type]}
      <span>{message}</span>
    </div>
  );
};

export const LibraryPage: React.FC = () => {
  const {
    books,
    isLoading,
    uploadBook,
    isUploading,
    deleteBook,
    isDeleting,
    updateBookMetadata,
    isUpdating,
    uploadBookCover,
  } = useLibrary();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' | 'uploading' }>({
    show: false,
    message: '',
    type: 'success',
  });
  const [dragCounter, setDragCounter] = useState(0);
  const [editingBook, setEditingBook] = useState<BookDetail | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteReturnFocusElement, setDeleteReturnFocusElement] = useState<HTMLElement | null>(null);

  // Toast 自动关闭逻辑
  useEffect(() => {
    if (toast.show && toast.type !== 'uploading') {
      const timer = setTimeout(() => {
        setToast((prev) => ({ ...prev, show: false }));
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast.show, toast.type]);

  const showToast = (message: string, type: 'success' | 'error' | 'uploading') => {
    setToast({ show: true, message, type });
  };

  const handleFileSelect = async (file: File | null) => {
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.epub') && !fileName.endsWith('.pdf')) {
      showToast('请选择 EPUB 或 PDF 格式的文件', 'error');
      return;
    }

    try {
      showToast('正在上传...', 'uploading');
      await uploadBook(file);
      showToast('上传成功，正在后台解析...', 'success');
    } catch (error) {
      console.error('Upload failed:', error);
      showToast('上传失败，请重试', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setDragCounter((prev) => prev + 1);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragCounter((prev) => (prev - 1 < 0 ? 0 : prev - 1));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragCounter(0);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDeleteRequest = (id: string, returnFocusElement?: HTMLElement | null) => {
    setDeleteReturnFocusElement(
      returnFocusElement ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    );
    setDeleteError(null);
    setDeletingBookId(id);
  };

  const handleCloseDeleteModal = () => {
    setDeleteError(null);
    setDeletingBookId(null);
    setDeleteReturnFocusElement(null);
  };

  const handleConfirmDelete = async () => {
    if (!deletingBookId) return;
    setDeleteError(null);
    try {
      await deleteBook(deletingBookId);
      showToast('书籍已删除', 'success');
      handleCloseDeleteModal();
    } catch (error) {
      console.error('Delete failed:', error);
      setDeleteError('删除失败，请检查连接后重试。');
    }
  };

  const handleEdit = (book: BookDetail) => {
    setEditingBook(book);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingBook(null);
  };

  const handleSave = async (data: { title: string; author: string; coverFile?: File }) => {
    if (!editingBook) return;

    try {
      if (data.coverFile) {
        await uploadBookCover({
          bookId: editingBook.id,
          file: data.coverFile,
        });
      }

      await updateBookMetadata({
        bookId: editingBook.id,
        data: { title: data.title, author: data.author },
      });

      showToast('保存成功', 'success');
    } catch (error) {
      console.error('Save failed:', error);
      showToast('保存失败，请重试', 'error');
      throw error;
    }
  };

  const completedCount = books.filter((b) => b.status === ProcessingStatus.COMPLETED).length;
  const processingCount = books.filter((b) => b.status === ProcessingStatus.PROCESSING || b.status === ProcessingStatus.PENDING).length;
  const failedCount = books.filter((b) => b.status === ProcessingStatus.FAILED).length;

  const isDragOver = dragCounter > 0;

  return (
    <div
      className='min-h-full p-4 text-slate-800 transition-colors dark:text-slate-100 sm:p-6 lg:p-8'
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 上传提示 */}
      <UploadToast {...toast} />

      {/* 拖拽上传遮罩 */}
      {isDragOver && (
        <div className='fixed inset-0 bg-slate-blue-600/10 backdrop-blur-sm z-40 flex items-center justify-center border-4 border-dashed border-slate-blue-500 rounded-2xl m-4'>
          <div className='text-center'>
            <UploadCloud size={64} className='text-slate-blue-600 dark:text-slate-blue-400 mx-auto mb-4 animate-bounce' />
            <p className='text-xl font-semibold text-slate-blue-600 dark:text-slate-blue-400'>拖放 EPUB/PDF 文件到这里</p>
          </div>
        </div>
      )}

      {/* 编辑书籍弹窗 */}
      {isModalOpen && editingBook && (
        <EditBookModal
          key={editingBook.id}
          book={editingBook}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onSave={handleSave}
          isSaving={isUpdating}
        />
      )}

      {/* 确认删除弹窗 */}
      <ConfirmModal
        isOpen={!!deletingBookId}
        title="确认删除书籍？"
        message="确定要删除这本书吗？相应的阅读记录和已收藏词汇数据也将同步清除。"
        confirmText="彻底删除"
        cancelText="取消"
        isDanger={true}
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={handleConfirmDelete}
        onClose={handleCloseDeleteModal}
        returnFocusElement={deleteReturnFocusElement}
      />

      {/* 头部 */}
      <header className='mx-auto mb-7 flex max-w-7xl flex-col justify-between gap-4 sm:flex-row sm:items-center'>
        <div className='flex items-center gap-3'>
          <LibraryIcon size={32} strokeWidth={1.5} className='text-slate-blue-600 dark:text-slate-blue-400 shrink-0' />
          <div>
            <h1 className='text-2xl font-bold text-slate-800 dark:text-slate-100 tracking-tight'>我的书架</h1>
            {books.length > 0 && (
              <p className='text-xs text-slate-500 dark:text-slate-400 mt-0.5'>
                {books.length} 本书 · {completedCount} 本可阅读
                {processingCount > 0 && ` · ${processingCount} 本处理中`}
              </p>
            )}
          </div>
        </div>

        <div>
          <input
            type='file'
            ref={fileInputRef}
            className='hidden'
            accept='.epub,.pdf'
            onChange={handleFileChange}
          />
          <button
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            className='flex items-center gap-2 rounded-lg bg-slate-blue-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-blue-800 disabled:cursor-not-allowed disabled:opacity-60'
          >
            {isUploading ? (
              <>
                <Loader2 size={17} className='animate-spin' />
                <span>上传中...</span>
              </>
            ) : (
              <>
                <Plus size={17} strokeWidth={1.5} />
                <span>导入书籍</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* 内容区域 */}
      <main className='max-w-7xl mx-auto'>
        {isLoading ? (
          <div className='flex flex-col items-center justify-center h-64 text-slate-400 dark:text-slate-500'>
            <Loader2 size={32} className='animate-spin mb-3 text-slate-blue-600 dark:text-slate-blue-400' />
            <span className='text-sm'>加载书架...</span>
          </div>
        ) : books.length === 0 ? (
          /* 空状态 */
          <div className='flex flex-col items-center justify-center h-[500px] border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white/50 dark:bg-slate-900/40 backdrop-blur-sm transition-all hover:border-slate-blue-300 dark:hover:border-slate-700 hover:bg-white/80 dark:hover:bg-slate-900/70'>
            <div className='p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl mb-4 text-slate-400 dark:text-slate-500'>
              <UploadCloud size={48} strokeWidth={1.5} />
            </div>
            <p className='text-slate-700 dark:text-slate-200 font-semibold text-lg mb-1'>还没有书籍</p>
            <p className='text-sm text-slate-500 dark:text-slate-400'>点击右上角按钮或拖放 EPUB/PDF 文件</p>
            <p className='text-xs text-slate-400 dark:text-slate-500 mt-4'>支持导入日文 EPUB/PDF 格式的轻小说</p>
          </div>
        ) : (
          /* 书籍网格 */
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6'>
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onDelete={handleDeleteRequest}
                onEdit={handleEdit}
                isDeleting={isDeleting}
              />
            ))}
          </div>
        )}

        {/* 失败书籍提示 */}
        {failedCount > 0 && (
          <div className='mt-8 p-4 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 rounded-xl flex items-start gap-3 max-w-7xl mx-auto'>
            <AlertCircle size={20} strokeWidth={1.5} className='text-red-500 flex-shrink-0 mt-0.5' />
            <div className='text-sm'>
              <p className='font-medium text-red-700 dark:text-red-300'>有 {failedCount} 本书解析失败</p>
              <p className='text-red-600 dark:text-red-400 mt-1'>请检查 EPUB/PDF 文件是否损坏，或尝试重新上传。</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
