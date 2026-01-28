/**
 * 应用入口组件
 * 配置路由和全局状态管理
 */

import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LibraryPage } from '@/pages/LibraryPage';
import { ReaderPage } from '@/pages/ReaderPage';
import { initConfig } from '@/services/config.service';

// 创建 React Query 客户端
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * 配置初始化组件
 * 在应用启动时从后端获取配置
 */
function ConfigInitializer({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initConfig()
      .then(() => setIsReady(true))
      .catch((err) => {
        console.error('配置初始化失败:', err);
        setError('配置加载失败，部分功能可能不可用');
        // 即使失败也继续加载应用
        setIsReady(true);
      });
  }, []);

  if (!isReady) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '1.2rem',
        color: '#666',
      }}>
        正在初始化配置...
      </div>
    );
  }

  if (error) {
    console.warn(error);
  }

  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigInitializer>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/read/:bookId" element={<ReaderPage />} />
          </Routes>
        </BrowserRouter>
      </ConfigInitializer>
    </QueryClientProvider>
  );
}

export default App;
