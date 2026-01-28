import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import fs from 'fs'

/**
 * 读取用户配置
 * 从项目根目录的 config/user.json 读取配置
 */
function loadUserConfig() {
  const configPath = path.resolve(__dirname, '../config/user.json');

  // 默认配置
  const defaultConfig = {
    backend: {
      host: '127.0.0.1',
      port: 8010,
    },
    frontend: {
      port: 5173,
    },
  };

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const userConfig = JSON.parse(content);
      return { ...defaultConfig, ...userConfig };
    }
  } catch (error) {
    console.warn(`[Vite] 读取配置文件失败: ${error}`);
  }

  return defaultConfig;
}

const userConfig = loadUserConfig();
const backendUrl = `http://${userConfig.backend.host}:${userConfig.backend.port}`;
const frontendPort = userConfig.frontend?.port ?? 5173;

console.log('[Vite] 配置加载成功:');
console.log(`  - 后端地址: ${backendUrl}`);
console.log(`  - 前端端口: ${frontendPort}`);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: frontendPort,
    proxy: {
      // 凡是 /api 开头的请求，转发到后端配置的端口
      '/api': {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
      },
      // 凡是 /static 开头的请求（封面图），转发到后端配置的端口
      '/static': {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
