/**
 * TokenRenderer - 原子组件
 * 负责渲染单个分词 Token，处理 Ruby 注音、点击交互、生词高亮和划线高亮
 *
 * 性能优化：使用 selector 订阅特定状态，避免 store 任何变化都触发重渲染
 */

import React, { useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { useReaderStore, getTokenKey } from '@/stores/readerStore';
import type { TokenData } from '@/types/chapter';

interface TokenRendererProps {
  token: TokenData;
  segmentIndex: number;
  tokenIndex: number;
}

/**
 * 高亮颜色样式映射
 */
const HIGHLIGHT_STYLES: Record<string, string> = {
  yellow: 'bg-yellow-200/60 dark:bg-yellow-500/30',
  green: 'bg-green-200/60 dark:bg-green-500/30',
  blue: 'bg-blue-200/60 dark:bg-blue-500/30',
  pink: 'bg-pink-200/60 dark:bg-pink-500/30',
  purple: 'bg-purple-200/60 dark:bg-purple-500/30',
};

/**
 * TokenRenderer 组件
 *
 * 性能关键点：
 * 1. 使用 React.memo 避免父组件重渲染时重渲染
 * 2. 使用 selector 订阅特定状态，而非整个 store
 * 3. 只有当"选中状态"、"生词状态"或"高亮状态"改变时才重渲染
 */
export const TokenRenderer: React.FC<TokenRendererProps> = React.memo(
  ({ token, segmentIndex, tokenIndex }) => {
    // 1. 只订阅 selectedToken
    const selectedToken = useReaderStore((s) => s.selectedToken);

    // 2. 只订阅 actions（函数引用稳定，不会触发重渲染）
    const setSelectedToken = useReaderStore((s) => s.setSelectedToken);

    // 3. 只订阅 vocabularySet，用于判断生词
    const vocabularySet = useReaderStore((s) => s.vocabularySet);

    // 4. 订阅高亮相关状态
    // 同时订阅 highlights 和 pendingHighlights 以触发重渲染
    // 这是因为 highlightMap 是 Map 对象，直接读取 .get() 结果不会触发 Map 内容变化的更新
    useReaderStore((s) => s.highlights.length + s.pendingHighlights.length);
    const highlightStyle = useReaderStore((s) =>
      s.highlightMap.get(getTokenKey(segmentIndex, tokenIndex))
    );

    // 5. 判断是否被选中（计算属性）
    const isSelected = useMemo(
      () =>
        selectedToken?.segmentIndex === segmentIndex &&
        selectedToken?.tokenIndex === tokenIndex,
      [selectedToken, segmentIndex, tokenIndex]
    );

    // 6. 判断是否是生词 (O(1) 查找)
    const isVocab = useMemo(
      () => (token.b ? vocabularySet.has(token.b) : false),
      [token.b, vocabularySet]
    );

    // 7. 点击处理（使用 useCallback 稳定引用）
    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        // 如果用户正在划线（Selection 不为空），则阻止点击事件，优先处理划线
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          console.log('[TokenRenderer] 点击被阻止：选区存在', selection.toString());
          return;
        }

        e.stopPropagation();

        // 设置选中状态
        setSelectedToken({
          token,
          segmentIndex,
          tokenIndex,
          text: token.s,
        });
      },
      [token, segmentIndex, tokenIndex, setSelectedToken]
    );

    // 8. 样式组合
    const containerClasses = clsx(
      'relative cursor-pointer transition-colors duration-150 rounded-sm px-[0.5px]',
      // Layer 1: 高亮背景色
      highlightStyle && HIGHLIGHT_STYLES[highlightStyle],
      // Layer 2: 选中状态（最高优先级）
      {
        'bg-indigo-500 text-white': isSelected,
        'hover:bg-black/5 dark:hover:bg-white/10': !isSelected && !highlightStyle,
      }
    );

    // Layer 3: 生词样式（下划线）
    const vocabClasses = clsx({
      'border-b-2 border-orange-400 dark:border-orange-500': isVocab && !isSelected,
      'text-orange-700 dark:text-orange-300': isVocab && !isSelected,
    });

    // 数据属性，用于划线定位
    const dataProps = {
      'data-segment-index': segmentIndex,
      'data-token-index': tokenIndex,
    };

    // 渲染注音内容
    const renderContent = () => {
      // A. 如果有详细的 Ruby Parts (精确对应的汉字注音)
      if (token.RUBY && token.RUBY.length > 0) {
        return (
          <>
            {token.RUBY.map((part, idx) => (
              <React.Fragment key={idx}>
                {part.ruby ? (
                  <ruby>
                    {part.text}
                    <rt
                      className={clsx(
                        'select-none text-[0.6em] font-normal',
                        isSelected ? 'text-indigo-200' : 'text-gray-500'
                      )}
                    >
                      {part.ruby}
                    </rt>
                  </ruby>
                ) : (
                  <span>{part.text}</span>
                )}
              </React.Fragment>
            ))}
          </>
        );
      }

      // B. 如果只有整体的 reading 且与 surface 不同 (整体注音)
      const shouldShowFurigana = token.r && token.r !== token.s && token.p !== 'Symbol';

      if (shouldShowFurigana) {
        return (
          <ruby>
            {token.s}
            <rt
              className={clsx(
                'select-none text-[0.6em] font-normal',
                isSelected ? 'text-indigo-200' : 'text-gray-500'
              )}
            >
              {token.r}
            </rt>
          </ruby>
        );
      }

      // C. 纯文本
      return token.s;
    };

    return (
      <span className={clsx(containerClasses, vocabClasses)} onClick={handleClick} {...dataProps}>
        {renderContent()}
      </span>
    );
  }
);

// 显示名称用于调试
TokenRenderer.displayName = 'TokenRenderer';
