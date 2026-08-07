import React, { useMemo, useState } from 'react';
import { Check, FileText, Loader2, Plus, RefreshCw, Send, X } from 'lucide-react';
import clsx from 'clsx';
import {
  createContextCardDraft,
  generateContextCardDraft,
  updateContextCardDraft,
  writeContextCardToAnki,
} from '@/services/context-card.service';
import type { ContextCardDraft } from '@/types/contextCard';
import type { VocabularyResponse } from '@/types/vocabulary';

interface Props {
  vocabulary: VocabularyResponse & { book_title?: string };
  onClose: () => void;
}

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-blue-500 focus:ring-2 focus:ring-slate-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const value = error as { message?: unknown; details?: unknown };
    if (typeof value.details === 'object' && value.details !== null) {
      const detail = (value.details as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail.trim()) return detail;
    }
    if (typeof value.message === 'string' && value.message.trim()) return value.message;
  }
  return fallback;
};

export const ContextCardModal: React.FC<Props> = ({ vocabulary, onClose }) => {
  const quotes = useMemo(
    () => (vocabulary.context_sentences ?? []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
    [vocabulary.context_sentences],
  );
  const [quote, setQuote] = useState(quotes[0] ?? '');
  const [draft, setDraft] = useState<ContextCardDraft | null>(null);
  const [meaning, setMeaning] = useState('');
  const [translation, setTranslation] = useState('');
  const [usageNote, setUsageNote] = useState('');
  const [deckName, setDeckName] = useState('EasierLightNovel');
  const [modelName, setModelName] = useState('Basic');
  const [busy, setBusy] = useState<'create' | 'generate' | 'save' | 'write' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncDraft = (value: ContextCardDraft) => {
    setDraft(value);
    setMeaning(value.meaning_in_context ?? '');
    setTranslation(value.sentence_translation ?? '');
    setUsageNote(value.usage_note ?? '');
  };

  const createDraft = async () => {
    if (!quote.trim()) {
      setError('请先选择或粘贴一条书中原句。');
      return;
    }
    setBusy('create');
    setError(null);
    try {
      const value = await createContextCardDraft({ vocabulary_id: vocabulary.id, quote_text: quote.trim(), quote_locked: true });
      syncDraft(value);
    } catch (err) {
      setError(errorMessage(err, '创建卡片草稿失败。'));
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!draft) return;
    setBusy('generate');
    setError(null);
    try {
      syncDraft(await generateContextCardDraft(draft.id));
    } catch (err) {
      setError(errorMessage(err, '生成语境解释失败，可稍后重试。'));
    } finally {
      setBusy(null);
    }
  };

  const saveEdits = async () => {
    if (!draft) return;
    setBusy('save');
    setError(null);
    try {
      syncDraft(await updateContextCardDraft(draft.id, {
        meaning_in_context: meaning,
        sentence_translation: translation,
        usage_note: usageNote,
      }));
    } catch (err) {
      setError(errorMessage(err, '保存草稿失败。'));
    } finally {
      setBusy(null);
    }
  };

  const writeToAnki = async () => {
    if (!draft || !deckName.trim() || !modelName.trim()) return;
    setBusy('write');
    setError(null);
    try {
      const saved = await updateContextCardDraft(draft.id, {
        meaning_in_context: meaning,
        sentence_translation: translation,
        usage_note: usageNote,
      });
      syncDraft(saved);
      syncDraft(await writeContextCardToAnki(draft.id, { deck_name: deckName.trim(), model_name: modelName.trim() }));
    } catch (err) {
      setError(errorMessage(err, '写入 Anki 失败，可安全重试。'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="context-card-title">
      <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <h2 id="context-card-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100"><FileText size={19} />语境卡片草稿</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{vocabulary.word} · {vocabulary.book_title ?? '当前书籍'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="关闭"><X size={18} /></button>
        </div>

        <div className="space-y-5 p-5">
          <section>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">锁定书中原句</label>
            {quotes.length > 0 && <select className={inputClass + ' mt-2'} value={quote} onChange={(event) => setQuote(event.target.value)} disabled={Boolean(draft)}>{quotes.map((item, index) => <option key={`${item}-${index}`} value={item}>{item}</option>)}</select>}
            <textarea className={clsx(inputClass, quotes.length > 0 ? 'mt-2' : 'mt-2')} rows={3} value={quote} onChange={(event) => setQuote(event.target.value)} disabled={Boolean(draft)} placeholder="粘贴或输入书中原句" />
            {!draft && <button type="button" onClick={createDraft} disabled={busy !== null} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-slate-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-slate-blue-700 disabled:opacity-50">{busy === 'create' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}锁定原句</button>}
            {draft && <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><Check size={14} />原句已锁定，后续生成不会替换出处</p>}
          </section>

          {draft && <>
            <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">语境解释</h3><button type="button" onClick={generate} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">{busy === 'generate' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {draft.status === 'generated' ? '重新生成' : '生成解释'}</button></div>
              <label className="block text-xs text-slate-500 dark:text-slate-400">语境义
                <textarea className={inputClass + ' mt-1'} rows={2} value={meaning} onChange={(event) => setMeaning(event.target.value)} placeholder="LLM 生成后可手动编辑" />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-400">原句翻译
                <textarea className={inputClass + ' mt-1'} rows={2} value={translation} onChange={(event) => setTranslation(event.target.value)} />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-400">用法备注（可选）
                <textarea className={inputClass + ' mt-1'} rows={2} value={usageNote} onChange={(event) => setUsageNote(event.target.value)} />
              </label>
              {draft.generation_error && <p className="text-xs text-red-600 dark:text-red-400">{draft.generation_error}</p>}
              <button type="button" onClick={saveEdits} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">{busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}保存草稿</button>
            </section>

            <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">写入 Anki（仅文本）</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-xs text-slate-500 dark:text-slate-400">牌组<input className={inputClass + ' mt-1'} value={deckName} onChange={(event) => setDeckName(event.target.value)} /></label><label className="text-xs text-slate-500 dark:text-slate-400">笔记类型<input className={inputClass + ' mt-1'} value={modelName} onChange={(event) => setModelName(event.target.value)} /></label></div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {modelName.trim().toLowerCase() === 'basic'
                  ? 'Basic 会自动使用 Front（词形）和 Back（读音、语境义、原句、翻译、备注）字段。'
                  : '非 Basic 模型会先检查字段；无法识别时不会写入，并会返回字段映射诊断。'}
                {' '}重复点击会复用稳定 GUID，不会静默删除 Anki 笔记。
              </p>
              <button type="button" onClick={writeToAnki} disabled={busy !== null || !deckName.trim() || !modelName.trim() || draft.status === 'written'} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy === 'write' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {draft.status === 'written' ? '已写入 Anki' : '写入 Anki'}</button>
              {draft.anki_note_id && <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">note {draft.anki_note_id}</span>}
            </section>
          </>}

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        </div>
      </div>
    </div>
  );
};
