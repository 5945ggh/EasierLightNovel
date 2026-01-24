import { defineConfig } from'vite'
import react from '@vitejs/plugin-react-swc'
import path from'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // 这里的端口是前端运行端口，通常是 5173
    port: 5173,
    proxy: {
      // 凡是 /api 开头的请求，转发到 8010
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
        secure: false,
      },
      // 凡是 /static 开头的请求（封面图），转发到 8010
      '/static': {
        target: 'http://localhost:8010',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
