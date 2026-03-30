/**
 * 阅读进度的本地降级存储
 */

const LOCAL_STORAGE_KEY_PREFIX = 'reading_progress_';

export interface ReadingProgressSnapshot {
  chapterIndex: number;
  segmentIndex: number;
  percentage: number;
  timestamp: number;
}

export interface ComparableServerProgress {
  current_chapter_index: number;
  current_segment_index: number;
  progress_percentage: number;
  updated_at?: string | null;
}

const isValidNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getStorageKey = (bookId: string) => `${LOCAL_STORAGE_KEY_PREFIX}${bookId}`;

export const saveReadingProgressSnapshot = (
  bookId: string,
  snapshot: ReadingProgressSnapshot
): void => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getStorageKey(bookId), JSON.stringify(snapshot));
  } catch (error) {
    console.error('[readingProgress] Failed to save progress snapshot:', error);
  }
};

export const loadReadingProgressSnapshot = (
  bookId: string
): ReadingProgressSnapshot | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getStorageKey(bookId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const candidate = parsed as Partial<ReadingProgressSnapshot>;
    if (
      isValidNumber(candidate.chapterIndex) &&
      isValidNumber(candidate.segmentIndex) &&
      isValidNumber(candidate.percentage) &&
      isValidNumber(candidate.timestamp)
    ) {
      return {
        chapterIndex: candidate.chapterIndex,
        segmentIndex: candidate.segmentIndex,
        percentage: Math.max(0, Math.min(1, candidate.percentage)),
        timestamp: candidate.timestamp,
      };
    }
  } catch (error) {
    console.error('[readingProgress] Failed to load progress snapshot:', error);
  }

  return null;
};

export const getServerProgressTimestamp = (
  progress: ComparableServerProgress | null | undefined
): number | null => {
  if (!progress?.updated_at) return null;

  const timestamp = Date.parse(progress.updated_at);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const isLocalSnapshotNewer = (
  localSnapshot: ReadingProgressSnapshot | null,
  serverProgress: ComparableServerProgress | null | undefined
): boolean => {
  if (!localSnapshot) return false;

  const serverTimestamp = getServerProgressTimestamp(serverProgress);
  if (serverTimestamp === null) {
    return true;
  }

  return localSnapshot.timestamp > serverTimestamp;
};
