import { apiClient } from './api-client';
import type {
  ReaderLookupEventRequest,
  ReaderLookupEventResponse,
} from '@/types/readerLookup';

export const createReaderLookupEventId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `reader-lookup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const recordReaderLookup = async (
  bookId: string,
  request: ReaderLookupEventRequest,
): Promise<ReaderLookupEventResponse> => {
  return apiClient.post<ReaderLookupEventResponse>(
    `/books/${bookId}/reader/lookup-events`,
    request,
  );
};
