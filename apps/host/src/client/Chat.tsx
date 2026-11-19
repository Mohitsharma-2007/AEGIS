import { PageReviewCard } from './PageReviewCard';
import { promptText } from './PromptDialog';
import { z } from 'zod';

import { pageReviewSchema, pageReviewTool } from '../shared/page-review';

import {

  connectionActionSchema,

  connectionActionTool,

} from '../shared/connection-types';

import { ConnectionActionCard } from './ConnectionActionCard';

import {

  memorySourcesSchema,

  memorySourcesTool,

  providerStatusSchema,

  providerStatusTool,

} from '../shared/generative-ui';

import {

  BrowserActivityCard,

  MemorySourcesCard,

  ProviderStatusCard,

} from './GenerativeCards';

import { ResearchBriefCard, VisualUiCard } from './VisualCards';
import { openPenBoard } from './PenBoardPanel';

import {

  BrowserPreviewContext,

  previewKey,

  type LivePagePreview,

} from './browser-preview-context';

import {

  visualUiSchema,

  visualUiTool,

  type VisualUiAck,

} from '../shared/visual-ui';

import { contextualMessage, type PageContext } from './page-context';

import { api, getAegisCapture, getProviders, searchAegisMemory } from './api';

import type { Page } from '../server/pages';

import { useCallback, useEffect, useRef, useState } from 'react';

import { CopilotKitCoreErrorCode } from '@copilotkit/core';

import {

  useRenderTool,

  useFrontendTool,

  useHumanInTheLoop,

  useAgent,

  useCopilotKit,

} from '@copilotkit/react-core/v2';

import {

  FilePlus,
  FileText,

  ArrowUp,

  Clock3,

  GitBranch,

  Link2,

  Loader2,

  Mic,

  MicOff,

  Paperclip,

  Square,

  X,

} from 'lucide-react';

import type { UserMessage } from '@ag-ui/core';

import {

  createAgentTask,

  getAgentTask,

  type SwarmAgentId,

} from './api';

import {

  ComputerToolCard,

  type ComputerToolRenderProps,

} from './ComputerToolCard';

import { ChatTranscript, isInternalVoiceReceipt } from './ChatTranscript';

import { InlineVoiceBar } from './InlineVoiceBar';
import { useVoiceSession } from './voiceSession';

import { persistVoiceTurn, subscribeVoiceTurns } from './voiceTranscript';

import { InlineRunTrace, characterForToolOrSubagent } from './RunTrace';

import type { CallReceipt, Conversation, Dot, Result } from '../shared/types';

import type { CharacterName } from 'aegis-mascot';


import { emitMascot } from './MascotPet';

import { playCue } from './sounds';

import { shouldSubmitComposerOnKeyDown } from './chat-composer';



export interface ChatAttachment {

  id: string;

  name: string;

  mimeType: string;

  size: number;

  kind: 'image' | 'text' | 'file';

  /** Absolute host path for binary attachments (PDF/Office/archives). */

  hostPath?: string;

  dataUrl?: string;

  text?: string;

}



const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const MAX_TEXT_BYTES = 512 * 1024;

const MAX_BINARY_BYTES = 20 * 1024 * 1024;

const MAX_ATTACHMENTS = 4;



const AGENT_ALIASES: Record<string, SwarmAgentId> = {

  aegis: 'aegis',

  rfi: 'rfi',

  research: 'rfi',

  finance: 'rfi',

  market: 'rfi',

  security: 'security',

  sentinel: 'security',

  files: 'files',

  filo: 'files',

  documents: 'files',

  memory: 'memory',

  memo: 'memory',

  computer: 'computer',

  operator: 'computer',

  browser: 'computer',

};



const AGENT_LABELS: Record<SwarmAgentId, string> = {

  aegis: 'Aegis',

  rfi: 'RFI',

  security: 'Sentinel',

  files: 'Filo',

  memory: 'Memo',

  computer: 'Operator',

};



const NAV_COMMANDS: Record<string, string> = {
  settings: 'settings',
  browser: 'computer',
  files: 'files',
  research: 'research',
  tools: 'integrations',
  whatsapp: 'whatsapp',
  marketplace: 'integrations',
  integrations: 'integrations',
  connections: 'integrations',
  computer: 'computer',
  terminal: 'terminal',
  memory: 'memories',
  memories: 'memories',
  swarm: 'agents',
  agents: 'agents',
  agent: 'agents',
  activity: 'tasks',
  tasks: 'tasks',
  harness: 'harness',
  finance: 'finance',
  ops: 'tasks',
};

const SLASH_HELP =

  'Commands: /call <widget>   /rate <agent> <task>   /agent <agent> <task>   /summary   /voice   /draw <topic>   /whiteboard   /settings   /files   /research   /agents   /memory   /computer   /terminal   /integrations   /tools   /whatsapp   /harness   /finance   /help';



function readDataUrl(file: File): Promise<string> {

  return new Promise((resolve, reject) => {

    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ''));

    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));

    reader.readAsDataURL(file);

  });

}



function readTextFile(file: File): Promise<string> {

  return new Promise((resolve, reject) => {

    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ''));

    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));

    reader.readAsText(file);

  });

}



export async function attachmentFromFile(file: File): Promise<ChatAttachment> {

  const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

  if (file.type.startsWith('image/')) {

    if (file.size > MAX_IMAGE_BYTES)

      throw new Error(`${file.name} is larger than 4 MB.`);

    return {

      id,

      name: file.name,

      mimeType: file.type || 'image/png',

      size: file.size,

      kind: 'image',

      dataUrl: await readDataUrl(file),

    };

  }

  const textLike =

    file.type.startsWith('text/') ||

    file.type === 'application/json' ||

    /\.(txt|md|markdown|json|csv|log|ts|tsx|js|jsx|py|html|css|ya?ml|xml|toml|ini|env)$/i.test(

      file.name,

    );

  if (!textLike) {
    const binaryLike =
      /\.(pdf|xlsx|xls|docx|doc|pptx|ppt|zip|rar|7z|csv)$/i.test(file.name);
    if (!binaryLike)
      throw new Error(
        `${file.name}: attach images, documents (PDF, Excel, Word, PowerPoint), archives or text files.`,
      );
    if (file.size > MAX_BINARY_BYTES)
      throw new Error(`${file.name} is larger than 20 MB.`);
    const dataUrl = await readDataUrl(file);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const stored = (await api('/attachments', 'POST', {
      name: file.name,
      base64,
    })) as { path?: string };
    return {
      id,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      kind: 'file',
      hostPath: stored.path,
    };
  }

  if (file.size > MAX_TEXT_BYTES)

    throw new Error(`${file.name} is larger than 512 KB.`);

  return {

    id,

    name: file.name,

    mimeType: file.type || 'text/plain',

    size: file.size,

    kind: 'text',

    text: await readTextFile(file),

  };

}



function buildMessageContent(

  text: string,

  context: PageContext | null | undefined,

  files: ChatAttachment[],

): UserMessage['content'] {

  const base = contextualMessage(text, context);

  if (!files.length) return base;

  const parts: Array<

    | { type: 'text'; text: string }

    | {

        type: 'image';

        source: { type: 'data'; value: string; mimeType: string };

      }

  > = [];

  for (const file of files) {

    if (file.kind === 'image' && file.dataUrl) {

      parts.push({

        type: 'image',

        source: {

          type: 'data',

          value: file.dataUrl,

          mimeType: file.mimeType,

        },

      });

    } else if (file.kind === 'file') {
      parts.push({
        type: 'text',
        text: `Attached file "${file.name}" is saved on this computer at ${file.hostPath ?? '(unknown path)'}. Use the computer tools to open or read it.`,
      });
    } else if (file.kind === 'text' && file.text !== undefined) {

      parts.push({

        type: 'text',

        text: `Attached file ${file.name}:\n\n${file.text}`,

      });

    }

  }

  if (base.trim()) parts.push({ type: 'text', text: base });

  else parts.push({ type: 'text', text: 'Please review the attached file(s).' });

  return parts;

}



function delay(ms: number): Promise<void> {

  return new Promise((resolve) => setTimeout(resolve, ms));

}



export function Chat({

  thread,

  dot,

  initialPrompt,

  initialAttachments,

  onConsumed,


  calls,

  paused,

  onSaved,

  onSchedule,

  onComputer,
  onBrowser,

  providerLabel,

  brief,

  onOpenBrief,

  onReply,

  readAloudLanguage = 'auto',

  onActiveSubagentChange,

  inlineVoiceRequested,

  onInlineVoiceChange,

}: {

  inlineVoiceRequested?: number;

  onInlineVoiceChange?: (active: boolean) => void;

  thread: Conversation;

  dot: Dot;

  initialPrompt?: string;

  initialAttachments?: ChatAttachment[];

  onConsumed: () => void;


  calls: CallReceipt[];

  paused: boolean;

  onSaved: () => void;

  onSchedule: () => void;

  onComputer?: () => void;
  onBrowser?: () => void;

  providerLabel?: string;

  brief?: Result;

  onOpenBrief?: () => void;

  onReply?: (text: string) => void;

  readAloudLanguage?: 'auto' | 'en' | 'hi' | 'hinglish';

  onActiveSubagentChange?: (character: CharacterName | null) => void;

}) {

  const { agent, isReady } = useAgent({

    agentId: `chat-${thread.id}`,

    runtimeAgentId: dot.id,

    threadId: thread.id,

  });

  const { copilotkit } = useCopilotKit();

  const [pageContext, setPageContext] = useState<PageContext | null>();

  const [contextError, setContextError] = useState('');

  const [contextAttempt, setContextAttempt] = useState(0);

  const contextReady = pageContext !== undefined;

  useEffect(() => {

    let active = true;

    setPageContext(undefined);

    setContextError('');

    void api<PageContext | null>(

      `/conversations/${thread.id}/page-context`,

      'GET',

      undefined,

      AbortSignal.timeout(10000),

    )

      .then((page) => {

        if (active) setPageContext(page);

      })

      .catch(() => {

        if (active)

          setContextError(

            'Conversation context could not load. Retry before sending your message.',

          );

      });

    return () => {

      active = false;

    };

  }, [thread.id, contextAttempt]);

  const [draft, setDraft] = useState('');
  const [cmdMenuOpen, setCmdMenuOpen] = useState(false);
  const [cmdType, setCmdType] = useState<'slash' | 'at' | null>(null);
  const [cmdCursorPos, setCmdCursorPos] = useState(0);
  const [cmdMenuPosition, setCmdMenuPosition] = useState({ x: 0, y: 0 });
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const [inlineVoice, setInlineVoiceState] = useState(false);
  const sharedVoice = useVoiceSession();
  const stopSharedVoice = sharedVoice?.stop;

  const setInlineVoice = (val: boolean) => {

    setInlineVoiceState(val);

    onInlineVoiceChange?.(val);

  };

  useEffect(() => {
    // Only show inline voice when a voice session has been requested.
    // Reset to false when the token resets to 0 so the bar doesn't stay
    // optimistically open after the session ends.
    setInlineVoice(Boolean(inlineVoiceRequested && inlineVoiceRequested > 0));
  }, [inlineVoiceRequested]);

  const [source, setSource] = useState('');

  const [sourceOpen, setSourceOpen] = useState(false);

  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [trayFileNotice, setTrayFileNotice] = useState('');

  const [delegateStatus, setDelegateStatus] = useState('');

  const attachInput = useRef<HTMLInputElement>(null);

  const [error, setError] = useState('');

  const [runError, setRunError] = useState('');

  const [runProvider, setRunProvider] = useState<{
    provider: string;
    model: string;
    fallback: boolean;
    fallbackReason?: string;
  } | null>(null);

  const chatError = error || runError;

  const [loaded, setLoaded] = useState(false);

  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Generative-UI specs stored with earlier turns, redrawn on reload.

  const [savedVisuals, setSavedVisuals] = useState<

    { id: string; spec: string }[]

  >([]);

  // Newest live page preview per URL, pushed by the browse tool mid-run.

  const [livePreviews, setLivePreviews] = useState<

    Record<string, LivePagePreview>

  >({});

  useEffect(() => {

    setLivePreviews({});

  }, [thread.id]);

  const [running, setRunning] = useState(false);

  const [traceOpen, setTraceOpen] = useState(true);

  // Spoken turns are persisted by the voice bar and echoed here, so a voice
  // exchange reads in the same transcript as typed messages without a reload.
  useEffect(

    () =>

      subscribeVoiceTurns(thread.id, (turn) => {

        agent.addMessage({

          id: turn.id ?? `voice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,

          role: turn.role === 'agent' ? 'assistant' : 'user',

          content: turn.text,

        });

      }),

    [thread.id, agent],

  );

  // A turn that starts after the owner sent a message gets the alert cue;

  // completion is announced once by the task watcher in App.

  useEffect(() => {

    if (running) playCue('alert');

  }, [running]);



  // Mascot follow: track active tool / subagent execution during a turn

  useEffect(() => {

    if (!running) {

      onActiveSubagentChange?.(null);

      return;

    }

    const lastAssistant = [...agent.messages]

      .reverse()

      .find((m) => m.role === 'assistant');

    const calls =

      lastAssistant &&

      'toolCalls' in lastAssistant &&

      Array.isArray(lastAssistant.toolCalls)

        ? lastAssistant.toolCalls

        : [];

    const latestCall = calls.at(-1);

    if (latestCall) {

      const char = characterForToolOrSubagent(latestCall.function?.name ?? '');

      if (char) {

        onActiveSubagentChange?.(char);

        return;

      }

    }

    onActiveSubagentChange?.(null);

  }, [running, agent.messages, onActiveSubagentChange]);

  const sent = useRef(false);

  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {

    const subscription = copilotkit.subscribe({

      onError: ({ error, code }) => {

        if (

          code === CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT ||

          code === CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT ||

          code === CopilotKitCoreErrorCode.AGENT_RUN_FAILED ||

          code === CopilotKitCoreErrorCode.AGENT_THREAD_LOCKED

        )

          setRunError(error.message);

        else setError(error.message);

      },

    });

    const events = agent.subscribe({

      onCustomEvent: ({ event }) => {

        if (event.name === 'aegis.provider') {

          const value = event.value as Partial<{
            provider: string;
            model: string;
            fallback: boolean;
            fallbackReason: string;
          }> | undefined;

          if (value?.provider && value.model) {

            setRunProvider({
              provider: value.provider,
              model: value.model,
              fallback: value.fallback === true,
              fallbackReason: value.fallbackReason,
            });

          }

          return;

        }

        if (event.name !== 'aegis.browser_preview') return;

        const value = event.value as Partial<LivePagePreview> | undefined;

        if (!value?.url || !value.screenshot) return;

        setLivePreviews((current) => ({

          ...current,

          [previewKey(value.url as string)]: {

            url: value.url as string,

            title: value.title ?? value.url!,

            screenshot: value.screenshot as string,

          },

        }));

      },

      onRunErrorEvent: ({ event }) => setRunError(event.message),

      onRunFinishedEvent: ({ outcome }) => {

        if (outcome === 'success') setRunError('');

      },

    });

    return () => {

      subscription.unsubscribe();

      events.unsubscribe();

    };

  }, [agent, copilotkit]);

  // Local mode has no hosted thread store: hydrate the conversation from the

  // server's own history so a reload keeps every turn (and the model gets

  // its context back). Runs once per conversation; a tool-call flow in

  // progress is left untouched.

  useEffect(() => {

    if (!loaded || historyLoaded) return;

    let active = true;

    void api<{

      messages: { id: string; role: 'user' | 'assistant'; content: string }[];

      visuals?: { id: string; spec: string }[];

    }>(`/conversations/${thread.id}/messages`, 'GET', undefined, AbortSignal.timeout(10000))

      .then(({ messages, visuals }) => {

        if (!active) return;

        setSavedVisuals(visuals ?? []);

        const current = agent.messages;

        const hasToolFlow = current.some(

          (message) =>

            message.role === 'tool' ||

            ('toolCalls' in message && !!message.toolCalls?.length),

        );

        if (!current.length && !hasToolFlow)

          for (const message of messages)

            agent.addMessage({

              id: message.id,

              role: message.role,

              content: message.content,

            });

        setHistoryLoaded(true);

      })

      .catch(() => {

        if (active) setHistoryLoaded(true);

      });

    return () => {

      active = false;

    };

  }, [agent, thread.id, loaded, historyLoaded]);

  useEffect(() => {

    if (!isReady) return;

    let active = true;

    void copilotkit

      .connectAgent({ agent })

      .then(() => {

        if (active) setLoaded(true);

      })

      .catch((e) => {

        if (active)

          setError(

            e instanceof Error ? e.message : 'Conversation could not connect.',

          );

      });

    return () => {

      active = false;

    };

  }, [agent, copilotkit, isReady]);

  const addFiles = useCallback(async (files: File[]) => {

    if (!files.length) return;

    setError('');

    const room = MAX_ATTACHMENTS - attachments.length;

    if (room <= 0) {

      setError(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);

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

    if (accepted.length)

      setAttachments((current) => [...current, ...accepted]);

  }, [attachments.length]);

  useEffect(() => {
    const addTrayFile = (event: Event) => {
      const file = (event as CustomEvent<File>).detail;
      if (file instanceof File) {
        setTrayFileNotice(`${file.name} attached. Supported text files up to 1 MB are indexed for workspace memory automatically; other files remain available to this chat.`);
        void addFiles([file]);
      }
    };
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('aegis:file-tray-attachment', addTrayFile);
    return () => window.removeEventListener('aegis:file-tray-attachment', addTrayFile);
  }, [addFiles]);



  const send = async (text: string, files: ChatAttachment[] = []) => {

    if (

      (!text.trim() && !files.length) ||

      running ||

      !loaded ||

      !contextReady ||

      paused

    )

      return;

    setError('');

    setRunError('');

    setRunProvider(null);

    setRunning(true);

    emitMascot('prompt:send');

    emitMascot('agent:thinking');

    agent.addMessage({

      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,

      role: 'user',

      content: buildMessageContent(text, pageContext, files),

    });

    setDraft('');

    setAttachments([]);

    setSource('');

    setSourceOpen(false);

    try {

      const result = await copilotkit.runAgent({ agent });

      if (!result.newMessages.some((message) => message.role === 'assistant'))

        throw new Error(

          'The current turn returned no response. Check the runtime connection and retry.',

        );

      emitMascot('agent:reply');

      emitMascot('agent:done');

      onSaved();

    } catch (e) {

      emitMascot('agent:error');

      setRunError(

        e instanceof Error

          ? e.message

          : 'The turn failed. Your conversation remains saved.',

      );

    } finally {

      setRunning(false);

      emitMascot('app:idle');

    }

  };



  const delegateToAgent = async (rawAgent: string, task: string) => {

    const agentId = AGENT_ALIASES[rawAgent.replace(/^@/, '').toLowerCase()];

    if (!agentId) {

      setError(

        `Unknown agent "${rawAgent}". Use one of: ${Object.keys(AGENT_LABELS)

          .map((id) => AGENT_LABELS[id as SwarmAgentId])

          .join(', ')}.`,

      );

      return;

    }

    if (!task.trim()) {

      setError('Usage: /rate <agent> <task>   for example /rate RFI NVDA news today');

      return;

    }

    if (running || !loaded || paused) return;

    const label = AGENT_LABELS[agentId];

    setDraft('');

    setError('');

    setRunError('');

    setRunning(true);

    setDelegateStatus(`${label} is working on the task `);

    emitMascot('prompt:send');

    emitMascot('agent:thinking');

    agent.addMessage({

      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,

      role: 'user',

      content: `Delegated to ${label} in the agent runtime: ${task}`,

    });

    try {

      let detail = await createAgentTask(task, dot.id, agentId);

      const started = Date.now();

      while (

        !['completed', 'failed', 'cancelled'].includes(detail.status) &&

        Date.now() - started < 180_000

      ) {

        setDelegateStatus(

          `${label}   ${detail.status}   ${detail.completedSubtasks}/${detail.subtaskCount} specialists`,

        );

        await delay(1500);

        detail = await getAgentTask(detail.id);

      }

      if (!['completed', 'failed', 'cancelled'].includes(detail.status))

        throw new Error(

          `${label} is still running. Open Agents to follow this task.`,

        );

      if (detail.status !== 'completed')

        throw new Error(

          detail.error ??

            `${label} could not complete the task. See Agents for the trace.`,

        );

      agent.addMessage({

        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,

        role: 'assistant',

        content:

          detail.synthesis ??

          'The agent completed without a written synthesis. Its reports are in the Agents → Queries mail threads.',

      });

      emitMascot('agent:reply');

      emitMascot('agent:done');

      onSaved();

    } catch (caught) {

      emitMascot('agent:error');

      setRunError(

        caught instanceof Error

          ? caught.message

          : 'The delegated task failed.',

      );

    } finally {

      setRunning(false);

      setDelegateStatus('');

      emitMascot('app:idle');

    }

  };



  const submitComposer = async (override?: string) => {

    const value = (override ?? draft).trim();

    if (!value && !attachments.length) return;

    playCue('sent');
    setCmdMenuOpen(false);
    const mention = value.match(/^@([a-zA-Z0-9_-]+)\s+([\s\S]+)$/);
    if (mention) {
      setDraft('');
      await delegateToAgent(mention[1], mention[2]);
      return;
    }

    if (value.startsWith('/')) {

      const [rawCmd, ...rest] = value.slice(1).split(/\s+/);

      const command = rawCmd.toLowerCase();

      const payload = rest.join(' ');

      if (command === 'summary') {

        setDraft('');

        void send('Please summarize this conversation so far, concisely.');

        return;

      }

      if (command === 'voice') {

        setDraft('');

        setInlineVoice(true);

        return;

      }

      if (command === 'draw' || command === 'whiteboard') {

        setDraft('');

        const topic = rest.join(' ').trim().toLowerCase();

        const shapes = /shape|primitive|arrow|circle|box|polygon|highlight/.test(topic);

        openPenBoard(shapes ? 'shapes' : 'pyth');

        return;

      }

      if (command === 'call') {

        setDraft('');

        const widget = rest.join(' ').trim();

        if (!widget) {

          setError(

            'Usage: /call <widget> — examples: /call weather, /call meeting, /call tasks, /call system, /call timer.',

          );

          return;

        }

        // The widget renders in the notch, resolved against its real card data.

        window.dispatchEvent(new CustomEvent('aegis:call-widget', { detail: widget }));

        return;

      }

      if (command === 'rate') {

        const [agentName, ...taskWords] = rest;

        if (!agentName) {

          setError(

            'Usage: /rate <agent> <task>   agents: Aegis, RFI, Sentinel, Filo, Memo, Operator.',

          );

          return;

        }

        const task = taskWords.join(' ') || payload;

        await delegateToAgent(agentName, task);

        return;

      }

      if (command === 'agent') {

        const [agentName, ...taskWords] = rest;

        if (!agentName) {

          setError(

            'Usage: /agent <agent> <task>. Use /rate to call a runtime agent from chat.',

          );

          return;

        }

        await delegateToAgent(agentName, taskWords.join(' '));

        return;

      }

      if (command === 'help') {

        setError(SLASH_HELP);

        return;

      }

      const navTarget = NAV_COMMANDS[command];

      if (navTarget) {

        try {

          window.dispatchEvent(

            new CustomEvent('aegis:nav', { detail: navTarget }),

          );

        } catch {

          // Navigation is best-effort; the command still clears.

        }

        setDraft('');

        return;

      }

      setError(`Unknown slash command "/${command}". ${SLASH_HELP}`);

      return;

    }

    const files = attachments;

    await send(

      `${source ? `From ${source}:\n\n` : ''}${value}`,

      files,

    );

  };

  useEffect(() => {

    if (loaded && contextReady && !paused && (initialPrompt || (initialAttachments && initialAttachments.length > 0)) && !sent.current) {

      sent.current = true;

      onConsumed();

      void send(initialPrompt || '', initialAttachments || []);

    }

  }, [loaded, contextReady, paused, initialPrompt, initialAttachments]);

  useEffect(() => {

    bottom.current?.scrollIntoView({ behavior: 'instant', block: 'end' });

  }, [agent.messages.length, running]);

  useEffect(() => {

    if (paused) {
      setInlineVoice(false);
      stopSharedVoice?.();
    }

  }, [paused, stopSharedVoice]);

  // Leaving voice mode must always release the microphone. Without this the
  // session kept listening in the background after the UI fell back to text.
  const wasInlineVoice = useRef(false);
  useEffect(() => {
    if (wasInlineVoice.current && !inlineVoice) {
      stopSharedVoice?.();
    }
    wasInlineVoice.current = inlineVoice;
  }, [inlineVoice, stopSharedVoice]);

  useHumanInTheLoop(

    {

      name: pageReviewTool.name,

      description: pageReviewTool.description,

      parameters: pageReviewSchema,

      render: (props) => (

        <PageReviewCard {...props} threadId={thread.id} onSaved={onSaved} />

      ),

    },

    [thread.id, onSaved],

  );

  useHumanInTheLoop(

    {

      name: connectionActionTool.name,

      description: connectionActionTool.description,

      parameters: connectionActionSchema,

      render: (props) => (

        <ConnectionActionCard {...props} threadId={thread.id} />

      ),

    },

    [thread.id],

  );

  // AEGIS (W-GEN): CopilotKit frontend tools (the v2 mechanism this

  // version of @copilotkit/react-core provides   there is no

  // useCopilotAction in v2). The handlers run in the browser against

  // the real APIs and return the real payloads; the renders are the

  // generative-UI cards. DotAgent forwards these to the model only

  // under their canonical shared definitions (generative-ui.ts).

  useFrontendTool(

    {

      name: providerStatusTool.name,

      description: providerStatusTool.description,

      parameters: providerStatusSchema,

      // AEGIS (W-FIX 1c): the handler's return value is DELIVERED BACK

      // to the model as the tool result. Returning the raw

      // getProviders() payload shipped the whole models.dev catalogue

      // (238 providers with model lists, ~20k tokens) with it   strict

      // providers rejected the follow-up run (Groq: 413, 8k TPM limit)

      // and CopilotKit surfaced it as a generative-UI "delivery

      // failed". The model gets a compact summary; the CARD fetches

      // the full payload itself for rendering (GenerativeCards.tsx).

      handler: async () => {

        const full = await getProviders();

        return {

          active: full.active,

          configured: full.providers

            .filter((provider) => provider.configured)

            .map((provider) => provider.id),

          notConfigured: full.providers

            .filter((provider) => !provider.configured)

            .map((provider) => provider.id),

          catalogueSource: full.catalogueSource ?? null,

          catalogueProviderCount: full.catalogue?.length ?? 0,

        };

      },

      render: (props) => (

        <ProviderStatusCard

          status={String(props.status)}

          args={props.args}

          result={props.result}

        />

      ),

    },

    [],

  );

  useFrontendTool(

    {

      name: memorySourcesTool.name,

      description: memorySourcesTool.description,

      parameters: memorySourcesSchema,

      handler: async ({ query }) => {

        const search = await searchAegisMemory(query);

        // Enrich the top hits with their capture records so the card

        // (and the model) get real provenance: source + capture id.

        const results = await Promise.all(

          search.results.slice(0, 5).map(async (hit) => {

            // W-FIX 1c: cap excerpt length in the delivered payload  

            // it returns to the model as the tool result.

            const capped = {

              ...hit,

              text: typeof hit.text === 'string' ? hit.text.slice(0, 400) : hit.text,

            };

            try {

              const detail = await getAegisCapture(hit.capture_id);

              return {

                ...capped,

                source: detail.capture?.source ?? null,

                kind: detail.capture?.kind ?? null,

              };

            } catch {

              return { ...capped, source: null, kind: null };

            }

          }),

        );

        return { ...search, query, results };

      },

      render: (props) => (

        <MemorySourcesCard

          status={String(props.status)}

          args={props.args}

          result={props.result}

        />

      ),

    },

    [],

  );

  // AEGIS (W-GEN 2): the model's generative-UI tool. The browser handler only

  // acknowledges the spec (the card renders it from `args`), so nothing large

  // travels back to the model on the follow-up run.

  useFrontendTool(

    {

      name: visualUiTool.name,

      description: visualUiTool.description,

      parameters: visualUiSchema,

      handler: async (spec): Promise<VisualUiAck> => ({

        rendered: true,

        ...(spec.title ? { title: spec.title } : {}),

        blocks: spec.blocks.map((block) => block.type),

      }),

      render: (props) => (

        <VisualUiCard

          args={props.args}

          status={String(props.status)}

          result={props.result}

        />

      ),

    },

    [],

  );

  // The pen board frontend tool: the model can open the drawing surface and
  // run a scripted teaching demo (e.g. Pythagoras) the same way the desktop
  // annotations overlay does — it just happens inside the app.
  useFrontendTool(
    {
      name: 'aegis_penboard',
      description:
        'Open the Aegis pen board and run a scripted teaching demo drawn with a hand-like pen. Use it to explain concepts visually: "pyth" draws a right-angled triangle with squares proving a² + b² = c²; "shapes" draws every drawing primitive (arrow, box, circle, polygon, highlight, angle, text).',
      parameters: z.object({
        demo: z.enum(['pyth', 'shapes']).default('pyth'),
      }),
      handler: async (args: { demo?: 'pyth' | 'shapes' }) => {
        const demo = args?.demo === 'shapes' ? 'shapes' : 'pyth';
        openPenBoard(demo);
        return { ok: true, opened: true, demo };
      },
      render: () => null,
    },
    [],
  );

  const computerCalls = agent.messages.flatMap((message) =>

    message.role === 'assistant' ? (message.toolCalls ?? []) : [],

  );

  const latestBrowserCall = computerCalls.findLast((call) =>

    [

      'navigate',

      'snapshot',

      'read',

      'screenshot',

      'click',

      'type',

      'key',

      'scroll',

    ].some((action) => call.function.name === `computer_${action}`),

  );

  useRenderTool(

    {

      name: '*',

      render: (props: ComputerToolRenderProps) =>

        props.name.startsWith('computer_') ? (

          <ComputerToolCard

            {...props}

            dotId={dot.id}

            dotName={dot.name}

            running={running}

            showScreen={props.toolCallId === latestBrowserCall?.id}

            onExpand={onBrowser}

          />

        ) : props.name === 'read_public_page' ? (

          <BrowserActivityCard {...props} />

        ) : null,

    },

    [dot.id, dot.name, running, latestBrowserCall?.id, onBrowser],

  );

  // The browser is never a silent background job: as soon as a browsing tool

  // starts, the AEGIS Computer pane opens so the owner watches it work.

  const visualsLive = agent.messages.some(

    (message) =>

      message.role === 'assistant' &&

      message.toolCalls?.some(

        (call) => call.function.name === visualUiTool.name,

      ),

  );

  // A read-only page read is browsing too: open the pane on Computer as soon

  // as the tool call appears, not when its brief arrives.

  const latestReadCall = computerCalls.findLast(

    (call) => call.function.name === 'read_public_page',

  );

  const openedReadCall = useRef('');

  useEffect(() => {

    // Only a live run may pull the preview open. Replaying a stored thread

    // must never start or pop the live screen by itself.

    if (!running) return;

    const id = latestReadCall?.id;

    if (!id || openedReadCall.current === id) return;

    openedReadCall.current = id;

    onBrowser?.();

  }, [latestReadCall?.id, onBrowser, running]);

  const openedBrowserCall = useRef('');

  useEffect(() => {

    if (!running) return;

    const id = latestBrowserCall?.id;

    if (!id || openedBrowserCall.current === id) return;

    openedBrowserCall.current = id;

    onBrowser?.();

  }, [latestBrowserCall?.id, onBrowser, running]);

  // Screen guidance: a live computer_annotate call is drawn over the owner's

  // real desktop by the Electron annotation window. Replay never redraws an

  // old annotation, and a clear call removes the overlay.

  const lastDrawnAnnotation = useRef('');

  useEffect(() => {

    if (!running) return;

    const bridge = (

      window as unknown as {

        aegis?: {

          annotateScreen?: (payload: unknown) => void;

          clearAnnotations?: () => void;

        };

      }

    ).aegis;

    if (!bridge) return;

    const clear = computerCalls.findLast(

      (call) => call.function?.name === 'computer_clear_annotations',

    );

    const annotate = computerCalls.findLast(

      (call) => call.function?.name === 'computer_annotate',

    );

    const latest = annotate && annotate.id !== lastDrawnAnnotation.current ? annotate : null;

    if (latest) {

      let args: Record<string, unknown> = {};

      try {

        args =

          typeof latest.function.arguments === 'string'

            ? (JSON.parse(latest.function.arguments) as Record<string, unknown>)

            : ((latest.function.arguments ?? {}) as Record<string, unknown>);

      } catch {

        args = {};

      }

      const x = Number(args.x ?? 0);

      const y = Number(args.y ?? 0);

      const width = Number(args.width ?? 0);

      const height = Number(args.height ?? 0);
      // The tool takes a named box; the overlay consumes the packed
      // [top,left,bottom,right] order. Convert in one place.
      const box = args.bbox as
        | { top?: number; left?: number; bottom?: number; right?: number }
        | undefined;
      const bbox =
        box && typeof box === 'object'
          ? [box.top ?? 0, box.left ?? 0, box.bottom ?? 1, box.right ?? 1]
          : undefined;
      // With normalized bbox only there is no pixel origin to point at; let
      // the overlay aim at the resolved target centre instead of (0,0).
      const hasPoint =
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        (x !== 0 || y !== 0 || Array.isArray(bbox));

      bridge.annotateScreen?.({
        ...args,
        unit: args.unit || (box ? 'norm' : 'px'),
        targets: Array.isArray(args.targets)
          ? args.targets
          : [{ x, y, width, height, bbox, label: args.label, note: args.note, step: args.step, shape: args.shape, direction: args.direction }],
        pointer: args.pointer === false || !hasPoint
          ? null
          : (args.pointer || { x: width ? x + width / 2 : x, y: height ? y + height / 2 : y }),
        explanation: args.explanation || args.note,
      });

      lastDrawnAnnotation.current = latest.id;

      return;

    }

    if (clear && clear.id !== lastDrawnAnnotation.current) {

      bridge.clearAnnotations?.();

      lastDrawnAnnotation.current = clear.id;

    }

  }, [computerCalls, running]);

  // Mirror the live run into the Electron notch. This is the only writer of

  // notch state, so opening an old thread (running=false) settles it to idle

  // instead of replaying someone else's task.

  useEffect(() => {

    const bridge = (

      window as unknown as {

        aegis?: { setStatus?: (payload: Record<string, unknown>) => void };

      }

    ).aegis;

    if (!bridge?.setStatus) return;

    const latest = computerCalls.at(-1);

    const tool = latest?.function?.name?.replace(/^computer_/, '').replace(/_/g, ' ');

    const lastUser = [...agent.messages]

      .reverse()

      .find(

        (message) =>

          message.role === 'user' && typeof message.content === 'string',

      );

    const task =

      lastUser && typeof lastUser.content === 'string' ? lastUser.content.trim() : '';

    bridge.setStatus({

      state: running ? 'working' : 'idle',

      status: running ? (tool ? `Using ${tool}` : 'Working') : 'Ready',

      text: running ? task : 'Ready',

      runningCount: running ? 1 : 0,

    });

  }, [running, computerCalls.length, agent.messages.length]);

  const visible = agent.messages.filter(

    (message) =>

      !isInternalVoiceReceipt(message) &&

      ['user', 'assistant'].includes(message.role) &&

      ((typeof message.content === 'string' && message.content.trim()) ||

        (message.role === 'assistant' &&

          (('toolCalls' in message &&

            Array.isArray(message.toolCalls) &&

            message.toolCalls.length > 0) ||

            'reasoningContent' in message ||

            'thought' in message))),

  );

  const lastReportedReply = useRef('');

  useEffect(() => {

    const last = [...visible]

      .reverse()

      .find(

        (message) =>

          message.role === 'assistant' &&

          typeof message.content === 'string' &&

          message.content.trim(),

      );

    const text =

      last && typeof last.content === 'string' ? last.content.trim() : '';

    if (text && text !== lastReportedReply.current) {

      lastReportedReply.current = text;

      onReply?.(text);

    }

  }, [visible, onReply]);

  return (

    <div className={`live-chat ${inlineVoice ? 'voice-chat-mode' : ''}`}>

      <header className={`chat-persona ${inlineVoice ? 'voice-mode' : ''}`}>

        {!inlineVoice && (
  <img
    className="brand-shield chat-header-mark"
    src="/assets/aegis-mark.svg"
    alt="Aegis"
    width={36}
    height={36}
  />
)}

        <div className="chat-persona-copy">

          <strong>{dot.name}</strong>

          <span>

            {paused

              ? 'Paused'

              : running

                ? 'Thinking '

                : loaded && contextReady

                  ? runProvider
                    ? `Here with you · ${runProvider.provider} · ${runProvider.model}${runProvider.fallback ? ' · fallback' : ''}`
                    : providerLabel
                    ? `Here with you   ${providerLabel}`

                    : 'Here with you'

                  : 'Connecting to your conversation '}

          </span>

          {runProvider?.fallbackReason && (
            <small className="chat-provider-fallback" title={runProvider.fallbackReason}>
              {runProvider.fallbackReason}
            </small>
          )}

        </div>

        <div className="chat-persona-actions">

          <button

            className={`icon-button ${traceOpen ? 'active' : ''}`}

            aria-label="Toggle run trace details"

            aria-pressed={traceOpen}

            title={traceOpen ? 'Collapse all run traces' : 'Expand all run traces'}

            onClick={() => setTraceOpen(!traceOpen)}

          >

            <GitBranch size={18} />

          </button>

          <button

            className="icon-button"

            aria-label="Save conversation as page"

            disabled={running}

            onClick={async () => {

              const title = await promptText({

                title: 'Save conversation as page',

                label: 'Page title',

                defaultValue: thread.title,

                confirmLabel: 'Save page',

              });

              if (!title) return;

              try {

                const page = await api<Page>(

                  `/conversations/${thread.id}/page`,

                  'POST',

                  { title },

                );

                location.hash = `/spaces/${page.spaceId}/pages/${page.id}`;

              } catch (e) {

                setError(

                  e instanceof Error

                    ? e.message

                    : 'Could not save conversation.',

                );

              }

            }}

          >

            <FilePlus size={18} />

          </button>

          <button

            className="icon-button"

            aria-label="Schedule a task in this conversation"

            onClick={onSchedule}

          >

            <Clock3 size={18} />

          </button>

          <button
            className={`icon-button ${inlineVoice ? 'on-call' : ''}`}
            aria-label={inlineVoice ? 'Close local voice chat' : 'Start local voice chat'}
            title="Use Aegis local speech recognition, model, and speech synthesis"
            disabled={paused || !loaded || !contextReady}
            onClick={() => {
              if (inlineVoice) sharedVoice?.stop();
              setInlineVoice(!inlineVoice);
            }}
          >
            {inlineVoice ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

        </div>

      </header>

      {pageContext && (

        <div className="page-chat-context">

          Working on{' '}

          <a href={`/#/spaces/${pageContext.spaceId}/pages/${pageContext.id}`}>

            {pageContext.title}

          </a>

        </div>

      )}

      <BrowserPreviewContext.Provider

        value={{ threadId: thread.id, previews: livePreviews }}

      >

      <div className="chat-transcript">

        {!visible.length && (

          <div className="chat-welcome">

            <span className="eyebrow">A LITTLE SPACE TO THINK</span>

            <h1>What s on your mind?</h1>

            <p>{dot.instructions}</p>

            <p className="muted">

              Your conversation stays with this Agent, across text and calls.

            </p>

          </div>

        )}

        <ChatTranscript

          messages={visible}

          allMessages={agent.messages}

          calls={calls}

          readAloudLanguage={readAloudLanguage}

          agentName={dot.name}

          running={running}

          forceExpandTraces={traceOpen}

        />

        {!visualsLive &&

          savedVisuals.map((visual) => (

            <VisualUiCard

              key={visual.id}

              args={visual.spec}

              status="complete"

            />

          ))}

        {brief?.text && (

          <ResearchBriefCard result={brief} onOpen={onOpenBrief} />

        )}

        {running && visible.at(-1)?.role === 'user' && (

          <InlineRunTrace

            running

            agentName={dot.name}

            allMessages={agent.messages}

            defaultExpanded

          />

        )}



        <div ref={bottom} />

      </div>

      </BrowserPreviewContext.Provider>

      {contextError && (

        <div className="chat-error" role="alert">

          {contextError}

          <button onClick={() => setContextAttempt((value) => value + 1)}>

            Retry context

          </button>

        </div>

      )}

      {chatError && (

        <div className="chat-error" role="alert">

          {chatError}

          {chatError && (

            <button

              onClick={() => {

                setError('');

                setRunError('');

                void copilotkit

                  .connectAgent({ agent })

                  .then(() => setLoaded(true))

                  .catch((e) => setError(e.message));

              }}

            >

              Reconnect

            </button>

          )}

        </div>

      )}


      {inlineVoice ? (

        <InlineVoiceBar

          language={readAloudLanguage}

          agentId={dot.id}

          dotId={dot.id}

          agentName={dot.name}

          onTurn={(role, text) => {

            void persistVoiceTurn(thread.id, role, text);

          }}

          onClose={() => setInlineVoice(false)}
        />

      ) : (

      <form

        className="chat-composer"

        onSubmit={(e) => {

          e.preventDefault();

          void submitComposer();

        }}

      >

        <input
          ref={attachInput}
          type="file"
          multiple
          hidden
          accept="image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown,application/json,text/csv,application/pdf,.pdf,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.zip,.md,.txt,.json,.csv,.log,.ts,.tsx,.js,.jsx,.py,.html,.css,.yml,.yaml,.xml,.toml,.ini"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            void addFiles(files);
          }}
        />
        {trayFileNotice && <div className="muted chat-tray-file-notice" role="status">{trayFileNotice}</div>}
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
        {sourceOpen && (

          <div className="source-input">

            <Link2 size={15} />

            <input

              aria-label="Source page URL"

              type="url"

              value={source}

              onChange={(e) => setSource(e.target.value)}

              placeholder="https://example.com/page"

            />

            <button

              type="button"

              className="icon-button"

              aria-label="Remove source"

              onClick={() => {

                setSourceOpen(false);

                setSource('');

              }}

            >

              <X size={14} />

            </button>

          </div>

        )}

        <div className="chat-compose-row">

          <button

            type="button"

            className="icon-button"

            aria-label="Add source page link"

            title="Add a source page link"

            onClick={() => setSourceOpen(!sourceOpen)}

          >

            <Link2 size={19} />

          </button>

          <button

            type="button"

            className="icon-button"

            aria-label="Attach images or files"

            title="Attach images or text files"

            onClick={() => attachInput.current?.click()}

          >

            <Paperclip size={18} />

          </button>

          <textarea

            ref={composerRef}

            aria-label="Message your Agent"

            placeholder={`Message ${dot.name}...`}

            rows={1}

            value={draft}

            maxLength={4000}

            onChange={(e) => {

              const val = e.target.value;

              setDraft(val);

              // Detect / and @ commands

              const lastChar = val[val.length - 1];

              const atIndex = val.lastIndexOf('@');

              const slashIndex = val.indexOf('/');

              const lastSpace = Math.max(val.lastIndexOf(' '), val.lastIndexOf('\n'));

              if (slashIndex >= 0 && (slashIndex === 0 || val[slashIndex - 1] === ' ' || slashIndex === val.length - 1)) {

                setCmdMenuOpen(true);

                setCmdType('slash');

                setCmdCursorPos(slashIndex);

                // Position menu near cursor
                const el = composerRef.current;

                if (el) {

                  const rect = el.getBoundingClientRect();

                  const lineHeight = parseInt(window.getComputedStyle(el).lineHeight) || 20;

                  // Approximate cursor position based on character index

                  const charsBefore = val.slice(0, slashIndex);

                  const lines = charsBefore.split('\n');

                  const currentLine = lines[lines.length - 1].length;

                  const lineIndex = lines.length - 1;

                  const charWidth = parseInt(window.getComputedStyle(el).fontSize) * 0.6;

                  setCmdMenuPosition({

                    x: rect.left + currentLine * charWidth + 4,

                    y: rect.top + lineIndex * lineHeight + 4,

                  });

                }

              } else if (atIndex >= 0 && (atIndex === 0 || val[atIndex - 1] === ' ')) {

                setCmdMenuOpen(true);

                setCmdType('at');

                setCmdCursorPos(atIndex);

                // Position menu near cursor

                const el = composerRef.current;

                if (el) {

                  const rect = el.getBoundingClientRect();

                  const lineHeight = parseInt(window.getComputedStyle(el).lineHeight) || 20;

                  const charsBefore = val.slice(0, atIndex);

                  const lines = charsBefore.split('\n');

                  const currentLine = lines[lines.length - 1].length;

                  const lineIndex = lines.length - 1;

                  const charWidth = parseInt(window.getComputedStyle(el).fontSize) * 0.6;

                  setCmdMenuPosition({

                    x: rect.left + currentLine * charWidth + 4,

                    y: rect.top + lineIndex * lineHeight + 4,

                  });

                }

              } else if (val.trim() === '' || (slashIndex <= lastSpace && atIndex <= lastSpace)) {

                setCmdMenuOpen(false);

              }

            }}

            onPaste={(e) => {

              const files = Array.from(e.clipboardData.files ?? []);

              if (files.length) {

                e.preventDefault();

                void addFiles(files);

              }

            }}

            onKeyDown={(e) => {

              if (cmdMenuOpen && e.key === 'Enter') {

                e.preventDefault();

                setCmdMenuOpen(false);

                void submitComposer();

                return;

              }

              if (cmdMenuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {

                e.preventDefault();

                return;

              }

              if (shouldSubmitComposerOnKeyDown(e)) {

                e.preventDefault();

                e.currentTarget.form?.requestSubmit();

              }

              // Close command menu on Escape

              if (e.key === 'Escape') {

                e.preventDefault();

                setCmdMenuOpen(false);

              }

              

            }}

          />

          {/* Command menu for / and @ */}
          {cmdMenuOpen && (
            <div
              className="cmd-menu"
              style={{
                position: 'fixed',
                zIndex: 60,
                left: cmdMenuPosition.x,
                top: cmdMenuPosition.y,
              }}
            >
              {cmdType === 'slash' ? (
                <div className="cmd-section">
                  <span className="cmd-label">Commands</span>
                  <div className="cmd-item" onClick={() => void submitComposer('/help')}> /help - Show available commands</div>
                  <div className="cmd-item" onClick={() => void submitComposer('/agents')}> /agents - List available agents</div>
                  <div className="cmd-item" onClick={() => void submitComposer('/computer')}> /computer - Open computer control</div>
                  <div className="cmd-item" onClick={() => void submitComposer('/browser')}> /browser - Open browser control</div>
                  <div className="cmd-item" onClick={() => void submitComposer('/settings')}> /settings - Open settings</div>
                  <div className="cmd-item" onClick={() => void submitComposer('/memory')}> /memory - View memory</div>
                  <div className="cmd-item" onClick={() => void submitComposer('/research')}> /research - Start research</div>
                  <div className="cmd-item" onClick={() => { setDraft('/computer'); setCmdMenuOpen(false); }}> /computer - Open computer control</div>
                  <div className="cmd-section">
                    <span className="cmd-label">Agents</span>
                    <div className="cmd-item" onClick={() => { setDraft('/computer agent'); setCmdMenuOpen(false); }}> Change model</div>
                    <div className="cmd-item" onClick={() => { setDraft('/computer add'); setCmdMenuOpen(false); }}> Add command</div>
                    <div className="cmd-item" onClick={() => { setDraft('/agents'); setCmdMenuOpen(false); }}> Add agents</div>
                  </div>
                </div>
              ) : (
                <div className="cmd-section">
                  <span className="cmd-label">Mention agent</span>
                  {Object.entries(AGENT_ALIASES).map(([alias, id]) => (
                    <div className="cmd-item" key={id} onClick={() => { setDraft(`@${alias} `); setCmdMenuOpen(false); }}> @{alias} - {AGENT_LABELS[id as keyof typeof AGENT_LABELS] || alias}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            className="icon-button"
            aria-label="Start voice chat"
            title="Start a local voice chat with the agent"
            disabled={paused || !loaded || !contextReady}
            onClick={() => {
              stopSharedVoice?.();
              setInlineVoice(true);
            }}
          >
            <Mic size={18} />
          </button>

          {running ? (

            <button

              type="button"

              className="send-button"

              aria-label="Stop response"

              onClick={() => copilotkit.stopAgent({ agent })}

            >

              <Square size={16} />

            </button>

          ) : (

            <button

              className="send-button"

              aria-label="Send message"

              disabled={

                (!draft.trim() && !attachments.length) ||

                !loaded ||

                !contextReady ||

                paused

              }

            >

              <ArrowUp size={19} />

            </button>

          )}

        </div>

        <div className="chat-compose-note">

          {delegateStatus ? (

            <span className="chat-delegate-status">

              <Loader2 size={12} className="spin" /> {delegateStatus}

            </span>

          ) : attachments.length ? (

            `${attachments.length} attachment${attachments.length === 1 ? '' : 's'} ready   images need a vision-capable model`

          ) : (

            'Text, files, and local voice use one conversation.'

          )}

        </div>

      </form>

      )}

    </div>

  );

}

