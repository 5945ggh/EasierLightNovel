export type ContextCardStatus = 'draft' | 'generated' | 'failed' | 'written';

export interface ContextCardDraft {
  id: number;
  vocabulary_id: number;
  book_id: string;
  chapter_id?: number | null;
  lexeme_occurrence_id?: number | null;
  source_document_id?: string | null;
  source_start?: number | null;
  source_end?: number | null;
  quote_text: string;
  quote_locked: boolean;
  analysis_version: string;
  status: ContextCardStatus;
  meaning_in_context?: string | null;
  sentence_translation?: string | null;
  usage_note?: string | null;
  llm_model?: string | null;
  generation_attempts: number;
  generation_error?: string | null;
  anki_guid?: string | null;
  anki_note_id?: string | null;
  anki_status?: 'pending' | 'written' | 'failed' | null;
  created_at: string;
  updated_at?: string | null;
}

export interface ContextCardDraftCreate {
  vocabulary_id: number;
  chapter_id?: number;
  lexeme_occurrence_id?: number;
  source_document_id?: string;
  source_start?: number;
  source_end?: number;
  quote_text: string;
  quote_locked?: boolean;
}

export interface ContextCardDraftUpdate {
  quote_text?: string;
  quote_locked?: boolean;
  meaning_in_context?: string;
  sentence_translation?: string;
  usage_note?: string;
}

export interface ContextCardAnkiWriteRequest {
  deck_name: string;
  model_name: string;
  field_mapping?: Record<string, string>;
  timeout_seconds?: number;
}
