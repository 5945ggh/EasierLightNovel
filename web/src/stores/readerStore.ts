/**
 * 阅读器 Store - 运行时状态（不持久化）
 */

import { create } from 'zustand';
import type { TokenData, ChapterResponse } from '@/types';

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
 * 阅读器状态
 */
interface ReaderState {
  // 当前书籍信息
  bookId: string | null;
  chapterIndex: number | null;
  chapter: ChapterResponse | null;

  // 生词集合 (O(1) 查找)
  vocabularySet: Set<string>;

  // 滚动位置
  currentSegmentIndex: number;

  // 交互状态
  selectedToken: SelectedToken | null;
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
  addVocabulary: (baseForm: string) => void;
  removeVocabulary: (baseForm: string) => void;
  isVocabulary: (baseForm: string) => boolean;

  // 滚动位置
  setCurrentSegmentIndex: (index: number) => void;

  // 交互状态
  setSelectedToken: (token: SelectedToken | null) => void;
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
 * 创建默认状态工厂函数
 * 避免共享引用导致的 bug (特别是 Set 和 对象)
 */
const createDefaultState = (): ReaderState => ({
  bookId: null,
  chapterIndex: null,
  chapter: null,
  vocabularySet: new Set<string>(),
  currentSegmentIndex: 0,
  selectedToken: null,
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
  setChapter: (chapter) => set({ chapter }),
  setChapterIndex: (chapterIndex) => set({ chapterIndex }),

  // 生词管理
  setVocabularySet: (baseForms) => set({ vocabularySet: new Set(baseForms) }),

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

  removeVocabulary: (baseForm) =>
    set((state) => {
      // 先检查是否不存在，避免不必要的更新
      if (!state.vocabularySet.has(baseForm)) {
        return state;
      }
      const newSet = new Set(state.vocabularySet);
      newSet.delete(baseForm);
      return { vocabularySet: newSet };
    }),

  isVocabulary: (baseForm) => get().vocabularySet.has(baseForm),

  // 滚动位置
  setCurrentSegmentIndex: (currentSegmentIndex) => set({ currentSegmentIndex }),

  // 交互状态
  setSelectedToken: (selectedToken) => set({ selectedToken }),
  setIsSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),
  setActiveTab: (activeTab) => set({ activeTab }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  // 加载状态
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  // 重置状态 - 使用工厂函数确保每次都是新的引用
  resetReader: () => set(createDefaultState()),
}));
