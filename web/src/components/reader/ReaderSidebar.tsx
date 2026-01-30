/**
 * ReaderSidebar - 阅读器侧边栏
 * 包含：词典、AI分析、生词本、高亮列表四个 Tab
 */

import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, BookOpen, Sparkles, Bookmark, Highlighter, Loader2, ChevronRight, ChevronDown, ChevronUp, Volume2, Trash2 } from 'lucide-react';
import { useReaderStore, type SidebarTab } from '@/stores/readerStore';
import { analyzeAI } from '@/services/ai.service';
import { saveAIAnalysis as saveAIAnalysisService, getArchiveItem } from '@/services/highlights.service';
import { searchDictionary } from '@/services/dictionary.service';
import { speak } from '@/utils/tts';
import { getHighlightStyleWithFallback } from '@/utils/highlightStyles';
import type { DictResult } from '@/types/dictionary';
import type { VocabularyResponse } from '@/types/vocabulary';
import type { AIAnalysisResult, ChapterHighlightData } from '@/types';
import type { ContentSegment } from '@/types';
import { clsx } from 'clsx';

// ==========================================
// 上下文提取常量
// ==========================================
const MAX_CONTEXT_CHARS = 1200;         // 上下文最大字符数（硬性限制）
const CONTEXT_SEGMENT_DEPTH = 2;        // 向前/向后最多取 2 个完整段落

// ==========================================
// 辅助函数：将一个 Segment 还原为字符串
// ==========================================
const stringifySegment = (segment: ContentSegment): string => {
  if (segment.type !== 'text' || !segment.tokens) return '';

  return segment.tokens.map((t, i) => {
    // 如果当前 token 有 gap 标记，前面加空格
    // gap 表示分词时补全的空格，应该在该 token 前面添加
    const prefix = (t.gap && i > 0) ? ' ' : '';
    return prefix + t.s;
  }).join('');
};

// ==========================================
// 辅助函数：按日语句子边界分割文本
// ==========================================
const splitIntoSentences = (text: string): string[] => {
  if (!text) return [];

  const sentences: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    current += char;

    // 日语句子结束标点：。！？ 以及后引号 」
    if (char === '。' || char === '！' || char === '？' || char === '」') {
      // 也检查后面是否跟引号
      if (i + 1 < text.length && (text[i + 1] === '」' || text[i + 1] === '』')) {
        current += text[i + 1];
        i++;
      }
      sentences.push(current.trim());
      current = '';
    }
  }

  // 添加剩余内容（如果没有以句号结尾）
  if (current.trim()) {
    sentences.push(current.trim());
  }

  return sentences.filter(s => s.length > 0);
};

// ==========================================
// 辅助函数：从句子数组构建上下文
// targetSentenceIndex: 目标句子在数组中的索引
// ==========================================
const buildContextFromSentences = (
  sentences: string[],
  targetStartSentenceIndex: number,
  targetEndSentenceIndex: number,
  maxChars: number,
  sentenceDepth: number
): string => {
  // 目标句子范围（确保不越界）
  const startIdx = Math.max(0, targetStartSentenceIndex);
  const endIdx = Math.min(sentences.length - 1, targetEndSentenceIndex);

  // 目标句子
  const targetSentences = sentences.slice(startIdx, endIdx + 1);
  let combined = targetSentences.join('');

  // 如果目标句子本身就超限，直接返回
  if (combined.length >= maxChars) {
    return combined.slice(0, maxChars);
  }

  // 向前扩展
  let preIdx = startIdx - 1;
  let preCount = 0;
  const preSentences: string[] = [];

  while (preIdx >= 0 && preCount < sentenceDepth) {
    const sentence = sentences[preIdx];
    const newLength = combined.length + sentence.length + preSentences.length; // +1 for space

    if (newLength > maxChars) break;

    preSentences.unshift(sentence);
    combined = sentence + ' ' + combined;
    preIdx--;
    preCount++;
  }

  // 向后扩展
  let postIdx = endIdx + 1;
  let postCount = 0;
  const postSentences: string[] = [];

  while (postIdx < sentences.length && postCount < sentenceDepth) {
    const sentence = sentences[postIdx];
    const newLength = combined.length + sentence.length + 1;

    if (newLength > maxChars) break;

    combined += ' ' + sentence;
    postSentences.push(sentence);
    postIdx++;
    postCount++;
  }

  return combined.trim();
};

// Tab 图标和标签配置
const TAB_CONFIG = {
  dictionary: { icon: BookOpen, label: '词典' },
  ai: { icon: Sparkles, label: 'AI分析' },
  vocabulary: { icon: Bookmark, label: '生词本' },
  highlights: { icon: Highlighter, label: '高亮列表' },
} as const;

// 词典 Tab 内容
const DictionaryTab: React.FC = () => {
  const selectedToken = useReaderStore((s) => s.selectedToken);
  const dictionaryQuery = useReaderStore((s) => s.dictionaryQuery);
  const setDictionaryQuery = useReaderStore((s) => s.setDictionaryQuery);

  const [dictResult, setDictResult] = useState<DictResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 获取当前要查询的词：优先使用 dictionaryQuery，其次使用 selectedToken
  const currentQueryWord = React.useMemo(() => {
    if (dictionaryQuery) return dictionaryQuery;
    if (selectedToken) return selectedToken.token.b || selectedToken.token.s;
    return null;
  }, [dictionaryQuery, selectedToken]);

  // 当查询词变化时，查询词典
  useEffect(() => {
    if (currentQueryWord) {
      fetchDictionary(currentQueryWord);
      // 查询完成后清除 dictionaryQuery，避免重复查询
      if (dictionaryQuery) {
        setDictionaryQuery(null);
      }
    } else {
      setDictResult(null);
      setError(null);
    }
  }, [currentQueryWord, dictionaryQuery, setDictionaryQuery]);

  const fetchDictionary = async (word: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await searchDictionary(word);
      setDictResult(result);
    } catch (err) {
      console.error('Dictionary query failed:', err);
      setError('查询失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTTS = useCallback(() => {
    const textToSpeak = selectedToken?.text || currentQueryWord || '';
    if (textToSpeak) speak(textToSpeak);
  }, [selectedToken, currentQueryWord]);

  if (!currentQueryWord) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <p>请点击文本中的单词查看释义</p>
      </div>
    );
  }

  // 优先使用 selectedToken 的详细信息，否则使用查询词
  const displayForm = selectedToken?.token ? (selectedToken.token.b || selectedToken.token.s) : currentQueryWord;
  const reading = selectedToken?.token?.r || dictResult?.reading || '';
  const partOfSpeech = selectedToken?.token?.p || dictResult?.part_of_speech || '';

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* 单词头部 */}
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white truncate">
            {displayForm}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            {reading && (
              <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">{reading}</p>
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
          onClick={handleTTS}
          className="flex-shrink-0 p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          title="朗读"
        >
          <Volume2 size={18} />
        </button>
      </div>

      {/* 词典释义 */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="animate-spin mr-2" size={18} />
            <span>查询中...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {dictResult && !dictResult.found && !isLoading && (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-gray-500 dark:text-gray-400 text-sm">
            未找到「{dictResult.query}」的释义
          </div>
        )}

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
                      <ol className="list-decimal list-inside text-gray-700 dark:text-gray-300 text-sm">
                        {sense.definitions.map((def, defIdx) => (
                          <li key={defIdx}>{def}</li>
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
    </div>
  );
};

// AI 分析 Tab 内容
const AITab: React.FC = () => {
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 使用 ref 来同步跟踪是否正在请求（避免 setState 异步导致的竞态条件）
  const isRequestingRef = React.useRef(false);

  // 获取 store 中的数据（合并订阅以减少重渲染）
  const selectedToken = useReaderStore((s) => s.selectedToken);
  const bookId = useReaderStore((s) => s.bookId);
  const chapterIndex = useReaderStore((s) => s.chapterIndex);
  const chapter = useReaderStore((s) => s.chapter);
  const highlights = useReaderStore((s) => s.highlights);
  const highlightMap = useReaderStore((s) => s.highlightMap);
  const activeTab = useReaderStore((s) => s.activeTab);
  const aiAnalysisTrigger = useReaderStore((s) => s.aiAnalysisTrigger);
  const clearAIAnalysisTrigger = useReaderStore((s) => s.clearAIAnalysisTrigger);
  const markHighlightAnalyzed = useReaderStore((s) => s.markHighlightAnalyzed);
  const startAnalyzing = useReaderStore((s) => s.startAnalyzing);
  const finishAnalyzing = useReaderStore((s) => s.finishAnalyzing);
  const displayHighlightId = useReaderStore((s) => s.displayHighlightId);
  const setDisplayHighlightId = useReaderStore((s) => s.setDisplayHighlightId);

  // 从 selectedToken 提取需要的值（使用 useMemo 避免重复计算）
  const selectedTokenInfo = useMemo(() => ({
    segmentIndex: selectedToken?.segmentIndex ?? null,
    tokenIndex: selectedToken?.tokenIndex ?? null,
    text: selectedToken?.text ?? null,
  }), [selectedToken]);

  // 检查当前选中的 token 是否在高亮句中
  const currentHighlightId = useMemo((): number | null => {
    const { segmentIndex, tokenIndex } = selectedTokenInfo;

    if (segmentIndex === null || tokenIndex === null || !highlightMap) {
      return null;
    }

    const key = `${segmentIndex}-${tokenIndex}`;
    const hasStyle = highlightMap.get(key);

    if (!hasStyle) return null;

    // 找到对应的高亮记录
    const highlight = highlights.find((h) => {
      if (h.start_segment_index <= segmentIndex &&
          h.end_segment_index >= segmentIndex) {
        if (h.start_segment_index === h.end_segment_index) {
          return h.start_token_idx <= tokenIndex &&
                 h.end_token_idx >= tokenIndex;
        }
        if (segmentIndex === h.start_segment_index) {
          return tokenIndex >= h.start_token_idx;
        }
        if (segmentIndex === h.end_segment_index) {
          return tokenIndex <= h.end_token_idx;
        }
        return true;
      }
      return false;
    });

    return highlight?.id ?? null;
  }, [selectedTokenInfo, highlightMap, highlights]);

  // 当前应该显示的高亮 ID：优先使用新点击的，其次使用正在显示的
  const activeHighlightId = useMemo(() => {
    return currentHighlightId ?? displayHighlightId;
  }, [currentHighlightId, displayHighlightId]);

  // ==========================================
  // 收集高亮文本和上下文（段落级扩展策略）
  // ==========================================
  const collectHighlightText = useCallback((highlightId: number): { targetText: string; contextText: string } => {
    const highlight = highlights.find((h) => h.id === highlightId);
    if (!highlight || !chapter?.segments) {
      return { targetText: '', contextText: '' };
    }

    // ------------------------------------------
    // 1. 提取 Target Text（用户选中的文本）
    // ------------------------------------------
    const targetTokens: string[] = [];

    for (let s = highlight.start_segment_index; s <= highlight.end_segment_index; s++) {
      const segment = chapter.segments[s];
      if (segment?.type !== 'text' || !segment.tokens) continue;

      const startT = (s === highlight.start_segment_index) ? highlight.start_token_idx : 0;
      const endT = (s === highlight.end_segment_index) ? highlight.end_token_idx : segment.tokens.length - 1;

      for (let t = startT; t <= endT; t++) {
        const token = segment.tokens[t];
        if (token?.s) {
          // 处理 gap：当前 token 有 gap 且不是范围内第一个时加空格
          const isFirstToken = (s === highlight.start_segment_index && t === startT);
          const prefix = (token.gap && !isFirstToken) ? ' ' : '';
          targetTokens.push(prefix + token.s);
        }
      }
    }

    const targetText = targetTokens.join('');

    // ------------------------------------------
    // 2. 提取上下文（句子级扩展策略）
    // ------------------------------------------
    // 2.1 收集前后各 N 个段落的完整文本
    const contextSegments: string[] = [];

    // 向前收集
    for (let s = Math.max(0, highlight.start_segment_index - CONTEXT_SEGMENT_DEPTH);
         s < highlight.start_segment_index; s++) {
      const seg = chapter.segments[s];
      if (seg?.type === 'text') {
        contextSegments.push(stringifySegment(seg));
      }
    }

    // 锚点段落（高亮覆盖的段落）
    for (let s = highlight.start_segment_index; s <= highlight.end_segment_index; s++) {
      const seg = chapter.segments[s];
      if (seg?.type === 'text') {
        contextSegments.push(stringifySegment(seg));
      }
    }

    // 向后收集
    for (let s = highlight.end_segment_index + 1;
         s < Math.min(chapter.segments.length, highlight.end_segment_index + 1 + CONTEXT_SEGMENT_DEPTH); s++) {
      const seg = chapter.segments[s];
      if (seg?.type === 'text') {
        contextSegments.push(stringifySegment(seg));
      }
    }

    // 2.2 将所有段落拼接并按句子分割
    const fullText = contextSegments.join('');
    const sentences = splitIntoSentences(fullText);

    if (sentences.length === 0) {
      return { targetText, contextText: '' };
    }

    // 2.3 找到 targetText 对应的句子索引范围
    // 通过计算 targetText 在完整文本中的位置来定位
    const targetTextStartPos = fullText.indexOf(targetText);
    let targetSentenceStartIdx = 0;
    let targetSentenceEndIdx = 0;

    if (targetTextStartPos >= 0) {
      // 找到 targetText 起始位置对应的句子
      let pos = 0;
      for (let i = 0; i < sentences.length; i++) {
        const sentenceEnd = pos + sentences[i].length;
        if (pos <= targetTextStartPos && targetTextStartPos < sentenceEnd) {
          targetSentenceStartIdx = i;
          break;
        }
        pos = sentenceEnd + 1; // +1 for space
      }

      // 找到 targetText 结束位置对应的句子
      const targetTextEndPos = targetTextStartPos + targetText.length;
      pos = 0;
      for (let i = 0; i < sentences.length; i++) {
        const sentenceEnd = pos + sentences[i].length;
        if (pos <= targetTextEndPos && targetTextEndPos <= sentenceEnd) {
          targetSentenceEndIdx = i;
          break;
        }
        pos = sentenceEnd + 1;
      }
    }

    // 2.4 使用句子级扩展构建上下文
    const contextText = buildContextFromSentences(
      sentences,
      targetSentenceStartIdx,
      targetSentenceEndIdx,
      MAX_CONTEXT_CHARS,
      3 // 前后各 3 个句子
    );

    return {
      targetText,
      contextText,
    };
  }, [chapter, highlights]);

  // 执行 AI 分析
  const performAIAnalysis = useCallback(async (highlightId: number) => {
    if (!bookId || chapterIndex === null) return;

    // 防止重复请求（同步检查）
    if (isRequestingRef.current) {
      return;
    }

    // 设置当前正在显示的高亮 ID
    setDisplayHighlightId(highlightId);
    isRequestingRef.current = true;  // 同步设置标志
    setIsLoading(true);
    setError(null);

    // 标记开始分析
    startAnalyzing(highlightId);

    try {
      // 先检查积累本是否已有分析结果
      try {
        const archiveItem = await getArchiveItem(highlightId);

        if (archiveItem.ai_analysis) {
          // 积累本已有分析，解析并显示
          const savedResult = JSON.parse(archiveItem.ai_analysis) as AIAnalysisResult;
          setAiResult(savedResult);
          markHighlightAnalyzed(highlightId);
        }
      } catch {
        // 积累本没有记录或出错，继续调用 AI
        // 调用 AI 分析
        const { targetText, contextText } = collectHighlightText(highlightId);

        if (!targetText) {
          return;
        }

        const result = await analyzeAI({
          book_id: bookId,
          chapter_index: chapterIndex,
          highlight_id: highlightId,
          target_text: targetText,
          context_text: contextText,
        });

        setAiResult(result);
        markHighlightAnalyzed(highlightId);

        // 自动保存到积累本
        try {
          await saveAIAnalysisService(highlightId, result);
        } catch (saveErr) {
          console.error('[AI] 保存到积累本失败:', saveErr);
        }
      }
    } catch (err) {
      console.error('[AI] 分析失败:', err);
      setError('AI 分析失败，请稍后重试');
    } finally {
      setIsLoading(false);
      isRequestingRef.current = false;  // 清除标志
      // 标记分析完成（无论成功或失败）
      finishAnalyzing(highlightId);
    }
  }, [bookId, chapterIndex, collectHighlightText, markHighlightAnalyzed, startAnalyzing, finishAnalyzing, setDisplayHighlightId]);

  // 当 activeHighlightId 变化时，自动加载已有的 AI 解析（如果有）
  useEffect(() => {
    // 只有在 AI tab 激活时才响应
    if (activeTab !== 'ai') return;
    if (activeHighlightId === null) {
      // 清空 AI 解析结果
      setAiResult(null);
      return;
    }

    // 如果有 AI 分析触发信号，说明是点击"AI解析"按钮触发的，跳过自动加载
    if (aiAnalysisTrigger !== null) return;

    // 防止重复请求
    if (isRequestingRef.current) return;

    // 静默检查并加载已有的 AI 解析
    (async () => {
      isRequestingRef.current = true;
      try {
        const archiveItem = await getArchiveItem(activeHighlightId);
        if (archiveItem.ai_analysis) {
          // 有已保存的分析，加载并显示
          const savedResult = JSON.parse(archiveItem.ai_analysis) as AIAnalysisResult;
          setAiResult(savedResult);
          markHighlightAnalyzed(activeHighlightId);
        } else {
          // 没有已保存的分析，清空之前的 AI 解析结果
          setAiResult(null);
        }
      } catch {
        // 积累本没有记录，清空之前的 AI 解析结果
        setAiResult(null);
      } finally {
        isRequestingRef.current = false;
      }
    })();
  }, [activeHighlightId, activeTab, aiAnalysisTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // 当收到 AI 分析触发信号时，执行分析（点击"AI解析"按钮时触发）
  useEffect(() => {
    // 防止重复执行：如果正在请求或没有触发信号，直接返回
    if (isRequestingRef.current || aiAnalysisTrigger === null || activeTab !== 'ai') {
      if (isRequestingRef.current) {
        // 正在请求时立即清除触发信号，避免下次再次触发
        clearAIAnalysisTrigger();
      }
      return;
    }

    // 立即清除触发信号（在开始执行前就清除，避免重复触发）
    clearAIAnalysisTrigger();
    performAIAnalysis(aiAnalysisTrigger);
  }, [aiAnalysisTrigger, activeTab, performAIAnalysis, clearAIAnalysisTrigger]);

  if (activeHighlightId === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <p>请点击高亮句中的单词，然后切换到此页面查看 AI 分析</p>
      </div>
    );
  }

  // 获取当前高亮文本用于显示
  const { targetText: displayText } = collectHighlightText(activeHighlightId);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* 目标文本 */}
      {displayText && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3">
          <p className="text-sm text-indigo-900 dark:text-indigo-100 font-medium">
            {displayText}
          </p>
        </div>
      )}

      {/* 加载中 */}
      {isLoading && (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 className="animate-spin mr-2" size={18} />
          <span>AI 分析中...</span>
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* AI 分析结果 */}
      {aiResult && !isLoading && (
        <div className="space-y-4">
          {/* 翻译 */}
          {aiResult.translation && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">翻译</h4>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                <p className="text-sm text-gray-900 dark:text-gray-100">{aiResult.translation}</p>
              </div>
            </div>
          )}

          {/* 语法分析 */}
          {aiResult.grammar_analysis && aiResult.grammar_analysis.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">语法分析</h4>
              <div className="space-y-2">
                {aiResult.grammar_analysis.map((point, idx) => (
                  <div key={idx} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      {point.level && (
                        <span className="text-xs px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded">
                          {point.level}
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {point.pattern}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">{point.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 词汇语感 */}
          {aiResult.vocabulary_nuance && aiResult.vocabulary_nuance.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">词汇语感</h4>
              <div className="space-y-2">
                {aiResult.vocabulary_nuance.map((nuance, idx) => (
                  <div key={idx} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {nuance.target_text}
                      </span>
                      <ChevronRight size={14} className="text-gray-400" />
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {nuance.base_form}
                      </span>
                    </div>
                    {nuance.conjugation && (
                      <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-1">
                        {nuance.conjugation}
                      </p>
                    )}
                    <p className="text-xs text-gray-600 dark:text-gray-400">{nuance.nuance}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 文化注释 */}
          {aiResult.cultural_notes && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">文化注释</h4>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 prose prose-sm dark:prose-invert max-w-none">
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {aiResult.cultural_notes}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// 生词本 Tab 内容
const VocabularyTab: React.FC = () => {
  const vocabularies = useReaderStore((s) => s.vocabularies);

  if (vocabularies.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <p>暂无生词</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-2">
        {vocabularies.map((vocab) => (
          <VocabItem key={vocab.id} vocab={vocab} />
        ))}
      </div>
    </div>
  );
};

// 单个生词卡片（可展开查看词典释义）
const VocabItem: React.FC<{ vocab: VocabularyResponse }> = ({ vocab }) => {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  // 懒加载词典数据
  const { data: dictResult, isLoading, isError } = useQuery({
    queryKey: ['dictionary', vocab.base_form || vocab.word],
    queryFn: () => searchDictionary(vocab.base_form || vocab.word),
    enabled: expanded,
    staleTime: 5 * 60 * 1000, // 5分钟内不重复请求
  });

  // 展开时预加载词典数据
  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  // 朗读
  const handleTTS = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    speak(vocab.word);
  }, [vocab.word]);

  // 删除生词
  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`确定要删除生词"${vocab.word}"吗？`)) {
      // 这里需要调用删除 API，暂时只从 store 中移除
      queryClient.invalidateQueries({ queryKey: ['vocabularies'] });
    }
  }, [vocab.word, queryClient]);

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg overflow-hidden">
      {/* 主卡片 */}
      <div
        onClick={handleToggle}
        className="p-3 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-gray-900 dark:text-white">
              {vocab.word}
            </span>
            {vocab.reading && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                [{vocab.reading}]
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={handleTTS}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
              title="朗读"
            >
              <Volume2 size={14} />
            </button>
            <button
              onClick={handleDelete}
              className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
              title="删除生词"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggle();
              }}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>
        {vocab.base_form && vocab.base_form !== vocab.word && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            原型: {vocab.base_form}
          </p>
        )}
      </div>

      {/* 展开的词典释义 */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50">
          {isLoading ? (
            <div className="flex items-center text-gray-400 text-sm py-3">
              <Loader2 className="animate-spin mr-2" size={14} />
              查询中...
            </div>
          ) : isError || !dictResult ? (
            <div className="text-sm text-gray-500 py-3">
              查询失败，请稍后重试
            </div>
          ) : !dictResult.found ? (
            <div className="text-sm text-gray-500 py-3">
              未找到「{dictResult.query}」的释义
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              {dictResult.entries.slice(0, 3).map((entry, idx) => (
                <div
                  key={`${entry.id}-${idx}`}
                  className={clsx(
                    'p-3',
                    idx > 0 && 'border-t border-gray-100 dark:border-gray-800'
                  )}
                >
                  {/* 汉字与读音 */}
                  <div className="flex items-baseline gap-2 mb-2">
                    {entry.kanji.length > 0 && (
                      <span className="font-medium text-gray-900 dark:text-white text-sm">
                        {entry.kanji.join('、')}
                      </span>
                    )}
                    {entry.reading.length > 0 && (
                      <span className="text-xs text-indigo-600 dark:text-indigo-400 font-mono">
                        [{entry.reading.join('、')}]
                      </span>
                    )}
                  </div>

                  {/* 释义列表 - 每个 sense 分组显示 */}
                  <div className="space-y-2">
                    {entry.senses.map((sense, senseIdx) => (
                      <div key={senseIdx}>
                        {/* 词性标签 */}
                        {sense.pos.length > 0 && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex flex-wrap gap-1">
                            {sense.pos.map((pos, posIdx) => (
                              <span
                                key={posIdx}
                                className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs"
                              >
                                {pos}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* 释义列表 */}
                        <ul className="space-y-1">
                          {sense.definitions.map((def, defIdx) => (
                            <li
                              key={defIdx}
                              className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-1"
                            >
                              <span className="text-gray-400 flex-shrink-0">{defIdx + 1}.</span>
                              <span className="break-words">{def}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// 高亮列表 Tab 内容
const HighlightsTab: React.FC = () => {
  const [pendingHighlight, setPendingHighlight] = useState<ChapterHighlightData | null>(null);

  // Store 数据
  const allHighlights = useReaderStore((s) => s.allHighlights);
  const allChapterList = useReaderStore((s) => s.allChapterList);
  const highlightViewChapter = useReaderStore((s) => s.highlightViewChapter);
  const chapter = useReaderStore((s) => s.chapter);
  const chapterIndex = useReaderStore((s) => s.chapterIndex);
  const setHighlightViewChapter = useReaderStore((s) => s.setHighlightViewChapter);
  const requestChapterChange = useReaderStore((s) => s.requestChapterChange);
  const setDisplayHighlightId = useReaderStore((s) => s.setDisplayHighlightId);

  // 计算每个章节的高亮数量
  const highlightCountsByChapter = useMemo(() => {
    const counts: Record<number, number> = {};
    allHighlights.forEach((h) => {
      if (h.chapter_index !== undefined) {
        counts[h.chapter_index] = (counts[h.chapter_index] || 0) + 1;
      }
    });
    return counts;
  }, [allHighlights]);

  // 过滤显示的高亮
  const displayHighlights = useMemo(() => {
    if (highlightViewChapter === null) {
      return allHighlights;  // 显示全部
    }
    return allHighlights.filter((h) => h.chapter_index === highlightViewChapter);
  }, [allHighlights, highlightViewChapter]);

  // 收集高亮文本（优先使用 selected_text，降级从 segments 提取）
  const getHighlightText = useCallback((highlight: ChapterHighlightData): string => {
    // 优先使用 selected_text（从 API 获取的包含此字段）
    if (highlight.selected_text) {
      return highlight.selected_text;
    }
    // 降级：从 segments 中提取（当前章节的情况）
    if (!chapter?.segments) return '无法显示文本';

    const tokens: string[] = [];
    for (let s = highlight.start_segment_index; s <= highlight.end_segment_index; s++) {
      const segment = chapter.segments[s];
      if (segment?.type === 'text' && segment.tokens) {
        const startT = s === highlight.start_segment_index ? highlight.start_token_idx : 0;
        const endT = s === highlight.end_segment_index ? highlight.end_token_idx : (segment.tokens?.length || 0) - 1;

        for (let t = startT; t <= endT; t++) {
          const token = segment.tokens[t];
          if (token?.s) {
            tokens.push(token.s);
          }
        }
      }
    }
    return tokens.join('');
  }, [chapter]);

  // 章节选择处理
  const handleChapterChange = useCallback((value: string) => {
    if (value === 'all') {
      setHighlightViewChapter(null);
    } else {
      setHighlightViewChapter(parseInt(value, 10));
    }
  }, [setHighlightViewChapter]);

  // 跳转到高亮位置
  const scrollToHighlight = useCallback((highlight: ChapterHighlightData) => {
    const isCurrentChapter = highlight.chapter_index === chapterIndex;

    // 设置 AI Tab 要显示的高亮 ID
    setDisplayHighlightId(highlight.id);

    if (isCurrentChapter) {
      // 当前章节：直接滚动
      const selector = `[data-segment-index="${highlight.start_segment_index}"][data-token-index="${highlight.start_token_idx}"]`;
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 高亮闪烁效果
        element.classList.add('ring-2', 'ring-indigo-500');
        setTimeout(() => {
          element.classList.remove('ring-2', 'ring-indigo-500');
        }, 2000);
      }
    } else {
      // 其他章节：显示确认对话框
      setPendingHighlight(highlight);
    }
  }, [chapterIndex, setDisplayHighlightId]);

  // 确认跳转到其他章节
  const handleJumpToChapter = useCallback(() => {
    if (pendingHighlight && pendingHighlight.chapter_index !== undefined) {
      // 请求章节切换（带滚动目标）
      requestChapterChange(
        pendingHighlight.chapter_index,
        pendingHighlight.start_segment_index,
        pendingHighlight.start_token_idx
      );
      setPendingHighlight(null);
    }
  }, [pendingHighlight, requestChapterChange]);

  // 从后端配置构建样式映射（用于内联样式）
  const getHighlightStyle = useCallback((category: string) => {
    return getHighlightStyleWithFallback(category).color;
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 章节选择器 */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-3">
        <select
          value={highlightViewChapter ?? 'all'}
          onChange={(e) => handleChapterChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
        >
          <option value="all">全部章节 ({allHighlights.length} 条)</option>
          {allChapterList.map((chap) => (
            <option key={chap.index} value={chap.index}>
              第 {chap.index + 1} 章 - {chap.title} ({highlightCountsByChapter[chap.index] || 0} 条)
            </option>
          ))}
        </select>
      </div>

      {/* 高亮列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {displayHighlights.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p>暂无高亮</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayHighlights.map((highlight) => (
              <div
                key={highlight.id}
                className="rounded-lg p-3 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-l-4"
                style={{ borderLeftColor: getHighlightStyle(highlight.style_category) }}
                onClick={() => scrollToHighlight(highlight)}
              >
                <p className="text-sm text-gray-900 dark:text-gray-100 line-clamp-2">
                  {getHighlightText(highlight) || '无法显示文本'}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    位置: {highlight.start_segment_index + 1}段
                  </p>
                  {highlight.chapter_index !== undefined && highlight.chapter_index !== chapterIndex && (
                    <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                      第 {highlight.chapter_index + 1} 章
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 跨章节跳转确认对话框 */}
      {pendingHighlight && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl">
            <h3 className="text-lg font-medium mb-2">跳转到其他章节</h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              该高亮位于第 {pendingHighlight.chapter_index! + 1} 章，是否跳转？
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPendingHighlight(null)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleJumpToChapter}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
              >
                跳转
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 侧边栏主组件
export const ReaderSidebar: React.FC = () => {
  const { isSidebarOpen, activeTab, setIsSidebarOpen, setActiveTab } = useReaderStore();

  const handleClose = useCallback(() => {
    setIsSidebarOpen(false);
  }, [setIsSidebarOpen]);

  const handleTabChange = useCallback((tab: SidebarTab) => {
    setActiveTab(tab);
  }, [setActiveTab]);

  // Tab 内容渲染
  const renderTabContent = () => {
    switch (activeTab) {
      case 'dictionary':
        return <DictionaryTab />;
      case 'ai':
        return <AITab />;
      case 'vocabulary':
        return <VocabularyTab />;
      case 'highlights':
        return <HighlightsTab />;
      default:
        return null;
    }
  };

  if (!isSidebarOpen) return null;

  return (
    <aside className="fixed right-0 top-0 h-full w-80 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 z-50 flex flex-col transition-transform duration-300">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {TAB_CONFIG[activeTab].label}
          </h2>
          <button
            onClick={handleClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(Object.keys(TAB_CONFIG) as SidebarTab[]).map((tab) => {
            const Icon = TAB_CONFIG[tab].icon;
            return (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium transition-colors relative',
                  activeTab === tab
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                )}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{TAB_CONFIG[tab].label}</span>
                {activeTab === tab && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* 内容区域 */}
        {renderTabContent()}
      </aside>
  );
};
