/**
 * SegmentRenderer - 分子组件
 * 负责渲染文本段落或图片段落
 *
 * 性能优化：使用 React.memo 避免不必要的重渲染
 * 布局优化：图片容器预设最小高度，避免图片加载导致的布局偏移
 */

import React from 'react';
import { TokenRenderer } from './TokenRenderer';
import { splitReaderParagraphs } from '@/utils/readerText';
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

    const paragraphs = splitReaderParagraphs(segment.tokens);

    return (
      <>
        {paragraphs.map((tokens, pIdx) => (
          <p
            key={`${index}-p-${pIdx}`}
            data-segment-index={index}
            className="mb-6 text-justify"
            style={{ textIndent: '1em', whiteSpace: 'pre-wrap', minHeight: '1em' }}
          >
            {tokens.map(({ token, tokenIndex: tIdx, sourceTokenIndex }) => {
              return (
                <React.Fragment key={`${index}-${sourceTokenIndex}`}>
                  {tIdx === null ? token.s : <TokenRenderer token={token} segmentIndex={index} tokenIndex={tIdx} sourceTokenIndex={sourceTokenIndex} />}
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
