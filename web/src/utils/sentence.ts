import type { ContentSegment } from '@/types';

// 例句最大长度限制
const MAX_CONTEXT_SENTENCE_LENGTH = 100;

/**
 * 从段落中截取包含指定 Token 的句子
 * 按日语标点（。！？」）分割句子，限制最大长度
 */
export const extractSentenceFromSegment = (
  segmentIndex: number,
  tokenIndex: number,
  segments?: ContentSegment[]
): string | null => {
  if (!segments) return null;

  const segment = segments[segmentIndex];
  if (segment?.type !== 'text' || !segment.tokens) return null;

  // 构建段落文本
  let segmentText = '';
  const tokenPositions: number[] = []; // 记录每个 token 在段落文本中的起始位置
  let currentPos = 0;

  for (const t of segment.tokens) {
    const prefix = t.gap && currentPos > 0 ? ' ' : '';
    if (prefix) currentPos += 1;
    tokenPositions.push(currentPos);
    segmentText += prefix + t.s;
    currentPos += t.s.length;
  }

  // 找到当前 token 在段落文本中的位置
  const tokenStartPos = tokenPositions[tokenIndex] ?? 0;
  const tokenEndPos = tokenStartPos + (segment.tokens[tokenIndex]?.s?.length ?? 0);

  // 按日语标点分割句子
  const sentenceEndMarks = ['。', '！', '？', '」', '』', '）', '(', '「', '『'];
  let sentenceStart = 0;
  let sentenceEnd = segmentText.length;

  // 向前找句子起点
  for (let i = tokenStartPos - 1; i >= 0; i--) {
    if (sentenceEndMarks.includes(segmentText[i])) {
      sentenceStart = i + 1;
      break;
    }
  }

  // 向后找句子终点
  for (let i = tokenEndPos; i < segmentText.length; i++) {
    if (sentenceEndMarks.includes(segmentText[i])) {
      sentenceEnd = i + 1;
      break;
    }
  }

  let sentence = segmentText.slice(sentenceStart, sentenceEnd).trim();

  // 长度限制：如果超过限制，以 token 为中心截取
  if (sentence.length > MAX_CONTEXT_SENTENCE_LENGTH) {
    const halfLength = Math.floor(MAX_CONTEXT_SENTENCE_LENGTH / 2);
    const tokenCenterInSentence = tokenStartPos - sentenceStart + Math.floor((tokenEndPos - tokenStartPos) / 2);

    const newStart = Math.max(0, tokenCenterInSentence - halfLength);
    const newEnd = Math.min(sentence.length, tokenCenterInSentence + halfLength);

    sentence = sentence.slice(newStart, newEnd).trim();
    // 添加省略号
    if (newStart > 0) sentence = '...' + sentence;
    if (newEnd < segmentText.length) sentence = sentence + '...';
  }

  return sentence.length > 0 ? sentence : null;
};
