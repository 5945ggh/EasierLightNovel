import React from'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { BookSummary } from '../../types/book';
import { BookCard } from './BookCard';
import { EditBookModal } from './EditBookModal';
import { Upload, Loader2, Plus } from'lucide-react';

export const LibraryContainer: React.FC = () => {
  const queryClient = useQueryClient();
  const [editingBook, setEditingBook] = React.useState<BookSummary | null>(null);

  // 1. 获取书籍列表
  const { data: books, isLoading } = useQuery<BookSummary[]>({
    queryKey: ['books'],
    queryFn: () => api.get('/books'),
    // 智能轮询：如果列表中有正在处理的书，每 2 秒刷新一次，否则不刷新
    refetchInterval: (query) => {
        const data = query.state.data as BookSummary[] | undefined;
        const hasProcessing = data?.some(b => b.status === 'processing' || b.status === 'pending');
        return hasProcessing ? 2000 : false;
    }
  });

  // 2. 上传书籍 Mutation
  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post('/books/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
    onError: (error) => {
      console.error('Upload failed:', error);
      // TODO: 后续替换为 Toast 组件
      alert('Upload failed. Please check if the file is a valid EPUB.');
    }
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      uploadMutation.mutate(e.target.files[0]);
    }
  };

  const handleDelete = async (id: string) => {
      if(!confirm("Delete this book?")) return;
      await api.delete(`/books/${id}`);
      queryClient.invalidateQueries({ queryKey: ['books'] });
  }

  const handleEdit = (book: BookSummary) => {
    setEditingBook(book);
  };

  const handleRead = (id: string) => {
      console.log("Navigating to reader for:", id);
      // 这里后续接路由跳转
  };

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-10">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-serif font-bold text-zinc-900">Library</h1>
          <p className="text-zinc-500 mt-1">Manage your Japanese collection</p>
        </div>
        
        {/* 上传按钮 */}
        <div className="relative">
            <input 
                type="file" 
                id="epub-upload" 
                accept=".epub" 
                className="hidden" 
                onChange={handleFileUpload}
                disabled={uploadMutation.isPending}
            />
            <label 
                htmlFor="epub-upload" 
                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer disabled:opacity-50"
            >
                {uploadMutation.isPending ? (
                    <Loader2 className="animate-spin" size={18} />
                ) : (
                    <Plus size={18} />
                )}
                <span>Import EPUB</span>
            </label>
        </div>
      </header>

      {/* 列表内容 */}
      {isLoading ? (
          <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-300" />
          </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {/* 空状态提示 */}
            {books?.length === 0 && (
                <div className="col-span-full text-center py-20 border-2 border-dashed border-zinc-200 rounded-xl bg-zinc-50">
                    <Upload className="mx-auto h-10 w-10 text-zinc-300 mb-3" />
                    <h3 className="text-zinc-600 font-medium">No books yet</h3>
                    <p className="text-zinc-400 text-sm mt-1">Upload an EPUB to start reading</p>
                </div>
            )}

            {books?.map((book) => (
                <BookCard
                    key={book.id}
                    book={book}
                    onClick={handleRead}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                />
            ))}
        </div>
      )}

      {/* 编辑模态框 */}
      <EditBookModal
        isOpen={!!editingBook}
        book={editingBook}
        onClose={() => setEditingBook(null)}
      />
    </div>
  );
};
