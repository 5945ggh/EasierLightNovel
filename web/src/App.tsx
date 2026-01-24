import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LibraryContainer } from './components/library/LibraryContainer';

// 创建 QueryClient 实例
const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-gray-50/50">
         {/* 暂时直接显示 Library，后续加路由 */}
        <LibraryContainer />
      </div>
    </QueryClientProvider>
  )
}

export default App
