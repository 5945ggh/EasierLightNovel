/**
 * Toast - 通用提示组件
 */

import React from 'react';
import { CheckCircle, AlertCircle, Loader2, Info } from 'lucide-react';
import { clsx } from 'clsx';

export type ToastType = 'success' | 'error' | 'loading' | 'info';

export interface ToastState {
  show: boolean;
  message: string;
  type: ToastType;
}

interface ToastProps {
  show: boolean;
  message: string;
  type: ToastType;
}

const toastConfig = {
  success: {
    bgClass: 'bg-green-600 dark:bg-green-700',
    icon: <CheckCircle size={16} />,
  },
  error: {
    bgClass: 'bg-red-600 dark:bg-red-700',
    icon: <AlertCircle size={16} />,
  },
  loading: {
    bgClass: 'bg-blue-600 dark:bg-blue-700',
    icon: <Loader2 size={16} className="animate-spin" />,
  },
  info: {
    bgClass: 'bg-gray-700 dark:bg-gray-600',
    icon: <Info size={16} />,
  },
};

export const Toast: React.FC<ToastProps> = ({ show, message, type }) => {
  if (!show) return null;

  const config = toastConfig[type];

  return (
    <div
      className={clsx(
        'fixed top-4 left-1/2 -translate-x-1/2',
        config.bgClass,
        'text-white px-4 py-2.5 rounded-full shadow-lg',
        'flex items-center gap-2 text-sm font-medium z-50',
        'animate-in fade-in slide-in-from-top-4 duration-200'
      )}
    >
      {config.icon}
      <span>{message}</span>
    </div>
  );
};

/**
 * Toast Hook - 用于管理 Toast 状态
 */
export const useToast = () => {
  const [toast, setToast] = React.useState<ToastState>({
    show: false,
    message: '',
    type: 'info',
  });

  const showToast = React.useCallback((message: string, type: ToastType = 'info', duration = 3000) => {
    setToast({ show: true, message, type });

    if (duration > 0 && type !== 'loading') {
      setTimeout(() => {
        setToast((prev) => ({ ...prev, show: false }));
      }, duration);
    }
  }, []);

  const hideToast = React.useCallback(() => {
    setToast((prev) => ({ ...prev, show: false }));
  }, []);

  return { toast, showToast, hideToast };
};
