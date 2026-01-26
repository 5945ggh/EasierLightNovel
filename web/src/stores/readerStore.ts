/**
 * 阅读器 Store - 运行时状态（不持久化）
 */

import { create } from 'zustand';
import type { TokenData, ChapterResponse } from '@/types';
import type { ChapterHighlightData, ChapterListItem } from '@/types/chapter';
import type { VocabularyResponse } from '@/types/vocabulary';
import { getArchiveItem } from '@/services/highlights.service';

/**
 * 侧边栏标签页
 */
export type SidebarTab = 'dictionary' | 'ai' | 'vocabulary' | 'highlights';

/**
 * 选中的 Token 信息
 */
export interface SelectedToken {
  token: TokenData;
  segmentIndex: number;
  tokenIndex: number;
  /** 原始文本（用于显示） */
  text: string;
}

/**
 * 高亮样式映射 (key: "segmentIdx-tokenIdx", value: styleCategory)
 * 用于 O(1) 查询某个 Token 是否被高亮
 */
export type HighlightMap = Map<string, string>;

/**
 * 临时高亮（用于乐观更新，无真实 ID）
 */
export interface PendingHighlight {
  tempId: string;
  start_segment_index: number;
  start_token_idx: number;
  end_segment_index: number;
  end_token_idx: number;
  style_category: string;
  book_id: string;
  chapter_index: number;
  selected_text: string;
}

/**
 * 阅读器状态
 */
interface ReaderState {
  // 当前书籍信息
  bookId: string | null;
  chapterIndex: number | null;
  chapter: ChapterResponse | null;

  // 生词集合 (O(1) 查找)
  vocabularySet: Set<string>;
  // 完整生词列表（包含 ID，用于删除操作）
  vocabularies: VocabularyResponse[];

  // 高亮数据
  highlights: ChapterHighlightData[];  // 当前章节的高亮
  highlightMap: HighlightMap;
  // 待同步的高亮（乐观更新但尚未收到服务器响应）
  pendingHighlights: PendingHighlight[];
  // 整本书的高亮数据（用于高亮列表跨章节显示）
  allHighlights: ChapterHighlightData[];
  // 所有章节列表（用于高亮列表章节选择）
  allChapterList: ChapterListItem[];
  // 高亮列表当前查看的章节索引（null 表示全部）
  highlightViewChapter: number | null;

  // 滚动位置
  currentSegmentIndex: number;
  /** 段落偏移比例 (0~1)，用于精确恢复阅读位置 */
  segmentOffset: number;

  // 交互状态
  selectedToken: SelectedToken | null;
  /** AI 分析触发信号（点击"AI解析"按钮时设置，AITab 执行后清除） */
  aiAnalysisTrigger: number | null;  // 存储要分析的 highlightId
  /** 已完成 AI 分析的高亮 ID 集合 */
  analyzedHighlightIds: Set<number>;
  /** 章节切换请求信号（HighlightsTab 设置，ReaderPage 执行后清除） */
  pendingChapterIndex: number | null;
  /** 章节切换后的滚动目标（用于切换后滚动到指定位置） */
  pendingScrollTarget: { segmentIndex: number; tokenIndex: number } | null;
  isSidebarOpen: boolean;
  activeTab: SidebarTab;

  // 加载状态
  isLoading: boolean;
  error: string | null;
}

/**
 * 阅读器操作
 */
interface ReaderActions {
  // 书籍/章节加载
  setBookId: (bookId: string | null) => void;
  setChapter: (chapter: ChapterResponse | null) => void;
  setChapterIndex: (index: number | null) => void;

  // 生词管理
  setVocabularySet: (baseForms: string[]) => void;
  setVocabularies: (vocabularies: VocabularyResponse[]) => void;
  addVocabulary: (baseForm: string) => void;
  /** 保存完整的生词记录（包含 id），用于添加生词后保存 API 返回的数据 */
  addVocabularyRecord: (record: VocabularyResponse) => void;
  removeVocabulary: (baseForm: string) => void;
  isVocabulary: (baseForm: string) => boolean;
  getVocabularyId: (baseForm: string) => number | null;

  // 高亮管理
  setHighlights: (highlights: ChapterHighlightData[]) => void;
  addHighlight: (highlight: ChapterHighlightData) => void;
  addHighlightOptimistic: (highlight: PendingHighlight) => void;
  removeHighlight: (id: number) => void;
  removePendingHighlight: (tempId: string) => void;
  // 整本书高亮数据管理（用于高亮列表跨章节显示）
  setAllHighlights: (highlights: ChapterHighlightData[]) => void;
  setAllChapterList: (chapters: ChapterListItem[]) => void;
  setHighlightViewChapter: (index: number | null) => void;

  // 滚动位置
  setCurrentSegmentIndex: (index: number) => void;
  setSegmentOffset: (offset: number) => void;

  // 交互状态
  setSelectedToken: (token: SelectedToken | null) => void;
  triggerAIAnalysis: (highlightId: number) => void;  // 触发 AI 分析
  clearAIAnalysisTrigger: () => void;  // 清除触发信号
  /** 标记高亮已分析 */
  markHighlightAnalyzed: (highlightId: number) => void;
  /** 检查高亮是否已分析 */
  isHighlightAnalyzed: (highlightId: number) => boolean;
  /** 检查章节内所有高亮的 AI 分析状态 */
  checkHighlightsAIStatus: (highlights: ChapterHighlightData[]) => Promise<void>;
  /** 请求章节切换（带滚动目标） */
  requestChapterChange: (chapterIndex: number, segmentIndex: number, tokenIndex: number) => void;
  /** 清除章节切换请求 */
  clearPendingChapter: () => void;
  setIsSidebarOpen: (open: boolean) => void;
  setActiveTab: (tab: SidebarTab) => void;
  toggleSidebar: () => void;

  // 加载状态
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // 重置状态
  resetReader: () => void;
}

/**
 * 生成高亮 Map 的 key
 */
export const getTokenKey = (segIdx: number, tokIdx: number) => `${segIdx}-${tokIdx}`;

/**
 * 根据章节内容和高亮数据构建 HighlightMap
 * 这是一个纯函数，方便测试和维护
 */
const buildHighlightMap = (
  highlights: ChapterHighlightData[],
  pendingHighlights: PendingHighlight[],
  segments?: ChapterResponse['segments']
): HighlightMap => {
  const map = new Map<string, string>();

  // 首先计算每个段落的 token 数量（如果提供了 segments）
  const segmentTokenCounts = new Map<number, number>();
  if (segments) {
    segments.forEach((seg, idx) => {
      if (seg.type === 'text' && seg.tokens) {
        segmentTokenCounts.set(idx, seg.tokens.length);
      }
    });
  }

  // 辅助函数：处理单个高亮
  const processHighlight = (
    startSeg: number,
    startTok: number,
    endSeg: number,
    endTok: number,
    style: string
  ) => {
    for (let s = startSeg; s <= endSeg; s++) {
      const startT = s === startSeg ? startTok : 0;
      // 如果知道该段的 token 数量，使用实际值；否则使用保守的大数
      const endT = s === endSeg ? endTok : (segmentTokenCounts.get(s) ?? 9999);

      for (let t = startT; t <= endT; t++) {
        map.set(getTokenKey(s, t), style);
      }
    }
  };

  // 处理已确认的高亮
  highlights.forEach((h) => {
    processHighlight(
      h.start_segment_index,
      h.start_token_idx,
      h.end_segment_index,
      h.end_token_idx,
      h.style_category
    );
  });

  // 处理待同步的高亮（乐观更新）
  pendingHighlights.forEach((h) => {
    processHighlight(
      h.start_segment_index,
      h.start_token_idx,
      h.end_segment_index,
      h.end_token_idx,
      h.style_category
    );
  });

  return map;
};

/**
 * 创建默认状态工厂函数
 * 避免共享引用导致的 bug (特别是 Set 和 对象)
 */
const createDefaultState = (): ReaderState => ({
  bookId: null,
  chapterIndex: null,
  chapter: null,
  vocabularySet: new Set<string>(),
  vocabularies: [],
  highlights: [],
  highlightMap: new Map(),
  pendingHighlights: [],
  allHighlights: [],
  allChapterList: [],
  highlightViewChapter: null,
  currentSegmentIndex: 0,
  segmentOffset: 0,
  selectedToken: null,
  aiAnalysisTrigger: null,
  analyzedHighlightIds: new Set<number>(),
  pendingChapterIndex: null,
  pendingScrollTarget: null,
  isSidebarOpen: false,
  activeTab: 'dictionary',
  isLoading: false,
  error: null,
});

/**
 * 阅读器 Store
 */
export const useReaderStore = create<ReaderState & ReaderActions>()((set, get) => ({
  ...createDefaultState(),

  // 书籍/章节加载
  setBookId: (bookId) => set({ bookId }),

  setChapter: (chapter) => {
    const highlights = chapter?.highlights ?? [];
    set({
      // 清理上一章的临时高亮，避免跨章污染
      pendingHighlights: [],
      chapter,
      highlights,
      highlightMap: buildHighlightMap(highlights, [], chapter?.segments),
    });
    // 异步检查 AI 分析状态
    if (highlights.length > 0) {
      get().checkHighlightsAIStatus(highlights);
    }
  },

  setChapterIndex: (chapterIndex) => set({ chapterIndex }),

  // 生词管理
  setVocabularySet: (baseForms) => set({ vocabularySet: new Set(baseForms) }),

  setVocabularies: (vocabularies) =>
    set({
      vocabularies,
      vocabularySet: new Set(vocabularies.map((v) => v.base_form)),
    }),

  addVocabulary: (baseForm) =>
    set((state) => {
      // 先检查是否已存在，避免不必要的更新 (rerender-optimization)
      if (state.vocabularySet.has(baseForm)) {
        return state;
      }
      const newSet = new Set(state.vocabularySet);
      newSet.add(baseForm);
      return { vocabularySet: newSet };
    }),

  addVocabularyRecord: (record) =>
    set((state) => {
      // 检查是否已存在（避免重复添加）
      if (state.vocabularies.some((v) => v.id === record.id || v.base_form === record.base_form)) {
        return state;
      }
      const newSet = new Set(state.vocabularySet);
      newSet.add(record.base_form);
      return {
        vocabularySet: newSet,
        vocabularies: [...state.vocabularies, record],
      };
    }),

  removeVocabulary: (baseForm) =>
    set((state) => {
      // 先检查是否不存在，避免不必要的更新
      if (!state.vocabularySet.has(baseForm)) {
        return state;
      }
      const newSet = new Set(state.vocabularySet);
      const newVocabularies = state.vocabularies.filter((v) => v.base_form !== baseForm);
      newSet.delete(baseForm);
      return { vocabularySet: newSet, vocabularies: newVocabularies };
    }),

  isVocabulary: (baseForm) => get().vocabularySet.has(baseForm),

  getVocabularyId: (baseForm) => {
    const vocab = get().vocabularies.find((v) => v.base_form === baseForm);
    return vocab ? vocab.id : null;
  },

  // 高亮管理
  setHighlights: (highlights) =>
    set((state) => ({
      highlights,
      highlightMap: buildHighlightMap(highlights, state.pendingHighlights, state.chapter?.segments),
    })),

  addHighlight: (highlight) =>
    set((state) => {
      const newHighlights = [...state.highlights, highlight];
      return {
        highlights: newHighlights,
        highlightMap: buildHighlightMap(newHighlights, state.pendingHighlights, state.chapter?.segments),
      };
    }),

  addHighlightOptimistic: (highlight) =>
    set((state) => {
      const newPending = [...state.pendingHighlights, highlight];
      return {
        pendingHighlights: newPending,
        highlightMap: buildHighlightMap(state.highlights, newPending, state.chapter?.segments),
      };
    }),

  removeHighlight: (id) =>
    set((state) => {
      const newHighlights = state.highlights.filter((h) => h.id !== id);
      return {
        highlights: newHighlights,
        highlightMap: buildHighlightMap(newHighlights, state.pendingHighlights, state.chapter?.segments),
      };
    }),

  removePendingHighlight: (tempId) =>
    set((state) => {
      const newPending = state.pendingHighlights.filter((h) => h.tempId !== tempId);
      return {
        pendingHighlights: newPending,
        highlightMap: buildHighlightMap(state.highlights, newPending, state.chapter?.segments),
      };
    }),

  // 整本书高亮数据管理（用于高亮列表跨章节显示）
  setAllHighlights: (allHighlights) => set({ allHighlights }),
  setAllChapterList: (allChapterList) => set({ allChapterList }),
  setHighlightViewChapter: (highlightViewChapter) => set({ highlightViewChapter }),

  // 滚动位置
  setCurrentSegmentIndex: (currentSegmentIndex) => set({ currentSegmentIndex }),
  setSegmentOffset: (segmentOffset) => set({ segmentOffset }),

  // 交互状态
  setSelectedToken: (selectedToken) => set({ selectedToken }),
  triggerAIAnalysis: (highlightId) => set({ aiAnalysisTrigger: highlightId }),
  clearAIAnalysisTrigger: () => set({ aiAnalysisTrigger: null }),
  markHighlightAnalyzed: (highlightId) =>
    set((state) => {
      if (state.analyzedHighlightIds.has(highlightId)) {
        return state;
      }
      const newSet = new Set(state.analyzedHighlightIds);
      newSet.add(highlightId);
      return { analyzedHighlightIds: newSet };
    }),
  isHighlightAnalyzed: (highlightId) => get().analyzedHighlightIds.has(highlightId),
  checkHighlightsAIStatus: async (highlights) =>
    set((state) => {
      // 并行检查所有高亮的 AI 分析状态
      highlights.forEach((h) => {
        getArchiveItem(h.id)
          .then((item) => {
            if (item.ai_analysis) {
              const currentState = get();
              if (!currentState.analyzedHighlightIds.has(h.id)) {
                const newSet = new Set(currentState.analyzedHighlightIds);
                newSet.add(h.id);
                set({ analyzedHighlightIds: newSet });
              }
            }
          })
          .catch(() => {
            // 忽略错误，高亮可能没有积累本记录
          });
      });
      return state;
    }),
  requestChapterChange: (chapterIndex, segmentIndex, tokenIndex) => set({
    pendingChapterIndex: chapterIndex,
    pendingScrollTarget: { segmentIndex, tokenIndex },
  }),
  clearPendingChapter: () => set({
    pendingChapterIndex: null,
    pendingScrollTarget: null,
  }),
  setIsSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),
  setActiveTab: (activeTab) => set({ activeTab }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  // 加载状态
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  // 重置状态 - 使用工厂函数确保每次都是新的引用
  resetReader: () => set(createDefaultState()),
}));
