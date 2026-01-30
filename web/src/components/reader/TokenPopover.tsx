/**
 * TokenPopover - Token 点击弹窗
 * 当用户点击单个 Token 时显示悬浮弹窗
 * 功能：显示词典信息、添加生词本、查看详情、AI 分析（仅高亮句中显示）
 */

import React, { useEffect, useCallback, useState } from 'react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useDismiss,
  useInteractions,
  FloatingPortal,
  arrow,
} from '@floating-ui/react';
import { X, Plus, BookOpen, Sparkles, Volume2, Loader2, Trash2 } from 'lucide-react';
import { useReaderStore, getTokenKey } from '@/stores/readerStore';
import { addVocabulary as addVocabularyService, deleteVocabulary } from '@/services/vocabularies.service';
import { searchDictionary } from '@/services/dictionary.service';
import { speak } from '@/utils/tts';
import type { DictResult } from '@/types/dictionary';
import { clsx } from 'clsx';

// 例句最大长度限制
const MAX_CONTEXT_SENTENCE_LENGTH = 100;

/**
 * 从段落中截取包含指定 Token 的句子
 * 按日语标点（。！？」）分割句子，限制最大长度
 */
const extractSentenceFromSegment = (
  segmentIndex: number,
  tokenIndex: number,
  segments?: import('@/types').ContentSegment[]
): string | null => {
  if (!segments) return null;

  const segment = segments[segmentIndex];
  if (segment?.type !== 'text' || !segment.tokens) return null;

  // 构建段落文本
  let segmentText = '';
  const tokenPositions: number[] = [];  // 记录每个 token 在段落文本中的起始位置
  let currentPos = 0;

  for (const t of segment.tokens) {
    const prefix = (t.gap && currentPos > 0) ? ' ' : '';
    if (prefix) currentPos += 1;
    tokenPositions.push(currentPos);
    segmentText += prefix + t.s;
    currentPos += t.s.length;
  }

  // 找到当前 token 在段落文本中的位置
  const tokenStartPos = tokenPositions[tokenIndex] ?? 0;
  const tokenEndPos = tokenStartPos + (segment.tokens[tokenIndex]?.s?.length ?? 0);

  // 按日语标点分割句子
  const sentenceEndMarks = ['。', '！', '？', '」', '』', '）', '(', '「', '『'];
  let sentenceStart = 0;
  let sentenceEnd = segmentText.length;

  // 向前找句子起点
  for (let i = tokenStartPos - 1; i >= 0; i--) {
    if (sentenceEndMarks.includes(segmentText[i])) {
      sentenceStart = i + 1;
      break;
    }
  }

  // 向后找句子终点
  for (let i = tokenEndPos; i < segmentText.length; i++) {
    if (sentenceEndMarks.includes(segmentText[i])) {
      sentenceEnd = i + 1;
      break;
    }
  }

  let sentence = segmentText.slice(sentenceStart, sentenceEnd).trim();

  // 长度限制：如果超过限制，以 token 为中心截取
  if (sentence.length > MAX_CONTEXT_SENTENCE_LENGTH) {
    const halfLength = Math.floor(MAX_CONTEXT_SENTENCE_LENGTH / 2);
    const tokenCenterInSentence = tokenStartPos - sentenceStart + Math.floor((tokenEndPos - tokenStartPos) / 2);

    const newStart = Math.max(0, tokenCenterInSentence - halfLength);
    const newEnd = Math.min(sentence.length, tokenCenterInSentence + halfLength);

    sentence = sentence.slice(newStart, newEnd).trim();
    // 添加省略号
    if (newStart > 0) sentence = '...' + sentence;
    if (newEnd < segmentText.length) sentence = sentence + '...';
  }

  return sentence.length > 0 ? sentence : null;
};

export const TokenPopover: React.FC = () => {
  const selectedToken = useReaderStore((s) => s.selectedToken);
  const setSelectedToken = useReaderStore((s) => s.setSelectedToken);
  const addVocabularyOpt = useReaderStore((s) => s.addVocabulary);
  const addVocabularyRecord = useReaderStore((s) => s.addVocabularyRecord);
  const removeVocabularyOpt = useReaderStore((s) => s.removeVocabulary);
  const getVocabularyId = useReaderStore((s) => s.getVocabularyId);
  const highlightMap = useReaderStore((s) => s.highlightMap);
  const highlights = useReaderStore((s) => s.highlights);
  const vocabularySet = useReaderStore((s) => s.vocabularySet);
  const bookId = useReaderStore((s) => s.bookId);
  const chapter = useReaderStore((s) => s.chapter);
  const isSidebarOpen = useReaderStore((s) => s.isSidebarOpen);
  const setIsSidebarOpen = useReaderStore((s) => s.setIsSidebarOpen);
  const setActiveTab = useReaderStore((s) => s.setActiveTab);
  const triggerAIAnalysis = useReaderStore((s) => s.triggerAIAnalysis);
  const isHighlightAnalyzed = useReaderStore((s) => s.isHighlightAnalyzed);
  const isAnalyzing = useReaderStore((s) => s.isAnalyzing);

  // 词典查询结果状态
  const [dictResult, setDictResult] = useState<DictResult | null>(null);
  const [isDictLoading, setIsDictLoading] = useState(false);
  const [dictError, setDictError] = useState<string | null>(null);

  // Popover 只在侧边栏关闭时显示
  const isOpen = !!selectedToken && !isSidebarOpen;
  const arrowRef = React.useRef<HTMLDivElement>(null);

  const {
    refs,
    floatingStyles,
    context,
    middlewareData: { arrow: { x: arrowX } = {} },
  } = useFloating({
    open: isOpen,
    onOpenChange: (open) => {
      if (!open) {
        setSelectedToken(null);
        setDictResult(null);
        setDictError(null);
      }
    },
    middleware: [
      offset(12),
      flip({ fallbackAxisSideDirection: 'start' }),
      shift({ padding: 8 }),
      arrow({ element: arrowRef }),
    ],
    whileElementsMounted: autoUpdate,
    placement: 'top',
  });

  const dismiss = useDismiss(context);
  const { getFloatingProps } = useInteractions([dismiss]);

  // 查询词典
  const fetchDictionary = useCallback(async (word: string) => {
    setIsDictLoading(true);
    setDictError(null);

    try {
      const result = await searchDictionary(word);
      setDictResult(result);
    } catch (err) {
      console.error('Dictionary query failed:', err);
      setDictError('查询失败');
    } finally {
      setIsDictLoading(false);
    }
  }, []);

  // 当 selectedToken 变化时，重新定位到对应的 DOM 元素并查询词典
  useEffect(() => {
    if (selectedToken) {
      // 定位 DOM 元素
      const selector = `span[data-segment-index="${selectedToken.segmentIndex}"][data-token-index="${selectedToken.tokenIndex}"]`;
      const element = document.querySelector<HTMLSpanElement>(selector);
      if (element) {
        refs.setReference(element);
      }

      // 查询词典（优先使用原型，其次使用表层形）
      const queryWord = selectedToken.token.b || selectedToken.token.s;
      fetchDictionary(queryWord);
    } else {
      setDictResult(null);
      setDictError(null);
    }
  }, [selectedToken, refs, fetchDictionary]);

  // 获取当前 token 所在高亮的 ID
  const currentHighlightId = React.useMemo((): number | null => {
    if (!selectedToken) return null;

    // 找到对应的高亮记录
    const highlight = highlights.find((h) => {
      // 判断 token 是否在高亮范围内
      if (h.start_segment_index <= selectedToken.segmentIndex &&
          h.end_segment_index >= selectedToken.segmentIndex) {
        if (h.start_segment_index === h.end_segment_index) {
          return h.start_token_idx <= selectedToken.tokenIndex &&
                 h.end_token_idx >= selectedToken.tokenIndex;
        }
        if (selectedToken.segmentIndex === h.start_segment_index) {
          return selectedToken.tokenIndex >= h.start_token_idx;
        }
        if (selectedToken.segmentIndex === h.end_segment_index) {
          return selectedToken.tokenIndex <= h.end_token_idx;
        }
        return true;
      }
      return false;
    });

    return highlight?.id ?? null;
  }, [selectedToken, highlights]);

  // 判断当前 Token 是否在高亮句中（基于是否找到对应的高亮记录）
  const isInHighlight = currentHighlightId !== null;

  // 判断当前高亮是否已分析
  const hasAIAnalysis = currentHighlightId !== null && isHighlightAnalyzed(currentHighlightId);
  // 判断当前高亮是否正在分析
  const isThisHighlightAnalyzing = currentHighlightId !== null && isAnalyzing(currentHighlightId);

  // 判断是否已经是生词
  const isVocab = selectedToken?.token.b
    ? vocabularySet.has(selectedToken.token.b!)
    : false;

  /**
   * 添加或移除生词
   */
  const handleToggleVocab = useCallback(async () => {
    if (!selectedToken || !bookId) return;

    const baseForm = selectedToken.token.b || selectedToken.text;

    if (isVocab) {
      // 删除生词
      const vocabId = getVocabularyId(baseForm);
      if (vocabId) {
        // 乐观更新
        removeVocabularyOpt(baseForm);
        // 发送请求
        try {
          await deleteVocabulary(vocabId);
        } catch (err) {
          console.error('Failed to delete vocabulary:', err);
          // 失败时恢复状态
          addVocabularyOpt(baseForm);
        }
      }
    } else {
      // 添加生词
      // 乐观更新
      addVocabularyOpt(baseForm);
      // 发送请求并保存完整记录
      try {
        // 构建 definition JSON（如果有词典结果）
        let definitionJson: string | undefined;
        if (dictResult && dictResult.found && dictResult.entries.length > 0) {
          definitionJson = JSON.stringify(dictResult.entries);
        }

        // 截取上下文句子（例句）
        const contextSentence = extractSentenceFromSegment(
          selectedToken.segmentIndex,
          selectedToken.tokenIndex,
          chapter?.segments
        );

        const result = await addVocabularyService({
          book_id: bookId,
          word: selectedToken.text,
          base_form: baseForm,
          reading: selectedToken.token.r || undefined,        // 从 Token 获取读音
          part_of_speech: selectedToken.token.p || undefined,  // 从 Token 获取词性
          definition: definitionJson,            // 从词典查询结果获取定义
          context_sentences: contextSentence ? [contextSentence] : undefined,  // 例句
        });
        // 保存完整记录（包含 id），以便后续删除操作使用
        addVocabularyRecord(result);
      } catch (err) {
        console.error('Failed to add vocabulary:', err);
        // 失败时恢复状态
        removeVocabularyOpt(baseForm);
      }
    }

    // 关闭弹窗
    setSelectedToken(null);
  }, [selectedToken, bookId, isVocab, addVocabularyOpt, removeVocabularyOpt, addVocabularyRecord, getVocabularyId, setSelectedToken, dictResult, chapter]);

  /**
   * 打开词典侧边栏查看详情
   */
  const handleViewDetails = useCallback(() => {
    if (!selectedToken) return;

    setActiveTab('dictionary');
    setIsSidebarOpen(true);
    // 不清除 selectedToken，让 DictionaryTab 能够显示词汇信息
  }, [selectedToken, setActiveTab, setIsSidebarOpen]);

  /**
   * 打开 AI 分析侧边栏
   * 触发 AI 分析：找到当前 token 所在的高亮句 ID，然后触发分析
   */
  const handleAIAnalyze = useCallback(() => {
    if (!selectedToken) return;

    // 找到当前 token 所在的高亮句
    const key = getTokenKey(selectedToken.segmentIndex, selectedToken.tokenIndex);
    const highlightStyle = highlightMap.get(key);

    if (!highlightStyle) {
      console.warn('[TokenPopover] 当前 token 不在高亮句中');
      return;
    }

    // 找到对应的高亮记录
    const highlight = highlights.find((h) => {
      // 判断 token 是否在高亮范围内
      if (h.start_segment_index <= selectedToken.segmentIndex &&
          h.end_segment_index >= selectedToken.segmentIndex) {
        if (h.start_segment_index === h.end_segment_index) {
          return h.start_token_idx <= selectedToken.tokenIndex &&
                 h.end_token_idx >= selectedToken.tokenIndex;
        }
        if (selectedToken.segmentIndex === h.start_segment_index) {
          return selectedToken.tokenIndex >= h.start_token_idx;
        }
        if (selectedToken.segmentIndex === h.end_segment_index) {
          return selectedToken.tokenIndex <= h.end_token_idx;
        }
        return true;
      }
      return false;
    });

    if (highlight) {
      // 检查是否正在分析
      if (isAnalyzing(highlight.id)) {
        console.warn('[TokenPopover] 该高亮正在分析中，请稍候');
        return;
      }
      triggerAIAnalysis(highlight.id);
      setActiveTab('ai');
      setIsSidebarOpen(true);
    } else {
      console.warn('[TokenPopover] 找不到对应的高亮记录');
    }
  }, [selectedToken, highlightMap, highlights, triggerAIAnalysis, setActiveTab, setIsSidebarOpen, isAnalyzing]);

  /**
   * 朗读该 Token
   */
  const handleTTS = useCallback(() => {
    if (!selectedToken) return;
    speak(selectedToken.text);
  }, [selectedToken]);

  // 点击外部关闭处理
  const clickOutside = useCallback(
    (event: MouseEvent) => {
      if (
        isOpen &&
        refs.floating.current &&
        !refs.floating.current.contains(event.target as Node) &&
        refs.reference.current !== event.target &&
        !(refs.reference.current as HTMLElement)?.contains(event.target as Node)
      ) {
        setSelectedToken(null);
      }
    },
    [isOpen, refs, setSelectedToken]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', clickOutside);
      return () => document.removeEventListener('mousedown', clickOutside);
    }
  }, [isOpen, clickOutside]);

  if (!isOpen || !selectedToken) return null;

  const { token } = selectedToken;
  const displayForm = token.b || token.s;
  const reading = token.r || '';
  const partOfSpeech = token.p || '';

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        {...getFloatingProps()}
        className="z-[60] w-80 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col animate-in fade-in zoom-in-95 duration-150"
      >
        {/* 头部：单词与读音 */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 rounded-t-xl flex justify-between items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white truncate">
              {displayForm}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              {reading && (
                <p className="text-sm text-gray-500 font-mono">{reading}</p>
              )}
              {partOfSpeech && (
                <>
                  <span className="text-gray-300">•</span>
                  <span className="text-xs text-gray-400">{partOfSpeech}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={() => setSelectedToken(null)}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容：词典释义 */}
        <div className="p-4 text-sm text-gray-700 dark:text-gray-300 max-h-64 overflow-y-auto">
          {/* 朗读按钮 */}
          <button
            onClick={handleTTS}
            className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 mb-3 transition-colors"
          >
            <Volume2 size={14} />
            <span>朗读</span>
          </button>

          {/* 加载中 */}
          {isDictLoading && (
            <div className="flex items-center justify-center py-4 text-gray-400">
              <Loader2 className="animate-spin mr-2" size={16} />
              <span>查询中...</span>
            </div>
          )}

          {/* 查询失败 */}
          {dictError && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-red-600 dark:text-red-400">
              {dictError}
            </div>
          )}

          {/* 未找到结果 */}
          {dictResult && !dictResult.found && !isDictLoading && (
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-gray-500 dark:text-gray-400">
              未找到「{dictResult.query}」的释义
            </div>
          )}

          {/* 显示词典结果 */}
          {dictResult && dictResult.found && dictResult.entries.length > 0 && (
            <div className="space-y-3">
              {dictResult.entries.map((entry, idx) => (
                <div
                  key={`${entry.id}-${idx}`}
                  className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3"
                >
                  {/* 汉字与读音 */}
                  <div className="flex items-baseline gap-2 mb-2">
                    {entry.kanji.length > 0 && (
                      <span className="font-medium text-gray-900 dark:text-white">
                        {entry.kanji.join('、')}
                      </span>
                    )}
                    {entry.reading.length > 0 && (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        [{entry.reading.join('、')}]
                      </span>
                    )}
                  </div>

                  {/* 释义列表 */}
                  <div className="space-y-2">
                    {entry.senses.map((sense, senseIdx) => (
                      <div key={senseIdx}>
                        {sense.pos.length > 0 && (
                          <span className="text-xs text-indigo-600 dark:text-indigo-400 mr-1">
                            {sense.pos.join(', ')}
                          </span>
                        )}
                        <ol className="list-decimal list-inside text-gray-700 dark:text-gray-300">
                          {sense.definitions.map((def, defIdx) => (
                            <li key={defIdx} className="text-xs">
                              {def}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部：操作栏 */}
        <div className="p-3 border-t border-gray-100 dark:border-gray-800 flex flex-col gap-2">
          {/* 主要操作 */}
          <div className="flex gap-2">
            <button
              onClick={handleToggleVocab}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors',
                isVocab
                  ? 'text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400'
                  : 'text-white bg-indigo-600 hover:bg-indigo-700'
              )}
            >
              {isVocab ? <Trash2 size={16} /> : <Plus size={16} />}
              {isVocab ? '移除生词' : '添加生词本'}
            </button>
            <button
              onClick={handleViewDetails}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <BookOpen size={16} />
              详情
            </button>
          </div>

          {/* AI 分析按钮 - 仅在高亮句中显示 */}
          {isInHighlight && (
            <button
              onClick={handleAIAnalyze}
              disabled={isThisHighlightAnalyzing}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-700 bg-gradient-to-r from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 dark:text-indigo-300 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isThisHighlightAnalyzing ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  分析中...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  {hasAIAnalysis ? '查看AI解析' : 'AI解析'}
                </>
              )}
            </button>
          )}
        </div>

        {/* 箭头 */}
        <div
          ref={arrowRef}
          className="absolute w-2 h-2 bg-white dark:bg-gray-900 border-l border-b border-gray-200 dark:border-gray-700 rotate-45"
          style={{
            top: -5,
            left: arrowX != null ? `${arrowX}px` : '',
          }}
        />
      </div>
    </FloatingPortal>
  );
};
