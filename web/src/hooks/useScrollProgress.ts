/** Reading restoration and live sampling share a gate with layout restoration. */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { captureReaderAnchor, restoreReaderAnchor } from '@/utils/readerAnchor';
import type { ReaderAnchor } from '@/utils/readerAnchor';

interface UseScrollProgressOptions {
  initialPercentage: number;
  restoreDelay?: number;
  isChapterSwitch?: boolean;
  layoutKey?: string;
}

export const useScrollProgress = (
  containerRef: React.RefObject<HTMLElement | null>,
  onProgressChange: (percentage: number) => void,
  { initialPercentage, restoreDelay = 150, isChapterSwitch = false, layoutKey }: UseScrollProgressOptions,
): void => {
  const callbackRef = useRef(onProgressChange);
  const initialRef = useRef(initialPercentage);
  const restoredRef = useRef(false);
  const programmaticRef = useRef(false);
  const anchorRef = useRef<ReaderAnchor | null>(null);
  const frameRef = useRef(0);
  const settleFrameRef = useRef(0);
  const lastPercentageRef = useRef(initialPercentage);
  const lastScrollTopRef = useRef(0);
  const hasReadRef = useRef(false);

  useLayoutEffect(() => { callbackRef.current = onProgressChange; }, [onProgressChange]);

  // The initial cursor belongs to this mounted chapter, not to later query refreshes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let timer = 0;
    let attempts = 0;
    const initial = isChapterSwitch ? 0 : Math.max(0, Math.min(1, initialRef.current));
    const finishLayout = () => {
      cancelAnimationFrame(settleFrameRef.current);
      settleFrameRef.current = requestAnimationFrame(() => {
        if (disposed) return;
        anchorRef.current = captureReaderAnchor(container);
        lastScrollTopRef.current = container.scrollTop;
        programmaticRef.current = false;
        // A confirmed cursor must use the new geometry when the reader later exits.
        // Merely opening a chapter still never creates a checkpoint.
        const maximum = container.scrollHeight - container.clientHeight;
        const percentage = maximum > 0 ? Math.max(0, Math.min(1, container.scrollTop / maximum)) : 0;
        if (hasReadRef.current && Math.abs(percentage - lastPercentageRef.current) > 0.00001) {
          lastPercentageRef.current = percentage;
          callbackRef.current(percentage);
        }
      });
    };
    const restore = () => {
      if (disposed) return;
      programmaticRef.current = true;
      if (!restoredRef.current) {
        const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = initial * maximum;
        if (maximum > 0 || initial === 0 || ++attempts >= 6) {
          restoredRef.current = true;
          lastPercentageRef.current = maximum > 0 ? container.scrollTop / maximum : 0;
        } else {
          timer = window.setTimeout(restore, restoreDelay);
        }
      } else if (anchorRef.current) {
        restoreReaderAnchor(container, anchorRef.current);
      }
      finishLayout();
    };
    const handleScroll = () => {
      if (!restoredRef.current || programmaticRef.current) return;
      // Ignore a late event from an already completed programmatic restoration.
      if (Math.abs(container.scrollTop - lastScrollTopRef.current) < 1) return;
      lastScrollTopRef.current = container.scrollTop;
      anchorRef.current = captureReaderAnchor(container);
      const maximum = container.scrollHeight - container.clientHeight;
      if (maximum <= 0) return;
      const percentage = Math.max(0, Math.min(1, container.scrollTop / maximum));
      if (Math.abs(percentage - lastPercentageRef.current) > 0.00001) {
        hasReadRef.current = true;
        lastPercentageRef.current = percentage;
        callbackRef.current(percentage);
      }
    };
    const observer = new ResizeObserver(restore);
    observer.observe(container);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    container.addEventListener('scroll', handleScroll, { passive: true });
    restore();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      observer.disconnect();
      container.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(frameRef.current);
      cancelAnimationFrame(settleFrameRef.current);
    };
  }, [containerRef, isChapterSwitch, restoreDelay]);

  // The anchor was sampled before React changed fonts, width, or ruby visibility.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !restoredRef.current || !anchorRef.current) return;
    programmaticRef.current = true;
    restoreReaderAnchor(container, anchorRef.current);
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      lastScrollTopRef.current = container.scrollTop;
      programmaticRef.current = false;
    });
  }, [containerRef, layoutKey]);
};
