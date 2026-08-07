import { apiClient } from './api-client';
import { isLearningMapResponse } from '@/types/learningMap';
import type { LearningMapResponse } from '@/types/learningMap';

export const getLearningMap = async (
  bookId: string,
  chapterIndex?: number,
): Promise<LearningMapResponse> => {
  const response = await apiClient.get<unknown>(`/books/${bookId}/learning-map`, {
    params: {
      ...(chapterIndex === undefined ? {} : { chapter_index: chapterIndex }),
    },
  });
  if (!isLearningMapResponse(response)) {
    throw new Error('学习地图接口返回了无效数据。');
  }
  return response;
};
