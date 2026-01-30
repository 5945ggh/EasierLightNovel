/**
 * TokenRenderer - 原子组件
 * 负责渲染单个分词 Token，处理 Ruby 注音、点击交互、生词高亮和划线高亮
 *
 * 性能优化：使用 selector 订阅特定状态，避免 store 任何变化都触发重渲染
 */

import React, { useCallback } from 'react';
import clsx from 'clsx';
import { useReaderStore, getTokenKey } from '@/stores/readerStore';
import type { TokenData } from '@/types/chapter';
import { getHighlightStyleWithFallback } from '@/utils/highlightStyles';

interface TokenRendererProps {
  token: TokenData;
  segmentIndex: number;
  tokenIndex: number;
}

/**
 * 获取划线内联样式（带缓存）
 */
let lastStyleCategory: string | null = null;
let lastInlineStyle: { backgroundColor: string } | null = null;

function getHighlightInlineStyle(styleCategory: string): { backgroundColor: string } | null {
  // 缓存优化：如果 key 相同，直接返回缓存结果
  if (lastStyleCategory === styleCategory && lastInlineStyle) {
    return lastInlineStyle;
  }

  const style = getHighlightStyleWithFallback(styleCategory);
  const hex = style.color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  lastInlineStyle = { backgroundColor: `rgba(${r}, ${g}, ${b}, 0.25)` };
  lastStyleCategory = styleCategory;

  return lastInlineStyle;
}

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
    // 1. 订阅选中状态 - 使用 selector 只在匹配时才触发重渲染
    const isSelected = useReaderStore((s) =>
      s.selectedToken?.segmentIndex === segmentIndex &&
      s.selectedToken?.tokenIndex === tokenIndex
    );

    // 2. 只订阅 actions（函数引用稳定，不会触发重渲染）
    const setSelectedToken = useReaderStore((s) => s.setSelectedToken);

    // 3. 订阅生词状态 - 使用 selector 只在匹配时才触发重渲染
    // 这样添加/删除生词时，只有相关的 Token 会重新渲染
    const isVocab = useReaderStore((s) =>
      token.b ? s.vocabularySet.has(token.b) : false
    );

    // 4. 订阅高亮相关状态
    // 订阅 highlightRevision 以在 highlightMap 更新时触发重渲染
    // 使用 highlightRevision 而不是 highlights.length，这样只有版本号变化时才触发
    useReaderStore((s) => s.highlightRevision);
    const highlightStyle = useReaderStore((s) =>
      s.highlightMap.get(getTokenKey(segmentIndex, tokenIndex))
    );

    // 5. 点击处理（使用 useCallback 稳定引用）
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
    const highlightInlineStyle = highlightStyle ? getHighlightInlineStyle(highlightStyle) : null;
    const containerClasses = clsx(
      'relative cursor-pointer transition-colors duration-150 rounded-sm px-[0.5px]',
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
      <span
        className={clsx(containerClasses, vocabClasses)}
        style={highlightInlineStyle ?? undefined}
        onClick={handleClick}
        {...dataProps}
      >
        {renderContent()}
      </span>
    );
  }
);

// 显示名称用于调试
TokenRenderer.displayName = 'TokenRenderer';
