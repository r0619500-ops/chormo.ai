import { useMemo, useState } from 'react';
import { PanelLeftClose, Plus, Search, Trash2, X } from 'lucide-react';
import type { Conversation } from '../types/chat';
import { ChromoLogo } from './ChromoLogo';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  desktopOpen: boolean;
  mobileOpen: boolean;
  onCloseDesktop: () => void;
  onCloseMobile: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
}

function getDateBucket(timestamp: number): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDay = 86_400_000;

  if (timestamp >= startOfToday) return 'Today';
  if (timestamp >= startOfToday - oneDay) return 'Yesterday';
  if (timestamp >= startOfToday - 7 * oneDay) return 'Previous 7 days';
  return 'Older';
}

export function Sidebar({
  conversations,
  activeId,
  desktopOpen,
  mobileOpen,
  onCloseDesktop,
  onCloseMobile,
  onNewChat,
  onSelectChat,
  onDeleteChat,
}: SidebarProps) {
  const [query, setQuery] = useState('');

  const groupedConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const sorted = [...conversations]
      .filter((c) => {
        if (!normalizedQuery) return true;
        if (c.title.toLowerCase().includes(normalizedQuery)) return true;
        return c.messages.some((m) => m.content.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const groups: Array<{ label: string; items: Conversation[] }> = [];
    for (const chat of sorted) {
      const label = getDateBucket(chat.updatedAt);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.label === label) {
        lastGroup.items.push(chat);
      } else {
        groups.push({ label, items: [chat] });
      }
    }
    return groups;
  }, [conversations, query]);

  const handleClose = () => {
    if (window.innerWidth < 768) {
      onCloseMobile();
    } else {
      onCloseDesktop();
    }
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Chat history"
        className={[
          'fixed inset-y-0 left-0 z-40 flex flex-col w-[272px] shrink-0',
          'bg-zinc-50 dark:bg-zinc-900/95 border-r border-zinc-200 dark:border-zinc-800',
          'transition-transform duration-200 ease-out',
          'md:static',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          desktopOpen ? 'md:translate-x-0 md:ml-0' : 'md:-ml-[272px] md:translate-x-0',
        ].join(' ')}
      >
        {/* Sidebar Header */}
        <div className="h-14 px-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <ChromoLogo size="sm" />
            <span className="font-display font-bold text-[15px] tracking-tight text-zinc-900 dark:text-zinc-50 whitespace-nowrap shrink-0">
              CHROMO AI
            </span>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="w-10 h-10 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <PanelLeftClose className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* New Chat + Search */}
        <div className="px-3 pb-2 space-y-2 shrink-0">
          <button
            type="button"
            onClick={onNewChat}
            className="w-full min-h-[40px] px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/70 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 text-sm font-medium flex items-center gap-2.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0" />
            <span>New chat</span>
          </button>

          {conversations.length > 0 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                className="w-full h-9 pl-8 pr-8 rounded-lg bg-zinc-100/80 dark:bg-zinc-800/50 border border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 focus:bg-white dark:focus:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none transition-colors"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Conversation List */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-2 space-y-4" aria-label="Conversations">
          {groupedConversations.length === 0 ? (
            <p className="px-2.5 py-4 text-xs text-zinc-500 dark:text-zinc-400">
              {query ? 'No matching conversations.' : 'Your conversations will appear here.'}
            </p>
          ) : (
            groupedConversations.map((group) => (
              <div key={group.label}>
                <div className="px-2.5 pb-1.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((chat) => {
                    const isActive = chat.id === activeId;
                    return (
                      <div
                        key={chat.id}
                        className={[
                          'group flex items-center justify-between gap-1.5 rounded-lg px-2.5 min-h-[40px] text-[13.5px] transition-colors cursor-pointer',
                          isActive
                            ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-950 dark:text-white font-medium'
                            : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/60 hover:text-zinc-950 dark:hover:text-zinc-100',
                        ].join(' ')}
                        onClick={() => {
                          onSelectChat(chat.id);
                          onCloseMobile();
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectChat(chat.id);
                            onCloseMobile();
                          }
                        }}
                      >
                        <span className="truncate flex-1">{chat.title || 'New conversation'}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteChat(chat.id);
                          }}
                          aria-label={`Delete ${chat.title || 'conversation'}`}
                          title="Delete chat"
                          className={[
                            'w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer',
                            isActive
                              ? 'opacity-100'
                              : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100',
                          ].join(' ')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Founded by <span className="font-medium text-zinc-700 dark:text-zinc-200">Meet Shasane</span>
          </p>
        </div>
      </aside>
    </>
  );
}
