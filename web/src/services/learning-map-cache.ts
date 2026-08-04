import type {
  LexemeKnowledgeStatus,
  LearningMapManageableLexeme,
  LearningMapRecommendedLexeme,
  LearningMapResponse,
} from '../types/learningMap';

type LearningMapLexeme = LearningMapRecommendedLexeme | LearningMapManageableLexeme;

export const incrementPendingLexeme = (
  counts: ReadonlyMap<number, number>,
  lexemeId: number,
): Map<number, number> => {
  const next = new Map(counts);
  next.set(lexemeId, (next.get(lexemeId) ?? 0) + 1);
  return next;
};

export const decrementPendingLexeme = (
  counts: ReadonlyMap<number, number>,
  lexemeId: number,
): Map<number, number> => {
  const next = new Map(counts);
  const count = next.get(lexemeId) ?? 0;
  if (count <= 1) {
    next.delete(lexemeId);
  } else {
    next.set(lexemeId, count - 1);
  }
  return next;
};

export const isLatestLexemeMutation = (
  latestMutationIds: ReadonlyMap<number, number>,
  lexemeId: number,
  requestId: number,
): boolean => latestMutationIds.get(lexemeId) === requestId;

export const getLearningMapLexemeStatus = (
  map: LearningMapResponse,
  lexemeId: number,
): LexemeKnowledgeStatus | null | undefined => {
  const lexeme = [
    ...(map.recommended_lexemes ?? []),
    ...(map.manageable_lexemes ?? []),
  ].find((item) => item.lexeme_id === lexemeId);
  if (!lexeme) return undefined;
  return lexeme.knowledge_status ?? lexeme.state ?? null;
};

const applyStatus = <T extends LearningMapLexeme>(
  lexemes: T[] | undefined,
  lexemeId: number,
  status: LexemeKnowledgeStatus | null,
): T[] | undefined => {
  if (!lexemes) return lexemes;

  return lexemes.map((lexeme) => {
    if (lexeme.lexeme_id !== lexemeId) return lexeme;

    const updated = {
      ...lexeme,
      state: status,
      knowledge_status: status,
    };
    if ('is_recommended' in lexeme) {
      return {
        ...updated,
        is_recommended: status !== 'known' && status !== 'ignored',
      } as T;
    }
    return updated as T;
  });
};

export const updateLearningMapLexemeStatus = (
  map: LearningMapResponse,
  lexemeId: number,
  status: LexemeKnowledgeStatus | null,
): LearningMapResponse => ({
  ...map,
  recommended_lexemes: applyStatus(map.recommended_lexemes, lexemeId, status) ?? [],
  manageable_lexemes: applyStatus(map.manageable_lexemes, lexemeId, status),
});
