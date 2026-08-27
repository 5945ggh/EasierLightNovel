/**
 * 词汇与摘录页面
 * 包含词汇收藏和摘录与解析两个标签页
 */

import React, { useState } from 'react';
import { BookOpen, Highlighter, BrainCircuit } from 'lucide-react';
import clsx from 'clsx';
import VocabularyTab from './VocabularyTab';
import HighlightTab from './HighlightTab';

type Tab = 'vocabulary' | 'highlights';

const StudyPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('vocabulary');

  return (
    <div className="min-h-full p-4 text-slate-900 transition-colors dark:text-slate-100 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-blue-100 text-slate-blue-700 dark:bg-slate-blue-900/40 dark:text-slate-blue-300">
            <BrainCircuit size={22} strokeWidth={1.6} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">词汇与摘录</h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">收藏的词汇、摘录与解析</p>
          </div>
        </header>

        <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800" role="tablist" aria-label="资料类型">
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

        <div className="mt-5 h-[calc(100dvh-13rem)] min-h-[32rem] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
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
    role="tab"
    aria-selected={active}
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
