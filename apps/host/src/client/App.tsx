import { openPageLink } from './page-navigation';
import { PromptHost, promptText } from './PromptDialog';
import { SpaceNav } from './SpaceNav';
import { SpaceWorkspace } from './SpaceWorkspace';
import { useCallback, useEffect, useState, useRef, type ReactNode } from 'react';
import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import {
  ArrowUp,
  ArrowUpRight,
  Bot,
  Clock3,
  FlaskConical,
  Menu,
  MessageCircle,
  Mic,
  Monitor,
  FolderOpen,
  MoreHorizontal,
  FileText,
  Paperclip,
  Pause,
  PanelLeft,
  Play,
  PlugZap,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Brain,
  Boxes,
  Sparkles,
  Terminal as TerminalIcon,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  Conversation,
  Detail,
  Dot,
  Result,
  State,
  WorkspaceState,
} from '../shared/types';
import {
  api,
  ApiError,
  authHeaders,
  isOffline,
  OFFLINE_MESSAGE,
  setToken,
  type SwarmAgentId,
} from './api';
import { trackSetupStep } from './setup-telemetry';
import {
  applyCaptureResult,
  applyRefreshResult,
  dismissNotice,
  visibleNotice,
  type Notices,
} from './poll-notice';
import { Mascot } from './Mascot';
import { MascotPet, characterForAgent } from './MascotPet';
import type { CharacterName } from 'aegis-mascot';
import { VoiceOS } from './VoiceOS';
import { DesktopVoiceCommand, VoiceSessionProvider } from './voiceSession';
import { persistVoiceTurn } from './voiceTranscript';
import { useWakeWord } from './useWakeWord';
import { readAloud, stopReadAloud } from './read-aloud';
import { Chat, type ChatAttachment, attachmentFromFile } from './Chat';
import { ThreadList } from './ThreadList';
import { ResultPane } from './ResultPane';
import { TaskRow } from './TaskPresentation';
import { TaskActions } from './TaskActions';
import { WorkspaceDialog, type Dialog } from './WorkspaceDialog';
import { ComputerPanel } from './ComputerPanel';
import { ServicesStatus } from './ServicesStatus';
import { ResearchPanel } from './ResearchPanel';
import { AgentsWorkspace } from './AgentsWorkspace';
import { HarnessPanel } from './HarnessPanel';
import { SightlineView } from './SightlineView';
import { SettingsForm } from './SettingsForm';
import { MemoryPanel } from './MemoryPanel';
import { InlineVoiceBar } from './InlineVoiceBar';
import { FilesSurfaceView } from './FilesSurfaceView';
import { PenBoardPanel } from './PenBoardPanel';
// The widget gallery render branch was unreachable (no rail entry), so only the
// shared payload types remain: the desktop broadcast below still mirrors them.
import type { DesktopStatus, DesktopWidgets } from './WidgetsPanel';
import { ActivityView } from './ActivityView';
import { IntegrationsView } from './IntegrationsView';
import { WhatsAppCard } from './WhatsAppCard';
import { AgentOnboardingModal, type EncryptedVaultRecord } from './AgentOnboardingModal';
import { submitComposerOnEnter } from './chat-composer';
import {
  AGENT_ALIASES,
  AGENT_LABELS,
  NAV_COMMANDS,
  SLASH_COMMANDS,
  tokenBeforeCaret,
  type SlashCommand,
} from './slash-commands';
import { adoptServerSoundPreference, playCue } from './sounds';
import { FinancePage } from './FinancePage';

// Breadcrumb titles for every view. The old chain fell through to "Memory"
// for Files, Terminal, Research, Connections, Agents and the Harness.
const VIEW_TITLES: Record<string, string> = {
  chat: 'Conversation',
  tasks: 'Activity',
  space: 'Pages',
  computer: 'Computer',
  browser: 'Browser',
  memories: 'Memory',
  ops: 'Operations',
  integrations: 'Integrations',
  settings: 'Settings',
  files: 'Files',
  research: 'Research',
  agents: 'Agents',
  harness: 'Harness',
  finance: 'Finance',
  sightline: '3D Library',
}
// Width of the fixed icon rail. The sidebar starts right after it and the
// workspace margin must equal rail + sidebar width, or the panels overlap.
const RAIL_WIDTH = 52;

// Every destination lives in the sidebar. There is no bottom tray: the
// previous two-column tray hid most of these behind tiny 10px rows and made
// the owner hunt for Browser / Files / Terminal. Related surfaces are merged
// into one entry each (Operations = terminal+tools+activity; Integrations =
// marketplace+connections+plugins+oauth).
//
// The AEGIS Computer deliberately does NOT live here. It belongs to the
// conversation: it opens from the header monitor button (or /computer) into
// the chat-side preview pane, so working on a task never takes the owner away
// from the thread that asked for it.
const SURFACE_VIEWS = [
  { id: 'chat', label: 'Conversation', icon: MessageCircle },
  { id: 'agents', label: 'Agents', icon: Bot },
  // The Harness is the execution engine with its own sessions and approval
  // gate, so it gets its own rail entry instead of hiding as a tab in Agents.
  { id: 'harness', label: 'Harness', icon: TerminalIcon },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'memories', label: 'Memory', icon: Brain },
  { id: 'research', label: 'Research', icon: FlaskConical },
  { id: 'finance', label: 'Finance', icon: TrendingUp },
  { id: 'sightline', label: '3D Library', icon: Boxes },
  { id: 'integrations', label: 'Integrations', icon: PlugZap },
] as const;

function describeFailure(error: unknown, fallback: string) {
  return {
    ok: false as const,
    status: error instanceof ApiError ? error.status : undefined,
    message: error instanceof Error ? error.message : fallback,
  };
}

const STARTER_SUGGESTION_SETS = [
  ['Help me think through this decision', 'Research the latest on a topic', 'Turn a goal into clear steps'],
  ['Summarize a file I add', 'Compare these options', 'Build a plan for this week'],
  ['Explain a difficult concept', 'Find recent news on a topic', 'Create a focused checklist'],
  ['Draft a message for me', 'Search my workspace files', 'Analyze this dataset'],
] as const;

export function App() {
  const [state, setState] = useState<State>();
  const [starterSuggestions] = useState(() =>
    STARTER_SUGGESTION_SETS[Math.floor(Math.random() * STARTER_SUGGESTION_SETS.length)],
  );
  const [voiceOpen, setVoiceOpen] = useState(false);
  // WhatsApp lives inside the conversation now: the same card that pairs a
  // device and reports the real connection state, not a separate page.
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [voiceAutoStart, setVoiceAutoStart] = useState(false);
  const [latestReply, setLatestReply] = useState('');


  // === All view/state declarations moved up to avoid temporal dead zone errors ===
  // rawSetView, setIntegrationsTab, setPane, setError, setNavCollapsed,
  // setEmptyInlineVoice, setInlineVoiceToken, isAnyVoiceActive are referenced
  // in useCallback/useEffect dependency arrays before their original declarations.
  const [view, rawSetView] = useState<
    | 'chat'
    | 'tasks'
    | 'memories'
    | 'space'
    | 'computer'
    | 'browser'
    | 'tools'
    | 'marketplace'
    | 'settings'
    | 'files'
    | 'terminal'
    | 'research'
    | 'connections'
    | 'agents'
    | 'harness'
    | 'finance'
    | 'integrations'
    | 'sightline'
  >('chat');
  const [integrationsTab, setIntegrationsTab] = useState<
    'marketplace' | 'connections' | 'tools' | 'oauth'
  >('marketplace');
  const [pane, setPane] = useState(false);
  const [notices, setNotices] = useState<Notices>({
    refresh: '',
    capture: '',
    action: '',
  });
  const error = visibleNotice(notices);
  const setError = (action: string) =>
    setNotices((current) =>
      current.action === action ? current : { ...current, action },
    );
  const [navCollapsed, setNavCollapsed] = useState(() => {
    const saved = localStorage.getItem('aegis_sidebar_collapsed');
    return saved ? saved === 'true' : false;
  });
  const [emptyInlineVoice, setEmptyInlineVoice] = useState(false);
  const [chatInlineVoice, setChatInlineVoice] = useState(false);
  const [inlineVoiceToken, setInlineVoiceToken] = useState(0);
  const isAnyVoiceActive = Boolean(emptyInlineVoice || chatInlineVoice || voiceOpen);

  const openVoice = useCallback((_autoStart = true) => {
    rawSetView('chat');
    setEmptyInlineVoice(true);
    setInlineVoiceToken((t) => t + 1);
  }, []);

  // Slash-command navigation from the chat composer (e.g. /settings).
  // Wrapped in useCallback so the listener identity stays stable across
  // re-renders, preventing orphaned listeners when views switch rapidly.
  const onNav = useCallback((event: Event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (detail === 'swarm' || detail === 'agent' || detail === 'agents') {
      rawSetView('agents');
      return;
    }
    if (detail === 'settings') {
      rawSetView('settings');
      return;
    }
    if (detail === 'files') {
      rawSetView('files');
      return;
    }
    // The reference directory and the standalone WhatsApp page were removed.
    // /reference now lands on the Agents workspace; /whatsapp opens the
    // WhatsApp panel inside the conversation it belongs to.
    if (detail === 'reference' || detail === 'directory' || detail === 'ecosystem') {
      rawSetView('agents');
      return;
    }
    if (detail === 'whatsapp') {
      rawSetView('chat');
      window.dispatchEvent(new CustomEvent('aegis:whatsapp', { detail: true }));
      return;
    }
    if (detail === 'connections' || detail === 'tools' || detail === 'marketplace') {
      setIntegrationsTab(detail);
      rawSetView('integrations');
      return;
    }
    if (detail === 'harness') {
      rawSetView('harness');
      return;
    }
    if (detail === 'tasks' || detail === 'activity') {
      rawSetView('tasks');
      return;
    }
    if (detail === 'terminal' || detail === 'ops') {
      rawSetView('terminal');
      return;
    }
    // Computer and Browser are not separate destinations any more: they
    // open as the in-chat panel so the conversation stays the workspace.
    if (detail === 'computer' || detail === 'browser') {
      rawSetView('chat');
      setPane(true);
      return;
    }
    const target = SURFACE_VIEWS.find((item) => item.id === detail);
    if (target) rawSetView(target.id);
  }, [rawSetView, setIntegrationsTab, setPane]);
    useEffect(() => {
    window.addEventListener('aegis:nav', onNav);
    return () => window.removeEventListener('aegis:nav', onNav);
  }, [onNav]);
  const onCallWidget = useCallback((event: Event) => {
    const name = String((event as CustomEvent<string>).detail || '').trim();
    if (!name) {
      setError('Widget name is required.');
      return;
    }
    const bridge = (
      window as unknown as {
        aegis?: { action?: (action: string, data: unknown) => void };
      }
    ).aegis;
    if (bridge?.action) {
      try {
        bridge.action('call-widget', { name });
      } catch (error) {
        setError(
          `Failed to call widget "${name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      // Browser-only run (no desktop shell): the widget gallery lives on
      // the desktop notch, so say so instead of silently doing nothing.
      setError(
        `Widget "${name}" lives on the Aegis desktop notch — open the desktop app to use it.`,
      );
    }
  }, [setError]);
  useEffect(() => {
    window.addEventListener('aegis:call-widget', onCallWidget);
    return () => window.removeEventListener('aegis:call-widget', onCallWidget);
  }, [onCallWidget]);
  const onWhatsApp = useCallback(() => {
    rawSetView('chat');
    setWhatsappOpen(true);
  }, [rawSetView, setWhatsappOpen]);
  useEffect(() => {
    window.addEventListener('aegis:whatsapp', onWhatsApp);
    return () => window.removeEventListener('aegis:whatsapp', onWhatsApp);
  }, [onWhatsApp]);
  const onSidebar = useCallback((event: Event) => {
    const detail = (event as CustomEvent<boolean>).detail;
    if (detail) {
      userCollapsedRef.current = false;
      setNavCollapsed(false);
    }
  }, [setNavCollapsed]);
  useEffect(() => {
    window.addEventListener('aegis:sidebar', onSidebar);
    return () => window.removeEventListener('aegis:sidebar', onSidebar);
  }, [onSidebar]);
  const wake = useWakeWord({
    enabled: state?.settings.wakeWordEnabled ?? false,
    language: state?.settings.voiceLanguage ?? 'auto',
    onWake: () => openVoice(true),
  });
  useEffect(() => {
    const bridge = (
      window as unknown as {
        aegis?: { onOpenVoice?: (callback: () => void) => () => void };
      }
    ).aegis;
    const off = bridge?.onOpenVoice?.(() => window.dispatchEvent(new Event('aegis:desktop-voice')));
    return () => off?.();
  }, [openVoice]);
  // Sound cues follow the persisted server preference, and every task that
  // finishes while the window is open gets a distinct success/error cue.
  const taskStatuses = useRef(new Map<string, string>());
  const lastPaused = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!state) return;
    adoptServerSoundPreference(state.settings.soundsEnabled);
    if (lastPaused.current !== undefined && lastPaused.current !== state.settings.paused)
      playCue(state.settings.paused ? 'paused' : 'resumed');
    lastPaused.current = state.settings.paused;
    const currentTaskIds = new Set(state.tasks.map((t) => t.id));
    // Prune entries for tasks no longer in state (prevents unbounded growth)
    for (const id of taskStatuses.current.keys()) {
      if (!currentTaskIds.has(id)) taskStatuses.current.delete(id);
    }
    for (const task of state.tasks) {
      const previous = taskStatuses.current.get(task.id);
      if (previous && previous !== task.status) {
        if (task.status === 'completed') playCue('success');
        if (task.status === 'failed') playCue('error');
      }
      taskStatuses.current.set(task.id, task.status);
    }
  }, [state]);
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [selectedDot, setSelectedDot] = useState('');
  const [activeSubagentCharacter, setActiveSubagentCharacter] = useState<CharacterName | null>(null);
  const [selectedThread, setSelectedThread] = useState<string>();
  // One-UI tabs (W-HARNESS): Conversation=chat, AEGIS Computer=computer,
  // Browser=browser, Harness=harness, Memory=memories, Tools & Plugins=
  // tools, Settings=settings. 'tasks' (Scheduled & activity) and 'space'
  // (Spaces/pages) remain reachable views, unchanged.

  // Inline voice belongs to the app session, not to one thread: a voice turn
  // that creates a thread must NOT flip the UI back to text while the mic is
  // still live (that was the "switches to text but keeps listening" bug).
  useEffect(() => {
    // Only reset emptyInlineVoice when no voice is actively listening.
    // If the mic is live, changing threads must not flip the UI back to text.
    if (!isAnyVoiceActive) {
      setEmptyInlineVoice(false);
    }
  }, [selectedThread, isAnyVoiceActive]);
  useEffect(() => {
    document.body.dataset.voiceActive = isAnyVoiceActive ? 'true' : 'false';
  }, [isAnyVoiceActive]);
  // The pointer wears the Aegis mark while a task is running (see
  // AEGIS WORKING CURSOR in style.css), then returns to normal.
  useEffect(() => {
    const busy = Boolean(
      state?.tasks.some((task) =>
        ['running', 'planning', 'synthesizing', 'queued'].includes(task.status),
      ),
    );
    document.body.dataset.agentBusy = busy ? 'true' : 'false';
  }, [state]);
  // Onboarding is a helper, not a gate. It used to open automatically behind a
  // full-screen scrim, which swallowed every click in the app (the owner could
  // not reach Agents, Files or Memory at all). It now opens from the header
  // button and remembers being dismissed.
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      return false;
    } catch {
      return false;
    }
  });
  const dirtyPage = useRef(false);
  const [spaceId, setSpaceId] = useState('');
  const [pageId, setPageId] = useState<string>();
  const setDirtyPage = useCallback((value: boolean) => {
    dirtyPage.current = value;
  }, []);
  const setView = (next: typeof view) => {
    if (dirtyPage.current && !window.confirm('Leave your unsaved page draft?'))
      return;
    dirtyPage.current = false;
    if (next !== 'space')
      history.replaceState(null, '', location.pathname + location.search);
    // Close the brief/computer side pane on any view change so popups do not
    // linger over unrelated pages (e.g. Settings).
    setPane(false);
    rawSetView(next);
  };
  useEffect(() => {
    let acceptedHash = location.hash;
    const navigate = () => {
      const match = location.hash.match(
        /^#\/spaces\/([^/]+)(?:\/pages\/([^/]+))?$/,
      );
      if (!match) return;
      if (dirtyPage.current && location.hash === acceptedHash) return;
      if (
        dirtyPage.current &&
        !window.confirm('Leave your unsaved page draft?')
      ) {
        history.replaceState(null, '', acceptedHash || location.pathname);
        return;
      }
      acceptedHash = location.hash;
      dirtyPage.current = false;
      setSpaceId(match[1]);
      setPageId(match[2]);
      rawSetView('space');
      setMobile(false);
    };
    navigate();
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const openPage = (space: string, page?: string) => {
    openPageLink(`#/spaces/${space}${page ? `/pages/${page}` : ''}`);
  };

  // AEGIS (W-FIX 2b): the seeded surface presets are grouped under the
  // one primary Aegis Agent, collapsed by default; the group opens
  // automatically when one of its surfaces is the selected Agent.
  const [connection, setConnection] = useState<
    'checking' | 'online' | 'offline'
  >('checking');
  const [auth, setAuth] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [dialog, setDialog] = useState<Dialog>();
  // The Agents workspace's "New Agent" button opens the same create-Agent
  // dialog the sidebar's + uses, so there is one creation path, not two.
  useEffect(() => {
    const onCreateAgent = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string }>).detail;
      rawSetView('agents');
      setDialog({
        type: 'dot',
        spaceId: detail?.spaceId ?? workspace?.spaces[0]?.id ?? '',
      });
    };
    window.addEventListener('aegis:new-agent', onCreateAgent);
    return () => window.removeEventListener('aegis:new-agent', onCreateAgent);
  }, [rawSetView, workspace]);
  const [mobile, setMobile] = useState(false);
// The collapse is transient on non-chat surfaces (full-width pages), but the
// owner's preference is restored when coming back to the conversation/pages.
const userCollapsedRef = useRef(navCollapsed);
useEffect(() => {
    localStorage.setItem('aegis_sidebar_collapsed', navCollapsed.toString());
  }, [navCollapsed]);
  useEffect(() => {
    if (view !== 'chat' && view !== 'space') setNavCollapsed(true);
    else setNavCollapsed(userCollapsedRef.current);
  }, [view]);
  const [liveDocked, setLiveDocked] = useState(false);
  // Widgets mirrored from the desktop broadcast (see the bridge effect below).
  const [desktopWidgets, setDesktopWidgets] = useState<DesktopWidgets>({});
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus>({});
  const [widgetsLoading, setWidgetsLoading] = useState(false);
  const [widgetsError, setWidgetsError] = useState<string | null>(null);
  const loadWidgetsRef = useRef<(() => void) | null>(null);
  // Plain-browser fallback: with no desktop shell there is no `aegis:widgets`
  // broadcast, so the identical widget shape is read from the host instead of
  // leaving the Widgets view blank.
  useEffect(() => {
    const bridge = (window as unknown as { aegis?: unknown }).aegis;
    if (bridge) return;
    let alive = true;
    const load = async () => {
      setWidgetsLoading(true);
      setWidgetsError(null);
      try {
        const payload = await api<DesktopWidgets>('/widgets');
        if (alive && payload && typeof payload === 'object') {
          setDesktopWidgets((previous) => ({ ...payload, ...previous }));
          setWidgetsError(null);
        }
      } catch (error) {
        // The host may still be starting; the next tick retries.
        setWidgetsError(error instanceof Error ? error.message : 'Failed to load widgets.');
      } finally {
        if (alive) setWidgetsLoading(false);
      }
    };
    loadWidgetsRef.current = load;
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  const retryWidgets = () => {
    loadWidgetsRef.current?.();
  };
  // Computer-use annotations: markers for the desktop overlay, streamed from
  // the agent-desktop adapter. No pixels, no preview — just where to draw.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/computer/desktop/annotations/stream');
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { payload?: Record<string, unknown> };
        if (!event?.payload) return;
        (
          window as unknown as {
            aegis?: { annotateScreen?: (payload: unknown) => void };
          }
        ).aegis?.annotateScreen?.(event.payload);
      } catch {
        // ignore a malformed frame
      }
    };
    return () => source.close();
  }, []);
const [sidebarWidth, setSidebarWidth] = useState(() => {
  const saved = localStorage.getItem('aegis_sidebar_width');
  const n = saved ? Number(saved) : 242;
  return Number.isFinite(n) && n >= 180 && n <= 420 ? n : 242;
});
const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
useEffect(() => {
  const onMove = (event: MouseEvent) => {
    const drag = sidebarDragRef.current;
    if (!drag) return;
    const next = Math.min(420, Math.max(180, drag.startWidth + (event.clientX - drag.startX)));
    setSidebarWidth(next);
  };
  const onUp = () => {
    if (sidebarDragRef.current) {
      sidebarDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  return () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
}, []);
useEffect(() => {
  localStorage.setItem('aegis_sidebar_width', String(sidebarWidth));
}, [sidebarWidth]);
const startSidebarResize = (event: { clientX: number; preventDefault: () => void }) => {
  sidebarDragRef.current = { startX: event.clientX, startWidth: sidebarWidth };
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  event.preventDefault();
};
  const [capture, setCapture] = useState<Result>();
  // A research brief is an answer, not a side effect: when one arrives, the
  // pane opens on it (and the chat renders the same brief inline). A brief
  // that was already there when the thread loaded is history, not news, so it
  // must not pop the pane open merely because the owner switched chats.
  const seenBrief = useRef('');
  const loadedBrief = useRef('');
  const [paneFocus, setPaneFocus] = useState<{
    tab: 'Brief' | 'Computer' | 'Browser';
    token: number;
  }>({ tab: 'Computer', token: 0 });
  const focusPane = useCallback((tab: 'Brief' | 'Computer' | 'Browser') => {
    setPane(true);
    setPaneFocus((current) => ({ tab, token: current.token + 1 }));
  }, []);
  useEffect(() => {
    const text = capture?.text?.trim();
    if (!text || text === loadedBrief.current) return;
    if (seenBrief.current === text) return;
    seenBrief.current = text;
    focusPane('Brief');
  }, [capture?.text, focusPane]);
  const [prompt, setPrompt] = useState('');
  // `/` and `@` menu for the new-thread composer. It shares SLASH_COMMANDS and
  // NAV_COMMANDS with the in-conversation composer, so a command typed before
  // a thread exists does the same thing instead of being sent to the model.
  const [emptyMenu, setEmptyMenu] = useState<'slash' | 'at' | null>(null);
  const [emptyQuery, setEmptyQuery] = useState('');
  const [emptyActive, setEmptyActive] = useState(0);
  const [emptyTokenStart, setEmptyTokenStart] = useState(0);
  const emptyComposerRef = useRef<HTMLTextAreaElement>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string>();
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [taskDetail, setTaskDetail] = useState<Detail>();
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const [s, w] = await Promise.all([
        api<State>('/state'),
        api<WorkspaceState>('/workspace'),
      ]);
      setState(s);
      setWorkspace(w);
      setNeedsAuth(false);
      setConnection('online');
      setSelectedDot((previous) => previous || w.dots[0]?.id || '');
      setNotices((current) => applyRefreshResult(current, { ok: true }));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedsAuth(true);
      // A transport failure is the server being absent, not a bad request:
      // say so once (deduped) instead of printing the browser's raw text.
      setConnection(isOffline(e) ? 'offline' : 'online');
      setNotices((current) =>
        applyRefreshResult(
          current,
          describeFailure(e, 'Could not connect to the server.'),
        ),
      );
      return false;
    }
  }, []);
  // Poll on a 3s cadence while healthy; back off to 20s while the server is
  // gone so a stopped app stops hammering the console and the CPU.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 3000;
    const tick = async () => {
      const ok = await refresh();
      if (cancelled) return;
      delay = ok ? 3000 : Math.min(Math.round(delay * 1.7), 20000);
      timer = setTimeout(() => void tick(), delay);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const onOnboardingDone = (event: Event) => {
      void (event as CustomEvent<{ record?: EncryptedVaultRecord }>);
      setOnboardingOpen(false);
      void refresh();
      setView('chat');
      const greeting = 'Hello Aegis! I have completed my onboarding. How can you assist me today?';
      setPrompt(greeting);
    };
    window.addEventListener('aegis:onboarding-completed', onOnboardingDone);
    return () => window.removeEventListener('aegis:onboarding-completed', onOnboardingDone);
  }, [refresh]);
  useEffect(() => {
    setCapture(undefined);
    if (!selectedThread) return;
    let active = true;
    // Only the first response after a thread switch is "history". Later polls
    // are live updates and may legitimately contain a brand-new brief.
    let firstLoad = true;
    const load = () =>
      void api<Result | null>(`/conversations/${selectedThread}/capture`)
        .then((result) => {
          if (!active) return;
          if (firstLoad) {
            firstLoad = false;
            loadedBrief.current = result?.text?.trim() ?? '';
          }
          setCapture(result ?? undefined);
          setNotices((current) => applyCaptureResult(current, { ok: true }));
        })
        .catch((e) => {
          if (!active) return;
          setNotices((current) =>
            applyCaptureResult(
              current,
              describeFailure(e, 'Could not connect to the server.'),
            ),
          );
        });
    load();
    const timer = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedThread]);
  const mutate = async (path: string, method: string, body?: unknown) => {
    setError('');
    try {
      await api(path, method, body);
      await refresh();
      if (taskDetail)
        setTaskDetail(await api<Detail>(`/tasks/${taskDetail.task.id}`));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      return false;
    }
  };
  const fallbackDot: Dot = {
    id: 'aegis',
    name: 'Aegis',
    instructions: 'Be thoughtful, practical, and concise.',
    spaceId: '',
    spaceIds: [],
    researchAllowed: true,
    memoryAllowed: true,
    appsAllowed: false,
    composioToolkits: [],
    createdAt: 0,
  };
  const dot =
    workspace?.dots.find((item) => item.id === selectedDot) ??
    workspace?.dots[0] ??
    fallbackDot;
  const currentMascotCharacter: CharacterName =
    activeSubagentCharacter ?? characterForAgent(dot);
  const thread = workspace?.conversations.find(
    (item) => item.id === selectedThread,
  );
  const configured = !!workspace && workspace.setup.missing.length === 0;
  const setupStep = workspace
    ? dialog?.type === 'settings'
      ? 'settings'
      : configured
        ? 'ready'
        : 'setup_required'
    : undefined;
  useEffect(() => {
    if (!setupStep) return;
    return trackSetupStep(setupStep);
  }, [setupStep]);
  /**
   * One pause path for the header button and the Widgets surface: the host owns
   * settings.paused, the desktop mirrors it, and every surface follows.
   */
  const togglePause = () => {
    const next = !state?.settings.paused;
    void mutate('/settings', 'PATCH', { paused: next }).then(() => {
      (
        window as unknown as { aegis?: { setPaused?: (paused: boolean) => void } }
      ).aegis?.setPaused?.(next);
    });
  };

  const chooseDot = (next: Dot) => {
    setSelectedDot(next.id);
    // Selecting an Agent switches the conversation, it does not silently start
    // a new one: keep the open thread when it already belongs to that Agent,
    // otherwise open that Agent's most recent conversation. A new chat is only
    // ever created by an explicit "New chat" / send.
    setSelectedThread((current) => {
      const open = workspace?.conversations.find((item) => item.id === current);
      if (open && open.dotId === next.id) return current;
      const recent = [...(workspace?.conversations ?? [])]
        .filter((item) => item.dotId === next.id)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      return recent?.id;
    });
    setView('chat');
    setMobile(false);
    setPendingPrompt(undefined);
    setPendingAttachments(undefined);
    setAttachments([]);
  };

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setError('');
    const room = 4 - attachments.length;
    if (room <= 0) {
      setError('You can attach up to 4 files per message.');
      return;
    }
    const accepted: ChatAttachment[] = [];
    for (const file of files.slice(0, room)) {
      try {
        accepted.push(await attachmentFromFile(file));
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'The file could not be read.',
        );
      }
    }
    if (accepted.length) {
      setAttachments((current) => [...current, ...accepted]);
    }
  };

  /** Rows the new-thread `/` and `@` menu shows, filtered by what was typed. */
  const emptySlashMatches = SLASH_COMMANDS.filter((command) =>
    command.name.startsWith(emptyQuery.toLowerCase()),
  );
  const emptyAgentMatches = Object.entries(AGENT_ALIASES).filter(([alias]) =>
    alias.startsWith(emptyQuery.toLowerCase()),
  );

  /** End of the `/token` or `@token` that starts at `emptyTokenStart`. */
  const emptyTokenEnd = () =>
    emptyTokenStart +
    (prompt.slice(emptyTokenStart).match(/^[/@][a-zA-Z0-9_-]*/)?.[0].length ?? 0);

  /** Replace the `/token` under the caret in the new-thread composer. */
  const applyEmptySlash = (command: SlashCommand) => {
    setEmptyMenu(null);
    if (command.args) {
      const token = `/${command.name} `;
      setPrompt(
        `${prompt.slice(0, emptyTokenStart)}${token}${prompt.slice(emptyTokenEnd())}`,
      );
      requestAnimationFrame(() => {
        const el = emptyComposerRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(
          emptyTokenStart + token.length,
          emptyTokenStart + token.length,
        );
      });
      return;
    }
    setPrompt('');
    // Navigation commands work before a thread exists. Everything else needs
    // chat context, so it starts the first conversation instead.
    const target = NAV_COMMANDS[command.name];
    if (target) {
      window.dispatchEvent(new CustomEvent('aegis:nav', { detail: target }));
      return;
    }
    void newConversation(`/${command.name}`);
  };

  /** Swap the `@partial` token for `@alias ` and keep typing. */
  const applyEmptyMention = (alias: string) => {
    setEmptyMenu(null);
    const token = `@${alias} `;
    setPrompt(
      `${prompt.slice(0, emptyTokenStart)}${token}${prompt.slice(emptyTokenEnd())}`,
    );
    requestAnimationFrame(() => {
      const el = emptyComposerRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(
        emptyTokenStart + token.length,
        emptyTokenStart + token.length,
      );
    });
  };

  /** Track the `/` or `@` token under the caret in the new-thread composer. */
  const syncEmptyMenu = (value: string, caret: number) => {
    const { token, start } = tokenBeforeCaret(value, caret);
    if (token.startsWith('/')) {
      setEmptyMenu('slash');
      setEmptyTokenStart(start);
      setEmptyQuery(token.slice(1));
      setEmptyActive(0);
      return;
    }
    if (/^@[a-zA-Z0-9_-]*$/.test(token)) {
      setEmptyMenu('at');
      setEmptyTokenStart(start);
      setEmptyQuery(token.slice(1));
      setEmptyActive(0);
      return;
    }
    setEmptyMenu(null);
  };

  const newConversation = async (text?: string, initialFiles?: ChatAttachment[]) => {
    if (!dot || !configured || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await api<Conversation>('/conversations', 'POST', {
        dotId: dot.id,
        title: text?.slice(0, 80) || (initialFiles?.length ? `Attachment: ${initialFiles[0].name}` : 'A new thought'),
      });
      await refresh();
      setSelectedThread(next.id);
      setPendingPrompt(text);
      setPendingAttachments(initialFiles);
      setPrompt('');
      setAttachments([]);
      setView('chat');
      setMobile(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not create the conversation.',
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const bridge = (window as unknown as {
      aegis?: {
        onAsk?: (callback: (text: string) => void) => () => void;
        onDesktopAction?: (callback: (payload: { action?: string; data?: unknown }) => void) => () => void;
        onStatus?: (callback: (payload: unknown) => void) => () => void;
        onWidgets?: (callback: (payload: DesktopWidgets) => void) => () => void;
      };
    }).aegis;
    const offAsk = bridge?.onAsk?.((text) => {
      const clean = text.trim();
      if (!clean) return;
      if (thread) {
        setPendingPrompt(clean);
        setView('chat');
        setMobile(false);
      } else {
        void newConversation(clean);
      }
    });
    const offAction = bridge?.onDesktopAction?.(({ action, data }) => {
      // Pause toggled from a desktop surface (notch, tray): the app reads the
      // same host flag instead of keeping a stale local copy.
      if (action === 'paused') void refresh();
      const detail = { action, data };
      window.dispatchEvent(new CustomEvent('aegis:desktop-action', { detail }));
      window.dispatchEvent(new CustomEvent('aegis:action', { detail: { tool: action, action, parameters: data } }));
      if (action === 'file-tray-select') {
        const filePath = (data as { path?: unknown } | undefined)?.path;
        const desktop = (window as Window & { aegis?: { readFileTrayFile?: (path: string) => Promise<{ ok: boolean; error?: string; name?: string; mime?: string; base64?: string }> } }).aegis;
        if (typeof filePath === 'string' && desktop?.readFileTrayFile) {
          void desktop.readFileTrayFile(filePath).then(async (result) => {
            if (!result.ok || !result.name || !result.base64) throw new Error(result.error || 'Could not read the selected tray file.');
            const binary = atob(result.base64);
            const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
            const file = new File([bytes], result.name, { type: result.mime || 'application/octet-stream' });
            if (view === 'chat' && selectedThread && configured) {
              window.dispatchEvent(new CustomEvent('aegis:file-tray-attachment', { detail: file }));
              return;
            }
            const attachment = await attachmentFromFile(file);
            setAttachments((current) => current.length < 4 ? [...current, attachment] : current);
            setView('chat');
            setMobile(false);
          }).catch((error) => setError(error instanceof Error ? error.message : 'Could not attach the tray file.'));
        }
      }
      if (action === 'voice-command') {
        const command = String((data as { command?: unknown } | undefined)?.command ?? '').toLowerCase();
        const route = command.match(/\b(?:open|show|go to)\s+(chat|computer|browser|settings|files|memory|memories|research|reference|directory|terminal|tasks|integrations|tools|harness|finance|agents|whatsapp)\b/);
        const views: Record<string, typeof view> = {
          chat: 'chat', computer: 'computer', browser: 'browser', settings: 'settings',
          files: 'files', memory: 'memories', memories: 'memories', research: 'research',
          reference: 'agents', directory: 'agents', ecosystem: 'agents',
          terminal: 'terminal', tasks: 'tasks', integrations: 'integrations', tools: 'tools',
          harness: 'harness', finance: 'finance', agents: 'agents', whatsapp: 'chat',
        };
        if (route?.[2] && views[route[2]]) {
          setView(views[route[2]]);
          setMobile(false);
        }
      }
      if (action === 'widget') {
        const widget = data as { id?: string; action?: string; value?: string } | undefined;
        if (widget?.id === 'agents' && widget.action === 'open') {
          setView('agents');
          setMobile(false);
        } else if (widget?.id === 'agents' && widget.action === 'stop' && widget.value) {
          void import('./api').then((api) => api.cancelAgentTask(widget.value!)).catch(() => undefined);
        }
      }
    });
    // The desktop broadcasts one status stream to every surface. The notch
    // merges it into its `W` store; the app keeps the identical payload so the
    // in-app widget surface and the notch can never disagree.
    const applyStatus = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const next = payload as {
        status?: unknown;
        text?: unknown;
        state?: unknown;
        paused?: unknown;
        surface?: unknown;
        widgets?: DesktopWidgets;
      };
      if (next.widgets) setDesktopWidgets((prev) => ({ ...prev, ...next.widgets }));
      setDesktopStatus({
        text:
          typeof next.status === 'string'
            ? next.status
            : typeof next.text === 'string'
              ? next.text
              : undefined,
        state: typeof next.state === 'string' ? next.state : undefined,
        paused: next.paused === true,
        surface: typeof next.surface === 'string' ? next.surface : undefined,
      });
    };
    const offStatus = bridge?.onStatus?.(applyStatus);
    const offWidgets = bridge?.onWidgets?.((payload) => {
      if (payload && typeof payload === 'object') {
        setDesktopWidgets((prev) => ({ ...prev, ...payload }));
      }
    });
    return () => {
      offAsk?.();
      offAction?.();
      offStatus?.();
      offWidgets?.();
    };
  }, [thread?.id, newConversation, view, selectedThread, configured]);

  const deleteConversation = async (id: string) => {
    try {
      await api(`/conversations/${id}`, 'DELETE');
      if (selectedThread === id) setSelectedThread(undefined);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not delete the conversation.',
      );
    }
  };

  const renameConversation = async (id: string, title: string) => {
    try {
      await api(`/conversations/${id}`, 'PATCH', { title });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename the conversation.');
    }
  };

  if (needsAuth)
    return (
      <main className="unlock">
        <Mascot />
        <h1>Your own little corner.</h1>
        <p>
          Enter the owner access token configured on this template's server.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setToken(auth);
            try {
              await api('/state');
              setError('');
              await refresh();
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : 'Access token was not accepted.',
              );
            }
          }}
        >
          <input
            type="password"
            aria-label="Owner access token"
            autoComplete="current-password"
            value={auth}
            onChange={(e) => setAuth(e.target.value)}
            required
          />
          <button className="primary">Unlock Aegis</button>
        </form>
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
        <p className="muted">The token stays in this tab's session storage.</p>
      </main>
    );
  if (!state || !workspace || !dot) {
    if (error) {
      return (
        <main className="unlock">
          <p className="chat-error">{error}</p>
          <button onClick={() => void refresh()}>Retry</button>
        </main>
      );
    }
    return (
      <div className="app-boot-splash" aria-label="Aegis is starting">
        <img src="/assets/aegis-loader.svg" alt="" aria-hidden="true" />
      </div>
    );
  }
  const content = (
    <div className={`app template-app ${navCollapsed ? 'nav-collapsed' : ''}`}>
      <nav className="icon-rail" aria-label="Workspace navigation">
        <button
          className="rail-brand"
          aria-label="Aegis home"
          title="Aegis home"
          onClick={() => {
            setView('chat');
            setSelectedThread(undefined);
          }}
        >
          <img
            className="rail-brand-mark"
            src="/assets/aegis-mark.svg"
            alt=""
            aria-hidden="true"
            width={24}
            height={24}
          />
        </button>
        <button
          className="rail-toggle"
          aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() =>
            setNavCollapsed((current) => {
              userCollapsedRef.current = !current;
              return !current;
            })
          }
        >
          <PanelLeft size={18} />
        </button>

        <div className="rail-divider" />

        <div className="rail-views-scroll" role="tablist" aria-label="Workspace surfaces">
          {SURFACE_VIEWS.map((item) => {
            const Icon = item.icon;
            const isActive = view === item.id;
            // Only memories the Memory surface actually renders are counted;
            // the encrypted vault identity row was making the badge show "1"
            // while the panel looked empty.
            const count =
              item.id === 'memories' && state?.memories
                ? state.memories.filter(
                    (memory) => !String(memory.text ?? '').startsWith('[ENCRYPTED_VAULT]'),
                  ).length
                : 0;
            return (
              <button
                key={item.id}
                className={`rail-item ${isActive ? 'active' : ''}`}
                aria-label={item.label}
                title={item.label}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  setView(item.id);
                  if (item.id === 'chat') setSelectedThread(undefined);
                  setMobile(false);
                }}
              >
                <Icon size={18} />
                {count > 0 && <span className="rail-badge">{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="rail-divider" />

        <button
          className="rail-item rail-voice"
          aria-label="Voice OS"
          title="Open Voice OS"
          onClick={() => openVoice(false)}
        >
          <Mic size={18} />
          <span
            className={`rail-wake-dot ${wake.status}`}
            title={`Wake word: ${wake.status}`}
          />
        </button>

        <button
          className={`rail-item rail-settings ${view === 'settings' ? 'active' : ''}`}
          aria-label="Open settings"
          title="Settings"
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => setView('settings')}
        >
          <Settings2 size={18} />
        </button>
      </nav>
      <button
        className="mobile-menu icon-button"
        aria-label="Open navigation"
        aria-expanded={mobile}
        aria-controls="workspace-sidebar"
        onClick={() => setMobile(true)}
      >
        <Menu size={21} />
      </button>
      {mobile && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        className={`sidebar ${mobile ? 'open' : ''}`}
      style={{ width: navCollapsed ? 64 : sidebarWidth }}
      >
        {/* AEGIS sidebar layout: a fixed header, ONE scroll region for
            agents/spaces/chats, and a compact grouped tray pinned to the
            bottom. The old layout stacked three separate scrollers under 14
            tray rows inside a fixed 242px column, which clipped entries and
            piled up scrollbars (the owner's screenshot). */}
        <div className="sidebar-head">
        <button
          className="wordmark"
          onClick={() => {
            setView('chat');
            setSelectedThread(undefined);
          }}
        >
          {/* AEGIS (W-FIX 3a): the wordmark mark is the brief's shield,
              drawn inline     replaces the upstream 4-dot logo. */}
                    <img
            className="brand-shield"
            src="/assets/aegis-mark.svg"
            alt="Aegis"
            width={48}
            height={48}
          />
          Aegis
        </button>
        <button
          className="new-chat nav-item"
          disabled={!configured}
          onClick={() => void newConversation()}
        >
          <Plus size={17} />
          <span>New chat</span>
        </button>
        </div>
        <div className="sidebar-scroll">
        
        <div className="spaces-heading nav-label">
          AGENTS
          <button
            className="icon-button"
            aria-label="Create Agent"
            onClick={() =>
              setDialog({ type: 'dot', spaceId: workspace.spaces[0].id })
            }
          >
            <Plus size={14} />
          </button>
        </div>
        <nav className="dots-nav" aria-label="Agents">
          {(() => {
            // AEGIS (W-FIX 2b): ONE Aegis agent. The seeded surface
            // presets (tagged with `surface` by the server) are not
            // peer agents     they render as a collapsible "Surfaces"
            // group under the primary Agent. User-created Agents stay
            // peers; creating Agents on demand is unchanged.
            const primary =
              workspace.dots.find((item) => !item.surface) ??
              workspace.dots[0];
            const peers = workspace.dots.filter(
              (item) => !item.surface && item.id !== primary?.id,
            );
            const renderRow = (item: Dot, nested = false) => (
              <div
                className={`dot-nav-row ${nested ? 'surface-row' : ''}`}
                key={item.id}
              >
                <button
                  className={`dot-nav ${dot.id === item.id && view === 'chat' ? 'active' : ''}`}
                  aria-current={
                    dot.id === item.id && view === 'chat' ? 'page' : undefined
                  }
                  onClick={() => chooseDot(item)}
                >
                  <Mascot
                    identity={item.id}
                    name={item.name}
                    small
                    decorative
                  />
                  <span>
                    {nested
                      ? item.name.replace(/^Aegis\s+/, '')
                      : item.name}
                  </span>
                </button>
                <button
                  className="icon-button dot-settings"
                  aria-label={`Edit ${item.name} settings`}
                  onClick={() =>
                    setDialog({
                      type: 'dot',
                      dot: item,
                      spaceId: item.spaceId,
                    })
                  }
                >
                  <MoreHorizontal size={15} />
                </button>
              </div>
            );
            return (
              <>
                {primary && renderRow(primary)}
                {peers.map((item) => renderRow(item))}
              </>
            );
          })()}
        </nav>
        <div className="spaces-heading nav-label">
          SPACES
          <button
            className="icon-button"
            aria-label="Create Space"
            onClick={() => setDialog({ type: 'space' })}
          >
            <Plus size={14} />
          </button>
        </div>
        <nav className="spaces-nav" aria-label="Spaces">
          {workspace.spaces.map((space) => (
            <SpaceNav
              key={space.id}
              space={space}
              active={view === 'space' && spaceId === space.id}
              pageId={pageId}
              onOpen={(id) => openPage(space.id, id)}
            />
          ))}
        </nav>
        {configured && !['integrations', 'research', 'memories', 'harness', 'finance', 'sightline'].includes(view) ? (
          <ThreadList
            dotId={dot.id}
            dots={workspace.dots}
            local={workspace.conversations}
            selected={view === 'chat' ? selectedThread : undefined}
            onSelect={(id) => {
              const conversation = workspace.conversations.find(
                (item) => item.id === id,
              );
              if (conversation) setSelectedDot(conversation.dotId);
              setSelectedThread(id);
              setView('chat');
              setMobile(false);
            }}
            onNew={() => void newConversation()}
            onDelete={(id) => void deleteConversation(id)}
            onRename={(id, title) => void renameConversation(id, title)}
          />
        ) : (
          <div className="sidebar-empty">
            Set up text chat to begin a persistent conversation.
          </div>
        )}
        </div>
        {/* Voice OS and Settings live in the left rail only. They used to be
            duplicated here as well, which is the twice-listed pair in the
            sidebar; the foot now carries just the docked screen + version. */}
        <div className="sidebar-foot">
          <div className="version">
            AEGIS <span>local-first agent</span>
          </div>
        </div>
      </aside>
      <div
  className="sidebar-resize-handle"
  onMouseDown={startSidebarResize}
  title="Drag to resize the sidebar"
  role="separator"
  aria-orientation="vertical"
  style={{ left: RAIL_WIDTH + (navCollapsed ? 0 : sidebarWidth) - 2 }}
/>
<div className="workspace" style={{ marginLeft: navCollapsed ? RAIL_WIDTH : RAIL_WIDTH + sidebarWidth }}>
        <header className="topbar">
          <div className="breadcrumbs">
            <span>
              {view === 'space'
                ? workspace.spaces.find((space) => space.id === spaceId)?.name
                : 'Agents'}
            </span>
            <span>/</span>
            <strong>
              {view === 'chat' ? dot.name : VIEW_TITLES[view]}
            </strong>
          </div>
          <div className="top-actions">
            <span
              className={`connection-chip ${connection}`}
              title={
                connection === 'offline'
                  ? 'The local Aegis server is not answering'
                  : 'Connected to the local Aegis server'
              }
            >
              {connection === 'offline'
                ? 'Offline'
                : connection === 'online'
                  ? 'Connected'
                  : 'Connecting'}
            </span>
            <span className="mode-badge">
              {configured ? 'SELF-HOSTED' : 'SETUP REQUIRED'}
            </span>
            <button
              className="pause-button"
              aria-label={
                state.settings.paused ? 'Resume all Agents' : 'Pause all Agents'
              }
              onClick={togglePause}
            >
              {state.settings.paused ? <Play size={14} /> : <Pause size={14} />}
              <span>{state.settings.paused ? 'Resume' : 'Pause'}</span>
            </button>
            <button
              className="icon-button"
              aria-label="Read the latest reply aloud"
              onClick={() => {
                const last = (latestReply || capture?.text || '').trim();
                if (!last) return;
                stopReadAloud();
                void readAloud(last, state.settings.voiceLanguage);
              }}
            >
              <Bot size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Agent Onboarding & Vault"
              title="Agent Onboarding & Vault"
              onClick={() => setOnboardingOpen(true)}
            >
              <ShieldCheck size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Open AEGIS visual layer"
              title="AEGIS Visual Layer over any app (Win+Shift+Space)"
              onClick={() => (window as unknown as { aegis?: { toggleVisualLayer?: () => void } }).aegis?.toggleVisualLayer?.()}
            >
              <Sparkles size={18} />
            </button>
            <button
              className="icon-button"
              aria-label={pane ? 'Hide AEGIS Computer' : 'Show AEGIS Computer'}
              aria-expanded={pane}
              title="AEGIS Computer: live screen and handoff"
              onClick={() => {
                if (pane) setPane(false);
                else focusPane('Computer');
              }}
            >
              <Monitor size={18} />
            </button>
          </div>
        </header>
        {connection === 'offline' && (
          <div className="error-banner offline-banner" role="alert">
            <span>
              {OFFLINE_MESSAGE}
              <small> Server log: .aegis-data/logs/host.log</small>
            </span>
            <button className="text-button" onClick={() => void refresh()}>
              Retry now
            </button>
          </div>
        )}
        {error && connection !== 'offline' && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setNotices((current) => dismissNotice(current))}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {state.settings.paused && (
          <div className="notice">
            All Agents are paused. Active compute stops and scheduled tasks
            wait.
          </div>
        )}
        {view === 'space' ? (
          <SpaceWorkspace
            key={spaceId}
            space={
              workspace.spaces.find((s) => s.id === spaceId) ??
              workspace.spaces[0]
            }
            pageId={pageId}
            workspace={workspace}
            paused={state.settings.paused}
            onPage={(id) => openPage(spaceId, id)}
            onSettings={() => setDialog({ type: 'settings' })}
            onCreateDot={() => setDialog({ type: 'dot', spaceId })}
            onDirty={setDirtyPage}
            onRefresh={refresh}
            onSchedule={(threadId) => setDialog({ type: 'schedule', threadId })}
            onThread={(id) => {
              const target = workspace.conversations.find((t) => t.id === id);
              if (target) {
                setView('chat');
                setSelectedDot(target.dotId);
                setSelectedThread(id);
              }
            }}
          />
        ) : view === 'chat' ? (
          <div className={`chat-workspace ${pane ? 'split' : ''}`}>
            <div className="chat-column">
              {thread && configured ? (
                <Chat
                  key={thread.id}
                  thread={thread}
                  dot={dot}
                  initialPrompt={pendingPrompt}
                  initialAttachments={pendingAttachments}
                  onConsumed={() => {
                    setPendingPrompt(undefined);
                    setPendingAttachments(undefined);
                  }}
                  inlineVoiceRequested={inlineVoiceToken}
                  onInlineVoiceChange={setChatInlineVoice}
                  calls={workspace.calls.filter(
                    (call) => call.threadId === thread.id,
                  )}
                  paused={state.settings.paused}
                  providerLabel={workspace.setup.activeProvider?.label}
                  brief={capture}
                  onOpenBrief={() => focusPane('Brief')}
                  onSaved={refresh}
                  onComputer={() => focusPane('Computer')}
                  onBrowser={() => focusPane('Browser')}
                  onReply={setLatestReply}
                  readAloudLanguage={state.settings.voiceLanguage}
                  onActiveSubagentChange={setActiveSubagentCharacter}
                  onSchedule={() =>
                    setDialog({ type: 'schedule', threadId: thread.id })
                  }
                />
              ) : (
                <div className="new-conversation">
                  {!isAnyVoiceActive && (
                    <div className="empty-chat-persona">
                      {/* The mascot lives on the desktop (notch or floating),
                          not inside the app window. */}
                      <h2>{dot.name}</h2>
                      <p>{dot.instructions}</p>
                      <button
                        className="text-button"
                        onClick={() =>
                          setDialog({ type: 'dot', dot, spaceId: dot.spaceId })
                        }
                      >
                        Edit specialist <MoreHorizontal size={14} />
                      </button>
                    </div>
                  )}
                  {!configured && (
                    <div className="setup-card">
                      <span className="setup-icon">
                        <Settings2 size={20} />
                      </span>
                      <div>
                        <strong>Connect your Agent</strong>
                        <p>
                          Connect your model and conversation service in
                          Settings to start chatting. Your Spaces and Agent
                          preferences are ready to use.
                        </p>
                        <p>
                          Setup and usage metadata is collected by default.{' '}
                          <a
                            href="https://github.com/CopilotKit/OpenDots/blob/main/docs/SETUP-TELEMETRY.md"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Tracking and opt-out details
                          </a>
                        </p>
                        <a
                          href="https://github.com/CopilotKit/OpenDots/blob/main/docs/SETUP.md"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open the setup guide <ArrowUpRight size={12} />
                        </a>
                      </div>
                    </div>
                  )}
                  {emptyInlineVoice ? (
                    <InlineVoiceBar
                      pipelineUrl={state.settings.voicePipelineUrl}
                      language={state.settings.voiceLanguage}
                      agentId={dot.id}
                      agentName={dot.name}
                      onClose={() => setEmptyInlineVoice(false)}
                      onSubmitText={(text) => {
                        setEmptyInlineVoice(false);
                        void newConversation(text);
                      }}
                    />
                  ) : (
                  <form
                    className="composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void newConversation(prompt, attachments);
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        if (e.target.files) {
                          void addFiles(Array.from(e.target.files));
                          e.target.value = '';
                        }
                      }}
                    />
                    {attachments.length > 0 && (
                      <div className="chat-attachments-row" aria-label="Attached files">
                        {attachments.map((file) => (
                          <span className="chat-attachment-chip" key={file.id}>
                            {file.kind === 'image' && file.dataUrl ? (
                              <img src={file.dataUrl} alt={file.name} />
                            ) : (
                              <FileText size={14} />
                            )}
                            <span className="chat-attachment-name" title={file.name}>
                              {file.name}
                            </span>
                            <button
                              type="button"
                              className="chat-attachment-remove"
                              aria-label={`Remove ${file.name}`}
                              onClick={() =>
                                setAttachments((current) =>
                                  current.filter((item) => item.id !== file.id),
                                )
                              }
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <textarea
                      ref={emptyComposerRef}
                      aria-label="Start a conversation"
                      placeholder={
                        configured
                          ? `Message ${dot.name}...  type / for commands, @ for agents`
                          : 'Your first conversation starts after setup.'
                      }
                      value={prompt}
                      maxLength={4000}
                      onChange={(e) => {
                        const value = e.target.value;
                        setPrompt(value);
                        syncEmptyMenu(value, e.target.selectionStart ?? value.length);
                      }}
                      onKeyDown={(e) => {
                        if (emptyMenu) {
                          const rows =
                            emptyMenu === 'slash' ? emptySlashMatches : emptyAgentMatches;
                          if (e.key === 'Enter' && rows.length) {
                            e.preventDefault();
                            const row = rows[Math.min(emptyActive, rows.length - 1)];
                            if (emptyMenu === 'slash') applyEmptySlash(row as SlashCommand);
                            else applyEmptyMention(String((row as [string, string])[0]));
                            return;
                          }
                          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            if (!rows.length) return;
                            const delta = e.key === 'ArrowDown' ? 1 : -1;
                            setEmptyActive(
                              (current) => (current + delta + rows.length) % rows.length,
                            );
                            return;
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setEmptyMenu(null);
                            return;
                          }
                        }
                        submitComposerOnEnter(
                          e,
                          configured && !busy && (!!prompt.trim() || attachments.length > 0),
                        );
                      }}
                      disabled={!configured}
                    />
                    {emptyMenu && (
                      <div
                        className="cmd-menu"
                        role="listbox"
                        aria-label={
                          emptyMenu === 'slash' ? 'Slash commands' : 'Mention an agent'
                        }
                      >
                        <span className="cmd-label">
                          {emptyMenu === 'slash' ? 'Commands' : 'Mention agent'}
                        </span>
                        {emptyMenu === 'slash'
                          ? emptySlashMatches.map((command, index) => (
                              <button
                                key={command.name}
                                type="button"
                                role="option"
                                aria-selected={index === emptyActive}
                                className={`cmd-item ${index === emptyActive ? 'is-active' : ''}`}
                                onMouseEnter={() => setEmptyActive(index)}
                                onClick={() => applyEmptySlash(command)}
                              >
                                <span className="cmd-key">
                                  /{command.name}
                                  {command.args ? ` ${command.args}` : ''}
                                </span>
                                <span className="cmd-desc">{command.description}</span>
                              </button>
                            ))
                          : emptyAgentMatches.map(([alias, id], index) => (
                              <button
                                key={alias}
                                type="button"
                                role="option"
                                aria-selected={index === emptyActive}
                                className={`cmd-item ${index === emptyActive ? 'is-active' : ''}`}
                                onMouseEnter={() => setEmptyActive(index)}
                                onClick={() => applyEmptyMention(alias)}
                              >
                                <span className="cmd-key">@{alias}</span>
                                <span className="cmd-desc">
                                  {AGENT_LABELS[id as SwarmAgentId] ?? alias}
                                </span>
                              </button>
                            ))}
                        {(emptyMenu === 'slash' ? emptySlashMatches : emptyAgentMatches)
                          .length === 0 && (
                          <div className="cmd-empty">
                            {emptyMenu === 'slash'
                              ? `No command matches "/${emptyQuery}".`
                              : `No agent matches "@${emptyQuery}".`}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="composer-bottom">
                      <span>
                        <MessageCircle size={14} />
                        Text and calls, one continuing conversation
                      </span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Attach images or files"
                        title="Attach images or files"
                        style={{ marginRight: '4px' }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip size={18} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Talk with Voice OS"
                        title="Talk with Voice OS"
                        style={{ color: '#d96b52', marginRight: '6px' }}
                        onClick={() => setEmptyInlineVoice(true)}
                      >
                        <Mic size={18} />
                      </button>
                      <button
                        className="send-button"
                        aria-label="Start conversation"
                        disabled={!configured || busy || (!prompt.trim() && !attachments.length)}
                      >
                        <ArrowUp size={19} />
                      </button>
                    </div>
                  </form>
                  )}
                  <div className="starter-suggestions">
                    {starterSuggestions.map((text) => (
                      <button
                        key={text}
                        disabled={!configured}
                        onClick={() => setPrompt(text)}
                      >
                        {text}
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                  </div>
                  <div className="connection-note">
                    <span
                      className={`online-dot ${workspace.setup.slack === 'online' ? '' : 'off'}`}
                    />
                    Slack   {workspace.setup.slack.replaceAll('_', ' ')}
                    <button
                      className="text-button"
                      onClick={() => setDialog({ type: 'settings' })}
                    >
                      Setup details
                    </button>
                  </div>
                </div>
              )}
            </div>
            {pane && (
              <ResultPane
                key={dot.id}
                dots={workspace.dots}
                defaultDotId={dot.id}
                latest={capture}
                dotState="idle"
                focusTab={paneFocus}
                onClose={() => setPane(false)}
                resizable
              />
            )}
          </div>
        ) : view === 'computer' ? (
          <main className="main-content">
            <div className="page-heading">
              <div>
                <span className="eyebrow">YOUR WORKSPACE</span>
                <h1>Computer</h1>
                <p>
                  {dot.name} s computer: the live screen, control handoff and
                  permissions. Browser, Files, Terminal and Activity each have
                  their own sidebar surface.
                </p>
              </div>
            </div>
            <ComputerPanel key={`computer:${dot.id}`} dot={dot} section="Computer" hideTabNav />
          </main>
        ) : view === 'browser' ? (
          <main className="main-content">
            <div className="page-heading">
              <div>
                <span className="eyebrow">YOUR WORKSPACE</span>
                <h1>Browser</h1>
                <p>
                  The AEGIS Computer browser (Playwright) with full browser
                  controls and one-click takeover of the agent's cursor.
                </p>
              </div>
            </div>
            <ComputerPanel key={`browser:${dot.id}`} dot={dot} browserOnly hideTabNav />
          </main>
        ) : view === 'terminal' || view === 'tasks' ? (
          <main className="main-content">
            {view === 'terminal' ? (
              <ComputerPanel key={`terminal:${dot.id}`} dot={dot} section="Terminal" hideTabNav />
            ) : (
              <ActivityView state={state} dotId={dot.id} />
            )}
          </main>
        ) : view === 'integrations' || view === 'marketplace' || view === 'connections' || view === 'tools' ? (
          <main className="main-content">
            <IntegrationsView
      dot={dot}
      initialTab={
        view === 'connections'
          ? 'connections'
          : view === 'tools'
            ? 'tools'
            : integrationsTab
      }
    />
          </main>
        ) : view === 'files' ? (
          <main className="main-content">
            <FilesSurfaceView />
          </main>
        ) : view === 'research' ? (
          <ResearchPanel />
        ) : view === 'agents' ? (
          <AgentsWorkspace
            dot={dot}
            dots={workspace.dots}
            onOpenHarness={() => setView('harness')}
          />
        ) : view === 'harness' ? (
          <HarnessPanel />
        ) : view === 'finance' ? (
          <FinancePage />
        ) : view === 'sightline' ? (
          <SightlineView />
        ) : view === 'settings' ? (
          <main className="main-content settings-page">
            <div className="page-heading">
              <div>
                <span className="eyebrow">AEGIS · YOUR WORKSPACE</span>
                <h1>Settings</h1>
                <p>
                  Provider, model, permissions and appearance   saved here,
                  on this page. Service health is below the form.
                </p>
              </div>
            </div>
            <SettingsForm
              state={state}
              workspace={workspace}
              mutate={mutate}
            />
            <div className="settings-link-row">
              <span>
                Connections, MCP tools, OAuth and the marketplace have their own
                surface.
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('aegis:nav', { detail: 'integrations' }),
                  )
                }
              >
                Open Integrations
              </button>
            </div>
            <ServicesStatus setup={workspace.setup} />
          </main>
        ) : view === 'memories' ? (
          <main className="main-content memory-page">
            <MemoryPanel />
          </main>
        ) : view === 'tasks' ? (
          <main className="main-content">
            <ActivityView state={state} dotId={dot.id} />
          </main>
        ) : (
          <main className="main-content">
            <div className="page-heading">
              <div>
                <span className="eyebrow">YOUR WORKSPACE</span>
                <h1>Activity & Tasks</h1>
                <p>Scheduled turns run on the server in their original conversation.</p>
              </div>
            </div>
            <>
                <label className="search-box">
                  <Search size={16} />
                  <input
                    aria-label="Search tasks"
                    placeholder="Find a task..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="task-list">
                  {state.tasks
                    .filter((task) =>
                      task.prompt.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onClick={() =>
                          void api<Detail>(`/tasks/${task.id}`)
                            .then(setTaskDetail)
                            .catch((e) => setError(e.message))
                        }
                      />
                    ))}
                </div>
                {!state.tasks.length && (
                  <div className="large-empty">
                    <Clock3 size={32} />
                    <h2>Let a thought come back around.</h2>
                    <p>
                      Open a conversation and use the clock button to schedule a
                      server-side task.
                    </p>
                  </div>
                )}
                {taskDetail && (
                  <section className="task-detail-card">
                    <h2>{taskDetail.task.prompt}</h2>
                    <TaskActions
                      task={taskDetail.task}
                      busy={busy}
                      settings={state.settings}
                      onAction={(action) =>
                        void mutate(
                          `/tasks/${taskDetail.task.id}/actions`,
                          'POST',
                          { action },
                        )
                      }
                      onSchedule={async () => {
                        const raw = await promptText({
                          title: 'Schedule this task',
                          message:
                            'Repeat interval in minutes (0 removes the schedule).',
                          label: 'Minutes',
                          defaultValue: String(
                            (taskDetail.task.intervalSeconds ?? 0) / 60,
                          ),
                          confirmLabel: 'Schedule',
                          validate: (input) => {
                            const value = Number(input);
                            if (!Number.isFinite(value) || value < 0)
                              return 'Enter a number of minutes (0 or more).';
                            return undefined;
                          },
                        });
                        if (raw === null) return;
                        const value = Number(raw);
                        if (!Number.isFinite(value) || value < 0) {
                          setError('Enter a valid number of minutes.');
                          return;
                        }
                        await mutate(
                          `/tasks/${taskDetail.task.id}/schedule`,
                          'PUT',
                          {
                            intervalSeconds: value
                              ? Math.round(value * 60)
                              : null,
                          },
                        );
                      }}
                    />
                    {taskDetail.task.error && (
                      <p className="chat-error">{taskDetail.task.error}</p>
                    )}
                    {taskDetail.events.slice(-6).map((event) => (
                      <p className="muted" key={event.id}>
                        {event.text}
                      </p>
                    ))}
                    <small>{taskDetail.runs.length} saved runs</small>
                  </section>
                )}
              </>
          </main>
        )}
        {pane && view !== 'chat' && (
          <div className="computer-overlay">
            <ResultPane
              key={view === 'space' ? spaceId : dot.id}
              dots={workspace.dots}
              defaultDotId={
                view === 'space'
                  ? (workspace.dots.find((candidate) =>
                      candidate.spaceIds.includes(spaceId),
                    )?.id ?? dot.id)
                  : dot.id
              }
              dotState="idle"
              onClose={() => setPane(false)}
            />
          </div>
        )}
      </div>
      {dialog && (
        <WorkspaceDialog
          dialog={dialog}
          state={state}
          workspace={workspace}
          onClose={() => setDialog(undefined)}
          mutate={mutate}
        />
      )}
      {onboardingOpen && (
        <AgentOnboardingModal
          onClose={() => {
            setOnboardingOpen(false);
            try {
              localStorage.setItem('aegis-onboarding-completed', 'true');
            } catch {
              // storage unavailable: nothing to persist
            }
          }}
          onCompleted={() => {
            setOnboardingOpen(false);
            void refresh();
            setView('chat');
            const greeting = 'Hello Aegis! I have completed my onboarding. How can you assist me today?';
            setPrompt(greeting);
          }}
        />
      )}
      <VoiceOS
        open={voiceOpen}
        settings={state.settings}
        autoStart={voiceAutoStart}
        threadId={selectedThread}
        onClose={() => {
          setVoiceOpen(false);
          setVoiceAutoStart(false);
        }}
      />
      <PenBoardPanel />
    </div>
  );
  const withVoice = (node: ReactNode) => (
    <VoiceSessionProvider
      dotId={dot.id}
      baseUrl={state.settings.voicePipelineUrl || 'http://127.0.0.1:8766'}
      language={state.settings.voiceLanguage ?? 'auto'}
      onTurn={async (role, text) => {
        let threadId = selectedThread;
        if (!threadId) {
          const convs = workspace?.conversations ?? [];
          if (convs.length > 0) {
            threadId = convs[0].id;
            setSelectedThread(threadId);
          } else {
            try {
              const created = await api<{ id: string }>('/conversations', 'POST', {
                title: 'Voice Session ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                dotId: dot.id,
              });
              if (created?.id) {
                threadId = created.id;
                setSelectedThread(threadId);
                await refresh();
              }
            } catch {
              // Creating a fresh voice session is best effort; the transcript
              // still persists to the thread below.
            }
          }
        }
        if (threadId) {
          void persistVoiceTurn(threadId, role, text);
        }
      }}
    >
      {node}
      <DesktopVoiceCommand onOpen={() => openVoice(true)} />
    </VoiceSessionProvider>
  );
  return configured ? withVoice(
    <CopilotKitProvider runtimeUrl="/api/copilotkit" headers={authHeaders()}>
      {content}
      <PromptHost />
      </CopilotKitProvider>,
    )
    : withVoice(
      <>
        {content}
        <PromptHost />
      </>,
    );
}
