export interface ReaderAnchor {
  segmentIndex: string;
  tokenIndex: string | null;
  offset: number;
}

/** Keep an existing reader coordinate and its distance from the viewport top. */
export function captureReaderAnchor(container: HTMLElement): ReaderAnchor | null {
  const viewport = container.getBoundingClientRect();
  const navigation = container.querySelector('[data-reader-navigation]')?.getBoundingClientRect();
  const top = Math.max(viewport.top, navigation?.bottom ?? viewport.top) + 8;
  const segments = container.querySelectorAll<HTMLElement>('.reader-content > [data-segment-index]');
  for (const segment of segments) {
    const bounds = segment.getBoundingClientRect();
    if (bounds.bottom <= top) continue;
    if (bounds.top >= viewport.bottom) break;
    const tokens = segment.querySelectorAll<HTMLElement>('[data-token-index]');
    for (const token of tokens) {
      const rect = token.getBoundingClientRect();
      if (rect.bottom <= top || rect.top >= viewport.bottom) continue;
      return {
        segmentIndex: token.dataset.segmentIndex!,
        tokenIndex: token.dataset.tokenIndex!,
        offset: rect.top - viewport.top,
      };
    }
    // Text paragraphs share their source segment index. A blank paragraph is
    // not a unique anchor; continue to the next visible token instead.
    if (tokens.length === 0 && segment.querySelector('img')) {
      return { segmentIndex: segment.dataset.segmentIndex!, tokenIndex: null, offset: bounds.top - viewport.top };
    }
  }
  return null;
}

export function restoreReaderAnchor(container: HTMLElement, anchor: ReaderAnchor): boolean {
  const token = anchor.tokenIndex === null ? '' : `[data-token-index="${anchor.tokenIndex}"]`;
  const element = container.querySelector<HTMLElement>(
    `.reader-content [data-segment-index="${anchor.segmentIndex}"]${token}`,
  );
  if (!element) return false;
  const offset = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop = Math.max(0, Math.min(
    container.scrollHeight - container.clientHeight,
    container.scrollTop + offset - anchor.offset,
  ));
  return true;
}
