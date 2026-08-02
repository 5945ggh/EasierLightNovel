import { apiClient } from './api-client';
import type { LearningMapResponse } from '@/types/learningMap';

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
