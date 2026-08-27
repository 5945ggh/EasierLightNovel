import type { ReactNode } from 'react';
import { BrainCircuit, BookOpen, Library as LibraryIcon, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';

interface AppShellProps {
  children: ReactNode;
}

interface NavigationItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  compact?: boolean;
}

const navigationItems = [
  { to: '/', icon: LibraryIcon, label: '我的书架' },
  { to: '/study', icon: BrainCircuit, label: '词汇与摘录' },
];

const settingsItem = { to: '/settings', icon: Settings, label: '系统设置' };

const NavigationItem = ({ to, icon: Icon, label, compact = false }: NavigationItemProps) => (
  <NavLink
    to={to}
    end={to === '/'}
    className={({ isActive }) => [
      'group flex items-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
      compact
        ? 'min-h-14 flex-1 flex-col justify-center gap-1 rounded-lg px-2 py-2 text-[11px]'
        : 'gap-3 rounded-lg px-3 py-2.5 text-sm',
      isActive
        ? 'bg-slate-blue-100 text-slate-blue-800 dark:bg-slate-blue-900/40 dark:text-slate-blue-200'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100',
    ].join(' ')}
  >
    <Icon size={compact ? 20 : 19} strokeWidth={1.7} aria-hidden="true" />
    <span className={compact ? 'leading-none' : undefined}>{label}</span>
  </NavLink>
);

export const AppShell = ({ children }: AppShellProps) => (
  <div className="min-h-[100dvh] bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100 md:flex">
    <aside className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-4 dark:border-slate-800 dark:bg-slate-900 md:flex">
      <NavLink
        to="/"
        end
        className="mb-8 flex items-center gap-2.5 rounded-lg px-2 py-2 text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-blue-500 dark:text-slate-100"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-slate-blue-700 text-white shadow-sm">
          <BookOpen size={18} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <span className="text-sm font-semibold">EasierLightNovel</span>
      </NavLink>

      <nav className="space-y-1" aria-label="主要导航">
        {navigationItems.map((item) => <NavigationItem key={item.to} {...item} />)}
      </nav>

      <nav className="mt-auto border-t border-slate-200 pt-3 dark:border-slate-800" aria-label="系统导航">
        <NavigationItem {...settingsItem} />
      </nav>
    </aside>

    <main className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0">
      {children}
    </main>

    <nav className="safe-area-bottom fixed inset-x-0 bottom-0 z-40 flex min-h-16 border-t border-slate-200 bg-white px-2 shadow-[0_-1px_8px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-900 md:hidden" aria-label="主要导航">
      {navigationItems.map((item) => <NavigationItem key={item.to} {...item} compact />)}
      <NavigationItem {...settingsItem} compact />
    </nav>
  </div>
);
