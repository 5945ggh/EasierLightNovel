import type { ChapterHighlightData, ContentSegment, TokenData } from '../types/chapter.ts';

export interface ReaderTokenPart {
  token: TokenData;
  tokenIndex: number | null;
  sourceTokenIndex: number;
}

/** Existing highlights use the indices assigned by the original paragraph renderer. */
function legacyTokenIndices(tokens: TokenData[]): Array<number | null> {
  let start = 0;
  let count = 0;
  return tokens.map((token, index) => {
    if (token.gap || !token.s || /^\s*$/.test(token.s)) {
      if (count > 0) { count = 0; start = index + 1; }
      return null;
    }
    return start + count++;
  });
}

/** Restore whitespace without changing the interaction coordinates of old books. */
export function splitReaderParagraphs(tokens: TokenData[]): ReaderTokenPart[][] {
  if (!tokens.length) return [];
  const indices = legacyTokenIndices(tokens);
  const paragraphs: ReaderTokenPart[][] = [[]];
  tokens.forEach((token, tokenIndex) => {
    const parts = token.s.split(/\r\n|[\r\n]/);
    parts.forEach((surface, partIndex) => {
      if (partIndex > 0) paragraphs.push([]);
      if (!surface) return;
      // A split surface cannot safely reuse ruby for the entire original token.
      const part = parts.length === 1
        ? token
        : { ...token, s: surface, r: undefined, RUBY: undefined };
      paragraphs[paragraphs.length - 1].push({ token: part, tokenIndex: indices[tokenIndex], sourceTokenIndex: tokenIndex });
    });
  });
  return paragraphs;
}

/** Convert persisted renderer coordinates before indexing the source token array. */
export function getSourceTokenIndex(tokens: TokenData[], tokenIndex: number): number | null {
  const index = legacyTokenIndices(tokens).indexOf(tokenIndex);
  return index < 0 ? null : index;
}

/** Saved text retains partial-token selections; older records use legacy coordinates. */
export function getReaderHighlightText(
  segments: ContentSegment[],
  highlight: Pick<ChapterHighlightData, 'start_segment_index' | 'end_segment_index' | 'start_token_idx' | 'end_token_idx' | 'selected_text'>,
): string {
  if (highlight.selected_text) return highlight.selected_text;
  const text: string[] = [];
  for (let s = highlight.start_segment_index; s <= highlight.end_segment_index; s++) {
    const segment = segments[s];
    if (segment?.type !== 'text' || !segment.tokens) continue;
    const start = s === highlight.start_segment_index
      ? getSourceTokenIndex(segment.tokens, highlight.start_token_idx) : 0;
    const end = s === highlight.end_segment_index
      ? getSourceTokenIndex(segment.tokens, highlight.end_token_idx) : segment.tokens.length - 1;
    if (start === null || end === null) continue;
    text.push(segment.tokens.slice(start, end + 1).map((token) => token.s).join(''));
  }
  return text.join('');
}
