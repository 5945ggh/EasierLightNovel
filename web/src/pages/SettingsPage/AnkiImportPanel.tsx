import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Loader2,
  RotateCw,
  Undo2,
} from 'lucide-react';
import clsx from 'clsx';
import {
  applyAnkiImport,
  getAnkiCatalog,
  previewAnkiImport,
  revokeKnowledgeImport,
} from '@/services/knowledge-import.service';
import type {
  AnkiCatalog,
  AnkiKnowledgeImportRequest,
  AnkiKnowledgeImportApplyRequest,
  ExternalKnowledgeImportApplyResponse,
  ExternalKnowledgeImportPreview,
} from '@/types/knowledgeImport';

const ANKI_STATES = ['new', 'learning', 'relearning', 'young', 'mature', 'suspended', 'buried'];
const DEFAULT_EXPRESSION_FIELDS = ['Expression', 'Word', 'Vocabulary', 'Front'];
const DEFAULT_READING_FIELDS = ['Reading', 'Kana', 'Yomi'];

const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    const details = (error as { details?: unknown }).details;
    if (details && typeof details === 'object' && 'detail' in details) {
      const detail = (details as { detail?: unknown }).detail;
      if (typeof detail === 'string') return detail;
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Anki 导入请求失败，请确认 AnkiConnect 正在运行。';
};

const getErrorStatus = (error: unknown): number | undefined => {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
};

const parseFields = (value: string, fallback: string[]): string[] => {
  const fields = value.split(',').map((field) => field.trim()).filter(Boolean);
  return fields.length > 0 ? fields : fallback;
};

const formatCoverage = (value?: number | null): string =>
  value == null ? '-' : `${(value * 100).toFixed(1)}%`;

export const AnkiImportPanel: React.FC = () => {
  const [deckName, setDeckName] = useState('');
  const [query, setQuery] = useState('');
  const [modelName, setModelName] = useState('');
  const [templateOrd, setTemplateOrd] = useState('');
  const [expressionFields, setExpressionFields] = useState(DEFAULT_EXPRESSION_FIELDS.join(', '));
  const [readingFields, setReadingFields] = useState(DEFAULT_READING_FIELDS.join(', '));
  const [preview, setPreview] = useState<ExternalKnowledgeImportPreview | null>(null);
  const [previewRequest, setPreviewRequest] = useState<AnkiKnowledgeImportApplyRequest | null>(null);
  const [catalog, setCatalog] = useState<AnkiCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [applied, setApplied] = useState<ExternalKnowledgeImportApplyResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loadingAction, setLoadingAction] = useState<'preview' | 'apply' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const request = useMemo<AnkiKnowledgeImportRequest>(() => {
    const parsedTemplate = templateOrd === '' ? undefined : Number(templateOrd);
    return {
      deck_name: deckName.trim() || undefined,
      query: query.trim() || undefined,
      model_name: modelName.trim() || undefined,
      template_ord: Number.isInteger(parsedTemplate) && parsedTemplate != null && parsedTemplate >= 0
        ? parsedTemplate
        : undefined,
      expression_fields: parseFields(expressionFields, DEFAULT_EXPRESSION_FIELDS),
      reading_fields: parseFields(readingFields, DEFAULT_READING_FIELDS),
    };
  }, [deckName, expressionFields, modelName, query, readingFields, templateOrd]);

  const canRun = Boolean(request.deck_name || request.query);

  const invalidatePreview = () => {
    setPreview(null);
    setPreviewRequest(null);
    setConfirmed(false);
    setApplied(null);
  };

  const updateFilter = (setter: React.Dispatch<React.SetStateAction<string>>, value: string) => {
    setter(value);
    invalidatePreview();
  };

  const loadCatalog = async (selectedModel?: string) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const result = await getAnkiCatalog(selectedModel || undefined);
      setCatalog(result);
      if (selectedModel && result.selected_model !== selectedModel) {
        setCatalogError('所选模型在 Anki 中不存在，请从目录重新选择。');
      }
    } catch (err) {
      setCatalog(null);
      setCatalogError(getErrorMessage(err));
    } finally {
      setCatalogLoading(false);
    }
  };

  const runPreview = async () => {
    if (!canRun) {
      setError('请填写牌组名称或 Anki 搜索条件。');
      return;
    }
    setLoadingAction('preview');
    setError(null);
    setApplied(null);
    setConfirmed(false);
    try {
      const result = await previewAnkiImport(request);
      setPreview(result);
      setPreviewRequest({ ...request, preview_digest: result.import_digest });
    } catch (err) {
      setError(getErrorMessage(err));
      setPreview(null);
      setPreviewRequest(null);
    } finally {
      setLoadingAction(null);
    }
  };

  const runApply = async () => {
    if (!preview || !previewRequest || !confirmed) return;
    setLoadingAction('apply');
    setError(null);
    try {
      setApplied(await applyAnkiImport(previewRequest));
    } catch (err) {
      if (getErrorStatus(err) === 409) {
        invalidatePreview();
        setError('Anki 内容已变化，请重新生成预览后再应用。');
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setLoadingAction(null);
    }
  };

  const runRevoke = async () => {
    if (!applied) return;
    setLoadingAction('revoke');
    setError(null);
    try {
      await revokeKnowledgeImport(applied.batch_id);
      setApplied(null);
      setConfirmed(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoadingAction(null);
    }
  };

  const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-blue-500 focus:ring-2 focus:ring-slate-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
  const stats = preview?.stats;

  return (
    <section className="max-w-5xl mx-auto mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Anki 学习基线导入</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            先生成只读预览，确认转换漏斗后再写入可撤销的基线证据。
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          AnkiConnect v6 · 只读探针
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="text-sm text-slate-700 dark:text-slate-200">
          牌组名称
          {catalog ? (
            <select className={inputClass + ' mt-1'} value={deckName} onChange={(event) => updateFilter(setDeckName, event.target.value)}>
              <option value="">选择牌组…</option>
              {catalog.deck_names.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : (
            <input className={inputClass + ' mt-1'} value={deckName} onChange={(event) => updateFilter(setDeckName, event.target.value)} placeholder="目录不可用时手填，例如 Kaishi 1.5k  zh-CH" />
          )}
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-200">
          搜索条件（可选）
          <input className={inputClass + ' mt-1'} value={query} onChange={(event) => updateFilter(setQuery, event.target.value)} placeholder="例如 is:review" />
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-200">
          模型名称（可选）
          {catalog ? (
            <select className={inputClass + ' mt-1'} value={modelName} onChange={(event) => { updateFilter(setModelName, event.target.value); void loadCatalog(event.target.value); }}>
              <option value="">选择模型…</option>
              {catalog.model_names.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : (
            <input className={inputClass + ' mt-1'} value={modelName} onChange={(event) => updateFilter(setModelName, event.target.value)} placeholder="目录不可用时手填模型名" />
          )}
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-200">
          模板序号（可选）
          {catalog && catalog.templates.length > 0 ? (
            <select className={inputClass + ' mt-1'} value={templateOrd} onChange={(event) => updateFilter(setTemplateOrd, event.target.value)}>
              <option value="">选择模板…</option>
              {catalog.templates.map((template) => <option key={template.ord} value={template.ord}>{template.ord}: {template.name}</option>)}
            </select>
          ) : (
            <input className={inputClass + ' mt-1'} type="number" min={0} step={1} value={templateOrd} onChange={(event) => updateFilter(setTemplateOrd, event.target.value)} placeholder="目录不可用时手填序号，例如 0" />
          )}
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-200">
          词形字段（按优先级，逗号分隔）
          <input className={inputClass + ' mt-1'} value={expressionFields} onChange={(event) => updateFilter(setExpressionFields, event.target.value)} />
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-200">
          读音字段（按优先级，逗号分隔）
          <input className={inputClass + ' mt-1'} value={readingFields} onChange={(event) => updateFilter(setReadingFields, event.target.value)} />
        </label>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">掌握策略</div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">固定保守映射：只有未被 Suspended 覆盖且间隔至少 21 天的 Mature 证据计入已掌握，其余可识别卡片计入学习中。</p>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-700 dark:text-slate-200">
            {catalog ? <span><strong className="text-emerald-600 dark:text-emerald-400">连接正常</strong> · v{catalog.version} · {catalog.deck_names.length} 个牌组 · {catalog.model_names.length} 个模型</span> : <span>连接检查会读取牌组、模型和模板名称，不会读取卡片内容。</span>}
          </div>
          <button type="button" onClick={() => void loadCatalog(modelName.trim())} disabled={catalogLoading || loadingAction !== null} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            {catalogLoading ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={15} />} 检查连接并读取目录
          </button>
        </div>
        {catalogError && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">目录读取失败：{catalogError} 可继续手填牌组、模型和模板序号。</p>}
        {catalog?.selected_model && catalog.fields.length > 0 && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">模型字段：{catalog.fields.join('、')} · 模板：{catalog.templates.map((template) => `${template.ord}: ${template.name}`).join('、')}</p>}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={runPreview} disabled={loadingAction !== null} className="inline-flex items-center gap-2 rounded-lg bg-slate-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
          {loadingAction === 'preview' ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
          连接检查并生成预览
        </button>
        <button type="button" onClick={() => { invalidatePreview(); setError(null); }} disabled={loadingAction !== null} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
          <RotateCw size={16} /> 清空预览
        </button>
      </div>

      {preview && stats && (
        <div className="mt-7 border-t border-slate-200 pt-6 dark:border-slate-800">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">预览结果</h3>
            <code className="text-xs text-slate-500 dark:text-slate-400">digest: {preview.import_digest.slice(0, 16)}…</code>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['卡片数', stats.card_count],
              ['唯一 note', stats.note_count],
              ['可识别词条', stats.parsable],
              ['唯一词汇', stats.unique_lexeme_count || stats.unique],
              ['拟计入已掌握', stats.known_candidate_count],
              ['拟标记学习中', stats.learning_candidate_count],
              ['已有已掌握', preview.known_before_count],
              ['预览后已掌握', preview.known_after_count],
              ['已掌握增量', preview.known_delta],
              ['跳过', preview.skipped.length],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70">
                <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
                <div className="mt-1 text-xl font-semibold text-slate-800 dark:text-slate-100">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200">Anki 卡片状态（按 card 统计）</h4>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {ANKI_STATES.map((state) => (
                  <div key={state} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1.5 dark:bg-slate-800/70">
                    <span className="capitalize text-slate-600 dark:text-slate-300">{state}</span>
                    <strong>{stats.anki_state_counts[state] ?? stats.anki_state_counts[state[0].toUpperCase() + state.slice(1)] ?? 0}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200">转换漏斗</h4>
              <dl className="mt-3 space-y-1.5 text-sm">
                {Object.entries(stats.conversion_funnel).map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-4"><dt className="text-slate-500 dark:text-slate-400">{label}</dt><dd className="font-medium text-slate-800 dark:text-slate-100">{value}</dd></div>
                ))}
              </dl>
            </div>
          </div>

          {preview.learning_map_impact.length > 0 && (
            <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="border-b border-slate-200 px-4 py-3 text-left font-medium dark:border-slate-800">学习地图变化</caption>
                <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/70 dark:text-slate-400"><tr><th className="px-4 py-2">书籍</th><th className="px-4 py-2">已掌握</th><th className="px-4 py-2">覆盖率</th><th className="px-4 py-2">变化</th></tr></thead>
                <tbody>{preview.learning_map_impact.map((impact) => <tr key={impact.book_id} className="border-t border-slate-100 dark:border-slate-800"><td className="px-4 py-2 text-slate-700 dark:text-slate-200">{impact.book_title}</td><td className="px-4 py-2">{impact.known_lexeme_count_before} → {impact.known_lexeme_count_after}</td><td className="px-4 py-2">{formatCoverage(impact.coverage_before)} → {formatCoverage(impact.coverage_after)}</td><td className="px-4 py-2 text-emerald-600 dark:text-emerald-400">{impact.coverage_delta == null ? '-' : `+${(impact.coverage_delta * 100).toFixed(1)}%`}</td></tr>)}</tbody>
              </table>
            </div>
          )}

          <button type="button" onClick={() => setShowSkipped((value) => !value)} className="mt-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
            {showSkipped ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {showSkipped ? '收起' : '查看'}无法识别项目（{preview.skipped.length}）
          </button>
          {showSkipped && <div className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/70">{preview.skipped.length === 0 ? <span className="text-slate-500">没有跳过项目。</span> : <ul className="space-y-1">{preview.skipped.map((item, index) => <li key={`${item.source_entry_id}-${index}`}><strong>{item.source_entry_id}</strong>：{item.reason}{item.normalized_form ? ` (${item.normalized_form})` : ''}</li>)}</ul>}</div>}

          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/70 dark:bg-amber-950/20">
            <label className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
              <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>我已检查预览，确认将这些外部证据应用到本地词汇基线；此操作会产生可撤销的批次。</span>
            </label>
            <button type="button" onClick={runApply} disabled={!confirmed || loadingAction !== null || Boolean(applied)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50">
              {loadingAction === 'apply' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} 应用此批次
            </button>
          </div>
        </div>
      )}

      {applied && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900/70 dark:bg-emerald-950/20">
          <div className="flex items-start gap-2 text-emerald-800 dark:text-emerald-200"><Check size={18} className="mt-0.5" /><span>已应用批次 <code className="font-semibold">{applied.batch_id}</code>，新增 {applied.created_count} 条证据。</span></div>
          <button type="button" onClick={runRevoke} disabled={loadingAction !== null} className={clsx('inline-flex items-center gap-2 rounded-lg border border-emerald-300 px-3 py-1.5 text-sm text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-900/40')}>
            {loadingAction === 'revoke' ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />} 撤销批次
          </button>
        </div>
      )}
    </section>
  );
};

export default AnkiImportPanel;
