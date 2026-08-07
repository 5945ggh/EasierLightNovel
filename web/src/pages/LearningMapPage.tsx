import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BarChart2,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  Table,
  TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  Cell,
} from 'recharts';
import { getBookDetail } from '@/services/books.service';
import { getLearningMap } from '@/services/learning-map.service';
import type {
  LearningMapChapter,
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

const formatFilterScope = (map: LearningMapResponse): string => {
  const { filter_spec: filterSpec } = map;
  const partOfSpeech = filterSpec.pos_allowlist
    .map((pos) => POS_LABELS[pos] || pos)
    .join('、');
  const properNouns = filterSpec.exclude_proper_nouns
    ? '专有名词不计入覆盖率统计'
    : '专有名词保留在覆盖率统计中';
  const oov = filterSpec.exclude_oov
    ? '词表外未收录词 (Out of Vocabulary, i.e. OOV) 不计入覆盖率分母'
    : '词表外未收录词 (Out of Vocabulary, i.e. OOV) 计入覆盖率分母';
  return `仅统计具有实际含义的词汇（包含${partOfSpeech || '名词、动词、形容词、副词'}），自动排除“は/が/です/ます”等纯语法虚词。${properNouns}。${oov}。`;
};

const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '学习地图暂时无法加载，请稍后重试。';
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
  const curve = map.coverage_curve;

  const uncoveredOccurrences = coverage
    ? coverage.eligible_occurrences - coverage.known_occurrences
    : null;
  const uncoveredBurdenPer1k =
    coverage && coverage.eligible_occurrences > 0 && uncoveredOccurrences !== null
      ? Math.round((uncoveredOccurrences / coverage.eligible_occurrences) * 1000)
      : null;

  // 动态寻找高于当前覆盖率的下一个收益目标点
  const currentCoverageRatio = coverage?.explicit_known_coverage ?? 0;
  const nextYieldPoint = curve?.find(
    (point) => point.target_coverage > currentCoverageRatio + 0.001
  );

  return (
    <section className="space-y-3">
      {/* 统一顶栏 KPI 卡片 */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3.5">
          <div>
            <p className="text-[11px] font-bold tracking-wider text-indigo-600 dark:text-indigo-400 uppercase">
              个人词汇阅读准备度诊断
            </p>
            <h2 className="mt-0.5 text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100">
              {coverage
                ? '全书词汇阻力与已知覆盖概览'
                : baselineReady
                  ? '当前范围无可统计词元'
                  : '个人词汇基线未建立'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">阅读锚点：</span>
            <span className="inline-flex items-center rounded-lg bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800/50">
              第 {map.reading_anchor_chapter_index + 1} 章
            </span>
          </div>
        </div>

        {coverage ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] items-center">
            {/* 左侧：主要指标与卡片网格 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
              {/* 明确掌握覆盖率 */}
              <div className="space-y-1 sm:border-r border-slate-100 dark:border-slate-800 sm:pr-4">
                <span className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 sm:text-5xl tabular-nums block">
                  {formatCoverage(coverage.explicit_known_coverage)}
                </span>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
                  明确掌握覆盖率 (已标记“会”)
                </span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums block">
                  已知 {coverage.known_occurrences.toLocaleString('zh-CN')} 次 / 共 {coverage.eligible_occurrences.toLocaleString('zh-CN')} 次
                </span>
              </div>

              {/* 每千词未覆盖负担 */}
              <div className="rounded-xl bg-amber-50/90 dark:bg-amber-950/40 p-3.5 border border-amber-200/80 dark:border-amber-900/40 space-y-1">
                <span className="text-xs font-semibold text-amber-900 dark:text-amber-300 block">
                  每千词未覆盖阻力
                </span>
                <span className="text-2xl font-black text-amber-900 dark:text-amber-200 tabular-nums block">
                  {uncoveredBurdenPer1k ?? '-'} <span className="text-xs font-normal text-amber-700 dark:text-amber-400">次/千词</span>
                </span>
                <span className="text-[10px] text-amber-700/90 dark:text-amber-400 block">
                  预估每千词未掌握实词频次
                </span>
              </div>

              {/* 未明确掌握实词总频次 */}
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/60 dark:border-slate-800 space-y-1">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
                  未明确掌握实词频次
                </span>
                <span className="text-xl font-bold text-slate-800 dark:text-slate-200 tabular-nums block">
                  {uncoveredOccurrences?.toLocaleString('zh-CN')} 次
                </span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 block">
                  全书需攻坚或确认的实词出现
                </span>
              </div>
            </div>

            {/* 右侧：学习投效预测微卡片 */}
            {nextYieldPoint ? (
              <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/50 bg-gradient-to-br from-indigo-50/70 to-slate-50 dark:from-indigo-950/30 dark:to-slate-900/40 p-4 min-w-[240px]">
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                  <TrendingUp size={15} />
                  <span>高频覆盖率展望</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-700 dark:text-slate-300">
                  若前 <strong className="text-indigo-600 dark:text-indigo-400 font-bold">{nextYieldPoint.required_lexeme_count}</strong> 个核心词汇均已掌握，
                  全书明确掌握覆盖率可达到 <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{formatCoverage(nextYieldPoint.target_coverage)}</strong>。
                </p>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  这是书内词频结构的数学估算，不构成学习任务或复习安排
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-100 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50/70 to-slate-50 dark:from-emerald-950/30 dark:to-slate-900/40 p-4 min-w-[240px]">
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 size={15} />
                  <span>高覆盖率里程碑</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-700 dark:text-slate-300">
                  已知覆盖率已达 <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{formatCoverage(coverage.explicit_known_coverage)}</strong>，
                  高于主要预设曲线目标点。
                </p>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  已具备极高顺畅阅读基础
                </p>
              </div>
            )}
          </div>
        ) : baselineReady ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3.5 text-xs leading-5 text-blue-900">
            <p className="font-semibold text-blue-950">当前范围没有可统计词元</p>
            <p className="mt-1">
              已建立个人词汇基线，但当前筛选条件（如词性过滤）下没有产生符合条件的实词。
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 text-xs leading-5 text-amber-900">
            <p className="font-semibold text-amber-950">尚未建立个人词汇基线</p>
            <p className="mt-1">
              系统不会将没有个人基线的词强行判定为不认识。导入个人词汇基线后，才会显示个人覆盖率与阅读负担。
            </p>
          </div>
        )}

        {/* 底部说明与规则展开 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 pt-3 text-xs text-slate-500 dark:text-slate-400">
          <p className="italic text-[11px] text-slate-400 dark:text-slate-500">
            注：“阻力”限定为词汇层面的个人阅读负担，不代表句法复杂度和文学综合难度。
          </p>

          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="inline-flex items-center gap-1 font-medium text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 focus:outline-none transition-colors"
            aria-expanded={showDetails}
          >
            <span>查看词汇筛选规则</span>
            {showDetails ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* 可折叠词汇筛选规则说明 */}
      {showDetails && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4 text-xs leading-6 text-slate-600 dark:text-slate-400 transition-all space-y-2">
          <p className="font-semibold text-slate-800 dark:text-slate-200">本页词汇筛选规则：</p>
          <p className="text-slate-700 dark:text-slate-300">{formatFilterScope(map)}</p>
          <ul className="space-y-1 text-slate-500 dark:text-slate-400 list-disc pl-4">
            <li><strong className="text-slate-700 dark:text-slate-300">明确掌握：</strong>由已导入的个人词汇基线确认，并计入明确掌握覆盖率。</li>
            <li><strong className="text-slate-700 dark:text-slate-300">未明确掌握：</strong>表示当前没有明确掌握证据，不等同于系统认定“不会”。</li>
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
            未明确掌握出现率：
            {hasStats
              ? `${data.unknownRate}%`
              : baselineReady
                ? '无可统计词元'
                : '待建立基线'}
          </p>
          <p className="text-gray-600">
            未明确掌握词汇负担：
            {hasStats
              ? `${data.unknownLexemeCount} 词元 (${data.unknownOccurrences} 次出现)`
              : baselineReady
                ? '无可统计词元'
                : '待建立基线'}
          </p>
          <p className="text-gray-600">实词出现：{data.eligibleOccurrences} 次</p>
          <p className="text-indigo-600">本书首次出现：{data.newLexemeCount} 词元</p>
        </div>
      </div>
    );
  }
  return null;
};

/**
 * 基于 Recharts 的详细图表视图模式组件
 * 平均未明确掌握出现率按词汇出现次数加权统计，确保与全书主覆盖率指标 1 - explicit_known_coverage 保持一致。
 */
const ChapterRouteChartView: React.FC<{
  bookId: string;
  chapters: LearningMapChapter[];
  anchorIndex: number;
  baselineReady: boolean;
  selectedChapterIndex: number | null;
  onSelectChapter: (index: number | null) => void;
}> = ({ bookId, chapters, anchorIndex, baselineReady, selectedChapterIndex, onSelectChapter }) => {
  const activeChapterIndex = selectedChapterIndex !== null
    ? selectedChapterIndex
    : (anchorIndex < chapters.length ? anchorIndex : 0);

  const activeChapter = chapters[activeChapterIndex] || chapters[0];
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

  // 加权平均计算：全书总未明确掌握出现次数 / 全书总符合口径出现次数。
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
              未明确掌握出现率 (%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-indigo-500 inline-block" />
              首次出现词元数 (右轴)
            </span>
            {baselineReady && weightedAverageRate > 0 && (
              <span className="flex items-center gap-1 text-amber-700">
                <span className="h-0.5 w-3 border-b border-dashed border-amber-600 inline-block" />
                全书平均未明确掌握出现率 ({weightedAverageRate.toFixed(1)}%)
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
                  const clickedIndex = state.activeTooltipIndex;
                  if (selectedChapterIndex === clickedIndex) {
                    onSelectChapter(null);
                  } else {
                    onSelectChapter(clickedIndex);
                  }
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
                name="未明确掌握出现率"
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 shadow-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition-colors"
            >
              <BookOpen size={14} aria-hidden="true" />
              <span>阅读本章</span>
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-3.5 sm:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">未明确掌握出现率 / 负担</p>
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
              <p className="text-[11px] text-gray-500">纳入统计的实词</p>
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
const ChapterRouteSection: React.FC<{
  bookId: string;
  map: LearningMapResponse;
  selectedChapterIndex: number | null;
  onSelectChapter: (index: number | null) => void;
}> = ({ bookId, map, selectedChapterIndex, onSelectChapter }) => {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const baselineReady = map.knowledge_baseline_status === 'ready';

  return (
    <section className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 dark:border-slate-800 px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">章节阅读路线与词汇负担</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            {baselineReady
              ? '点击图中柱形或表格行，右侧将协同展现对应章节的焦点词汇。'
              : '尚未建立基线时仅展示统计出现与本书首次出现词元。'}
          </p>
        </div>

        {/* 视图切换 Segmented Switch */}
        <div className="inline-flex rounded-lg bg-gray-100 dark:bg-slate-800 p-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          <button
            type="button"
            onClick={() => setViewMode('chart')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${viewMode === 'chart'
              ? 'bg-white dark:bg-slate-700 font-semibold text-indigo-700 dark:text-indigo-300 shadow-sm'
              : 'hover:text-gray-900 dark:hover:text-slate-100'
              }`}
          >
            <BarChart2 size={14} aria-hidden="true" />
            图表视图
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${viewMode === 'table'
              ? 'bg-white dark:bg-slate-700 font-semibold text-indigo-700 dark:text-indigo-300 shadow-sm'
              : 'hover:text-gray-900 dark:hover:text-slate-100'
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
            selectedChapterIndex={selectedChapterIndex}
            onSelectChapter={onSelectChapter}
          />
        ) : (
          <div className="divide-y divide-gray-100">
            {/* 表头 (桌面端) */}
            <div className="hidden grid-cols-[minmax(0,1.8fr)_100px_minmax(140px,1.4fr)_130px_90px] gap-4 bg-gray-50/70 px-6 py-2.5 text-xs font-medium text-gray-500 sm:grid">
              <span>章节</span>
              <span className="text-right">统计出现</span>
              <span>未明确掌握出现率 / 负担</span>
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
                  className={`grid grid-cols-1 gap-2 p-4 transition-colors hover:bg-gray-50/50 sm:grid-cols-[minmax(0,1.8fr)_100px_minmax(140px,1.4fr)_130px_90px] sm:items-center sm:gap-4 sm:px-6 sm:py-3.5 ${isAnchor ? 'bg-indigo-50/40' : ''
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

                  {/* 未明确掌握出现率与对比柱状条 */}
                  <div className="flex items-center justify-between sm:block">
                    <span className="text-xs text-gray-400 sm:hidden">未明确掌握负担</span>
                    {unknownRate !== null ? (
                      <div className="w-full max-w-[200px]">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold tabular-nums text-amber-700">
                            {(unknownRate * 100).toFixed(1)}% 未明确掌握
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
                          aria-label={`第 ${chapter.chapter_index + 1} 章未明确掌握出现率 ${(unknownRate * 100).toFixed(1)}%`}
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
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
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
 * Section D: 学习投入与书内覆盖收益
 */
interface CurveChartPoint {
  coveragePct: string;
  targetCoverage: number;
  requiredLexemes: number;
  coveredOccurrences: number;
  marginalCoveragePct: number;
  marginalLexemes: number;
}

const CoverageYieldTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: CurveChartPoint }>;
}> = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-3 shadow-md text-xs space-y-1 backdrop-blur-sm max-w-xs z-30">
        <p className="font-bold text-gray-900 dark:text-slate-100 border-b border-gray-100 dark:border-slate-800 pb-1">
          目标覆盖率：{data.coveragePct}
        </p>
        <p className="text-indigo-700 dark:text-indigo-300 font-semibold pt-0.5">
          需要高频词元：{data.requiredLexemes} 词
        </p>
        <p className="text-gray-600 dark:text-slate-300 tabular-nums">
          对应全书出现：{data.coveredOccurrences.toLocaleString('zh-CN')} 次
        </p>
        {data.marginalLexemes > 0 && (
          <p className="text-emerald-700 dark:text-emerald-400 text-[11px]">
            边际收益：+{data.marginalCoveragePct.toFixed(0)}% 覆盖率需额外 +{data.marginalLexemes} 词
          </p>
        )}
      </div>
    );
  }
  return null;
};

const CoverageYieldSection: React.FC<{ map: LearningMapResponse }> = ({ map }) => {
  const curve = map.coverage_curve;
  if (!curve || curve.length === 0) return null;

  const currentCoveragePct = map.coverage
    ? Number((map.coverage.explicit_known_coverage * 100).toFixed(1))
    : null;

  const chartData: CurveChartPoint[] = curve.map((point, index) => {
    const prevPoint = index > 0 ? curve[index - 1] : null;
    const lexemeDiff = prevPoint
      ? point.required_lexeme_count - prevPoint.required_lexeme_count
      : point.required_lexeme_count;
    const coverageDiff = prevPoint
      ? (point.target_coverage - prevPoint.target_coverage) * 100
      : point.target_coverage * 100;

    return {
      coveragePct: formatCoverage(point.target_coverage),
      targetCoverage: Math.round(point.target_coverage * 100),
      requiredLexemes: point.required_lexeme_count,
      coveredOccurrences: point.covered_occurrences,
      marginalCoveragePct: coverageDiff,
      marginalLexemes: lexemeDiff,
    };
  });

  const targetCoverageValues = chartData.map((point) => point.targetCoverage);
  const minX = Math.min(...targetCoverageValues);
  const maxX = Math.max(...targetCoverageValues);
  const showCurrentReference = currentCoveragePct !== null
    && currentCoveragePct >= minX
    && currentCoveragePct <= maxX;

  return (
    <section className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 dark:border-slate-800 px-4 py-3.5 sm:px-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">学习投入与书内覆盖收益</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          水平折线图展示掌握高频词汇数量与全书出现次数累积覆盖率的边际收益关系。
        </p>
      </div>

      <div className="p-4 sm:p-5 space-y-3">
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/40 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2.5 mb-2 text-xs">
            <div className="flex items-center gap-3 text-gray-600 dark:text-slate-300 font-medium">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400 inline-block" />
                所需高频词元数
              </span>
              <span className="text-gray-400 dark:text-slate-500">目标覆盖率</span>
            </div>
            {currentCoveragePct !== null && (
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
                <span className={showCurrentReference
                  ? 'h-0.5 w-3 border-b border-dashed border-emerald-600 dark:border-emerald-400 inline-block'
                  : 'h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400 inline-block'}
                />
                当前掌握 {currentCoveragePct}%
                {!showCurrentReference && (
                  <span className="font-normal text-emerald-600/70 dark:text-emerald-400/70">
                  </span>
                )}
              </span>
            )}
          </div>

          <div className="h-48 w-full sm:h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 8, right: 10, left: -10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="coverageGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="targetCoverage"
                  type="number"
                  domain={[minX, maxX]}
                  ticks={targetCoverageValues}
                  tickFormatter={(val: number) => `${val}%`}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={{ stroke: '#475569' }}
                />
                <YAxis
                  unit=" 词"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 'auto']}
                />
                <RechartsTooltip content={<CoverageYieldTooltip />} />
                {showCurrentReference && currentCoveragePct !== null && (
                  <ReferenceLine
                    x={currentCoveragePct}
                    stroke="#10b981"
                    strokeDasharray="3 3"
                    label={{
                      value: `当前 (${currentCoveragePct}%)`,
                      position: 'top',
                      fill: '#10b981',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="requiredLexemes"
                  name="所需词元数"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#coverageGradient)"
                  dot={{ r: 3.5, fill: '#6366f1', stroke: '#ffffff', strokeWidth: 1.5 }}
                  activeDot={{ r: 5, fill: '#6366f1' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <p className="border-t border-gray-100 dark:border-slate-800 pt-3 text-[11px] leading-5 text-gray-500 dark:text-slate-400">
          注：此收益仅反映“书内词汇出现次数”的数学累积覆盖比例。高覆盖率代表阅读时碰到的词汇大部分处于已知范围，不等于阅读理解能力保证、JLPT 考试等级或通用词汇量。
        </p>
      </div>
    </section>
  );
};

const LearningMapReady: React.FC<{ bookId: string; map: LearningMapResponse }> = ({ bookId, map }) => {
  const [selectedChapterIndex, setSelectedChapterIndex] = useState<number | null>(
    map.reading_anchor_chapter_index < map.chapters.length ? map.reading_anchor_chapter_index : null
  );

  return (
    <div className="space-y-6">
      {/* 顶部: 个人词汇阅读准备度与收益诊断 KPI */}
      <ReadingReadinessSection map={map} />

      {/* 章节路线与阻力地图 */}
      <ChapterRouteSection
        bookId={bookId}
        map={map}
        selectedChapterIndex={selectedChapterIndex}
        onSelectChapter={setSelectedChapterIndex}
      />

      {/* 底部: 学习投入与书内覆盖收益曲线 */}
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
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-12 transition-colors">
      {/* Section A: 页面头部和当前阅读上下文 */}
      <header className="sticky top-0 z-20 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to={`/book/${bookId}`}
              className="flex-shrink-0 rounded-lg p-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="返回书籍主页"
              title="返回书籍主页"
            >
              <ArrowLeft size={20} strokeWidth={1.5} />
            </Link>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-blue-600 dark:text-slate-blue-400">
                <MapIcon size={14} strokeWidth={1.5} aria-hidden="true" />
                词汇阅读准备度与章节路线
              </p>
              <h1 className="truncate text-base font-bold text-slate-900 dark:text-slate-100 sm:text-lg" title={bookTitle}>
                {bookTitle}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/read/${bookId}?chapter=${map.reading_anchor_chapter_index}`}
              aria-label={`继续阅读第 ${map.reading_anchor_chapter_index + 1} 章`}
              className="flex flex-shrink-0 items-center gap-2 rounded-xl border border-slate-blue-200 dark:border-slate-800 bg-slate-blue-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-blue-700 dark:text-slate-blue-300 transition-colors hover:bg-slate-blue-100 dark:hover:bg-slate-700"
            >
              <BookOpen size={15} strokeWidth={1.5} aria-hidden="true" />
              <span>继续阅读 (第 {map.reading_anchor_chapter_index + 1} 章)</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {map.analysis_status === 'needs_analysis' ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 p-5 text-amber-900 dark:text-amber-200 sm:p-6">
            <div className="flex items-start gap-3">
              <RefreshCw size={20} className="mt-0.5 flex-shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <div>
                <h2 className="font-semibold text-base">需要重新分析这本书</h2>
                <p className="mt-2 text-xs leading-6 text-amber-800 dark:text-amber-300">
                  当前书籍缺少 active AnalysisRun。请在书籍主页点击重新分析。重新分析完成后，
                  系统将呈现准确的章节词汇负担与书内覆盖曲线。
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
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex w-fit items-center justify-center text-slate-400 dark:text-slate-500">{icon}</div>
        <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h1>
        <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">{message}</p>
        <Link
          to={backTo}
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {backLabel}
        </Link>
      </div>
    </div>
  );
export default LearningMapPage;
