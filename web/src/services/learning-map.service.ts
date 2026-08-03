import { apiClient } from './api-client';
import type {
  LexemeKnowledgeStatus,
  LexemeKnowledgeUpdateResponse,
  LearningMapResponse,
} from '@/types/learningMap';

export const getLearningMap = async (
  bookId: string,
  chapterIndex?: number,
  recommendationLimit = 20,
): Promise<LearningMapResponse> => {
  return apiClient.get<LearningMapResponse>(`/books/${bookId}/learning-map`, {
    params: {
      ...(chapterIndex === undefined ? {} : { chapter_index: chapterIndex }),
      recommendation_limit: recommendationLimit,
    },
  });
};

export const putLexemeKnowledgeStatus = async (
  lexemeId: number,
  status: LexemeKnowledgeStatus,
): Promise<LexemeKnowledgeUpdateResponse> => {
  return apiClient.put<LexemeKnowledgeUpdateResponse>(`/lexeme-knowledge/${lexemeId}`, { state: status });
};

export const deleteLexemeKnowledgeStatus = async (
  lexemeId: number,
): Promise<LexemeKnowledgeUpdateResponse> => {
  return apiClient.delete<LexemeKnowledgeUpdateResponse>(`/lexeme-knowledge/${lexemeId}`);
};
