function readerRoot(node: Node): Element | null {
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  if (element?.closest('rt, rp')) return null;
  return element?.closest('.reader-content') ?? null;
}

/** Both endpoints must belong to the same reader, including Text-node ranges. */
export function isReaderSelectionRange(range: Pick<Range, 'startContainer' | 'endContainer'>): boolean {
  const root = readerRoot(range.startContainer);
  return root !== null && root === readerRoot(range.endContainer);
}

export function getReaderSelectionText(range: Pick<Range, 'cloneContents' | 'toString'>): string {
  const fragment = range.cloneContents();
  const annotations = fragment.querySelectorAll('rt, rp');
  if (annotations.length === 0) return range.toString().trim();
  annotations.forEach((annotation) => annotation.remove());
  return fragment.textContent?.trim() ?? '';
}

/** Resolve tokens by actual selected content, since whitespace has no token wrapper. */
export function getReaderSelectionCoordinates(range: Range): {
  start: { segIdx: number; tokIdx: number };
  end: { segIdx: number; tokIdx: number };
} | null {
  if (!isReaderSelectionRange(range)) return null;
  const root = readerRoot(range.startContainer)!;
  let start: { segIdx: number; tokIdx: number } | null = null;
  let end: { segIdx: number; tokIdx: number } | null = null;
  for (const token of root.querySelectorAll('[data-segment-index][data-token-index]')) {
    const tokenRange = root.ownerDocument.createRange();
    tokenRange.selectNodeContents(token);
    const intersection = range.cloneRange();
    // Compare like endpoints, then clamp to the token to exclude merely touching
    // boundaries and ruby-only portions of a selection.
    if (range.compareBoundaryPoints(0, tokenRange) < 0) {
      intersection.setStart(tokenRange.startContainer, tokenRange.startOffset);
    }
    if (range.compareBoundaryPoints(2, tokenRange) > 0) {
      intersection.setEnd(tokenRange.endContainer, tokenRange.endOffset);
    }
    if (intersection.collapsed || !getReaderSelectionText(intersection)) continue;
    const segIdx = Number(token.getAttribute('data-segment-index'));
    const tokIdx = Number(token.getAttribute('data-token-index'));
    if (!Number.isInteger(segIdx) || !Number.isInteger(tokIdx)) continue;
    start ??= { segIdx, tokIdx };
    end = { segIdx, tokIdx };
  }
  return start && end ? { start, end } : null;
}
