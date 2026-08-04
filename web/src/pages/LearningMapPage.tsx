import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BarChart2,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  Table,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  Cell,
} from 'recharts';
import { getBookDetail } from '@/services/books.service';
import {
  deleteLexemeKnowledgeStatus,
  getLearningMap,
  putLexemeKnowledgeStatus,
} from '@/services/learning-map.service';
import {
  decrementPendingLexeme,
  getLearningMapLexemeStatus,
  incrementPendingLexeme,
  isLatestLexemeMutation,
  updateLearningMapLexemeStatus,
} from '@/services/learning-map-cache';
import type {
  LexemeKnowledgeStatus,
  LearningMapChapter,
  LearningMapLookupObservation,
  LearningMapManageableLexeme,
  LearningMapRecommendedLexeme,
  LearningMapResponse,
} from '@/types';

const formatCount = (value: number | null): string =>
  value === null ? '待建立基线' : value.toLocaleString('zh-CN');

const formatCoverage = (value: number): string => `${(value * 100).toFixed(1)}%`;

const POS_LABELS: Record<string, string> = {
  名詞: '名词',
  動詞: '动词',
  形容詞: '形容词',
  形状詞: '形状词',
  副詞: '副词',
};

const LEARNING_MAP_QUERY_KEY = 'learning-map';

const MANUAL_STATUS_OPTIONS: Array<{
  value: LexemeKnowledgeStatus | 'unset';
  label: string;
  description: string;
}> = [
  { value: 'unset', label: '未设置', description: '不覆盖当前基线判断' },
  { value: 'learning', label: '学习中', description: '标记为正在学习' },
  { value: 'known', label: '已掌握', description: '计入明确掌握基线' },
  { value: 'ignored', label: '暂不学习', description: '从学习目标中排除' },
];

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
  return `统计词性：${partOfSpeech || '未指定'}。${properNouns}。${oov}。`;
};

const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '学习地图暂时无法加载，请稍后重试。';
};

const formatLookupTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

/**
 * 查词事实观察展示
 */
const LookupObservation: React.FC<{ observation?: LearningMapLookupObservation | null }> = ({
  observation,
}) => {
  if (!observation) return null;

  const laterLookupText =
    observation.later_lookup_count_after_first === 0
      ? '之后没有再次查询'
      : `之后又查询 ${observation.later_lookup_count_after_first} 次`;
  const afterFirstText =
    observation.occurrences_after_first_lookup === null
      ? `${laterLookupText}。`
      : `首次查询后又出现 ${observation.occurrences_after_first_lookup} 次，${laterLookupText}。`;
  const afterLastText =
    observation.occurrences_after_last_lookup === null
      ? ''
      : `最近一次查询后又出现 ${observation.occurrences_after_last_lookup} 次。`;
  const lastLookupText =
    observation.lookup_count > 1
      ? `最近一次查询在第 ${observation.last_lookup.chapter_index + 1} 章，${formatLookupTime(observation.last_lookup.created_at)}。`
      : '';

  return (
    <div className="col-span-full min-w-0 rounded-md bg-indigo-50/70 px-3 py-2 text-xs leading-5 text-indigo-800">
      <p className="break-words">
        <strong className="font-medium text-indigo-900">阅读行为事实：</strong>
        本书中查过 {observation.lookup_count} 次；首次查询在第 {observation.first_lookup.chapter_index + 1} 章，
        {formatLookupTime(observation.first_lookup.created_at)}。{afterFirstText}{lastLookupText}{afterLastText}
      </p>
    </div>
  );
};

/**
 * Section B: 首要结论 - 阅读准备度
 * 包含完整的三态处理：
 * 1. coverage !== null：展示明确掌握覆盖率与具体次数
 * 2. coverage === null && baselineReady：提示当前过滤范围没有可统计词元
 * 3. coverage === null && !baselineReady：提示尚未建立个人词汇基线
 */
const ReadingReadinessSection: React.FC<{ map: LearningMapResponse }> = ({ map }) => {
  const [showDetails, setShowDetails] = useState(false);
  const coverage = map.coverage;
  const baselineReady = map.knowledge_baseline_status === 'ready';

  return (
    <section className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* 主要卡片：明确掌握覆盖率 / 三态逻辑 */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
                首要结论 · 阅读准备度
              </p>
              <h2 className="mt-1 text-base font-semibold text-gray-900">
                {coverage
                  ? '明确掌握覆盖率'
                  : baselineReady
                  ? '当前范围无可统计词元'
                  : '词汇基线未建立'}
              </h2>
            </div>
          </div>

          {coverage ? (
            <div className="mt-4">
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl tabular-nums">
                  {formatCoverage(coverage.explicit_known_coverage)}
                </span>
                <span className="text-xs text-gray-500">(基于已标记“已掌握”词汇)</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-gray-600">
                已明确掌握{' '}
                <strong className="font-semibold text-gray-900 tabular-nums">
                  {coverage.known_occurrences.toLocaleString('zh-CN')}
                </strong>{' '}
                次出现，统计分母共{' '}
                <span className="font-medium text-gray-800 tabular-nums">
                  {coverage.eligible_occurrences.toLocaleString('zh-CN')}
                </span>{' '}
                次（按全书词汇出现次数计算）。
              </p>
            </div>
          ) : baselineReady ? (
            <div className="mt-3">
              <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3.5 text-xs leading-5 text-blue-900">
                <p className="font-semibold text-blue-950">当前范围没有可统计词元</p>
                <p className="mt-1">
                  已建立个人词汇基线，但当前过滤口径下没有产生符合统计条件的词元。
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 text-xs leading-5 text-amber-900">
                <p className="font-semibold text-amber-950">尚未建立个人词汇基线</p>
                <p className="mt-1">
                  系统默认不会将“未设置”状态的词误认为未知。只有在您手动标记已掌握词汇或导入已有词汇后，才会计算明确掌握覆盖率和章节未知负担。
                </p>
              </div>
            </div>
          )}

          <p className="mt-4 border-t border-gray-100 pt-3 text-xs leading-5 text-gray-500">
            {map.knowledge_baseline_message}
          </p>
        </div>

        {/* 辅助卡片：阅读锚点与统计口径概要 */}
        <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Info size={18} className="text-indigo-600" aria-hidden="true" />
              当前阅读位置与统计范围
            </div>
            <div className="mt-3 space-y-2 text-sm text-gray-600">
              <p className="flex items-center gap-2">
                <span className="text-xs text-gray-500">阅读锚点：</span>
                <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                  第 {map.reading_anchor_chapter_index + 1} 章
                </span>
              </p>
              <p className="text-xs leading-5 text-gray-500">
                分析运行版本：#{map.analysis_run_id ?? '无'}
              </p>
            </div>
          </div>

          <div className="mt-4 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="flex w-full items-center justify-between py-1 text-xs font-medium text-gray-600 hover:text-indigo-600 focus:outline-none"
              aria-expanded={showDetails}
            >
              <span>查看完整统计口径与规则</span>
              {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* 可折叠统计口径说明 */}
      {showDetails && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs leading-6 text-gray-600 transition-all">
          <p className="font-semibold text-gray-800">统计口径与规则：</p>
          <p className="mt-1">{formatFilterScope(map)}</p>
          <ul className="mt-2 space-y-1 text-gray-500 list-disc pl-4">
            <li><strong className="text-gray-700">已掌握（known）：</strong>唯一计入“明确掌握覆盖率”的词汇状态。</li>
            <li><strong className="text-gray-700">学习中 / 暂不学习：</strong>显式声明的状态，但不会增加覆盖率。</li>
            <li><strong className="text-gray-700">未设置：</strong>表示未声明，系统不会将其误假定为未知词。</li>
            <li><strong className="text-gray-700">查词事实：</strong>Reader 中查词事件只作为上下文事实显示，不改变掌握状态，也不进入覆盖率计算。</li>
          </ul>
        </div>
      )}
    </section>
  );
};

interface ChartDataPoint {
  chapterIndex: number;
  name: string;
  shortName: string;
  title: string;
  unknownRate: number | null;
  eligibleOccurrences: number;
  unknownOccurrences: number | null;
  unknownLexemeCount: number | null;
  newLexemeCount: number;
  isAnchor: boolean;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartDataPoint }>;
  baselineReady: boolean;
}

/* Recharts 自定义悬浮 Tooltip 组件 */
const CustomChartTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  baselineReady,
}) => {
  if (active && payload && payload.length) {
    const data: ChartDataPoint = payload[0].payload;
    const hasStats =
      baselineReady &&
      data.eligibleOccurrences > 0 &&
      data.unknownRate !== null;

    return (
      <div className="rounded-lg border border-gray-200 bg-white/95 p-3 shadow-md text-xs space-y-1.5 backdrop-blur-sm max-w-xs z-30">
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-1 font-bold text-gray-900">
          <span>{data.name}</span>
          {data.isAnchor && (
            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700 font-semibold">
              当前阅读位置
            </span>
          )}
        </div>
        <p className="text-gray-500 truncate" title={data.title}>
          {data.title}
        </p>
        <div className="space-y-1 pt-1 text-gray-700">
          <p className="font-semibold text-amber-700">
            未知出现率：
            {hasStats
              ? `${data.unknownRate}%`
              : baselineReady
              ? '无可统计词元'
              : '待建立基线'}
          </p>
          <p className="text-gray-600">
            未知词负担：
            {hasStats
              ? `${data.unknownLexemeCount} 词元 (${data.unknownOccurrences} 次出现)`
              : baselineReady
              ? '无可统计词元'
              : '待建立基线'}
          </p>
          <p className="text-gray-600">符合口径出现：{data.eligibleOccurrences} 次</p>
          <p className="text-indigo-600">本书首次出现：{data.newLexemeCount} 词元</p>
        </div>
      </div>
    );
  }
  return null;
};

/**
 * 基于 Recharts 的详细图表视图模式组件
 * 平均未知率修改为按词汇出现次数加权统计，确保与全书主覆盖率指标 1 - explicit_known_coverage 保持一致
 */
const ChapterRouteChartView: React.FC<{
  bookId: string;
  chapters: LearningMapChapter[];
  anchorIndex: number;
  baselineReady: boolean;
}> = ({ bookId, chapters, anchorIndex, baselineReady }) => {
  const [selectedChapterIndex, setSelectedChapterIndex] = useState<number>(
    anchorIndex < chapters.length ? anchorIndex : 0,
  );

  const activeChapter = chapters[selectedChapterIndex] || chapters[0];
  const isAnchor = activeChapter?.chapter_index === anchorIndex;
  const activeUnknownRate =
    baselineReady && activeChapter?.unknown_occurrences !== null && activeChapter?.eligible_occurrences > 0
      ? activeChapter.unknown_occurrences / activeChapter.eligible_occurrences
      : null;

  const chartData: ChartDataPoint[] = chapters.map((ch) => {
    const hasStats =
      baselineReady &&
      ch.eligible_occurrences > 0 &&
      ch.unknown_occurrences !== null;
    const rate = hasStats ? ch.unknown_occurrences! / ch.eligible_occurrences : null;
    return {
      chapterIndex: ch.chapter_index,
      name: `第 ${ch.chapter_index + 1} 章`,
      shortName: `${ch.chapter_index + 1}`,
      title: ch.title,
      unknownRate: rate !== null ? Number((rate * 100).toFixed(1)) : null,
      eligibleOccurrences: ch.eligible_occurrences,
      unknownOccurrences: hasStats ? ch.unknown_occurrences : null,
      unknownLexemeCount: hasStats ? ch.unknown_lexeme_count : null,
      newLexemeCount: ch.new_lexeme_count,
      isAnchor: ch.chapter_index === anchorIndex,
    };
  });

  // 加权平均计算：全书总未知出现次数 / 全书总符合口径出现次数
  const totalEligibleOccurrences = chapters.reduce(
    (sum, ch) => sum + ch.eligible_occurrences,
    0,
  );
  const totalUnknownOccurrences = chapters.reduce(
    (sum, ch) => sum + (ch.unknown_occurrences ?? 0),
    0,
  );
  const weightedAverageRate =
    baselineReady && totalEligibleOccurrences > 0
      ? (totalUnknownOccurrences / totalEligibleOccurrences) * 100
      : 0;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* 图表主区域 */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 sm:p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 text-xs">
          <div className="flex flex-wrap items-center gap-4 text-gray-600 font-medium">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-amber-500 inline-block" />
              未知出现率 (%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-indigo-500 inline-block" />
              首次出现词元数 (右轴)
            </span>
            {baselineReady && weightedAverageRate > 0 && (
              <span className="flex items-center gap-1 text-amber-700">
                <span className="h-0.5 w-3 border-b border-dashed border-amber-600 inline-block" />
                全书平均未知率 ({weightedAverageRate.toFixed(1)}%)
              </span>
            )}
            <span className="flex items-center gap-1.5 text-indigo-700 font-semibold">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-600 inline-block" />
              当前阅读位置
            </span>
          </div>
          <span className="text-gray-400 text-[11px]">
            点击柱形图可锁定选中章节明细
          </span>
        </div>

        {/* 响应式 Recharts 容器 */}
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 15, right: 15, left: -10, bottom: 5 }}
              onClick={(state) => {
                if (state && typeof state.activeTooltipIndex === 'number') {
                  setSelectedChapterIndex(state.activeTooltipIndex);
                }
              }}
            >
              <XAxis
                dataKey={chapters.length > 25 ? 'shortName' : 'name'}
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
              />
              <YAxis
                yAxisId="rate"
                unit="%"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={false}
                domain={[0, 'auto']}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                domain={[0, 'auto']}
              />
              <RechartsTooltip content={<CustomChartTooltip baselineReady={baselineReady} />} />
              {baselineReady && weightedAverageRate > 0 && (
                <ReferenceLine
                  yAxisId="rate"
                  y={weightedAverageRate}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                />
              )}
              <Bar
                yAxisId="rate"
                dataKey="unknownRate"
                name="未知出现率"
                radius={[4, 4, 0, 0]}
                cursor="pointer"
              >
                {chartData.map((entry) => (
                  <Cell
                    key={`cell-${entry.chapterIndex}`}
                    fill={
                      entry.chapterIndex === selectedChapterIndex
                        ? '#b45309'
                        : entry.isAnchor
                        ? '#4f46e5'
                        : baselineReady
                        ? '#f59e0b'
                        : '#60a5fa'
                    }
                  />
                ))}
              </Bar>
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="newLexemeCount"
                name="首次出现词元"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3, fill: '#6366f1' }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 选中章节的明细 Inspector 卡片 */}
      {activeChapter && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 sm:p-5 shadow-sm transition-all">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-100/80 pb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-900">
                  第 {activeChapter.chapter_index + 1} 章：{activeChapter.title}
                </span>
                {isAnchor && (
                  <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                    当前阅读位置
                  </span>
                )}
              </div>
            </div>
            <Link
              to={`/read/${bookId}?chapter=${activeChapter.chapter_index}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
            >
              <BookOpen size={14} aria-hidden="true" />
              <span>阅读本章</span>
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-3.5 sm:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">未知出现率 / 负担</p>
              <p className="mt-1 text-lg font-extrabold text-amber-700 tabular-nums">
                {activeUnknownRate !== null
                  ? `${(activeUnknownRate * 100).toFixed(1)}%`
                  : baselineReady
                  ? '无可统计词元'
                  : '待建立基线'}
              </p>
              {activeUnknownRate !== null && activeChapter.unknown_occurrences !== null && (
                <p className="text-[11px] text-gray-500 tabular-nums">
                  {activeChapter.unknown_lexeme_count ?? 0} 词元 ({activeChapter.unknown_occurrences} 次)
                </p>
              )}
            </div>

            <div>
              <p className="text-xs text-gray-500">统计出现次数</p>
              <p className="mt-1 text-lg font-bold text-gray-900 tabular-nums">
                {formatCount(activeChapter.eligible_occurrences)} 次
              </p>
              <p className="text-[11px] text-gray-500">符合口径词元</p>
            </div>

            <div>
              <p className="text-xs text-gray-500">本书首次出现词元</p>
              <p className="mt-1 text-lg font-bold text-gray-900 tabular-nums">
                {activeChapter.new_lexeme_count} 词元
              </p>
              <p className="text-[11px] text-gray-500">在该章首见的词元</p>
            </div>

            <div>
              <p className="text-xs text-gray-500">章节相对位置</p>
              <p className="mt-1 text-sm font-medium text-gray-800">
                第 {activeChapter.chapter_index + 1} / 共 {chapters.length} 章
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Section C: 章节阅读路线
 */
const ChapterRouteSection: React.FC<{ bookId: string; map: LearningMapResponse }> = ({ bookId, map }) => {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const baselineReady = map.knowledge_baseline_status === 'ready';

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">章节阅读路线与词汇负担</h2>
          <p className="mt-1 text-xs text-gray-500">
            {baselineReady
              ? '通过图形或表格呈现各章节未知出现率与词汇负担，安排最佳阅读节奏。'
              : '尚未建立基线时仅展示统计出现与本书首次出现词元，建立基线后将显示未知负担。'}
          </p>
        </div>

        {/* 视图切换 Segmented Switch */}
        <div className="inline-flex rounded-lg bg-gray-100 p-1 text-xs font-medium text-gray-600">
          <button
            type="button"
            onClick={() => setViewMode('chart')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
              viewMode === 'chart'
                ? 'bg-white font-semibold text-indigo-700 shadow-sm'
                : 'hover:text-gray-900'
            }`}
          >
            <BarChart2 size={14} aria-hidden="true" />
            图表视图
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
              viewMode === 'table'
                ? 'bg-white font-semibold text-indigo-700 shadow-sm'
                : 'hover:text-gray-900'
            }`}
          >
            <Table size={14} aria-hidden="true" />
            表格视图
          </button>
        </div>
      </div>

      {map.chapters.length > 0 ? (
        viewMode === 'chart' ? (
          <ChapterRouteChartView
            bookId={bookId}
            chapters={map.chapters}
            anchorIndex={map.reading_anchor_chapter_index}
            baselineReady={baselineReady}
          />
        ) : (
          <div className="divide-y divide-gray-100">
            {/* 表头 (桌面端) */}
            <div className="hidden grid-cols-[minmax(0,1.8fr)_100px_minmax(140px,1.4fr)_130px_90px] gap-4 bg-gray-50/70 px-6 py-2.5 text-xs font-medium text-gray-500 sm:grid">
              <span>章节</span>
              <span className="text-right">统计出现</span>
              <span>未知出现率 / 负担</span>
              <span className="text-right">本书首次出现词元</span>
              <span className="text-right">操作</span>
            </div>

            {map.chapters.map((chapter) => {
              const isAnchor = chapter.chapter_index === map.reading_anchor_chapter_index;
              const unknownRate =
                baselineReady && chapter.unknown_occurrences !== null && chapter.eligible_occurrences > 0
                  ? chapter.unknown_occurrences / chapter.eligible_occurrences
                  : null;

              return (
                <div
                  id={`chapter-row-${chapter.chapter_index}`}
                  key={chapter.chapter_index}
                  className={`grid grid-cols-1 gap-2 p-4 transition-colors hover:bg-gray-50/50 sm:grid-cols-[minmax(0,1.8fr)_100px_minmax(140px,1.4fr)_130px_90px] sm:items-center sm:gap-4 sm:px-6 sm:py-3.5 ${
                    isAnchor ? 'bg-indigo-50/40' : ''
                  }`}
                >
                  {/* 章节标题与当前锚点 */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 text-sm">
                        第 {chapter.chapter_index + 1} 章
                      </span>
                      {isAnchor && (
                        <span className="inline-flex items-center rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                          当前阅读
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-gray-500" title={chapter.title}>
                      {chapter.title}
                    </p>
                  </div>

                  {/* 统计出现 */}
                  <div className="flex items-center justify-between sm:block sm:text-right">
                    <span className="text-xs text-gray-400 sm:hidden">统计出现</span>
                    <span className="text-sm font-medium tabular-nums text-gray-700">
                      {formatCount(chapter.eligible_occurrences)} 次
                    </span>
                  </div>

                  {/* 未知出现率与对比柱状条 */}
                  <div className="flex items-center justify-between sm:block">
                    <span className="text-xs text-gray-400 sm:hidden">未知负担</span>
                    {unknownRate !== null ? (
                      <div className="w-full max-w-[200px]">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold tabular-nums text-amber-700">
                            {(unknownRate * 100).toFixed(1)}% 未知
                          </span>
                          <span className="text-[11px] text-gray-500 tabular-nums">
                            {chapter.unknown_lexeme_count ?? 0} 词元 ({chapter.unknown_occurrences} 次)
                          </span>
                        </div>
                        <div
                          className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
                          role="progressbar"
                          aria-valuenow={Math.round(unknownRate * 100)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`第 ${chapter.chapter_index + 1} 章未知出现率 ${(unknownRate * 100).toFixed(1)}%`}
                        >
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all"
                            style={{ width: `${Math.min(100, Math.max(3, unknownRate * 100))}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 italic">
                        {baselineReady ? '无可统计词元' : '待建立基线'}
                      </span>
                    )}
                  </div>

                  {/* 本书首次出现词元 */}
                  <div className="flex items-center justify-between sm:block sm:text-right">
                    <span className="text-xs text-gray-400 sm:hidden">本书首次出现词元</span>
                    <div className="inline-flex items-center gap-1 text-xs text-gray-600 sm:justify-end">
                      <span className="font-medium tabular-nums text-gray-800">
                        {chapter.new_lexeme_count}
                      </span>
                      <span className="text-[11px] text-gray-400">词元</span>
                    </div>
                  </div>

                  {/* 进入阅读操作 */}
                  <div className="flex justify-end pt-1 sm:pt-0">
                    <Link
                      to={`/read/${bookId}?chapter=${chapter.chapter_index}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    >
                      <BookOpen size={13} aria-hidden="true" />
                      <span>阅读本章</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <p className="p-6 text-center text-sm text-gray-500">当前分析没有可显示的章节统计。</p>
      )}
    </section>
  );
};

/**
 * Section D: 下一步优先词
 */
const PriorityWordsSection: React.FC<{
  bookId: string;
  map: LearningMapResponse;
}> = ({ bookId, map }) => {
  const queryClient = useQueryClient();
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const [pendingLexemeIds, setPendingLexemeIds] = useState<Set<number>>(
    () => new Set(),
  );
  const pendingLexemeCountsRef = useRef<Map<number, number>>(new Map());
  const latestMutationIdsRef = useRef<Map<number, number>>(new Map());
  const nextMutationIdRef = useRef(0);
  const baselineReady = map.knowledge_baseline_status === 'ready';

  // 基线已建立时展示 recommended_lexemes；未建立时展示 manageable_lexemes 用于手动建基线
  const lexemesToShow = baselineReady
    ? map.recommended_lexemes
    : (map.manageable_lexemes ?? map.recommended_lexemes);

  interface StatusMutationVariables {
    lexemeId: number;
    status: LexemeKnowledgeStatus | null;
    requestId: number;
  }

  interface StatusMutationContext {
    lexemeId: number;
    previousStatus?: LexemeKnowledgeStatus | null;
    requestId: number;
  }

  const addPendingLexeme = (lexemeId: number) => {
    pendingLexemeCountsRef.current = incrementPendingLexeme(
      pendingLexemeCountsRef.current,
      lexemeId,
    );
    setPendingLexemeIds(new Set(pendingLexemeCountsRef.current.keys()));
  };

  const removePendingLexeme = (lexemeId: number) => {
    pendingLexemeCountsRef.current = decrementPendingLexeme(
      pendingLexemeCountsRef.current,
      lexemeId,
    );
    setPendingLexemeIds(new Set(pendingLexemeCountsRef.current.keys()));
  };

  const statusMutation = useMutation<
    Awaited<ReturnType<typeof putLexemeKnowledgeStatus>>,
    Error,
    StatusMutationVariables,
    StatusMutationContext
  >({
    mutationFn: ({ lexemeId, status }: StatusMutationVariables) =>
      status === null
        ? deleteLexemeKnowledgeStatus(lexemeId)
        : putLexemeKnowledgeStatus(lexemeId, status),
    onMutate: async ({ lexemeId, status, requestId }) => {
      await queryClient.cancelQueries({
        queryKey: [LEARNING_MAP_QUERY_KEY, bookId],
        exact: true,
      });
      const previousMap = queryClient.getQueryData<LearningMapResponse>([
        LEARNING_MAP_QUERY_KEY,
        bookId,
      ]);
      const previousStatus = previousMap
        ? getLearningMapLexemeStatus(previousMap, lexemeId)
        : undefined;
      if (previousMap) {
        queryClient.setQueryData<LearningMapResponse>(
          [LEARNING_MAP_QUERY_KEY, bookId],
          updateLearningMapLexemeStatus(previousMap, lexemeId, status),
        );
      }
      setStatusFeedback('正在提交...');
      if (import.meta.env.DEV) {
        console.debug('learning_map phase=optimistic_status_feedback');
      }
      return { lexemeId, previousStatus, requestId };
    },
    onError: (error, _variables, context) => {
      const currentMap = queryClient.getQueryData<LearningMapResponse>([
        LEARNING_MAP_QUERY_KEY,
        bookId,
      ]);
      const isLatestRequest =
        context &&
        isLatestLexemeMutation(
          latestMutationIdsRef.current,
          context.lexemeId,
          context.requestId,
        );
      if (
        currentMap &&
        isLatestRequest &&
        context.previousStatus !== undefined
      ) {
        queryClient.setQueryData<LearningMapResponse>(
          [LEARNING_MAP_QUERY_KEY, bookId],
          updateLearningMapLexemeStatus(
            currentMap,
            context.lexemeId,
            context.previousStatus,
          ),
        );
      }
      if (isLatestRequest || !context) {
        setStatusFeedback(`状态更新失败：${getErrorMessage(error)}`);
        void queryClient.invalidateQueries({
          queryKey: [LEARNING_MAP_QUERY_KEY, bookId],
          exact: true,
        });
      }
    },
    onSuccess: (_response, variables) => {
      if (
        isLatestLexemeMutation(
          latestMutationIdsRef.current,
          variables.lexemeId,
          variables.requestId,
        )
      ) {
        setStatusFeedback('词汇状态已更新，统计正在后台同步。');
        void queryClient.invalidateQueries({
          queryKey: [LEARNING_MAP_QUERY_KEY, bookId],
          exact: true,
        });
      }
    },
    onSettled: (_data, _error, variables) => {
      removePendingLexeme(variables.lexemeId);
      if (
        isLatestLexemeMutation(
          latestMutationIdsRef.current,
          variables.lexemeId,
          variables.requestId,
        )
      ) {
        latestMutationIdsRef.current.delete(variables.lexemeId);
      }
    },
  });

  const handleStatusChange = (
    lexemeId: number,
    status: LexemeKnowledgeStatus | null,
  ) => {
    const requestId = nextMutationIdRef.current;
    nextMutationIdRef.current += 1;
    latestMutationIdsRef.current.set(lexemeId, requestId);
    addPendingLexeme(lexemeId);
    statusMutation.mutate({ lexemeId, status, requestId });
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-4 sm:px-6">
        <h2 className="text-base font-semibold text-gray-900">
          {baselineReady ? '下一步优先词' : '建立个人词汇基线'}
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          {baselineReady
            ? `按第 ${map.reading_anchor_chapter_index + 1} 章及之后的出现频次排序，优先处理后续出现最多的生词。`
            : '未建立个人基线时，请仅标注您真正确定已掌握的词（标记为“已掌握”）；其他词保持未设置。'}
        </p>
      </div>

      {!baselineReady && (
        <div className="mx-5 my-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900 sm:mx-6">
          <p className="font-semibold text-amber-950">提示：诚实建立基线</p>
          <p className="mt-1">
            请只将您真正已经掌握的词标注为“已掌握”。未标注的词保持“未设置”，系统不会把未设置强行假定为已知或未知。
          </p>
        </div>
      )}

      {lexemesToShow.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-500">
          {baselineReady
            ? map.coverage
              ? '当前后续章节没有符合条件的推荐生词。'
              : '当前过滤范围内没有符合统计条件的词元。'
            : '当前没有可手动标注的词元。'}
        </p>
      ) : (
        <>
          <StatusFeedback error={statusMutation.error} message={statusFeedback} />
          <ul className="divide-y divide-gray-100">
            {lexemesToShow.map((lexeme) => (
              <RecommendationRow
                key={lexeme.lexeme_id}
                lexeme={lexeme}
                isPending={pendingLexemeIds.has(lexeme.lexeme_id)}
                onStatusChange={(status) =>
                  handleStatusChange(lexeme.lexeme_id, status)
                }
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

const RecommendationRow: React.FC<{
  lexeme: LearningMapRecommendedLexeme | LearningMapManageableLexeme;
  isPending: boolean;
  onStatusChange: (status: LexemeKnowledgeStatus | null) => void;
}> = ({ lexeme, isPending, onStatusChange }) => {
  const currentStatus = lexeme.knowledge_status ?? lexeme.state ?? 'unset';
  const isRecommended = !('is_recommended' in lexeme) || lexeme.is_recommended;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-5 py-3.5 transition-colors hover:bg-gray-50/50 sm:grid-cols-[minmax(0,1.2fr)_120px_100px_100px_136px] sm:items-center sm:gap-4 sm:px-6">
      {/* 单词表记与读音/词性 */}
      <div className="min-w-0">
        <p className="truncate font-bold text-gray-900 text-base" title={lexeme.display_form}>
          {lexeme.display_form}
        </p>
        <p className="truncate text-xs text-gray-500 mt-0.5">
          {lexeme.reading || '读音待确认'} · {POS_LABELS[lexeme.part_of_speech] || lexeme.part_of_speech || '词性待确认'}
          {!isRecommended && <span className="ml-1 text-amber-600">(从推荐中排除)</span>}
        </p>
      </div>

      {/* 从阅读位置起的后续出现 */}
      <div className="text-right sm:text-right">
        <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold tabular-nums text-blue-700">
          {lexeme.upcoming_chapter_occurrence_count} 次后续出现
        </span>
      </div>

      {/* 全书出现 */}
      <span className="hidden text-right text-xs tabular-nums text-gray-600 sm:block">
        全书 {lexeme.book_occurrence_count} 次
      </span>

      {/* 首次出现章节 */}
      <span className="hidden text-right text-xs text-gray-500 sm:block">
        首见第 {lexeme.first_chapter_index + 1} 章
      </span>

      {/* 状态设置下拉框 */}
      <label className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
        <span className="text-xs text-gray-500 sm:hidden">知识状态</span>
        <span className="relative inline-flex min-w-[128px] items-center">
          {isPending && (
            <Loader2
              size={14}
              className="pointer-events-none absolute left-2.5 z-10 animate-spin text-blue-600"
              aria-hidden="true"
            />
          )}
          <select
            aria-label={`设置 ${lexeme.display_form} 的掌握状态`}
            className="h-9 w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-gray-700 transition-colors hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:bg-gray-50 disabled:text-gray-400"
            value={currentStatus}
            disabled={isPending}
            onChange={(event) => {
              const nextValue = event.target.value as LexemeKnowledgeStatus | 'unset';
              onStatusChange(nextValue === 'unset' ? null : nextValue);
            }}
          >
            {MANUAL_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.description}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </label>

      {/* 查词事实观察 */}
      <LookupObservation observation={lexeme.lookup_observation} />
    </li>
  );
};

/**
 * Section E: 学习投入与书内覆盖收益
 */
const CoverageYieldSection: React.FC<{ map: LearningMapResponse }> = ({ map }) => {
  const curve = map.coverage_curve;
  if (!curve || curve.length === 0) return null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-4 sm:px-6">
        <h2 className="text-base font-semibold text-gray-900">学习投入与书内覆盖收益</h2>
        <p className="mt-1 text-xs text-gray-500">
          按书内词频降序统计：展示掌握最高频的前 N 个词元时对全书出现次数的边际覆盖比例。
        </p>
      </div>

      <div className="p-5 sm:p-6">
        {/* CSS 边际收益柱状/阶梯可视化 */}
        <div className="space-y-3">
          {curve.map((point, index) => {
            const prevPoint = index > 0 ? curve[index - 1] : null;
            const lexemeDiff = prevPoint ? point.required_lexeme_count - prevPoint.required_lexeme_count : point.required_lexeme_count;
            const coverageDiff = prevPoint ? (point.target_coverage - prevPoint.target_coverage) * 100 : point.target_coverage * 100;

            return (
              <div key={point.target_coverage} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-800">
                    覆盖率 {formatCoverage(point.target_coverage)}
                  </span>
                  <span className="text-gray-600 tabular-nums">
                    需要 <strong className="font-semibold text-gray-900">{point.required_lexeme_count}</strong> 词
                    ({point.covered_occurrences.toLocaleString('zh-CN')} 次出现)
                    {index > 0 && (
                      <span className="ml-2 text-indigo-600">
                        (增量: +{coverageDiff.toFixed(0)}% 需 +{lexemeDiff} 词)
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-3.5 w-full overflow-hidden rounded-full bg-gray-100 p-0.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all"
                    style={{ width: `${Math.min(100, Math.max(4, point.target_coverage * 100))}%` }}
                    role="progressbar"
                    aria-valuenow={Math.round(point.target_coverage * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`目标覆盖率 ${formatCoverage(point.target_coverage)} 需要 ${point.required_lexeme_count} 词元`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-4 border-t border-gray-100 pt-3 text-[11px] leading-5 text-gray-500">
          注：此收益仅反映“书内词汇出现次数”的数学累积覆盖比例。高覆盖率代表阅读时碰到的词汇大部分处于已知范围，不等于阅读理解能力保证、JLPT 考试等级或通用词汇量。
        </p>
      </div>
    </section>
  );
};

const StatusFeedback: React.FC<{ error: unknown; message: string | null }> = ({ error, message }) => {
  if (error) {
    return (
      <div className="mx-5 my-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 sm:mx-6">
        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>{getErrorMessage(error)}</span>
      </div>
    );
  }

  if (!message) return null;

  return (
    <div className="mx-5 my-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 sm:mx-6">
      <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
};

const LearningMapReady: React.FC<{ bookId: string; map: LearningMapResponse }> = ({ bookId, map }) => {
  return (
    <div className="space-y-5">
      {/* Section B: 首要结论 - 阅读准备度 */}
      <ReadingReadinessSection map={map} />

      {/* Section C: 章节阅读路线与词汇负担 */}
      <ChapterRouteSection bookId={bookId} map={map} />

      {/* Section D: 下一步优先词 / 建立个人词汇基线 */}
      <PriorityWordsSection bookId={bookId} map={map} />

      {/* Section E: 学习投入与书内覆盖收益 */}
      <CoverageYieldSection map={map} />
    </div>
  );
};

const LearningMapPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const bookQuery = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => getBookDetail(bookId as string),
    enabled: Boolean(bookId),
  });
  const mapQuery = useQuery({
    queryKey: [LEARNING_MAP_QUERY_KEY, bookId],
    queryFn: () => getLearningMap(bookId as string),
    enabled: Boolean(bookId),
  });

  if (!bookId) {
    return <PageMessage icon={<AlertCircle />} title="缺少书籍信息" message="无法确定要显示的书籍。" />;
  }

  if (bookQuery.isLoading || mapQuery.isLoading) {
    return (
      <PageMessage
        icon={<Loader2 className="animate-spin text-blue-600" />}
        title="正在加载学习地图"
        message="正在读取本书的分析结果与个人词汇基线..."
      />
    );
  }

  if (bookQuery.isError || mapQuery.isError || !mapQuery.data) {
    const error = bookQuery.error || mapQuery.error;
    return (
      <PageMessage
        icon={<AlertCircle className="text-red-500" />}
        title="学习地图加载失败"
        message={getErrorMessage(error)}
        backTo={`/book/${bookId}`}
        backLabel="返回书籍主页"
      />
    );
  }

  const map = mapQuery.data;
  const bookTitle = bookQuery.data?.title || '书籍学习地图';

  return (
    <div className="min-h-screen bg-gray-50/80 text-gray-900 pb-12">
      {/* Section A: 页面头部和当前阅读上下文 */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to={`/book/${bookId}`}
              className="flex-shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              aria-label="返回书籍主页"
              title="返回书籍主页"
            >
              <ArrowLeft size={20} />
            </Link>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600">
                <MapIcon size={14} aria-hidden="true" />
                词汇阅读准备度与学习优先级
              </p>
              <h1 className="truncate text-base font-bold text-gray-900 sm:text-lg" title={bookTitle}>
                {bookTitle}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/read/${bookId}?chapter=${map.reading_anchor_chapter_index}`}
              aria-label={`继续阅读第 ${map.reading_anchor_chapter_index + 1} 章`}
              className="flex flex-shrink-0 items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-800"
            >
              <BookOpen size={15} aria-hidden="true" />
              <span>继续阅读 (第 {map.reading_anchor_chapter_index + 1} 章)</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {map.analysis_status === 'needs_analysis' ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900 sm:p-6">
            <div className="flex items-start gap-3">
              <RefreshCw size={20} className="mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
              <div>
                <h2 className="font-semibold text-base">需要重新分析这本书</h2>
                <p className="mt-2 text-xs leading-6 text-amber-800">
                  当前书籍缺少 active AnalysisRun。请在书籍主页点击重新分析。重新分析完成后，
                  系统将呈现准确的章节未知词负担和推荐词优先级。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <LearningMapReady bookId={bookId} map={map} />
        )}
      </main>
    </div>
  );
};

const PageMessage: React.FC<{
  icon: React.ReactNode;
  title: string;
  message: string;
  backTo?: string;
  backLabel?: string;
}> = ({
  icon,
  title,
  message,
  backTo = '/',
  backLabel = '返回书架',
}) => (
  <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
      <div className="mx-auto mb-3 flex w-fit items-center justify-center text-gray-400">{icon}</div>
      <h1 className="text-base font-semibold text-gray-800">{title}</h1>
      <p className="mt-2 text-xs leading-6 text-gray-500">{message}</p>
      <Link
        to={backTo}
        className="mt-5 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {backLabel}
      </Link>
    </div>
  </div>
);
export default LearningMapPage;
