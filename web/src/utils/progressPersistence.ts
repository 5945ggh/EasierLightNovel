export type ProgressSaveStatus = 'idle' | 'pending' | 'saved' | 'local-only' | 'error';

/** Serialize writes across reader mounts; a rejection must not poison later writes. */
export function enqueueProgressWrite<T>(
  pending: Map<string, Promise<unknown>>,
  bookId: string,
  write: () => Promise<T>,
): Promise<T> {
  const result = (pending.get(bookId) ?? Promise.resolve()).catch(() => {}).then(write);
  pending.set(bookId, result);
  const remove = () => { if (pending.get(bookId) === result) pending.delete(bookId); };
  void result.then(remove, remove);
  return result;
}

/** Local snapshots are synchronous; only remote writes are debounced. */
export function createProgressSaver<T>({
  writeLocal, writeRemote, onStatus = () => {}, delay = 1000,
}: {
  writeLocal: (value: T) => boolean;
  writeRemote: (value: T) => Promise<unknown>;
  onStatus?: (status: ProgressSaveStatus) => void;
  delay?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T; localSaved: boolean; revision: number } | undefined;
  let revision = 0;
  let inFlight = Promise.resolve();

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    const sample = pending;
    pending = undefined;
    if (!sample) return inFlight;
    inFlight = Promise.resolve().then(() => writeRemote(sample.value)).then(
      () => { if (sample.revision === revision) onStatus('saved'); },
      () => { if (sample.revision === revision) onStatus(sample.localSaved ? 'local-only' : 'error'); },
    );
    return inFlight;
  };

  return {
    record(value: T) {
      const localSaved = writeLocal(value);
      pending = { value, localSaved, revision: ++revision };
      onStatus('pending');
      clearTimeout(timer);
      timer = setTimeout(() => { void flush(); }, delay);
    },
    flush,
  };
}
