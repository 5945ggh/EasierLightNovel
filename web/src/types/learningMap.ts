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

export interface LearningMapRecommendedLexeme {
  lexeme_id: number;
  normalized_form: string;
  display_form: string;
  reading: string | null;
  part_of_speech: string;
  book_occurrence_count: number;
  upcoming_chapter_occurrence_count: number;
  first_chapter_index: number;
  excluded_from_learning_target: boolean;
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
  recommended_lexemes: LearningMapRecommendedLexeme[];
}
