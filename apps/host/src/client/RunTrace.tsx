import { useEffect, useRef, useState } from 'react';
import type { AssistantMessage, Message } from '@ag-ui/core';
import type { CharacterName } from 'aegis-mascot';
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Globe,
  Loader2,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import { getBrandLogo } from './BrandIcons';

// Maps tools or subagent delegations to character personas
export function characterForToolOrSubagent(name?: string | null): CharacterName | null {
  if (!name || typeof name !== 'string') return null;
  const n = name.toLowerCase();
  if (n.includes('mail') || n.includes('gmail')) return 'mail';
  if (
    n.includes('social') ||
    n.includes('chat') ||
    n.includes('whatsapp') ||
    n.includes('slack')
  )
    return 'social';
  if (
    n.includes('file') ||
    n.includes('page') ||
    n.includes('pdf') ||
    n.includes('drive') ||
    n.includes('doc')
  )
    return 'files';
  if (
    n.includes('memory') ||
    n.includes('research') ||
    n.includes('search') ||
    n.includes('recall')
  )
    return 'memory';
  if (
    n.includes('computer') ||
    n.includes('terminal') ||
    n.includes('harness') ||
    n.includes('bash') ||
    n.includes('exec') ||
    n.includes('harness') ||
    n.includes('browse')
  )
    return 'harness';
  if (
    n.includes('security') ||
    n.includes('permission') ||
    n.includes('review') ||
    n.includes('vault')
  )
    return 'security';
  return null;
}

// Parses <think>...</think> or [thinking]...[/thinking] out of raw content
export function parseMessageContent(rawContent?: string | null): {
  thought: string | null;
  content: string;
} {
  if (typeof rawContent !== 'string' || !rawContent) return { thought: null, content: '' };
  const thinkMatch = rawContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
  if (thinkMatch) {
    const thought = thinkMatch[1].trim();
    const clean = rawContent
      .replace(/<think>[\s\S]*?(?:<\/think>|$)/i, '')
      .trim();
    return { thought: thought || null, content: clean };
  }
  const reasoningMatch = rawContent.match(
    /\[thinking\]([\s\S]*?)(?:\[\/thinking\]|$)/i,
  );
  if (reasoningMatch) {
    const thought = reasoningMatch[1].trim();
    const clean = rawContent
      .replace(/\[thinking\][\s\S]*?(?:\[\/thinking\]|$)/i, '')
      .trim();
    return { thought: thought || null, content: clean };
  }
  return { thought: null, content: rawContent };
}

export type TraceStep = {
  id: string;
  name: string;
  detail: string;
  kind: 'tool' | 'specialist' | 'reply' | 'orchestrator';
  status: 'done' | 'active';
  result?: string;
};

const SPECIALIST =
  /(agent|spawn|delegate|subagent|task|specialist|handoff|research|browse|computer)/i;

function humanize(name: string) {
  if (!name) return 'Tool';
  return name
    .replace(/^functions?\./, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function describeArguments(raw: unknown) {
  if (!raw) return '';
  if (typeof raw === 'object' && raw !== null) {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return '';
    }
  }
  if (typeof raw !== 'string') return String(raw);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const interesting =
      parsed.query ??
      parsed.url ??
      parsed.path ??
      parsed.command ??
      parsed.prompt ??
      parsed.task ??
      parsed.agent ??
      parsed.message ??
      parsed.code;
    if (typeof interesting === 'string') return interesting;
    if (typeof interesting === 'object' && interesting !== null) {
      return JSON.stringify(interesting, null, 2);
    }
    const entries = Object.entries(parsed);
    if (!entries.length) return '';
    return entries.map(([k, v]) => `${k}: ${String(v)}`).join('\n');
  } catch {
    return raw;
  }
}

function truncateText(text: string, maxLen = 300) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)} `;
}

export function buildStepsFromMessage(
  message?: AssistantMessage,
  allMessages: Message[] = [],
): TraceStep[] {
  if (!message) return [];
  const safeAllMessages = Array.isArray(allMessages) ? allMessages.filter(Boolean) : [];
  const completedResults = new Map<string, string>();
  for (const m of safeAllMessages) {
    if (m && m.role === 'tool' && 'toolCallId' in m && m.toolCallId) {
      completedResults.set(
        String(m.toolCallId),
        typeof m.content === 'string' ? m.content : '',
      );
    }
  }

  const steps: TraceStep[] = [];
  const rawCalls =
    message && 'toolCalls' in message && Array.isArray(message.toolCalls)
      ? message.toolCalls
      : [];

  const calls = Array.isArray(rawCalls) ? rawCalls.filter(Boolean) : [];

  for (const call of calls) {
    const fn = (call as unknown as { function?: { name?: string; arguments?: string } }).function;
    const directName = (call as unknown as { name?: string }).name;
    const name = fn?.name ?? directName ?? 'tool';
    const id = call.id ?? `${name}-${steps.length}`;
    const specialist = SPECIALIST.test(name);
    const hasResult = completedResults.has(id);
    const resultRaw = completedResults.get(id);
    const rawArgs = fn?.arguments ?? (call as unknown as { args?: unknown }).args ?? '';

    steps.push({
      id,
      name: humanize(name),
      detail: describeArguments(rawArgs),
      kind: specialist ? 'specialist' : 'tool',
      status: hasResult ? 'done' : 'active',
      result: resultRaw ? truncateText(resultRaw, 300) : undefined,
    });
  }

  return steps;
}

export function InlineRunTrace({
  message,
  allMessages = [],
  running = false,
  agentName = 'Aegis',
  thought: propThought,
  defaultExpanded,
}: {
  message?: AssistantMessage;
  allMessages?: Message[];
  running?: boolean;
  agentName?: string;
  thought?: string | null;
  defaultExpanded?: boolean;
}) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  // The header control expands or collapses every trace in the conversation.
  // Without this reset a trace the reader opened once would ignore that control
  // forever, which is why the button used to look like it did nothing.
  const lastDefaultExpanded = useRef(defaultExpanded);
  useEffect(() => {
    if (lastDefaultExpanded.current === defaultExpanded) return;
    lastDefaultExpanded.current = defaultExpanded;
    setUserExpanded(null);
  }, [defaultExpanded]);

  // Extract thinking if not passed directly
  let thought = propThought;
  if (!thought && message) {
    const rawContent = typeof message.content === 'string' ? message.content : '';
    const parsed = parseMessageContent(rawContent);
    thought =
      parsed.thought ??
      (message as unknown as { reasoningContent?: string }).reasoningContent ??
      (message as unknown as { thought?: string }).thought ??
      (message as unknown as { metadata?: { thought?: string; reasoning?: string } })
        .metadata?.thought ??
      (message as unknown as { metadata?: { thought?: string; reasoning?: string } })
        .metadata?.reasoning ??
      null;
  }

  const steps = buildStepsFromMessage(message, allMessages);
  const toolsCount = steps.filter((s) => s.kind === 'tool').length;
  const specialistsCount = steps.filter((s) => s.kind === 'specialist').length;

  const hasContent = !!thought || steps.length > 0 || running;
  if (!hasContent) return null;

  // Auto-expanded if running or explicitly requested; collapsed by default once done unless clicked
  const isExpanded =
    userExpanded !== null ? userExpanded : defaultExpanded ?? running;

  return (
    <div className="inline-run-trace" data-running={running ? 'true' : 'false'}>
      <button
        type="button"
        className="inline-run-trace-summary"
        aria-expanded={isExpanded}
        onClick={() => setUserExpanded(!isExpanded)}
      >
        <span className="inline-run-trace-title">
          {running ? (
            <Loader2 size={14} className="spin inline-run-trace-icon-spin" />
          ) : (
            <Brain size={14} className="inline-run-trace-icon-done" />
          )}
          <strong>
            {running
              ? `${agentName} is thinking & coordinating `
              : 'Thought process & run trace'}
          </strong>
        </span>

        <div className="inline-run-trace-badges">
          {thought && (
            <span className="inline-run-trace-badge">Thinking</span>
          )}
          {toolsCount > 0 && (
            <span className="inline-run-trace-badge">
              {toolsCount} tool{toolsCount === 1 ? '' : 's'}
            </span>
          )}
          {specialistsCount > 0 && (
            <span className="inline-run-trace-badge specialist">
              {specialistsCount} specialist{specialistsCount === 1 ? '' : 's'}
            </span>
          )}
          {running && (
            <span className="inline-run-trace-badge active">Active</span>
          )}
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {isExpanded && (
        <div className="inline-run-trace-content">
          {thought && (
            <div className="inline-thought-block">
              <div className="inline-thought-header">
                <Brain size={13} />
                <span>Model Thinking & Chain of Thought</span>
              </div>
              <div className="inline-thought-body">{thought}</div>
            </div>
          )}

          {steps.length > 0 && (
            <ul className="inline-trace-steps">
              {steps.map((step) => {
                const isSpecialist = step.kind === 'specialist';
                const brandLogo = !isSpecialist ? getBrandLogo({ name: step.name, command: step.name }, 14) : null;
                return (
                  <li
                    key={step.id}
                    className="inline-trace-step"
                    data-kind={step.kind}
                    data-status={step.status}
                  >
                    <span className="inline-trace-step-icon">
                      {brandLogo ? (
                        brandLogo
                      ) : isSpecialist ? (
                        <GitBranch size={13} />
                      ) : step.name.toLowerCase().includes('terminal') ||
                        step.name.toLowerCase().includes('computer') ? (
                        <SquareTerminal size={13} />
                      ) : step.name.toLowerCase().includes('browse') ||
                        step.name.toLowerCase().includes('web') ||
                        step.name.toLowerCase().includes('playwright') ? (
                        <Globe size={13} />
                      ) : (
                        <Wrench size={13} />
                      )}
                    </span>
                    <div className="inline-trace-step-info">
                      <div className="inline-trace-step-header">
                        <span className="inline-trace-step-name">
                          {step.name}
                        </span>
                        {isSpecialist && (
                          <span className="inline-trace-step-tag">
                            Specialist
                          </span>
                        )}
                      </div>
                      {step.detail && (
                        <pre className="inline-trace-step-detail">
                          {step.detail}
                        </pre>
                      )}
                      {step.result && (
                        <div className="inline-trace-step-result">
                          <strong>Output:</strong> {step.result}
                        </div>
                      )}
                    </div>
                    <span className="inline-trace-step-status">
                      {step.status === 'active' ? (
                        <Loader2 size={13} className="spin" />
                      ) : (
                        <Check size={13} />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {running && !steps.length && !thought && (
            <div className="inline-trace-step" data-kind="orchestrator" data-status="active">
              <span className="inline-trace-step-icon">
                <Bot size={13} />
              </span>
              <div className="inline-trace-step-info">
                <span className="inline-trace-step-name">{agentName}</span>
                <span className="inline-trace-step-detail">
                  Analyzing context and planning the response 
                </span>
              </div>
              <span className="inline-trace-step-status">
                <Loader2 size={13} className="spin" />
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Backward-compatibility alias
export const RunTrace = InlineRunTrace;
