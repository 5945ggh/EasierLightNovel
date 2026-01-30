/**
 * 积累与高亮标签页（简化版）
 */

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllHighlights, getArchiveItem, deleteHighlight } from '@/services/highlights.service';
import { getHighlightStyleWithFallback } from '@/utils/highlightStyles';
import type { ArchiveItemResponse, AIAnalysisResult } from '@/types';
import { Loader2, Sparkles, ChevronDown, ChevronUp, Quote, Trash2, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * 获取样式分类的显示信息
 * 使用统一的工具函数，包含完整的降级兼容逻辑
 */
const getStyleInfo = (category: string) => {
  const style = getHighlightStyleWithFallback(category);
  return {
    name: style.name,
    color: style.color,
  };
};

/**
 * JLPT 等级颜色
 */
const getJLPTColor = (level?: string) => {
  if (!level) return 'bg-gray-200 text-gray-700';
  const levelColors: Record<string, string> = {
    N5: 'bg-green-100 text-green-700',
    N4: 'bg-blue-100 text-blue-700',
    N3: 'bg-yellow-100 text-yellow-700',
    N2: 'bg-orange-100 text-orange-700',
    N1: 'bg-red-100 text-red-700',
  };
  return levelColors[level] || 'bg-gray-200 text-gray-700';
};

/**
 * 安全解析 AI 分析结果
 */
const parseAnalysis = (analysisStr: string | undefined): AIAnalysisResult | null => {
  if (!analysisStr) return null;
  try {
    return JSON.parse(analysisStr);
  } catch {
    return null;
  }
};

const HighlightTab: React.FC = () => {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const { data: highlights, isLoading } = useQuery({
    queryKey: ['highlights', 'all'],
    queryFn: getAllHighlights,
  });

  // 搜索筛选
  const filteredData = useMemo(() => {
    if (!highlights) return [];
    if (!filter) return highlights;

    const lowerFilter = filter.toLowerCase();
    return highlights.filter(h =>
      (h.selected_text && h.selected_text.toLowerCase().includes(lowerFilter)) ||
      (h.book_title && h.book_title.toLowerCase().includes(lowerFilter))
    );
  }, [highlights, filter]);

  const handleDelete = async (id: number) => {
    if (confirm('确定要删除这条划线吗？')) {
      await deleteHighlight(id);
      queryClient.invalidateQueries({ queryKey: ['highlights'] });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <Loader2 className="animate-spin mr-2" size={20} /> 加载划线中...
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
            placeholder="搜索划线内容或书名..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <div className="text-sm text-gray-500">
          共 {filteredData.length} 条划线
        </div>
      </div>

      {/* 列表区域 */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredData.length > 0 ? (
          <div className="space-y-4">
            {filteredData.map(highlight => (
              <HighlightItem key={highlight.id} highlight={highlight} onDelete={handleDelete} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <Quote size={48} className="mb-4 opacity-50" />
            <p>{highlights?.length === 0 ? '暂无划线记录，去阅读器里划线吧！' : '没有找到匹配的划线'}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// 单个划线项组件
const HighlightItem: React.FC<{
  highlight: any;
  onDelete: (id: number) => void;
}> = ({ highlight, onDelete }) => {
  const [expanded, setExpanded] = useState(false);

  // 懒加载积累本数据
  const { data: archiveData, isLoading, isError } = useQuery({
    queryKey: ['archive', highlight.id],
    queryFn: () => getArchiveItem(highlight.id),
    enabled: expanded,
    retry: false,
  });

  const styleInfo = getStyleInfo(highlight.style_category);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-all overflow-hidden">
      {/* 句子主体 */}
      <div
        className="p-5 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex gap-4">
          <Quote className="text-indigo-200 flex-shrink-0 mt-1" size={20} />
          <div className="flex-1 min-w-0">
            <p className="text-base text-gray-800 leading-relaxed font-serif break-words">
              {highlight.selected_text}
            </p>
            <div className="flex items-center gap-3 mt-3 text-xs text-gray-400 flex-wrap">
              <span
                className="px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: styleInfo.color }}
              >
                {styleInfo.name}
              </span>
              <span>{highlight.book_title || '未知书籍'}</span>
              <span>第 {highlight.chapter_index + 1} 章</span>
              <span>{new Date(highlight.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {highlight.has_Archive && (
              <span title="有 AI 分析">
                <Sparkles size={16} className="text-amber-400" />
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(highlight.id);
              }}
              className="p-1.5 hover:bg-red-50 hover:text-red-500 rounded transition-all text-gray-400"
              title="删除划线"
            >
              <Trash2 size={14} />
            </button>
            <div className="text-gray-400">
              {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </div>
          </div>
        </div>
      </div>

      {/* 展开区域：显示 AI 分析结果 */}
      {expanded && (
        <div className="bg-indigo-50/30 border-t border-gray-100 p-5 pl-14">
          {isLoading ? (
            <div className="flex items-center text-indigo-500 gap-2">
              <Sparkles size={16} className="animate-spin" /> 正在加载分析...
            </div>
          ) : isError || !archiveData ? (
            <div className="text-sm text-gray-500 italic flex items-center gap-2">
              <Sparkles size={14} className="text-gray-300" />
              这条划线尚未进行深度分析。
              进入阅读器选中此文本后点击"AI 分析"即可添加到积累本。
            </div>
          ) : (
            <ArchiveContent archive={archiveData} />
          )}
        </div>
      )}
    </div>
  );
};

// 积累本内容组件
const ArchiveContent: React.FC<{ archive: ArchiveItemResponse }> = ({ archive }) => {
  const analysis = parseAnalysis(archive.ai_analysis);

  if (!analysis) {
    return <div className="text-sm text-gray-500 italic">分析数据格式错误</div>;
  }

  return (
    <div className="space-y-4 text-sm text-gray-700">
      {/* 翻译 */}
      <div>
        <h4 className="font-bold text-indigo-700 mb-2 flex items-center gap-2">
          <Sparkles size={14} /> 翻译
        </h4>
        <p className="bg-white p-3 rounded-lg border border-indigo-100 text-gray-800">
          {analysis.translation}
        </p>
      </div>

      {/* 语法分析 */}
      {analysis.grammar_analysis && analysis.grammar_analysis.length > 0 && (
        <div>
          <h4 className="font-bold text-indigo-700 mb-2">语法分析</h4>
          <div className="space-y-2">
            {analysis.grammar_analysis.map((g, idx) => (
              <div
                key={idx}
                className="bg-white p-3 rounded-lg border border-gray-100 hover:border-indigo-200 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-bold text-gray-900">{g.target_text}</span>
                  {g.level && (
                    <span className={`px-2 py-0.5 text-xs rounded ${getJLPTColor(g.level)}`}>
                      {g.level}
                    </span>
                  )}
                </div>
                <div className="text-xs text-indigo-500 mb-1">{g.pattern}</div>
                <div className="text-gray-600">{g.explanation}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 词汇语感 */}
      {analysis.vocabulary_nuance && analysis.vocabulary_nuance.length > 0 && (
        <div>
          <h4 className="font-bold text-indigo-700 mb-2">词汇语感</h4>
          <div className="space-y-2">
            {analysis.vocabulary_nuance.map((v, idx) => (
              <div
                key={idx}
                className="bg-white p-3 rounded-lg border border-gray-100 hover:border-indigo-200 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-gray-900">{v.target_text}</span>
                  {v.base_form && v.base_form !== v.target_text && (
                    <span className="text-xs text-gray-400">→ {v.base_form}</span>
                  )}
                  {v.conjugation && (
                    <span className="text-xs text-indigo-500 border border-indigo-200 px-1 rounded">
                      {v.conjugation}
                    </span>
                  )}
                </div>
                <div className="text-gray-600">{v.nuance}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 文化注释 */}
      {analysis.cultural_notes && (
        <div>
          <h4 className="font-bold text-indigo-700 mb-2">文化注释</h4>
          <div
            className="bg-white p-3 rounded-lg border border-gray-100 prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: analysis.cultural_notes }}
          />
        </div>
      )}

      {/* 用户笔记 */}
      {archive.user_note && (
        <div className="mt-4 pt-4 border-t border-indigo-200">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">我的笔记</span>
          <p className="mt-1 text-gray-700">{archive.user_note}</p>
        </div>
      )}
    </div>
  );
};

export default HighlightTab;
