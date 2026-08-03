export interface ReaderLookupEventRequest {
  client_event_id: string;
  chapter_index: number;
  reader_segment_index: number;
  reader_token_index: number;
  surface: string;
  query_text: string;
}

export interface ReaderLookupEventResponse extends ReaderLookupEventRequest {
  id: number;
  book_id: string;
  chapter_id: number;
  analysis_run_id: number | null;
  lexeme_id: number | null;
  run_lexeme_id: number | null;
  source_document_id: string | null;
  source_start: number | null;
  source_end: number | null;
  source_token_index: number | null;
  event_type: 'reader_dictionary_lookup';
  mapping_status: 'resolved' | 'unresolved';
  created_at: string;
}
