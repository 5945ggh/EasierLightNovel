/**
 * 应用入口组件
 * 配置路由和全局状态管理
 */

import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { LibraryPage } from '@/pages/LibraryPage';
import { ReaderPage } from '@/pages/ReaderPage';
import { BookHomePage } from '@/pages/BookHomePage';
import StudyPage from '@/pages/StudyPage';
import SettingsPage from '@/pages/SettingsPage';
import { initConfig } from '@/services/config.service';

const LearningMapPage = lazy(() => import('@/pages/LearningMapPage'));

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

const PageLoader = () => (
  <div className="flex h-screen w-full items-center justify-center bg-gray-50">
    <Loader2 className="animate-spin text-blue-600" size={32} />
  </div>
);

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigInitializer>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/book/:bookId" element={<BookHomePage />} />
            <Route path="/study" element={<StudyPage />} />
            <Route
              path="/study/map/:bookId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <LearningMapPage />
                </Suspense>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/read/:bookId" element={<ReaderPage />} />
          </Routes>
        </BrowserRouter>
      </ConfigInitializer>
    </QueryClientProvider>
  );
}

export default App;
