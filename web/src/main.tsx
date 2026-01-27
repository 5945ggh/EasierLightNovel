import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTTS } from './utils/tts'

// 初始化 TTS 语音引擎（解决 Chrome 兼容性问题）
// 通过用户交互事件触发，确保在用户与页面交互后才初始化
const initTTSOnInteraction = () => {
  initTTS();
  document.removeEventListener('click', initTTSOnInteraction);
  document.removeEventListener('keydown', initTTSOnInteraction);
};

document.addEventListener('click', initTTSOnInteraction, { once: true });
document.addEventListener('keydown', initTTSOnInteraction, { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
