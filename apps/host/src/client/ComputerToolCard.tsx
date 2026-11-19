import { useEffect, useState } from 'react';
import { ArrowUpRight, FileText, Monitor, Terminal } from 'lucide-react';
import { z } from 'zod';
import { api } from './api';

const screenSchema = z.object({
  base64: z
    .string()
    .regex(/^[A-Za-z0-9+/=]+$/)
    .max(4_000_000),
  url: z.string(),
  format: z.string().optional(),
});
export type ComputerToolRenderProps = {
  name: string;
  toolCallId: string;
  status: string;
  args?: unknown;
  result?: unknown;
};
const labels: Record<string, string> = {
  navigate: 'Opening website',
  snapshot: 'Inspecting browser',
  read: 'Reading page',
  screenshot: 'Viewing browser',
  click: 'Clicking in browser',
  type: 'Typing in browser',
  key: 'Using keyboard',
  scroll: 'Scrolling page',
  files_write: 'Saving file',
  files_read: 'Reading file',
  files_list: 'Listing files',
  exec: 'Running terminal command',
  human_click: 'Clicking in browser',
  human_type: 'Typing in browser',
  human_key: 'Using keyboard',
  human_scroll: 'Scrolling page',
};
export function computerToolResult(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { error: raw };
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw))
    : {};
}
export function ComputerToolCard({
  name,
  status,
  args,
  result,
  dotId,
  dotName,
  showScreen,
  running,
  onExpand,
}: ComputerToolRenderProps & {
  dotId: string;
  dotName: string;
  showScreen: boolean;
  running: boolean;
  onExpand?: () => void;
}) {
  const [screen, setScreen] = useState<z.infer<typeof screenSchema>>();
  const [screenError, setScreenError] = useState('');
  const action = name.replace(/^computer_/, '');
  const data = computerToolResult(result);
  const parameters = computerToolResult(args);
  const interrupted =
    data.status === 'stopped' || data.reason === 'stop_requested';
  const error =
    typeof data.error === 'string'
      ? data.error
      : data.status === 'error' && typeof data.message === 'string'
        ? data.message
        : '';
  const interruption =
    interrupted && typeof data.message === 'string' ? data.message : '';
  const complete = status === 'complete';
  const failed =
    data.status === 'error' ||
    !!error ||
    (typeof data.exitCode === 'number' && data.exitCode !== 0);
  const state = interrupted
    ? 'Interrupted'
    : failed
      ? 'Needs attention'
      : complete
        ? 'Finished'
        : running
          ? 'Working'
          : 'Interrupted';
  const detail =
    typeof parameters.url === 'string'
      ? parameters.url
      : typeof parameters.path === 'string'
        ? parameters.path
        : typeof parameters.command === 'string'
          ? parameters.command
          : '';
  // AEGIS (W-GEN): a screenshot carried by THIS call's own result (the
  // computer_screenshot action returns {base64, url,  }) renders inline
  // here, in addition to the live current-browser view below that the
  // latest browser-ish call polls for.
  const resultScreen =
    complete && typeof data.base64 === 'string'
      ? screenSchema.safeParse({
          base64: data.base64,
          url: typeof data.url === 'string' ? data.url : '',
          format: typeof data.format === 'string' ? data.format : undefined,
        })
      : null;
  useEffect(() => {
    // AEGIS (W-FIX 2a): the live screen poll runs ONLY while the agent
    // run that produced this card is still in progress. Previously it
    // kept screenshotting every 3s for as long as the card stayed on
    // screen   screenshots the owner never asked for, and a stream of
    // "Computer permission is disabled" errors once permission was off.
    if (!showScreen || !running) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setScreen(undefined);
    setScreenError('');
    const refresh = async () => {
      if (!document.hidden) {
        try {
          const value = await api<unknown>(
            `/dots/${encodeURIComponent(dotId)}/computer/actions`,
            'POST',
            { action: 'screenshot', input: {} },
            controller.signal,
          );
          const next = screenSchema.parse(value);
          if (!controller.signal.aborted) {
            setScreen(next);
            setScreenError('');
          }
        } catch (cause) {
          if (!controller.signal.aborted) {
            setScreen(undefined);
            setScreenError(
              cause instanceof Error
                ? cause.message
                : 'AEGIS Computer preview unavailable.',
            );
          }
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void refresh(), 3000);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [dotId, showScreen, running]);
  const Icon =
    action === 'exec'
      ? Terminal
      : action.startsWith('files_')
        ? FileText
        : Monitor;
  return (
    <section
      className={`inline-computer ${showScreen ? 'with-screen' : ''}`}
      aria-label={`${dotName} AEGIS Computer: ${labels[action] ?? action}`}
    >
      <header>
        <Icon size={16} aria-hidden="true" />
        <strong>{labels[action] ?? 'Using AEGIS Computer'}</strong>
        <span className={failed ? 'tool-state failed' : 'tool-state'}>
          {state}
        </span>
        {onExpand && (
          <button
            type="button"
            aria-label={`Expand ${dotName} AEGIS Computer`}
            onClick={onExpand}
          >
            <ArrowUpRight size={16} />
          </button>
        )}
      </header>
      {detail && (
        <div className="inline-computer-detail" title={detail}>
          {detail}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {interruption && <p role="status">{interruption}</p>}
      {action === 'exec' && complete && typeof data.stdout === 'string' && (
        <pre aria-label="Computer terminal output">
          {data.stdout.slice(0, 4000)}
        </pre>
      )}
      {action === 'exec' &&
        complete &&
        typeof data.stderr === 'string' &&
        data.stderr && <pre>{data.stderr.slice(0, 2000)}</pre>}
      {resultScreen?.success && (
        <div className="inline-computer-preview">
          <div className="inline-computer-caption">
            <span className="live-indicator" />
            Screenshot returned by this action
          </div>
          <img
            src={`data:${resultScreen.data.format ?? 'image/png'};base64,${resultScreen.data.base64}`}
            alt={`Screenshot from ${dotName}'s AEGIS Computer`}
          />
          {resultScreen.data.url && (
            <div className="inline-computer-url">{resultScreen.data.url}</div>
          )}
        </div>
      )}
      {showScreen && (
        <div className="inline-computer-preview">
          <div className="inline-computer-caption">
            <span className="live-indicator" />
            {dotName} s AEGIS Computer   Current browser view   engine:
            Playwright
          </div>
          {screen && (
            <img
              src={`data:${screen.format ?? 'image/png'};base64,${screen.base64}`}
              alt={`Current browser view from ${dotName}'s AEGIS Computer`}
            />
          )}
          {screenError ? (
            <p role="status">{screenError}</p>
          ) : (
            !screen && <p role="status">Connecting to AEGIS Computer </p>
          )}
          {screen && <div className="inline-computer-url">{screen.url}</div>}
        </div>
      )}
    </section>
  );
}
