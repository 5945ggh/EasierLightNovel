import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Info,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  Target,
} from 'lucide-react';
import { getBookDetail } from '@/services/books.service';
import { getLearningMap } from '@/services/learning-map.service';
import type { LearningMapChapter, LearningMapResponse } from '@/types';

const formatCount = (value: number | null): string =>
  value === null ? '待确认' : value.toLocaleString('zh-CN');

const formatCoverage = (value: number): string => `${(value * 100).toFixed(1)}%`;

const POS_LABELS: Record<string, string> = {
  名詞: '名词',
  動詞: '动词',
  形容詞: '形容词',
  形状詞: '形状词',
  副詞: '副词',
};

const formatFilterScope = (map: LearningMapResponse): string => {
  const { filter_spec: filterSpec } = map;
  const partOfSpeech = filterSpec.pos_allowlist
    .map((pos) => POS_LABELS[pos] || pos)
    .join('、');
  const properNouns = filterSpec.exclude_proper_nouns
    ? '专有名词不计入覆盖率统计'
    : '专有名词保留在覆盖率统计中';
  const oov = filterSpec.exclude_oov
    ? 'OOV 不计入覆盖率分母，也不会列入推荐学习词'
    : 'OOV 计入覆盖率分母，但不会列入推荐学习词';
  return `统计词性：${partOfSpeech || '当前 run 未指定'}。${properNouns}。${oov}。`;
};

const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '学习地图暂时无法加载，请稍后重试。';
};

const ChapterRow: React.FC<{ chapter: LearningMapChapter }> = ({ chapter }) => (
  <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-gray-100 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(78px,1fr))] sm:items-center sm:gap-4">
    <div className="min-w-0 sm:col-auto">
      <p className="truncate font-medium text-gray-800" title={chapter.title}>
        第 {chapter.chapter_index + 1} 章
      </p>
      <p className="truncate text-xs text-gray-500" title={chapter.title}>
        {chapter.title}
      </p>
    </div>
    <MetricCell label="统计出现" value={formatCount(chapter.eligible_occurrences)} />
    <MetricCell label="未知出现" value={formatCount(chapter.unknown_occurrences)} />
    <MetricCell label="未知词元" value={formatCount(chapter.unknown_lexeme_count)} />
    <MetricCell label="新词元" value={formatCount(chapter.new_lexeme_count)} />
  </div>
);

const MetricCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex min-w-0 items-baseline justify-between gap-2 sm:block">
    <span className="text-xs text-gray-500 sm:hidden">{label}</span>
    <span className="font-medium tabular-nums text-gray-800">{value}</span>
  </div>
);

const LearningMapReady: React.FC<{ map: LearningMapResponse }> = ({ map }) => {
  const coverage = map.coverage;
  const baselineReady = map.knowledge_baseline_status === 'ready';

  return (
    <>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="border border-gray-200 bg-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-500">明确掌握覆盖率</p>
              {coverage ? (
                <p className="mt-2 text-4xl font-semibold tracking-tight text-gray-900">
                  {formatCoverage(coverage.explicit_known_coverage)}
                </p>
              ) : baselineReady ? (
                <p className="mt-2 text-2xl font-semibold text-gray-800">当前范围没有可统计词元</p>
              ) : (
                <p className="mt-2 text-2xl font-semibold text-gray-800">尚未建立个人词汇基线</p>
              )}
            </div>
            <div className="rounded-lg bg-blue-50 p-2.5 text-blue-600">
              <Target size={22} aria-hidden="true" />
            </div>
          </div>
          {coverage ? (
            <p className="mt-4 text-sm text-gray-600">
              已明确掌握 {coverage.known_occurrences.toLocaleString('zh-CN')} 次出现，
              统计分母为 {coverage.eligible_occurrences.toLocaleString('zh-CN')} 次。
            </p>
          ) : null}
          <p className="mt-3 border-t border-gray-100 pt-3 text-sm leading-6 text-gray-500">
            {map.knowledge_baseline_message}
          </p>
        </div>

        <div className="border border-gray-200 bg-white p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Info size={18} className="text-indigo-500" aria-hidden="true" />
            这份地图的统计范围
          </div>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            {formatFilterScope(map)}
          </p>
          <p className="mt-3 text-xs leading-5 text-gray-500">
            分析运行 #{map.analysis_run_id} · 当前阅读锚点：第 {map.reading_anchor_chapter_index + 1} 章
          </p>
        </div>
      </section>

      <section className="border border-gray-200 bg-white">
        <SectionHeading title="章节学习地图" subtitle="用未知密度和新词数量决定下一步阅读节奏。" />
        {map.chapters.length > 0 ? (
          <div className="overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(78px,1fr))] gap-4 px-4 py-3 text-xs font-medium text-gray-500 sm:grid">
              <span>章节</span>
              <span>统计出现</span>
              <span>未知出现</span>
              <span>未知词元</span>
              <span>新词元</span>
            </div>
            {map.chapters.map((chapter) => (
              <ChapterRow key={chapter.chapter_index} chapter={chapter} />
            ))}
          </div>
        ) : (
          <p className="px-4 pb-5 text-sm text-gray-500">当前分析没有可显示的章节统计。</p>
        )}
      </section>

      <section className="border border-gray-200 bg-white">
        <SectionHeading
          title={baselineReady ? '当前章节推荐词' : '推荐学习词'}
          subtitle={
            baselineReady
              ? `按第 ${map.reading_anchor_chapter_index + 1} 章及之后的出现情况排序。`
              : '建立个人词汇基线后，这里才会判断哪些词是未知并生成推荐。'
          }
        />
        {!baselineReady ? (
          <div className="mx-4 mb-5 border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            尚未建立个人词汇基线。章节中的词不能被直接假定为未知，因此这里暂不生成推荐词。
          </div>
        ) : map.recommended_lexemes.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-gray-500">当前分析范围内没有待推荐的词。</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {map.recommended_lexemes.map((lexeme) => (
              <li
                key={lexeme.lexeme_id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_110px_90px_90px] sm:items-center sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900" title={lexeme.display_form}>
                    {lexeme.display_form}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {lexeme.reading || '读音待确认'} · {lexeme.part_of_speech || '词性待确认'}
                  </p>
                </div>
                <span className="text-right text-sm tabular-nums text-gray-700">
                  {lexeme.upcoming_chapter_occurrence_count} 次将出现
                </span>
                <span className="hidden text-right text-sm tabular-nums text-gray-600 sm:block">
                  全书 {lexeme.book_occurrence_count} 次
                </span>
                <span className="hidden text-right text-xs text-gray-500 sm:block">
                  首见第 {lexeme.first_chapter_index + 1} 章
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border border-gray-200 bg-white">
        <SectionHeading title="书内频率曲线" subtitle="这是当前书内 occurrence 的真实累积结果，包含长尾成本。" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500">
              <tr>
                <th className="px-4 py-3">目标覆盖率</th>
                <th className="px-4 py-3">所需词元数</th>
                <th className="px-4 py-3">覆盖出现次数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {map.coverage_curve.map((point) => (
                <tr key={point.target_coverage}>
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {formatCoverage(point.target_coverage)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">{point.required_lexeme_count}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-600">{point.covered_occurrences}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

const SectionHeading: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
    <h2 className="text-base font-semibold text-gray-900">{title}</h2>
    <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
  </div>
);

const LearningMapPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const bookQuery = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => getBookDetail(bookId as string),
    enabled: Boolean(bookId),
  });
  const mapQuery = useQuery({
    queryKey: ['learning-map', bookId],
    queryFn: () => getLearningMap(bookId as string),
    enabled: Boolean(bookId),
  });

  if (!bookId) {
    return <PageMessage icon={<AlertCircle />} title="缺少书籍信息" message="无法确定要显示的书籍。" />;
  }

  if (bookQuery.isLoading || mapQuery.isLoading) {
    return <PageMessage icon={<Loader2 className="animate-spin" />} title="正在加载学习地图" message="正在读取本书的分析结果。" />;
  }

  if (bookQuery.isError || mapQuery.isError || !mapQuery.data) {
    const error = bookQuery.error || mapQuery.error;
    return <PageMessage icon={<AlertCircle />} title="学习地图加载失败" message={getErrorMessage(error)} />;
  }

  const map = mapQuery.data;
  const bookTitle = bookQuery.data?.title || '书籍学习地图';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/"
              className="flex-shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              aria-label="返回书架"
              title="返回书架"
            >
              <ArrowLeft size={20} />
            </Link>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-medium text-indigo-600">
                <MapIcon size={14} aria-hidden="true" />
                书籍学习地图
              </p>
              <h1 className="truncate text-lg font-semibold text-gray-900 sm:text-xl" title={bookTitle}>
                {bookTitle}
              </h1>
            </div>
          </div>
          <Link
            to={`/read/${bookId}`}
            aria-label="继续阅读"
            className="flex flex-shrink-0 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          >
            <BookOpen size={16} aria-hidden="true" />
            <span className="hidden sm:inline">继续阅读</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-6 sm:py-6">
        {map.analysis_status === 'needs_analysis' ? (
          <div className="border border-amber-200 bg-amber-50 p-5 text-amber-900 sm:p-6">
            <div className="flex items-start gap-3">
              <RefreshCw size={20} className="mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">需要重新分析这本书</h2>
                <p className="mt-2 text-sm leading-6 text-amber-800">
                  旧书没有可用的 active AnalysisRun，当前页面不会从旧正文临时计算覆盖率。重新分析完成后，
                  这里会显示章节信息和书内频率曲线。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <LearningMapReady map={map} />
        )}

        <p className="px-1 text-xs leading-5 text-gray-500">
          覆盖率只表示明确掌握的 canonical Lexeme 在本书统计范围内的出现比例；加入生词本、查过词典、
          学习中或高频出现不会自动变成已知。
        </p>
      </main>
    </div>
  );
};

const PageMessage: React.FC<{ icon: React.ReactNode; title: string; message: string }> = ({
  icon,
  title,
  message,
}) => (
  <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <div className="w-full max-w-md border border-gray-200 bg-white p-6 text-center shadow-sm">
      <div className="mx-auto mb-3 flex w-fit items-center justify-center text-gray-400">{icon}</div>
      <h1 className="text-base font-semibold text-gray-800">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-gray-500">{message}</p>
      <Link
        to="/"
        className="mt-5 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        返回书架
      </Link>
    </div>
  </div>
);

export default LearningMapPage;
