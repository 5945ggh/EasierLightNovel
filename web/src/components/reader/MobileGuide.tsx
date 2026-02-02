/**
 * MobileGuide - 移动端使用引导
 * 首次在移动端使用时显示，解释交互方式
 */

import React, { useEffect, useState, useCallback } from 'react';
import { X, BookOpen, Highlighter, Hand } from 'lucide-react';
import { clsx } from 'clsx';

const STORAGE_KEY = 'mobile-guide-shown';

interface GuideStep {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    icon: BookOpen,
    title: '底部导航栏',
    description: '点击底部图标可打开词典、AI 分析、生词本和高亮列表',
  },
  {
    icon: Highlighter,
    title: '添加高亮',
    description: '选择文本后会显示系统菜单，再次点击选中的文本即可添加高亮',
  },
  {
    icon: Hand,
    title: '二次点击',
    description: '点击已选中的文本可以唤起高亮菜单，支持多种颜色标记',
  },
];

interface MobileGuideProps {
  onClose?: () => void;
}

export const MobileGuide: React.FC<MobileGuideProps> = ({ onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  // 检查是否已显示过引导
  useEffect(() => {
    const hasShown = localStorage.getItem(STORAGE_KEY);
    if (!hasShown) {
      // 延迟显示，等待页面加载完成
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    localStorage.setItem(STORAGE_KEY, 'true');
    onClose?.();
  }, [onClose]);

  const handleNext = useCallback(() => {
    if (currentStep < GUIDE_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleClose();
    }
  }, [currentStep, handleClose]);

  const handleSkip = useCallback(() => {
    handleClose();
  }, [handleClose]);

  if (!isVisible) return null;

  const step = GUIDE_STEPS[currentStep];
  const Icon = step.icon;
  const isLastStep = currentStep === GUIDE_STEPS.length - 1;

  return (
    <div className="md:hidden fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleSkip}
      />

      {/* 引导卡片 */}
      <div className="relative w-[90%] max-w-xs bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
        {/* 顶部装饰条 */}
        <div className="h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />

        {/* 关闭按钮 */}
        <button
          onClick={handleSkip}
          className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="关闭"
        >
          <X size={16} />
        </button>

        {/* 内容区域 */}
        <div className="p-5 text-center">
          {/* 图标 */}
          <div className="inline-flex items-center justify-center w-14 h-14 mb-3 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-white">
            <Icon size={24} className="text-white" />
          </div>

          {/* 标题 */}
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
            {step.title}
          </h3>

          {/* 描述 */}
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            {step.description}
          </p>

          {/* 进度指示器 */}
          <div className="flex justify-center gap-1 mt-5">
            {GUIDE_STEPS.map((_, idx) => (
              <div
                key={idx}
                className={clsx(
                  'h-1.5 rounded-full transition-all duration-300',
                  idx === currentStep
                    ? 'w-6 bg-blue-500'
                    : 'w-1.5 bg-gray-300 dark:bg-gray-600'
                )}
              />
            ))}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleSkip}
            className="flex-1 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            跳过
          </button>
          <div className="w-px bg-gray-200 dark:bg-gray-700" />
          <button
            onClick={handleNext}
            className="flex-1 py-2.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
          >
            {isLastStep ? '知道了' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
};
