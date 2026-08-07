export interface LearningMapFilterSpec {
  pos_allowlist: string[];
  exclude_proper_nouns: boolean;
  exclude_oov: boolean;
  identity: string;
}

export interface LearningMapCoverage {
  explicit_known_coverage: number;
  known_occurrences: number;
  eligible_occurrences: number;
}

export interface LearningMapCurvePoint {
  target_coverage: number;
  required_lexeme_count: number;
  covered_occurrences: number;
}

export interface LearningMapChapter {
  chapter_index: number;
  title: string;
  eligible_occurrences: number;
  explicit_known_occurrences: number | null;
  unknown_occurrences: number | null;
  unknown_lexeme_count: number | null;
  new_lexeme_count: number;
}

export interface LearningMapResponse {
  book_id: string;
  analysis_status: 'ready' | 'needs_analysis';
  analysis_run_id: number | null;
  knowledge_baseline_status: 'ready' | 'uninitialized';
  knowledge_baseline_migration_status: 'none' | 'ready' | 'partial' | 'uninitialized';
  knowledge_baseline_message: string;
  filter_spec: LearningMapFilterSpec;
  reading_anchor_chapter_index: number;
  coverage: LearningMapCoverage | null;
  coverage_curve: LearningMapCurvePoint[];
  chapters: LearningMapChapter[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Runtime guard for the backend Learning Map response contract. */
export const isLearningMapResponse = (value: unknown): value is LearningMapResponse => {
  if (!isRecord(value)) return false;
  if (typeof value.book_id !== 'string') return false;
  if (value.analysis_status !== 'ready' && value.analysis_status !== 'needs_analysis') return false;
  if (value.knowledge_baseline_status !== 'ready' && value.knowledge_baseline_status !== 'uninitialized') return false;
  if (typeof value.knowledge_baseline_message !== 'string') return false;
  if (!Number.isInteger(value.reading_anchor_chapter_index)) return false;
  if (!isRecord(value.filter_spec) || !Array.isArray(value.filter_spec.pos_allowlist)) return false;
  if (typeof value.filter_spec.exclude_proper_nouns !== 'boolean' || typeof value.filter_spec.exclude_oov !== 'boolean' || typeof value.filter_spec.identity !== 'string') return false;
  if (!Array.isArray(value.coverage_curve) || !Array.isArray(value.chapters)) return false;
  if (value.coverage !== null && !isRecord(value.coverage)) return false;
  return true;
};
