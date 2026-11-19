import { Fragment, useState, type ReactNode } from 'react';
import { PhoneOff, Volume2, VolumeX } from 'lucide-react';
import type { AssistantMessage, Message } from '@ag-ui/core';
import type { CallReceipt } from '../shared/types';
import { voiceReceiptMessagePrefix } from '../shared/voice-receipt';
import { isScheduledTaskMessage } from '../shared/scheduled-message';
import { readAloud, stopReadAloud } from './read-aloud';
import { InlineRunTrace, parseMessageContent } from './RunTrace';
import { RichMarkdown } from './RichMarkdown';

// These markers only control rendering; they do not confer trust or permissions.
export function isInternalVoiceReceipt(message?: Message | null): boolean {
  if (!message || message.role !== 'user') return false;
  const metadata = message.metadata;
  return (
    (typeof message.id === 'string' && message.id.startsWith(voiceReceiptMessagePrefix)) ||
    (!!metadata &&
      typeof metadata === 'object' &&
      'aegisSource' in metadata &&
      metadata.aegisSource === 'voice_receipt')
  );
}

function Receipt({ call }: { call: CallReceipt }) {
  return (
    <div className="call-receipt">
      <PhoneOff size={13} />
      <span>
        {call.status === 'failed'
          ? 'Call failed'
          : call.endedAt
            ? `${Math.round((call.endedAt - call.startedAt) / 1000)}s   Call ended`
            : 'Call in progress'}
      </span>
      {call.error && <small>{call.error}</small>}
    </div>
  );
}

type MessageContentPart = {
  type?: string;
  text?: string;
  source?: {
    type?: string;
    value?: string;
    url?: string;
    mimeType?: string;
  };
};

function contentParts(message: Message): MessageContentPart[] {
  const content = message.content as unknown;
  if (typeof content === 'string')
    return content ? [{ type: 'text', text: content }] : [];
  if (Array.isArray(content))
    return content.filter(
      (part): part is MessageContentPart =>
        !!part && typeof part === 'object',
    );
  return [];
}

function messageText(message: Message): string {
  return contentParts(message)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n\n');
}

function messageImages(
  message: Message,
): Array<{ src: string; mimeType: string }> {
  return contentParts(message)
    .filter((part) => part.type === 'image' && part.source)
    .map((part) => {
      const source = part.source;
      if (!source) return null;
      if (source.type === 'data' && source.value)
        return {
          src: source.value.startsWith('data:')
            ? source.value
            : `data:${source.mimeType ?? 'image/png'};base64,${source.value}`,
          mimeType: source.mimeType ?? 'image/png',
        };
      if (source.type === 'url' && source.url)
        return { src: source.url, mimeType: source.mimeType ?? 'image/*' };
      return null;
    })
    .filter((image): image is { src: string; mimeType: string } => !!image);
}

function AttachmentImages({ message }: { message: Message }) {
  const images = messageImages(message);
  if (!images.length) return null;
  return (
    <div className="chat-message-images">
      {images.map((image, index) => (
        <a
          key={`${image.src.slice(0, 40)}:${index}`}
          href={image.src}
          target="_blank"
          rel="noreferrer"
          className="chat-message-image-link"
        >
          <img
            src={image.src}
            alt={`Attachment ${index + 1}`}
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}

export function ChatTranscript({
  messages = [],
  allMessages,
  calls = [],
  renderTools,
  readAloudLanguage = 'auto',
  agentName = 'Aegis',
  running = false,
  forceExpandTraces,
}: {
  messages: Message[];
  allMessages?: Message[];
  calls: CallReceipt[];
  renderTools?: (message: AssistantMessage) => ReactNode;
  readAloudLanguage?: 'auto' | 'en' | 'hi' | 'hinglish';
  agentName?: string;
  running?: boolean;
  forceExpandTraces?: boolean;
}) {
  const safeMessages = Array.isArray(messages) ? messages.filter(Boolean) : [];
  const safeCalls = Array.isArray(calls) ? calls.filter(Boolean) : [];
  const safeAllMessages = Array.isArray(allMessages) ? allMessages : safeMessages;

  const ids = new Set(safeMessages.map((message) => message.id).filter(Boolean));
  const [speakingId, setSpeakingId] = useState<string>();

  const assistantMessages = safeMessages.filter((m) => m?.role === 'assistant');
  const latestAssistantId = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1]?.id : undefined;

  return (
    <>
      {safeCalls
        .filter(
          (call) => !call.anchorMessageId || !ids.has(call.anchorMessageId),
        )
        .map((call) => (
          <Receipt key={call.id} call={call} />
        ))}
      {safeMessages.map((message) => {
        if (!message) return null;
        if (message.role === 'assistant') {
          const rawContent = messageText(message);
          const { thought: parsedThought, content: cleanContent } =
            parseMessageContent(rawContent);
          const thought =
            parsedThought ??
            (message as unknown as { reasoningContent?: string })
              .reasoningContent ??
            (message as unknown as { thought?: string }).thought ??
            (
              message as unknown as {
                metadata?: { thought?: string; reasoning?: string };
              }
            ).metadata?.thought ??
            (
              message as unknown as {
                metadata?: { thought?: string; reasoning?: string };
              }
            ).metadata?.reasoning ??
            null;

          const hasToolCalls =
            'toolCalls' in message &&
            Array.isArray(message.toolCalls) &&
            message.toolCalls.length > 0;
          const hasTrace = !!thought || hasToolCalls;
          const isLatest = !!message.id && message.id === latestAssistantId;

          return (
            <Fragment key={message.id || Math.random()}>
              {hasTrace && (
                <InlineRunTrace
                  message={message as AssistantMessage}
                  allMessages={safeAllMessages}
                  thought={thought}
                  agentName={agentName}
                  running={running && isLatest}
                  defaultExpanded={forceExpandTraces}
                />
              )}
              {cleanContent.trim() ? (
                <div
                  className={`chat-bubble ${message.role}${isScheduledTaskMessage(message) ? ' scheduled' : ''}`}
                >
                  {isScheduledTaskMessage(message) && (
                    <span className="scheduled-message-label">Scheduled</span>
                  )}
                  <RichMarkdown>{cleanContent}</RichMarkdown>
                  <button
                    type="button"
                    className="read-aloud-button"
                    aria-label={
                      speakingId === message.id
                        ? 'Stop reading this reply'
                        : 'Read this reply aloud'
                    }
                    title={
                      speakingId === message.id
                        ? 'Stop reading'
                        : 'Read aloud (Piper)'
                    }
                    onClick={async (event) => {
                      event.stopPropagation();
                      if (speakingId === message.id) {
                        stopReadAloud();
                        setSpeakingId(undefined);
                        return;
                      }
                      stopReadAloud();
                      setSpeakingId(message.id);
                      try {
                        await readAloud(cleanContent, readAloudLanguage);
                      } finally {
                        setSpeakingId((current) =>
                          current === message.id ? undefined : current,
                        );
                      }
                    }}
                  >
                    {speakingId === message.id ? (
                      <VolumeX size={13} />
                    ) : (
                      <Volume2 size={13} />
                    )}
                  </button>
                </div>
              ) : null}
              {renderTools?.(message as AssistantMessage)}
              {safeCalls
                .filter((call) => call.anchorMessageId === message.id)
                .map((call) => (
                  <Receipt key={call.id} call={call} />
                ))}
            </Fragment>
          );
        }

        // User / other roles
        const userText = messageText(message);
        const userImages = messageImages(message);
        return (
          <Fragment key={message.id || Math.random()}>
            {(userText.trim() || userImages.length > 0) && (
              <div
                className={`chat-bubble ${message.role}${isScheduledTaskMessage(message) ? ' scheduled' : ''}`}
              >
                {isScheduledTaskMessage(message) && (
                  <span className="scheduled-message-label">Scheduled</span>
                )}
                <AttachmentImages message={message} />
                {userText.trim() && (
                  <RichMarkdown>{userText}</RichMarkdown>
                )}
              </div>
            )}
            {safeCalls
              .filter((call) => call.anchorMessageId === message.id)
              .map((call) => (
                <Receipt key={call.id} call={call} />
              ))}
          </Fragment>
        );
      })}
    </>
  );
}
