import axios from'axios';

// 创建 axios 实例
export const api = axios.create({
  // 因为配置了 Vite 代理，这里直接用 /api 即可
  // 生产环境可能需要根据 import.meta.env.VITE_API_URL 判断
  baseURL: '/api', 
  timeout: 60000, // 60秒超时，防止大文件上传中断
});

// 响应拦截器：简化数据返回，处理通用错误
api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    // 这里可以接入 Toast 提示错误
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

// ==================== Book API ====================

// 更新书籍元数据 (Title, Author)
export const updateBookMetadata = (id: string, data: { title?: string; author?: string }) => {
  return api.patch(`/books/${id}`, data);
};

// 单独更新封面
export const updateBookCover = (id: string, file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post(`/books/${id}/cover`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};
