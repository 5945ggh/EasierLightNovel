/**
 * SelectionMenu - 划线工具栏
 * 当用户选中一段文本时，显示悬浮工具栏
 * 功能：高亮（多种颜色）、朗读、删除高亮
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useDismiss,
  useInteractions,
  FloatingPortal,
} from '@floating-ui/react';
import { Volume2, X, Trash2 } from 'lucide-react';
import { useReaderStore, type PendingHighlight } from '@/stores/readerStore';
import { createHighlight, deleteHighlight } from '@/services/highlights.service';
import { speak } from '@/utils/tts';
import { clsx } from 'clsx';

/**
 * 选区坐标信息
 */
interface SelectionCoordinates {
  start: { segIdx: number; tokIdx: number };
  end: { segIdx: number; tokIdx: number };
  text: string;
}

/**
 * 高亮颜色配置
 */
const HIGHLIGHT_COLORS = [
  { name: 'yellow', bgClass: 'bg-yellow-300', hoverClass: 'hover:ring-2 ring-yellow-400' },
  { name: 'green', bgClass: 'bg-green-300', hoverClass: 'hover:ring-2 ring-green-400' },
  { name: 'blue', bgClass: 'bg-blue-300', hoverClass: 'hover:ring-2 ring-blue-400' },
  { name: 'pink', bgClass: 'bg-pink-300', hoverClass: 'hover:ring-2 ring-pink-400' },
  { name: 'purple', bgClass: 'bg-purple-300', hoverClass: 'hover:ring-2 ring-purple-400' },
] as const;

type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]['name'];

/**
 * SelectionMenu 组件
 */
export const SelectionMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<SelectionCoordinates | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [existingHighlightId, setExistingHighlightId] = useState<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const {
    addHighlightOptimistic,
    removePendingHighlight,
    addHighlight,
    removeHighlight,
    highlights,
    bookId,
    chapterIndex,
  } = useReaderStore();

  // Floating UI 配置
  const {
    refs,
    floatingStyles,
    context,
  } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset(10), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    placement: 'top',
  });

  const dismiss = useDismiss(context);
  const { getFloatingProps } = useInteractions([dismiss]);

  /**
   * 从 DOM 节点向上查找，找到包含 data-segment-index 和 data-token-index 的元素
   */
  const findTokenData = useCallback((node: Node | null): { segIdx: number; tokIdx: number } | null => {
    let current = node instanceof Element ? node : node?.parentElement;
    while (current) {
      if (current.hasAttribute('data-segment-index') && current.hasAttribute('data-token-index')) {
        const segIdx = parseInt(current.getAttribute('data-segment-index')!, 10);
        const tokIdx = parseInt(current.getAttribute('data-token-index')!, 10);
        if (!isNaN(segIdx) && !isNaN(tokIdx)) {
          return { segIdx, tokIdx };
        }
      }
      current = current.parentElement;
      // 边界：到达内容区域
      if (current?.classList.contains('reader-content')) break;
    }
    return null;
  }, []);

  /**
   * 监听鼠标抬起事件，检测选区
   */
  useEffect(() => {
    const handleMouseUp = () => {
      // 清除之前的定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // 延迟检测，避免拖拽时误触发
      timeoutRef.current = window.setTimeout(() => {
        const selection = window.getSelection();

        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          setIsOpen(false);
          setCoords(null);
          return;
        }

        const r = selection.getRangeAt(0);
        const text = selection.toString().trim();

        if (text.length === 0) {
          setIsOpen(false);
          return;
        }

        // 检查选区是否在阅读器内容区域内
        const container = r.commonAncestorContainer;
        const inReaderArea =
          container instanceof HTMLElement &&
          (container.closest('.reader-content') || container.closest('[data-segment-index]'));

        if (!inReaderArea) {
          setIsOpen(false);
          return;
        }

        // 解析选区坐标
        const parsedCoords = {
          start: findTokenData(r.startContainer)!,
          end: findTokenData(r.endContainer)!,
          text,
        };

        if (!parsedCoords.start || !parsedCoords.end) {
          setIsOpen(false);
          return;
        }

        setCoords(parsedCoords);

        // 检查选区是否已经有高亮（可能有多个重复高亮）
        const matchingHighlights = highlights.filter((h) =>
          h.start_segment_index === parsedCoords.start.segIdx &&
          h.start_token_idx === parsedCoords.start.tokIdx &&
          h.end_segment_index === parsedCoords.end.segIdx &&
          h.end_token_idx === parsedCoords.end.tokIdx
        );
        // 如果有多个重复高亮，选择最新的（id 最大的）
        const latestHighlight = matchingHighlights.length > 0
          ? matchingHighlights.reduce((latest, current) =>
              current.id > latest.id ? current : latest
            )
          : null;
        setExistingHighlightId(latestHighlight?.id ?? null);

        // 设置 Floating UI 的参考元素为选区 Range
        const virtualEl = {
          getBoundingClientRect: () => r.getBoundingClientRect(),
          getClientRects: () => r.getClientRects(),
        };
        refs.setReference(virtualEl);
        setIsOpen(true);
      }, 10);
    };

    const handleSelectionChange = () => {
      // 当选区清空时关闭菜单
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('selectionchange', handleSelectionChange);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [refs, findTokenData, highlights]);

  /**
   * 处理高亮操作（乐观更新）
   */
  const handleHighlight = useCallback(
    async (color: HighlightColor) => {
      if (!coords || !bookId || chapterIndex === null || isProcessing) return;

      setIsProcessing(true);

      const { start, end, text } = coords;

      // 构造临时高亮数据
      const tempId = `temp-${Date.now()}`;
      const pendingHighlight: PendingHighlight = {
        tempId,
        start_segment_index: start.segIdx,
        start_token_idx: start.tokIdx,
        end_segment_index: end.segIdx,
        end_token_idx: end.tokIdx,
        style_category: color,
        book_id: bookId,
        chapter_index: chapterIndex,
        selected_text: text,
      };

      // 1. 乐观更新 UI
      addHighlightOptimistic(pendingHighlight);

      // 2. 关闭菜单并清空选区
      setIsOpen(false);
      window.getSelection()?.removeAllRanges();

      try {
        // 3. 发送 API 请求，获取服务器返回的真实高亮数据
        const result = await createHighlight({
          book_id: bookId,
          chapter_index: chapterIndex,
          start_segment_index: start.segIdx,
          start_token_idx: start.tokIdx,
          end_segment_index: end.segIdx,
          end_token_idx: end.tokIdx,
          style_category: color,
          selected_text: text,
        });

        // 成功后：添加真实高亮，移除临时高亮
        addHighlight({
          id: result.id,
          start_segment_index: start.segIdx,
          start_token_idx: start.tokIdx,
          end_segment_index: end.segIdx,
          end_token_idx: end.tokIdx,
          style_category: result.style_category,
        });
        removePendingHighlight(tempId);
      } catch (error) {
        console.error('Failed to create highlight:', error);
        // 失败时回滚
        removePendingHighlight(tempId);
      } finally {
        setIsProcessing(false);
      }
    },
    [coords, bookId, chapterIndex, isProcessing, addHighlightOptimistic, removePendingHighlight, addHighlight]
  );

  /**
   * 处理朗读操作（使用浏览器原生 TTS）
   */
  const handleTTS = useCallback(() => {
    const text = window.getSelection()?.toString();
    if (text) {
      speak(text);
    }
    setIsOpen(false);
  }, []);

  /**
   * 处理删除高亮
   */
  const handleDeleteHighlight = useCallback(async () => {
    if (!existingHighlightId) return;

    setIsProcessing(true);

    try {
      // 乐观更新
      removeHighlight(existingHighlightId);

      // 发送请求
      await deleteHighlight(existingHighlightId);
    } catch (error) {
      console.error('Failed to delete highlight:', error);
      // 失败时不回滚，因为刷新后会恢复
    } finally {
      setIsProcessing(false);
    }

    setIsOpen(false);
    window.getSelection()?.removeAllRanges();
  }, [existingHighlightId, removeHighlight]);

  if (!isOpen) return null;

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        {...getFloatingProps()}
        className="z-[60] flex items-center bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        {existingHighlightId ? (
          // 已有高亮：显示删除选项
          <div className="flex items-center px-1 py-1 space-x-0.5">
            <button
              onClick={handleDeleteHighlight}
              disabled={isProcessing}
              className="flex items-center gap-1 px-2 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 dark:text-red-400 rounded transition-colors"
              title="删除高亮"
            >
              <Trash2 size={16} />
              删除高亮
            </button>
            <div className="w-[1px] h-4 bg-gray-300 mx-1" />
            <button
              onClick={handleTTS}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-700 dark:text-gray-200 transition-colors"
              title="朗读"
            >
              <Volume2 size={16} />
            </button>
            <button
              onClick={() => {
                setIsOpen(false);
                window.getSelection()?.removeAllRanges();
              }}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              title="取消"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          // 无高亮：显示颜色选择
          <>
            {/* 颜色选择区 */}
            <div className="flex items-center px-1.5 py-1 space-x-1 border-r border-gray-200 dark:border-gray-700">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color.name}
                  onClick={() => handleHighlight(color.name)}
                  disabled={isProcessing}
                  className={clsx(
                    'w-5 h-5 rounded-full transition-all',
                    color.bgClass,
                    color.hoverClass,
                    isProcessing && 'opacity-50 cursor-not-allowed'
                  )}
                  title={`高亮: ${color.name}`}
                />
              ))}
            </div>

            {/* 功能按钮区 */}
            <div className="flex items-center px-1 py-1 space-x-0.5">
              <button
                onClick={handleTTS}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-700 dark:text-gray-200 transition-colors"
                title="朗读"
              >
                <Volume2 size={16} />
              </button>
              <button
                onClick={() => {
                  setIsOpen(false);
                  window.getSelection()?.removeAllRanges();
                }}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                title="取消"
              >
                <X size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </FloatingPortal>
  );
};