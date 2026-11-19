import { useMemo, useState } from 'react';
import { useThreads } from '@copilotkit/react-core/v2';
import { MessageCircle, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Conversation, Dot } from '../shared/types';
import { promptText } from './PromptDialog';

export function ThreadList({
  dots,
  dotId,
  local = [],
  selected,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: {
  dots: Dot[];
  dotId: string;
  local: Conversation[];
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string, title: string) => void;
}) {
  const [query, setQuery] = useState('');
  const threads = useThreads({
    agentId: dotId,
    enabled: !!dotId,
    includeArchived: false,
    limit: 20,
  });

  const remoteList = Array.isArray(threads?.threads) ? threads.threads : [];
  const visibleThreads = useMemo(() => (local || []).filter((thread) => {
    const remote = remoteList.find((item) => item.id === thread.id);
    const title = remote?.name || thread.title || 'Untitled conversation';
    const agent = (dots || []).find((dot) => dot.id === thread.dotId)?.name || 'Aegis';
    return `${title} ${agent}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }), [dots, local, query, remoteList]);

  return (
    <section className="thread-list">
      <div className="nav-label">
        RECENT CHATS
        <button
          className="icon-button"
          onClick={onNew}
          aria-label="New conversation"
        >
          <Plus size={14} />
        </button>
      </div>
      <label className="thread-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
        />
      </label>
      {threads?.error && (
        <p className="sidebar-error">
          Conversation sync unavailable. Check your runtime connection.
        </p>
      )}
      {visibleThreads.map((thread) => {
        const remote = remoteList.find((item) => item.id === thread.id);
        const agentDot = (dots || []).find((dot) => dot.id === thread.dotId);
        return (
          <div
            key={thread.id}
            className={`thread-row ${selected === thread.id ? 'active' : ''}`}
          >
            {onRename && (
              <button
                className="icon-button thread-rename"
                aria-label={`Rename ${remote?.name || thread.title || 'conversation'}`}
                title="Rename conversation"
                onClick={async (event) => {
                  event.stopPropagation();
                  const title = await promptText({
                    title: 'Rename conversation',
                    label: 'Conversation name',
                    defaultValue: remote?.name || thread.title || '',
                    confirmLabel: 'Rename',
                  });
                  if (title?.trim()) onRename(thread.id, title.trim());
                }}
              >
                <Pencil size={13} />
              </button>
            )}
            {onDelete && (
              <button
                className="icon-button thread-delete"
                aria-label={`Delete ${remote?.name || thread.title || 'conversation'}`}
                title="Delete conversation"
                onClick={(event) => {
                  event.stopPropagation();
                  if (window.confirm(`Delete “${remote?.name || thread.title || 'conversation'}”? This cannot be undone.`)) {
                    onDelete(thread.id);
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
            <button
              className="nav-item"
              onClick={() => onSelect(thread.id)}
            >
              <MessageCircle size={15} />
              <span className="thread-summary">
                <span>{remote?.name || thread.title || 'Untitled conversation'}</span>
                <small>{agentDot?.name || 'Aegis'}</small>
              </span>
            </button>
          </div>
        );
      })}
      {(local || []).length === 0 && (
        <p className="sidebar-empty">Your first conversation will live here.</p>
      )}
      {(local || []).length > 0 && visibleThreads.length === 0 && (
        <p className="sidebar-empty">No chats match “{query}”.</p>
      )}
      {threads?.hasMoreThreads && (
        <button
          className="text-button"
          disabled={threads.isFetchingMoreThreads}
          onClick={() => void threads.fetchMoreThreads?.()}
        >
          Load more conversations
        </button>
      )}
    </section>
  );
}
