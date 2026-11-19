import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  Code2,
  Lock,
  Play,
  Plus,
  Shield,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react';
import {
  approveHarnessAction,
  createHarnessSession,
  getHarnessMessages,
  getHarnessSessions,
  getHarnessStatus,
  sendHarnessPrompt,
  type HarnessMessage,
  type HarnessSession,
  type HarnessStatusResponse,
} from './api';
import { submitComposerOnEnter } from './chat-composer';

function messageText(message: HarnessMessage): string {
  if (typeof message.text === 'string' && message.text) return message.text;
  if (Array.isArray(message.content))
    return message.content
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('\n');
  return '';
}

export function HarnessPanel() {
  const [status, setStatus] = useState<HarnessStatusResponse>();
  const [sessions, setSessions] = useState<HarnessSession[]>([]);
  const [selected, setSelected] = useState<string>();
  const [messages, setMessages] = useState<HarnessMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [error, setError] = useState('');
  const awaitingCount = useRef(0);

  const loadStatus = useCallback(async () => {
    try {
      const next = await getHarnessStatus();
      setStatus(next);
      // A successful probe means whatever went wrong before is over; without this
      // the banner stayed up for the rest of the session after one failed poll.
      setError('');
      if (next.running) {
        const list = await getHarnessSessions();
        const available = list.data ?? [];
        setSessions(available);
        if (!selected && available.length > 0) {
          setSelected(available[0].id);
        }
      } else {
        setSessions([]);
      }
    } catch (cause) {
      setStatus(undefined);
      setSessions([]);
      setError(
        cause instanceof Error ? cause.message : 'Could not load the harness.',
      );
    }
  }, [selected]);

  useEffect(() => {
    void loadStatus();
    // Poll quickly while a reply is in flight and slowly when idle, so an answer
    // that takes a minute does not sit invisible behind a 5s tick.
    const timer = setInterval(
      () => void loadStatus(),
      awaiting || busy ? 1500 : 5000,
    );
    return () => clearInterval(timer);
  }, [loadStatus, awaiting, busy]);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const result = await getHarnessMessages(sessionId);
      const next = result.data ?? [];
      setMessages(next);
      if (awaitingCount.current > 0) {
        const last = next[next.length - 1];
        if (next.length > awaitingCount.current && last?.type === 'assistant') {
          setAwaiting(false);
          awaitingCount.current = 0;
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load messages.',
      );
    }
  }, []);

  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    void loadMessages(selected);
    if (!awaiting) return;
    const timer = setInterval(() => void loadMessages(selected), 2000);
    return () => clearInterval(timer);
  }, [selected, awaiting, loadMessages]);

  const createSession = async () => {
    setBusy(true);
    setError('');
    try {
      const created = await createHarnessSession();
      setSessions((list) => [created.data, ...list]);
      setSelected(created.data.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not create a session.',
      );
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!selected || !prompt.trim() || busy) return;
    const text = prompt.trim();
    setBusy(true);
    setError('');
    try {
      await sendHarnessPrompt(selected, text);
      setPrompt('');
      awaitingCount.current = messages.length;
      setAwaiting(true);
      await loadMessages(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  const handleApproval = async (approvalId: string, approved: boolean) => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await approveHarnessAction(selected, approvalId, approved);
      await loadMessages(selected);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not update approval state.',
      );
    } finally {
      setBusy(false);
    }
  };

  const insertPrefix = (prefix: string) => {
    setPrompt((prev) => (prev.startsWith(prefix) ? prev : `${prefix}${prev}`));
  };

  const isNative = status?.engine === 'native';

  return (
    <div className="harness-panel">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {'NATIVE EXECUTION HARNESS'}
          </span>
          <h1>Harness {isNative ? '(Built-in)' : '(Sidecar)'}</h1>
          <p>
            {status === undefined
              ? 'Probing execution harness '
              : isNative
                ? 'Native built-in execution active (Node / Python / Shell / Tools)'
                : `Native engine ${status.version ?? ''}   ${status.url}`}
          </p>
        </div>
        <button
          className="primary"
          disabled={!status?.running || busy}
          onClick={() => void createSession()}
        >
          <Plus size={15} />
          New session
        </button>
      </div>

      {/* Runtimes & Security Capabilities Bar */}
      {status?.running && (
        <div className="harness-capabilities-bar">
          <div className="runtime-badges">
            {status.runtimes?.node && (
              <span className="runtime-badge">
                <Code2 size={13} /> Node.js {status.runtimes.node}
              </span>
            )}
            {status.runtimes?.shell && (
              <span className="runtime-badge">
                <TerminalIcon size={13} /> Shell ({status.runtimes.shell})
              </span>
            )}
            {status.runtimes?.python && (
              <span className="runtime-badge">
                <Play size={13} /> Python ({status.runtimes.python})
              </span>
            )}
            {!status.runtimes?.node &&
              !status.runtimes?.python &&
              !status.runtimes?.shell && (
                <span className="runtime-badge">
                  No runtimes reported by the execution engine
                </span>
              )}
            <span className="runtime-badge security">
              <Shield size={13} /> Approval Gate: Enforced
            </span>
          </div>
          <span className="engine-label">
            Engine: {isNative ? 'Aegis Native Execution' : 'Native Execution'}
          </span>
        </div>
      )}

      {status && !status.running && (
        <div className="large-empty">
          <h2>Harness is unavailable.</h2>
          <p>{status.detail}</p>
        </div>
      )}

      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}

      {status?.running && (
        <div className="harness-layout">
          <div className="task-list">
            {sessions.map((session) => (
              <button
                key={session.id}
                className={`nav-item ${selected === session.id ? 'active' : ''}`}
                onClick={() => setSelected(session.id)}
              >
                <span>{session.title || session.id}</span>
              </button>
            ))}
            {!sessions.length && (
              <p className="muted">
                No harness sessions yet. Click "New session" to start.
              </p>
            )}
          </div>

          {selected ? (
            <div className="chat-column">
              <div className="harness-messages">
                {messages.map((message) => {
                  const hasPendingApproval =
                    message.approval && message.approval.status === 'pending';
                  const textContent = messageText(message);

                  return (
                    <article className="memory-card" key={message.id}>
                      <div className="harness-msg-header">
                        <small className="harness-msg-type">
                          {message.type ?? 'message'}
                        </small>
                        {message.approval && (
                          <span
                            className={`approval-status-pill ${message.approval.status}`}
                          >
                            <Lock size={11} />
                            {message.approval.status.toUpperCase()}
                          </span>
                        )}
                      </div>

                      <div className="harness-msg-text">
                        <p>{textContent || '(no text)'}</p>
                      </div>

                      {/* Interactive Approval Gate Card */}
                      {hasPendingApproval && message.approval && (
                        <div className="harness-approval-gate">
                          <div className="approval-gate-banner">
                            <Shield size={16} />
                            <div>
                              <strong>
                                Approval Required: Execute{' '}
                                {message.approval.runtime.toUpperCase()} Command
                              </strong>
                              <p className="approval-reason">
                                {message.approval.reason ??
                                  'Confirm execution in Aegis workspace root.'}
                              </p>
                            </div>
                          </div>

                          <pre className="approval-cmd-preview">
                            {message.approval.command}
                          </pre>

                          <div className="approval-gate-actions">
                            <button
                              type="button"
                              className="approve-btn"
                              disabled={busy}
                              onClick={() =>
                                void handleApproval(message.approval!.id, true)
                              }
                            >
                              <Check size={14} /> Approve & Execute
                            </button>
                            <button
                              type="button"
                              className="reject-btn"
                              disabled={busy}
                              onClick={() =>
                                void handleApproval(message.approval!.id, false)
                              }
                            >
                              <X size={14} /> Reject
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Native Execution Output Block */}
                      {message.execution && (
                        <div className="harness-execution-box">
                          <div className="exec-meta-bar">
                            <span className="runtime-tag">
                              {message.execution.runtime.toUpperCase()}
                            </span>
                            <span
                              className={`exit-tag ${message.execution.exitCode === 0 ? 'success' : 'error'}`}
                            >
                              Exit {message.execution.exitCode}
                            </span>
                            <span className="duration-tag">
                              {message.execution.durationMs}ms
                            </span>
                          </div>

                          {message.execution.stdout && (
                            <pre className="exec-stdout">
                              {message.execution.stdout}
                            </pre>
                          )}
                          {message.execution.stderr && (
                            <pre className="exec-stderr">
                              {message.execution.stderr}
                            </pre>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}

                {!messages.length && (
                  <p className="muted">No messages in this session yet.</p>
                )}
                {awaiting && <p className="muted">Waiting for execution response </p>}
              </div>

              {/* Quick Input Helper Chips */}
              <div className="harness-prompt-shortcuts">
                <span className="shortcuts-label">Run Prefix:</span>
                <button
                  type="button"
                  className="shortcut-chip"
                  onClick={() => insertPrefix('$ ')}
                >
                  $ Shell
                </button>
                <button
                  type="button"
                  className="shortcut-chip"
                  onClick={() => insertPrefix('node: ')}
                >
                  node: JS
                </button>
                <button
                  type="button"
                  className="shortcut-chip"
                  onClick={() => insertPrefix('python: ')}
                >
                  python: Py
                </button>
                <button
                  type="button"
                  className="shortcut-chip"
                  onClick={() => insertPrefix('tool: ')}
                >
                  tool: MCP
                </button>
              </div>

              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <textarea
                  aria-label="Message the harness"
                  placeholder="Enter prompt or command (e.g. $ git status, node: 2 + 2, python: print('hi'))..."
                  value={prompt}
                  maxLength={20000}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) =>
                    submitComposerOnEnter(event, !busy && !!prompt.trim())
                  }
                />
                <div className="composer-bottom">
                  <span>
                    {isNative
                      ? 'Aegis Native Execution Session (Approval-gated)'
                      : 'Native harness session'}
                  </span>
                  <button
                    className="send-button"
                    aria-label="Send to harness"
                    disabled={busy || !prompt.trim()}
                  >
                    <ArrowUp size={19} />
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <p className="muted">Select a session to start native execution.</p>
          )}
        </div>
      )}
    </div>
  );
}
