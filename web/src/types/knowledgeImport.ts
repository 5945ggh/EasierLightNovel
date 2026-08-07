/** Types shared by the reversible external-knowledge import workflow. */

export interface AnkiKnowledgeImportRequest {
  query?: string;
  deck_name?: string;
  model_name?: string;
  template_ord?: number;
  expression_fields?: string[];
  reading_fields?: string[];
  timeout_seconds?: number;
}

export interface AnkiKnowledgeImportApplyRequest extends AnkiKnowledgeImportRequest {
  preview_digest: string;
}

export interface AnkiTemplate {
  ord: number;
  name: string;
}

export interface AnkiCatalog {
  version: number;
  deck_names: string[];
  model_names: string[];
  selected_model?: string | null;
  fields: string[];
  templates: AnkiTemplate[];
}

export interface ExternalKnowledgeImportStats {
  total: number;
  parsable: number;
  unique: number;
  ambiguous: number;
  unmatched: number;
  provisional: number;
  card_count: number;
  note_count: number;
  unique_lexeme_count: number;
  known_candidate_count: number;
  learning_candidate_count: number;
  anki_state_counts: Record<string, number>;
  conversion_funnel: Record<string, number>;
}

export interface ExternalKnowledgeImportCandidate {
  lexeme_id: number;
  normalized_form: string;
  canonical_reading_kana: string;
  source_entry_id: string;
  level?: string | null;
  target_state?: 'learning' | 'known' | null;
}

export interface ExternalKnowledgeImportSkip {
  source_entry_id: string;
  reason: string;
  normalized_form?: string | null;
  canonical_reading_kana?: string | null;
}

export interface ExternalKnowledgeImportBookImpact {
  book_id: string;
  book_title: string;
  eligible_occurrences: number;
  known_lexeme_count_before: number;
  known_lexeme_count_after: number;
  known_occurrences_before: number;
  known_occurrences_after: number;
  coverage_before?: number | null;
  coverage_after?: number | null;
  coverage_delta?: number | null;
}

export interface ExternalKnowledgeImportPreview {
  source_kind: 'anki' | 'jlpt';
  import_digest: string;
  stats: ExternalKnowledgeImportStats;
  accepted: ExternalKnowledgeImportCandidate[];
  skipped: ExternalKnowledgeImportSkip[];
  known_before_count: number;
  known_after_count: number;
  known_delta: number;
  learning_map_impact: ExternalKnowledgeImportBookImpact[];
}

export interface ExternalKnowledgeImportApplyResponse {
  batch_id: string;
  source_kind: 'anki' | 'jlpt';
  import_digest: string;
  created_count: number;
  skipped: ExternalKnowledgeImportSkip[];
}

export interface ExternalKnowledgeImportRevokeResponse {
  batch_id: string;
  deleted_count: number;
}
