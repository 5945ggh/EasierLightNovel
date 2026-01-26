/**
 * TokenRenderer - 原子组件
 * 负责渲染单个分词 Token，处理 Ruby 注音、点击交互和生词高亮
 *
 * 性能优化：使用 selector 订阅特定状态，避免 store 任何变化都触发重渲染
 */

import React, { useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { useReaderStore } from '@/stores/readerStore';
import type { TokenData } from '@/types/chapter';

interface TokenRendererProps {
  token: TokenData;
  segmentIndex: number;
  tokenIndex: number;
}

/**
 * TokenRenderer 组件
 *
 * 性能关键点：
 * 1. 使用 React.memo 避免父组件重渲染时重渲染
 * 2. 使用 selector 订阅特定状态，而非整个 store
 * 3. 只有当"选中状态"或"生词状态"改变时才重渲染
 */
export const TokenRenderer: React.FC<TokenRendererProps> = React.memo(
  ({ token, segmentIndex, tokenIndex }) => {
    // 1. 只订阅 selectedToken，而非整个 store
    const selectedToken = useReaderStore((s) => s.selectedToken);

    // 2. 只订阅 actions（函数引用稳定，不会触发重渲染）
    const setSelectedToken = useReaderStore((s) => s.setSelectedToken);
    const setIsSidebarOpen = useReaderStore((s) => s.setIsSidebarOpen);

    // 3. 只订阅 vocabularySet，用于判断生词
    const vocabularySet = useReaderStore((s) => s.vocabularySet);

    // 4. 判断是否被选中（计算属性）
    const isSelected = useMemo(
      () =>
        selectedToken?.segmentIndex === segmentIndex &&
        selectedToken?.tokenIndex === tokenIndex,
      [selectedToken, segmentIndex, tokenIndex]
    );

    // 5. 判断是否是生词 (O(1) 查找)
    const isVocab = useMemo(
      () => (token.b ? vocabularySet.has(token.b) : false),
      [token.b, vocabularySet]
    );

    // 6. 点击处理（使用 useCallback 稳定引用）
    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation(); // 防止冒泡触发段落级事件

        // 设置选中状态
        setSelectedToken({
          token,
          segmentIndex,
          tokenIndex,
          text: token.s,
        });

        // 自动打开侧边栏
        setIsSidebarOpen(true);
      },
      [token, segmentIndex, tokenIndex, setSelectedToken, setIsSidebarOpen]
    );

    // 样式类名
    const tokenClasses = clsx(
      'cursor-pointer transition-colors duration-200 rounded-sm px-[1px]',
      {
        // 选中状态：根据不同主题使用不同的配色
        // 白色主题：深蓝色背景 + 白色文字
        'theme-light-selected': isSelected,
        // 暗黑主题：浅蓝色背景 + 深色文字（不覆盖原文）
        'theme-dark-selected': isSelected,
        // 羊皮纸主题：蓝色背景
        'theme-sepia-selected': isSelected,
        // 生词状态：下划线或颜色标记 (未选中时)
        'text-orange-700 decoration-orange-300 underline decoration-2 underline-offset-2':
          isVocab && !isSelected,
        // 悬停状态
        'hover:bg-blue-100/50 dark:hover:bg-blue-900/30': !isSelected,
      }
    );

    // 渲染逻辑：优先使用 RUBY 结构，其次使用 r (reading)，最后只显示 s (surface)

    // A. 如果有详细的 Ruby Parts (精确对应的汉字注音)
    if (token.RUBY && token.RUBY.length > 0) {
      return (
        <span className={tokenClasses} onClick={handleClick}>
          {token.RUBY.map((part, idx) => (
            <React.Fragment key={idx}>
              {part.ruby ? (
                <ruby>
                  {part.text}
                  <rt className="select-none text-[0.65em] text-gray-500 font-normal">
                    {part.ruby}
                  </rt>
                </ruby>
              ) : (
                <span>{part.text}</span>
              )}
            </React.Fragment>
          ))}
        </span>
      );
    }

    // B. 如果只有整体的 reading 且与 surface 不同 (整体注音)
    // 过滤掉片假名本身注音相同的情况，或者标点符号
    const shouldShowFurigana =
      token.r && token.r !== token.s && token.p !== 'Symbol';

    if (shouldShowFurigana) {
      return (
        <ruby className={tokenClasses} onClick={handleClick}>
          {token.s}
          <rt className="select-none text-[0.65em] text-gray-500 font-normal">
            {token.r}
          </rt>
        </ruby>
      );
    }

    // C. 纯文本
    return (
      <span className={tokenClasses} onClick={handleClick}>
        {token.s}
      </span>
    );
  }
);

// 显示名称用于调试
TokenRenderer.displayName = 'TokenRenderer';
