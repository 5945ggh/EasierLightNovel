/**
 * 书架页面
 * 展示所有书籍，支持上传 EPUB/PDF、删除书籍、编辑元数据
 */

import React, { useRef, useState, useEffect } from 'react';
import { Plus, UploadCloud, Library as LibraryIcon, Loader2, FileText, CheckCircle, AlertCircle, BrainCircuit } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLibrary } from '@/hooks/useLibrary';
import { BookCard } from '@/components/library/BookCard';
import { EditBookModal } from '@/components/library/EditBookModal';
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
    uploading: 'bg-blue-600',
    success: 'bg-green-600',
    error: 'bg-red-600',
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

  // Toast 自动关闭逻辑 - 使用 useEffect 清理定时器，避免竞态问题
  useEffect(() => {
    if (toast.show && toast.type !== 'uploading') {
      const timer = setTimeout(() => {
        setToast((prev) => ({ ...prev, show: false }));
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast.show, toast.type]);

  // 显示提示
  const showToast = (message: string, type: 'success' | 'error' | 'uploading') => {
    setToast({ show: true, message, type });
  };

  // 处理文件选择
  const handleFileSelect = async (file: File | null) => {
    if (!file) return;

    // 验证文件类型
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
      // 清空 input 允许再次选择同一文件
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  // 拖拽上传 - 使用计数器防止子元素触发 dragLeave 导致闪烁
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setDragCounter((prev) => prev + 1);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      // 只在第一次进入时显示遮罩（通过计数器判断）
      setDragCounter((prev) => {
        if (prev === 1) return prev;
        return prev;
      });
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragCounter((prev) => {
      const newCount = prev - 1;
      // 只有当计数器归零时，才认为真的离开了拖拽区域
      return newCount < 0 ? 0 : newCount;
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    // 必须阻止默认行为才能允许 drop
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragCounter(0); // 重置计数器

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('确定要删除这本书吗？阅读记录和生词本也将被清除。')) {
      try {
        await deleteBook(id);
        showToast('书籍已删除', 'success');
      } catch (error) {
        console.error('Delete failed:', error);
        showToast('删除失败，请重试', 'error');
      }
    }
  };

  // 打开编辑弹窗
  const handleEdit = (book: BookDetail) => {
    setEditingBook(book);
    setIsModalOpen(true);
  };

  // 关闭编辑弹窗
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setTimeout(() => setEditingBook(null), 300); // 动画结束后清空
  };

  // 保存元数据（包括封面）
  const handleSave = async (data: { title: string; author: string; coverFile?: File }) => {
    if (!editingBook) return;

    try {
      // 如果有新封面，先上传封面
      if (data.coverFile) {
        await uploadBookCover({
          bookId: editingBook.id,
          file: data.coverFile,
        });
      }

      // 再更新元数据
      await updateBookMetadata({
        bookId: editingBook.id,
        data: { title: data.title, author: data.author },
      });

      showToast('保存成功', 'success');
    } catch (error) {
      console.error('Save failed:', error);
      showToast('保存失败，请重试', 'error');
      throw error; // 重新抛出以便弹窗知道保存失败
    }
  };

  // 统计信息
  const completedCount = books.filter((b) => b.status === ProcessingStatus.COMPLETED).length;
  const processingCount = books.filter((b) => b.status === ProcessingStatus.PROCESSING || b.status === ProcessingStatus.PENDING).length;
  const failedCount = books.filter((b) => b.status === ProcessingStatus.FAILED).length;

  const isDragOver = dragCounter > 0;

  return (
    <div
      className='min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 sm:p-6 md:p-10 transition-colors'
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 上传提示 */}
      <UploadToast {...toast} />

      {/* 拖拽上传遮罩 */}
      {isDragOver && (
        <div className='fixed inset-0 bg-blue-600/10 backdrop-blur-sm z-40 flex items-center justify-center border-4 border-dashed border-blue-500 rounded-2xl m-4'>
          <div className='text-center'>
            <UploadCloud size={64} className='text-blue-600 mx-auto mb-4 animate-bounce' />
            <p className='text-xl font-semibold text-blue-600'>拖放 EPUB/PDF 文件到这里</p>
          </div>
        </div>
      )}

      {/* 编辑书籍弹窗 */}
      <EditBookModal
        book={editingBook}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSave={handleSave}
        isSaving={isUpdating}
      />

      {/* 头部 */}
      <header className='max-w-7xl mx-auto mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <div className='p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl text-white shadow-lg shadow-blue-200'>
            <LibraryIcon size={24} />
          </div>
          <div>
            <h1 className='text-2xl font-bold text-gray-800 tracking-tight'>我的书架</h1>
            {books.length > 0 && (
              <p className='text-xs text-gray-500 mt-0.5'>
                {books.length} 本书 · {completedCount} 本可阅读
                {processingCount > 0 && ` · ${processingCount} 本处理中`}
              </p>
            )}
          </div>
        </div>

        {/* 右侧按钮组 */}
        <div className='flex items-center gap-3'>
          {/* 学习中心入口 */}
          <Link
            to='/study'
            className='flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl transition-all shadow-sm hover:shadow-md font-medium text-sm'
          >
            <BrainCircuit size={18} className='text-indigo-500' />
            <span>学习中心</span>
          </Link>

          {/* 上传按钮 */}
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
              className='flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed font-medium text-sm'
            >
              {isUploading ? (
                <>
                  <Loader2 size={18} className='animate-spin' />
                  <span>上传中...</span>
                </>
              ) : (
                <>
                  <Plus size={18} />
                  <span>导入书籍</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* 内容区域 */}
      <main className='max-w-7xl mx-auto'>
        {isLoading ? (
          <div className='flex flex-col items-center justify-center h-64 text-gray-400'>
            <Loader2 size={32} className='animate-spin mb-3 text-blue-500' />
            <span className='text-sm'>加载书架...</span>
          </div>
        ) : books.length === 0 ? (
          /* 空状态 */
          <div className='flex flex-col items-center justify-center h-[500px] border-2 border-dashed border-gray-200 rounded-3xl bg-white/50 backdrop-blur transition-all hover:border-blue-300 hover:bg-white/80'>
            <div className='p-4 bg-gray-100 rounded-2xl mb-4'>
              <UploadCloud size={48} className='text-gray-400' />
            </div>
            <p className='text-gray-700 font-semibold text-lg mb-1'>还没有书籍</p>
            <p className='text-sm text-gray-500'>点击右上角按钮或拖放 EPUB/PDF 文件</p>
            <p className='text-xs text-gray-400 mt-4'>支持导入日文 EPUB/PDF 格式的轻小说</p>
          </div>
        ) : (
          /* 书籍网格 */
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6'>
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onDelete={handleDelete}
                onEdit={handleEdit}
                isDeleting={isDeleting}
              />
            ))}
          </div>
        )}

        {/* 失败书籍提示 */}
        {failedCount > 0 && (
          <div className='mt-8 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 max-w-7xl mx-auto'>
            <AlertCircle size={20} className='text-red-500 flex-shrink-0 mt-0.5' />
            <div className='text-sm'>
              <p className='font-medium text-red-700'>有 {failedCount} 本书解析失败</p>
              <p className='text-red-600 mt-1'>请检查 EPUB/PDF 文件是否损坏，或尝试重新上传。</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
