/**
 * 书籍阅读进度的本地降级存储。
 *
 * v2 keeps the book resume cursor separate from per-chapter checkpoints while
 * transparently migrating the old one-snapshot format on first read/write.
 */

const LOCAL_STORAGE_KEY_PREFIX = 'reading_progress_';
const SNAPSHOT_VERSION = 2 as const;

export type ReadingProgressState = 'in_progress' | 'completed';

export interface ReadingProgressSnapshot {
  chapterIndex: number;
  segmentIndex: number;
  percentage: number;
  timestamp: number;
  state?: ReadingProgressState;
}

export interface ReadingProgressStore {
  version: typeof SNAPSHOT_VERSION;
  resume: ReadingProgressSnapshot | null;
  chapters: Record<string, ReadingProgressSnapshot>;
}

export interface ComparableServerProgress {
  current_chapter_index: number;
  current_segment_index: number;
  progress_percentage: number;
  updated_at?: string | null;
}

export interface ComparableServerChapterProgress {
  chapter_index: number;
  current_segment_index: number;
  progress_percentage: number;
  state?: ReadingProgressState;
  updated_at?: string | null;
}

export interface ReaderPosition {
  percentage: number;
  segmentIndex: number;
}

export interface ReaderPositionInput {
  targetChapterIndex: number | null;
  isExplicitChapterRequest: boolean;
  selectedChapterProgress: ReadingProgressSnapshot | ComparableServerChapterProgress | null;
  persistedProgress: ComparableServerProgress | null | undefined;
}

const isValidNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getStorageKey = (bookId: string) => `${LOCAL_STORAGE_KEY_PREFIX}${bookId}`;

const getChapterKey = (chapterIndex: number) => String(chapterIndex);

const normalizeSnapshot = (value: unknown): ReadingProgressSnapshot | null => {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<ReadingProgressSnapshot>;
  if (
    !isValidNumber(candidate.chapterIndex) ||
    !Number.isInteger(candidate.chapterIndex) ||
    candidate.chapterIndex < 0 ||
    !isValidNumber(candidate.segmentIndex) ||
    candidate.segmentIndex < 0 ||
    !isValidNumber(candidate.percentage) ||
    !isValidNumber(candidate.timestamp)
  ) {
    return null;
  }

  const state = candidate.state === 'completed' ? 'completed' : 'in_progress';
  return {
    chapterIndex: candidate.chapterIndex,
    segmentIndex: candidate.segmentIndex,
    percentage: Math.max(0, Math.min(1, candidate.percentage)),
    timestamp: candidate.timestamp,
    state,
  };
};

const emptyStore = (): ReadingProgressStore => ({
  version: SNAPSHOT_VERSION,
  resume: null,
  chapters: {},
});

const parseStore = (parsed: unknown): ReadingProgressStore => {
  if (!parsed || typeof parsed !== 'object') return emptyStore();

  const candidate = parsed as {
    version?: unknown;
    resume?: unknown;
    chapters?: unknown;
  };
  if (candidate.version === SNAPSHOT_VERSION) {
    const store = emptyStore();
    store.resume = normalizeSnapshot(candidate.resume);
    if (candidate.chapters && typeof candidate.chapters === 'object') {
      Object.entries(candidate.chapters).forEach(([key, value]) => {
        const snapshot = normalizeSnapshot(value);
        if (snapshot) store.chapters[key] = snapshot;
      });
    }
    return store;
  }

  // Legacy format: the object itself was the book-level cursor. Keep it as
  // both resume and the matching chapter checkpoint so no location is lost.
  const legacySnapshot = normalizeSnapshot(parsed);
  if (!legacySnapshot) return emptyStore();
  return {
    version: SNAPSHOT_VERSION,
    resume: legacySnapshot,
    chapters: {
      [getChapterKey(legacySnapshot.chapterIndex)]: legacySnapshot,
    },
  };
};

export const loadReadingProgressStore = (bookId: string): ReadingProgressStore => {
  if (typeof window === 'undefined') return emptyStore();

  try {
    const raw = window.localStorage.getItem(getStorageKey(bookId));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as { version?: unknown };
    const store = parseStore(parsed);
    if (parsed.version !== SNAPSHOT_VERSION) {
      window.localStorage.setItem(getStorageKey(bookId), JSON.stringify(store));
    }
    return store;
  } catch (error) {
    console.error('[readingProgress] Failed to load progress snapshot:', error);
    return emptyStore();
  }
};

const writeStore = (bookId: string, store: ReadingProgressStore): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getStorageKey(bookId), JSON.stringify(store));
};

export const saveChapterProgressSnapshot = (
  bookId: string,
  snapshot: ReadingProgressSnapshot,
  options: { updateResume?: boolean } = {}
): void => {
  if (typeof window === 'undefined') return;

  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) return;

  try {
    const store = loadReadingProgressStore(bookId);
    store.chapters[getChapterKey(normalized.chapterIndex)] = normalized;
    if (options.updateResume) store.resume = normalized;
    writeStore(bookId, store);
  } catch (error) {
    console.error('[readingProgress] Failed to save progress snapshot:', error);
  }
};

/** Save a confirmed reading event to both the chapter and book cursors. */
export const saveReadingProgressSnapshot = (
  bookId: string,
  snapshot: ReadingProgressSnapshot
): void => {
  saveChapterProgressSnapshot(bookId, snapshot, { updateResume: true });
};

/** Return the book-level cursor used by the Continue Reading action. */
export const loadReadingProgressSnapshot = (
  bookId: string
): ReadingProgressSnapshot | null => loadReadingProgressStore(bookId).resume;

export const loadChapterProgressSnapshot = (
  bookId: string,
  chapterIndex: number
): ReadingProgressSnapshot | null => {
  return loadReadingProgressStore(bookId).chapters[getChapterKey(chapterIndex)] ?? null;
};

export const clearReadingProgressSnapshot = (bookId: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getStorageKey(bookId));
  } catch (error) {
    console.error('[readingProgress] Failed to clear progress snapshot:', error);
  }
};

export const getServerProgressTimestamp = (
  progress: ComparableServerProgress | ComparableServerChapterProgress | null | undefined
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
  return serverTimestamp === null || localSnapshot.timestamp > serverTimestamp;
};

export const isLocalChapterSnapshotNewer = (
  localSnapshot: ReadingProgressSnapshot | null,
  serverProgress: ComparableServerChapterProgress | null | undefined
): boolean => {
  if (!localSnapshot) return false;
  const serverTimestamp = getServerProgressTimestamp(serverProgress);
  return serverTimestamp === null || localSnapshot.timestamp > serverTimestamp;
};

export const chooseChapterProgress = (
  localSnapshot: ReadingProgressSnapshot | null,
  serverProgress: ComparableServerChapterProgress | null | undefined
): ReadingProgressSnapshot | ComparableServerChapterProgress | null => {
  if (localSnapshot && isLocalChapterSnapshotNewer(localSnapshot, serverProgress)) {
    return localSnapshot;
  }
  return serverProgress ?? localSnapshot;
};

/** Accept only a non-negative integer that exists in the current TOC. */
export const parseChapterQuery = (
  rawQueryChapter: string | null,
  chapterIndexes: readonly number[]
): number | null => {
  if (rawQueryChapter === null) return null;

  const rawValue = rawQueryChapter.trim();
  const parsedIndex = Number(rawValue);
  if (
    !/^\d+$/.test(rawValue) ||
    !Number.isSafeInteger(parsedIndex) ||
    parsedIndex < 0 ||
    !chapterIndexes.includes(parsedIndex)
  ) {
    return null;
  }

  return parsedIndex;
};

/** Resolve a chapter's initial position without falling back across chapters. */
export const resolveInitialReaderPosition = ({
  targetChapterIndex,
  isExplicitChapterRequest,
  selectedChapterProgress,
  persistedProgress,
}: ReaderPositionInput): ReaderPosition => {
  if (isExplicitChapterRequest) {
    if (!selectedChapterProgress) return { percentage: 0, segmentIndex: 0 };

    if ('chapterIndex' in selectedChapterProgress) {
      return {
        percentage: selectedChapterProgress.percentage,
        segmentIndex: selectedChapterProgress.segmentIndex,
      };
    }

    return {
      percentage: selectedChapterProgress.progress_percentage / 100,
      segmentIndex: selectedChapterProgress.current_segment_index,
    };
  }

  if (
    !persistedProgress ||
    targetChapterIndex === null ||
    persistedProgress.current_chapter_index !== targetChapterIndex
  ) {
    return { percentage: 0, segmentIndex: 0 };
  }

  return {
    percentage: persistedProgress.progress_percentage / 100,
    segmentIndex: persistedProgress.current_segment_index,
  };
};
