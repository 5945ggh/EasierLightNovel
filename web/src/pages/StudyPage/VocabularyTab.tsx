/**
 * 生词本标签页（简化版）
 */

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllVocabularies, deleteVocabulary } from '@/services/vocabularies.service';
import { Loader2, Trash2, Search, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
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

  const handleDelete = async (id: number) => {
    if (confirm('确定要删除这个生词吗？')) {
      await deleteVocabulary(id);
      queryClient.invalidateQueries({ queryKey: ['vocabularies'] });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <Loader2 className="animate-spin mr-2" size={20} /> 加载生词中...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="搜索单词、读音或书名..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <div className="text-sm text-gray-500">
          共 {filteredData.length} 个生词
        </div>
      </div>

      {/* 列表区域 */}
      <div className="flex-1 overflow-y-auto">
        {filteredData.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {filteredData.map(vocab => (
              <VocabItem key={vocab.id} vocab={vocab} onDelete={handleDelete} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <BookOpen size={48} className="mb-4 opacity-50" />
            <p>{vocabularies?.length === 0 ? '还没有生词，去阅读时添加吧！' : '没有找到匹配的生词'}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// 单个生词条目（紧凑可展开）
const VocabItem: React.FC<{
  vocab: VocabularyListItem;
  onDelete: (id: number) => void;
}> = ({ vocab, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const definitions = parseDefinition(vocab.definition);
  const hasDefinition = definitions.length > 0;

  return (
    <div className="bg-white hover:bg-gray-50 transition-colors">
      {/* 主行（默认显示） */}
      <div className="flex items-center gap-4 px-4 py-3">
        {/* 单词信息 */}
        <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center">
          {/* 表层形 */}
          <div className="col-span-3">
            <span className="font-medium text-gray-800 truncate block">{vocab.word}</span>
          </div>

          {/* 读音 */}
          <div className="col-span-3">
            <span className="text-indigo-600 text-sm truncate block">{vocab.reading || '—'}</span>
          </div>

          {/* 原型 */}
          <div className="col-span-2">
            <span className="text-gray-500 text-sm truncate block">
              {vocab.base_form && vocab.base_form !== vocab.word ? vocab.base_form : '—'}
            </span>
          </div>

          {/* 词性 */}
          <div className="col-span-2">
            <span className="text-gray-400 text-xs truncate block">
              {vocab.part_of_speech || '—'}
            </span>
          </div>

          {/* 书名 */}
          <div className="col-span-2">
            <span className="text-gray-400 text-xs truncate block" title={vocab.book_title}>
              {vocab.book_title || '未知书籍'}
            </span>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasDefinition && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 transition-colors"
              title={expanded ? '收起释义' : '查看释义'}
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
          <button
            onClick={() => onDelete(vocab.id)}
            className="p-1 hover:bg-red-50 hover:text-red-500 rounded text-gray-400 transition-colors"
            title="删除生词"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* 展开的释义 */}
      {expanded && hasDefinition && (
        <div className="px-4 pb-3 pl-16">
          <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
            <ul className="space-y-1">
              {definitions.map((def, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-gray-400 flex-shrink-0">{idx + 1}.</span>
                  <span>{def}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default VocabularyTab;
