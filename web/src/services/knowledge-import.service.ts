import apiClient from './api-client';
import type {
  AnkiKnowledgeImportRequest,
  AnkiKnowledgeImportApplyRequest,
  AnkiCatalog,
  ExternalKnowledgeImportApplyResponse,
  ExternalKnowledgeImportPreview,
  ExternalKnowledgeImportRevokeResponse,
} from '@/types/knowledgeImport';

const isAnkiCatalog = (value: unknown): value is AnkiCatalog => {
  if (!value || typeof value !== 'object') return false;
  const catalog = value as Partial<AnkiCatalog>;
  return typeof catalog.version === 'number'
    && Array.isArray(catalog.deck_names)
    && catalog.deck_names.every((name) => typeof name === 'string')
    && Array.isArray(catalog.model_names)
    && catalog.model_names.every((name) => typeof name === 'string')
    && Array.isArray(catalog.fields)
    && Array.isArray(catalog.templates);
};

export const getAnkiCatalog = async (modelName?: string): Promise<AnkiCatalog> => {
  const payload = await apiClient.get<unknown>('/knowledge-imports/anki/catalog', {
    params: modelName ? { model_name: modelName } : undefined,
  });
  if (!isAnkiCatalog(payload)) {
    throw new Error('目录接口返回了无效数据。请确认后端已更新并正在运行。');
  }
  return payload;
};

export const previewAnkiImport = (
  request: AnkiKnowledgeImportRequest,
): Promise<ExternalKnowledgeImportPreview> =>
  apiClient.post<ExternalKnowledgeImportPreview>('/knowledge-imports/anki/preview', request);

export const applyAnkiImport = (
  request: AnkiKnowledgeImportApplyRequest,
): Promise<ExternalKnowledgeImportApplyResponse> =>
  apiClient.post<ExternalKnowledgeImportApplyResponse>('/knowledge-imports/anki/apply', request);

export const revokeKnowledgeImport = (
  batchId: string,
): Promise<ExternalKnowledgeImportRevokeResponse> =>
  apiClient.delete<ExternalKnowledgeImportRevokeResponse>(`/knowledge-imports/${encodeURIComponent(batchId)}`);
