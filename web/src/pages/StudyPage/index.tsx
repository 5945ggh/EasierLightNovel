/**
 * 学习中心页面
 * 包含生词本和积累本（高亮句）两个标签页
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Highlighter, BrainCircuit, ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import VocabularyTab from './VocabularyTab';
import HighlightTab from './HighlightTab';

type Tab = 'vocabulary' | 'highlights';

const StudyPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('vocabulary');

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      {/* 顶部导航栏 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700 transition-colors"
            title="返回书架"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
              <BrainCircuit size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800">学习中心</h1>
              <p className="text-sm text-gray-500">积累词汇，回顾高亮与 AI 解析</p>
            </div>
          </div>
        </div>
      </header>

      {/* Tab 切换器 */}
      <div className="px-6 py-4 flex-shrink-0">
        <div className="flex gap-4 border-b border-gray-200">
          <TabButton
            active={activeTab === 'vocabulary'}
            onClick={() => setActiveTab('vocabulary')}
            icon={<BookOpen size={18} />}
            label="生词本"
          />
          <TabButton
            active={activeTab === 'highlights'}
            onClick={() => setActiveTab('highlights')}
            icon={<Highlighter size={18} />}
            label="积累与高亮"
          />
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden px-6 pb-6">
        <div className="h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
          {activeTab === 'vocabulary' ? <VocabularyTab /> : <HighlightTab />}
        </div>
      </div>
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={clsx(
      'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2',
      active
        ? 'border-indigo-600 text-indigo-600'
        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
    )}
  >
    {icon}
    {label}
  </button>
);

export default StudyPage;
