/**
 * 词汇收藏标签页（简化版）
 */

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllVocabularies, deleteVocabulary } from '@/services/vocabularies.service';
import { Loader2, Trash2, Search, BookOpen, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { ContextCardModal } from '@/components/study/ContextCardModal';
import type { VocabularyResponse } from '@/types';

type VocabularyListItem = VocabularyResponse & { book_title: string };

interface DictionarySenseLike {
  definitions?: unknown;
}

interface DictionaryEntryLike {
  senses?: unknown;
}

const isDictionarySenseLike = (value: unknown): value is DictionarySenseLike =>
  !!value && typeof value === 'object';

const isDictionaryEntryLike = (value: unknown): value is DictionaryEntryLike =>
  !!value && typeof value === 'object';

/**
 * 从词典条目对象中提取释义
 */
const extractDictDefinitions = (entry: DictionaryEntryLike): string[] => {
  const results: string[] = [];

  if (Array.isArray(entry.senses)) {
    entry.senses.forEach((sense) => {
      if (!isDictionarySenseLike(sense) || !Array.isArray(sense.definitions)) {
        return;
      }

      results.push(
        ...sense.definitions.filter((definition): definition is string => typeof definition === 'string')
      );
    });
  }

  return results;
};

/**
 * 安全解析 definition 字段
 */
const parseDefinition = (def: string | undefined): string[] => {
  if (!def) return [];

  try {
    const parsed: unknown = JSON.parse(def);

    if (Array.isArray(parsed)) {
      const results: string[] = [];
      parsed.forEach((item) => {
        if (typeof item === 'string') {
          results.push(item);
        } else if (isDictionaryEntryLike(item)) {
          results.push(...extractDictDefinitions(item));
        }
      });
      return results.length > 0 ? results : [];
    }

    if (isDictionaryEntryLike(parsed)) {
      return extractDictDefinitions(parsed);
    }

    return [String(parsed)];
  } catch {
    return [];
  }
};

const VocabularyTab: React.FC = () => {
  const queryClient = useQueryClient();
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cardVocabulary, setCardVocabulary] = useState<VocabularyListItem | null>(null);

  const { data: vocabularies, isLoading } = useQuery({
    queryKey: ['vocabularies', 'all'],
    queryFn: getAllVocabularies,
  });

  const [filter, setFilter] = useState('');

  // 搜索筛选
  const filteredData = useMemo(() => {
    if (!vocabularies) return [];
    return vocabularies.filter(v =>
      !filter ||
      v.word.includes(filter) ||
      (v.reading?.includes(filter) ?? false) ||
      (v.base_form?.includes(filter) ?? false) ||
      (v.book_title?.includes(filter) ?? false)
    );
  }, [vocabularies, filter]);

  const handleConfirmDelete = async () => {
    if (deleteTargetId === null) return;
    setDeleteError(null);
    setIsDeleting(true);
    try {
      await deleteVocabulary(deleteTargetId);
      await queryClient.invalidateQueries({ queryKey: ['vocabularies'] });
      setDeleteTargetId(null);
    } catch (error) {
      console.error('Failed to delete vocabulary:', error);
      setDeleteError('删除失败，请检查连接后重试。');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteRequest = (id: number) => {
    setDeleteError(null);
    setDeleteTargetId(id);
  };

  const handleCloseDeleteModal = () => {
    setDeleteError(null);
    setDeleteTargetId(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 dark:text-slate-500">
        <Loader2 className="animate-spin mr-2" size={20} /> 加载词汇资料中...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      {/* 工具栏 */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center bg-slate-50/50 dark:bg-slate-900/50">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={16} strokeWidth={1.5} />
          <input
            type="text"
            placeholder="搜索单词、读音或书名..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-blue-500 transition-all"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <div className="self-end whitespace-nowrap text-sm text-slate-500 dark:text-slate-400 sm:self-auto">
          共 {filteredData.length} 条词汇资料
        </div>
      </div>

      {/* 列表区域 */}
      <div className="flex-1 overflow-y-auto">
        {filteredData.length > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredData.map(vocab => (
              <VocabItem key={vocab.id} vocab={vocab} onDelete={handleDeleteRequest} onCreateCard={setCardVocabulary} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 py-12">
            <BookOpen size={48} strokeWidth={1.5} className="mb-4 opacity-50" />
            <p>{vocabularies?.length === 0 ? '还没有收藏词汇，去阅读时加入吧！' : '没有找到匹配的词汇资料'}</p>
          </div>
        )}
      </div>

      {/* 确认删除对话框 */}
      <ConfirmModal
        isOpen={deleteTargetId !== null}
        title="确认移除词汇收藏？"
        message="确定要移除这个词汇收藏吗？此操作无法撤销。"
        confirmText="移除收藏"
        cancelText="取消"
        isDanger={true}
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={handleConfirmDelete}
        onClose={handleCloseDeleteModal}
      />
      {cardVocabulary && <ContextCardModal vocabulary={cardVocabulary} onClose={() => setCardVocabulary(null)} />}
    </div>
  );
};

// 单个词汇资料条目（紧凑可展开）
const VocabItem: React.FC<{
  vocab: VocabularyListItem;
  onDelete: (id: number) => void;
  onCreateCard: (vocabulary: VocabularyListItem) => void;
}> = ({ vocab, onDelete, onCreateCard }) => {
  const [expanded, setExpanded] = useState(false);
  const definitions = parseDefinition(vocab.definition);
  const hasDefinition = definitions.length > 0;
  const contextSentences = (vocab.context_sentences ?? []).filter(
    (sentence): sentence is string => typeof sentence === 'string' && sentence.trim().length > 0
  );
  const hasContext = contextSentences.length > 0;
  const hasDetails = hasDefinition || hasContext;
  const detailActionLabel = hasDefinition && hasContext
    ? '详情'
    : hasDefinition
      ? '释义'
      : '阅读上下文';

  return (
    <div className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
      {/* 主行（默认显示） */}
      <div className="flex items-center gap-4 px-4 py-3">
        {/* 单词信息 */}
        <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center">
          {/* 表层形 */}
          <div className="col-span-3">
            <span className="font-medium text-slate-800 dark:text-slate-100 truncate block">{vocab.word}</span>
          </div>

          {/* 读音 */}
          <div className="col-span-3">
            <span className="text-slate-blue-600 dark:text-slate-blue-400 text-sm truncate block font-medium">{vocab.reading || '—'}</span>
          </div>

          {/* 原型 */}
          <div className="col-span-2">
            <span className="text-slate-500 dark:text-slate-400 text-sm truncate block">
              {vocab.base_form && vocab.base_form !== vocab.word ? vocab.base_form : '—'}
            </span>
          </div>

          {/* 词性 */}
          <div className="col-span-2">
            <span className="text-slate-400 dark:text-slate-500 text-xs truncate block">
              {vocab.part_of_speech || '—'}
            </span>
          </div>

          {/* 书名 */}
          <div className="col-span-2">
            <span className="text-slate-400 dark:text-slate-500 text-xs truncate block" title={vocab.book_title}>
              {vocab.book_title || '未知书籍'}
            </span>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onCreateCard(vocab)}
            className="p-1.5 hover:bg-slate-blue-50 dark:hover:bg-slate-blue-950/40 hover:text-slate-blue-600 rounded-lg text-slate-400 transition-colors"
            title="制作语境卡片"
            aria-label="制作语境卡片"
          >
            <FileText size={15} strokeWidth={1.5} />
          </button>
          {hasDetails && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              title={expanded ? `收起${detailActionLabel}` : `查看${detailActionLabel}`}
              aria-label={expanded ? `收起${detailActionLabel}` : `查看${detailActionLabel}`}
            >
              {expanded ? <ChevronUp size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}
            </button>
          )}
          <button
            onClick={() => onDelete(vocab.id)}
            className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-500 rounded-lg text-slate-400 transition-colors"
            title="移除词汇收藏"
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* 展开的词典释义和阅读上下文 */}
      {expanded && hasDetails && (
        <div className="px-4 pb-3 pl-16">
          <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/80 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
            {hasContext && (
              <section aria-labelledby={`vocabulary-context-${vocab.id}`}>
                <h3 id={`vocabulary-context-${vocab.id}`} className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  阅读上下文
                </h3>
                <ul className="space-y-2">
                  {contextSentences.map((sentence, idx) => (
                    <li key={`${sentence}-${idx}`} className="border-l-2 border-slate-blue-300 dark:border-slate-blue-600 pl-3 leading-6">
                      {sentence}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {hasDefinition && (
              <section aria-labelledby={`vocabulary-definition-${vocab.id}`}>
                <h3 id={`vocabulary-definition-${vocab.id}`} className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  释义
                </h3>
                <ul className="space-y-1">
                  {definitions.map((def, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-slate-400 dark:text-slate-500 flex-shrink-0">{idx + 1}.</span>
                      <span>{def}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VocabularyTab;
