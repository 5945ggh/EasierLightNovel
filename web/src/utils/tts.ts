/**
 * TTS (文本朗读) 工具模块
 * 解决 Chrome 浏览器 Web Speech API 兼容性问题
 */

// 初始化标志
let isInitialized = false;

/**
 * 初始化 TTS 语音引擎
 * Chrome 需要在用户交互后预先触发语音加载
 */
export function initTTS(): void {
  if (isInitialized || !('speechSynthesis' in window)) {
    return;
  }

  try {
    // Chrome 需要"唤醒"语音引擎
    // 调用 getVoices 触发语音加载
    window.speechSynthesis.getVoices();

    // 监听语音加载完成事件
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => {
        // 语音列表加载完成
      };
    }

    isInitialized = true;
  } catch (error) {
    console.warn('[TTS] 初始化失败:', error);
  }
}

/**
 * 播放文本朗读
 * @param text - 要朗读的文本
 * @param options - 朗读选项
 */
export function speak(text: string, options: { lang?: string; rate?: number } = {}): void {
  if (!('speechSynthesis' in window)) {
    console.warn('[TTS] 当前浏览器不支持语音合成');
    return;
  }

  if (!text) {
    console.warn('[TTS] 文本为空，跳过朗读');
    return;
  }

  try {
    // 取消当前正在播放的语音
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang || 'ja-JP';
    utterance.rate = options.rate ?? 0.9;

    // 添加错误处理
    utterance.onerror = (event) => {
      console.error('[TTS] 朗读错误:', event.error);
    };

    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.error('[TTS] 播放失败:', error);
  }
}

/**
 * 取消当前朗读
 */
export function cancel(): void {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * 检查浏览器是否支持 TTS
 */
export function isTTSSupported(): boolean {
  return 'speechSynthesis' in window;
}

/**
 * 获取可用的语音列表
 */
export function getVoices(): SpeechSynthesisVoice[] {
  if (!isTTSSupported()) {
    return [];
  }
  return window.speechSynthesis.getVoices();
}
