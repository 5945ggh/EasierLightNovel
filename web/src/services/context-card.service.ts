import apiClient from './api-client';
import type {
  ContextCardAnkiWriteRequest,
  ContextCardDraft,
  ContextCardDraftCreate,
  ContextCardDraftUpdate,
} from '@/types/contextCard';

export const createContextCardDraft = (data: ContextCardDraftCreate) =>
  apiClient.post<ContextCardDraft>('/context-cards', data);

export const updateContextCardDraft = (draftId: number, data: ContextCardDraftUpdate) =>
  apiClient.patch<ContextCardDraft>(`/context-cards/${draftId}`, data);

export const generateContextCardDraft = (draftId: number, modelPreference?: string) =>
  apiClient.post<ContextCardDraft>(`/context-cards/${draftId}/generate`, {
    model_preference: modelPreference || undefined,
  });

export const writeContextCardToAnki = (draftId: number, data: ContextCardAnkiWriteRequest) =>
  apiClient.post<ContextCardDraft>(`/context-cards/${draftId}/anki`, data);
