import { useCallback, useEffect, useState } from 'react';
import {
  Inbox,
  Loader2,
  Mail,
  Reply,
  Send,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api } from './api';

interface MailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  kind: string;
  subject?: string;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
  taskId?: string;
  requiresApproval?: boolean;
}

interface MailMessage extends MailSummary {
  body?: string;
}

interface ThreadMeta {
  threadId: string;
  subject?: string;
  lastAt: string;
  unread: number;
}

const KIND_LABEL: Record<string, string> = {
  task: 'Task',
  handoff: 'Handoff',
  question: 'Question',
  verification: 'Verification',
  reply: 'Reply',
  progress: 'Progress',
  report: 'Report',
  'approval-request': 'Approval request',
  'approval-decision': 'Approval decision',
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function displayName(address: string): string {
  if (address === 'user@aegis') return 'You';
  if (address === 'orchestrator@aegis') return 'Aegis Orchestrator';
  const match = /^agent\/([^@]+)@aegis$/.exec(address);
  return match ? `Agent · ${match[1]}` : address;
}

export function AgentMailPanel({ mailboxAddress }: { mailboxAddress: string }) {
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [activeThread, setActiveThread] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [sending, setSending] = useState(false);

  const refreshThreads = useCallback(async () => {
    try {
      const data = await api<{ threads: ThreadMeta[] }>(
        `/mail/me?address=${encodeURIComponent(mailboxAddress)}`,
      );
      setThreads(data.threads ?? []);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load mail.');
    } finally {
      setLoading(false);
    }
  }, [mailboxAddress]);

  useEffect(() => {
    void refreshThreads();
    const timer = window.setInterval(() => void refreshThreads(), 15000);
    return () => window.clearInterval(timer);
  }, [refreshThreads]);

  const openThread = useCallback(
    async (threadId: string) => {
      setActiveThread(threadId);
      setDetailLoading(true);
      setError('');
      try {
        const data = await api<{ messages: MailSummary[] }>(
          `/mail/thread?threadId=${encodeURIComponent(threadId)}&address=${encodeURIComponent(mailboxAddress)}`,
        );
        const loaded: MailMessage[] = [];
        for (const summary of data.messages ?? []) {
          const full = await api<MailMessage>(
            `/mail/message/${summary.id}?address=${encodeURIComponent(mailboxAddress)}`,
          );
          loaded.push(full);
        }
        setMessages(loaded);
        await refreshThreads();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not open thread.');
      } finally {
        setDetailLoading(false);
      }
    },
    [mailboxAddress, refreshThreads],
  );

  const sendReply = async () => {
    const text = replyDraft.trim();
    if (!text || sending || !messages.length) return;
    const last = messages[0];
    const recipient = last.from === mailboxAddress ? last.to[0] ?? 'orchestrator@aegis' : last.from;
    setSending(true);
    setError('');
    try {
      await api('/mail/send', 'POST', {
        from: mailboxAddress,
        to: [recipient],
        subject: last.subject?.startsWith('Re:') ? last.subject : `Re: ${last.subject ?? 'thread'}`,
        body: text,
        kind: 'reply',
        threadId: last.threadId,
        inReplyTo: last.id,
        taskId: last.taskId,
      });
      setReplyDraft('');
      await openThread(last.threadId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send reply.');
    } finally {
      setSending(false);
    }
  };

  const removeMessage = async (message: MailMessage) => {
    if (!window.confirm('Delete this mail message?')) return;
    try {
      await api(`/mail/${message.id}?address=${encodeURIComponent(mailboxAddress)}`, 'DELETE');
      await refreshThreads();
      if (activeThread) await openThread(activeThread);
    } catch {
      setError('Could not delete the message.');
    }
  };

  return (
    <div className="ag-mail-panel">
      <div className="ag-mail-layout">
        <div className="ag-mail-threads" aria-label="Mail threads">
          <div className="ag-list-head">
            <span>
              <Inbox size={14} /> Queries &amp; mail
            </span>
            <em>{threads.length} threads</em>
          </div>
          {loading ? (
            <div className="ag-empty compact">
              <Loader2 size={16} className="ag-spin" /> Loading mail
            </div>
          ) : threads.length === 0 ? (
            <div className="ag-empty compact">
              <Mail size={17} />
              <p>No mail yet. Orchestrator queries and agent replies land here.</p>
            </div>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.threadId}
                type="button"
                className={`ag-mail-thread ${activeThread === thread.threadId ? 'active' : ''}`}
                onClick={() => void openThread(thread.threadId)}
              >
                <span className="ag-mail-thread-copy">
                  <strong>{thread.subject || 'Untitled thread'}</strong>
                  <small>{formatWhen(thread.lastAt)}</small>
                </span>
                {thread.unread > 0 && (
                  <span className="ag-mail-unread">{thread.unread}</span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="ag-mail-detail">
          {!activeThread ? (
            <div className="ag-empty">
              <Inbox size={22} />
              <p>
                Select a thread to read the orchestrator's queries and agent
                replies (markdown mail).
              </p>
            </div>
          ) : detailLoading ? (
            <div className="ag-empty">
              <Loader2 size={18} className="ag-spin" /> Reading thread
            </div>
          ) : messages.length === 0 ? (
            <div className="ag-empty">
              <p>This thread is empty.</p>
            </div>
          ) : (
            <>
              <div className="ag-mail-messages">
                {messages.map((message) => (
                  <article key={message.id} className="ag-mail-message">
                    <header className="ag-mail-message-head">
                      <span className="ag-mail-kind">{KIND_LABEL[message.kind] || message.kind}</span>
                      <span className="ag-mail-from">{displayName(message.from)}</span>
                      <span className="ag-mail-time">{formatWhen(message.createdAt)}</span>
                      <button
                        type="button"
                        className="ag-icon-button"
                        aria-label="Delete message"
                        title="Delete message"
                        onClick={() => void removeMessage(message)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </header>
                    {message.subject && <strong className="ag-mail-subject">{message.subject}</strong>}
                    <div className="ag-markdown">
                      {message.body ? (
                        <ReactMarkdown>{message.body}</ReactMarkdown>
                      ) : (
                        <p className="muted">(body not loaded)</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              <div className="ag-mail-reply">
                <textarea
                  value={replyDraft}
                  onChange={(event) => setReplyDraft(event.target.value)}
                  placeholder={`Reply to ${displayName(messages[0].from)}…`}
                  rows={3}
                  aria-label="Reply to this mail thread"
                />
                <button
                  type="button"
                  className="ag-button primary"
                  disabled={sending || !replyDraft.trim()}
                  onClick={() => void sendReply()}
                >
                  {sending ? <Loader2 size={14} className="ag-spin" /> : <Reply size={14} />}
                  Send reply
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {error && (
        <div className="ag-banner" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function AgentSendComposer({
  onSent,
  mailboxAddress,
}: {
  onSent: () => void;
  mailboxAddress: string;
}) {
  const [draft, setDraft] = useState('');
  const [to, setTo] = useState('orchestrator@aegis');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [agents, setAgents] = useState<Array<{ address: string; name: string; role: string }>>([]);

  useEffect(() => {
    void api<{ agents: Array<{ address: string; name: string; role: string }> }>('/mail/agents')
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => undefined);
  }, []);

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/mail/send', 'POST', {
        from: mailboxAddress,
        to: [to],
        subject: text.slice(0, 80),
        body: text,
        kind: 'task',
      });
      setDraft('');
      onSent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="ag-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder="Give the team a task — e.g. Review NVDA before earnings and list the risks from today’s news."
        rows={2}
        aria-label="Agent task prompt"
      />
      <div className="ag-composer-row">
        <label className="ag-select">
          <Mail size={14} />
          <select value={to} onChange={(event) => setTo(event.target.value)} aria-label="Mail recipient">
            <option value="orchestrator@aegis">To: Aegis Orchestrator</option>
            {agents.map((agent) => (
              <option key={agent.address} value={agent.address}>
                To: {agent.name} — {agent.role}
              </option>
            ))}
          </select>
        </label>
        <span className="ag-composer-hint">Enter to send · Shift+Enter for a new line</span>
        <button type="submit" className="ag-button primary" disabled={busy || !draft.trim()}>
          {busy ? <Loader2 size={14} className="ag-spin" /> : <Send size={14} />}
          Send task
        </button>
      </div>
      {error && <div className="ag-banner" role="alert">{error}</div>}
    </form>
  );
}
