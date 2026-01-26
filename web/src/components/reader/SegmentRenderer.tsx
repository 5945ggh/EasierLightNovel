/**
 * SegmentRenderer - 分子组件
 * 负责渲染文本段落或图片段落
 *
 * 性能优化：使用 React.memo 避免不必要的重渲染
 * 布局优化：图片容器预设最小高度，避免图片加载导致的布局偏移
 */

import React from 'react';
import { TokenRenderer } from './TokenRenderer';
import type { ContentSegment, TextSegment, ImageSegment } from '@/types/chapter';

interface SegmentRendererProps {
  segment: ContentSegment;
  index: number;
}

const TextSegmentRenderer: React.FC<{
  segment: TextSegment;
  index: number;
}> = React.memo(
  ({ segment, index }) => {
    if (!segment.tokens) return null;

    // 将 token 数组按 gap 分组，实现真正的段落分隔
    const paragraphs: Array<{ tokens: typeof segment.tokens; startIdx: number }> = [];
    let currentGroup: typeof segment.tokens = [];
    let currentStartIdx = 0;

    // 判断 token 是否为段落分隔符
    const isParagraphBreak = (token: typeof segment.tokens[0]): boolean => {
      // 1. 显式的 gap 标记
      if (token.gap) return true;
      // 2. 空字符串或纯空白（通常是分段标记）
      if (!token.s || /^\s*$/.test(token.s)) return true;
      // 3. 全角空格（常见的日文分段标记）
      if (token.s === '　') return true;
      return false;
    };

    segment.tokens.forEach((token, tIdx) => {
      // 跳过分段标记 token 本身，不渲染
      if (isParagraphBreak(token)) {
        // 结束当前段落
        if (currentGroup.length > 0) {
          paragraphs.push({ tokens: currentGroup, startIdx: currentStartIdx });
          currentGroup = [];
          currentStartIdx = tIdx + 1;
        }
        return;
      }

      currentGroup.push(token);
    });

    // 添加最后一个段落（如果有剩余 token）
    if (currentGroup.length > 0) {
      paragraphs.push({ tokens: currentGroup, startIdx: currentStartIdx });
    }

    return (
      <>
        {paragraphs.map(({ tokens, startIdx }, pIdx) => (
          <p
            key={`${index}-p-${pIdx}`}
            data-segment-index={index}
            className="mb-6 text-justify"
            style={{ textIndent: '1em' }}
          >
            {tokens.map((token, relIdx) => {
              const tIdx = startIdx + relIdx;
              return (
                <React.Fragment key={`${index}-${tIdx}`}>
                  <TokenRenderer token={token} segmentIndex={index} tokenIndex={tIdx} />
                </React.Fragment>
              );
            })}
          </p>
        ))}
      </>
    );
  }
);

TextSegmentRenderer.displayName = 'TextSegmentRenderer';

const ImageSegmentRenderer: React.FC<{
  segment: ImageSegment;
  index: number;
}> = React.memo(({ segment, index }) => {
  return (
    <div
      data-segment-index={index}
      className="my-8 flex justify-center"
      style={{ minHeight: '200px' }}
    >
      <img
        src={segment.src}
        alt={segment.alt || 'illustration'}
        loading="lazy"
        className="max-w-full max-h-[80vh] object-contain rounded-md shadow-sm"
      />
    </div>
  );
});

ImageSegmentRenderer.displayName = 'ImageSegmentRenderer';

export const SegmentRenderer: React.FC<SegmentRendererProps> = React.memo((props) => {
  const { segment } = props;

  if (segment.type === 'image') {
    return <ImageSegmentRenderer segment={segment} index={props.index} />;
  }

  return <TextSegmentRenderer segment={segment} index={props.index} />;
});

SegmentRenderer.displayName = 'SegmentRenderer';
