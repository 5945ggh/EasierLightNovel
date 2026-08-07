/**
 * 词汇与摘录页面
 * 包含词汇收藏和摘录与解析两个标签页
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
    <div className="min-h-[100dvh] flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden transition-colors">
      {/* 顶部导航栏 */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
            title="返回书架"
          >
            <ArrowLeft size={20} strokeWidth={1.5} />
          </Link>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-blue-50 dark:bg-slate-800 rounded-xl text-slate-blue-600 dark:text-slate-blue-400">
              <BrainCircuit size={24} strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">词汇与摘录</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">管理阅读中收藏的词汇、摘录与解析</p>
            </div>
          </div>
        </div>
      </header>

      {/* Tab 切换器 */}
      <div className="px-6 py-4 flex-shrink-0">
        <div className="flex gap-4 border-b border-slate-200 dark:border-slate-800">
          <TabButton
            active={activeTab === 'vocabulary'}
            onClick={() => setActiveTab('vocabulary')}
            icon={<BookOpen size={18} strokeWidth={1.5} />}
            label="词汇收藏"
          />
          <TabButton
            active={activeTab === 'highlights'}
            onClick={() => setActiveTab('highlights')}
            icon={<Highlighter size={18} strokeWidth={1.5} />}
            label="摘录与解析"
          />
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden px-6 pb-6">
        <div className="h-full bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden relative">
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
        ? 'border-slate-blue-600 text-slate-blue-600 dark:border-slate-blue-400 dark:text-slate-blue-400 font-semibold'
        : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700'
    )}
  >
    {icon}
    {label}
  </button>
);

export default StudyPage;
