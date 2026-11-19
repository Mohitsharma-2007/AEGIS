import type { Message } from '@ag-ui/core';

// Message IDs survive Intelligence history replay even when metadata does not.
export const scheduledTaskMessagePrefix = 'aegis:scheduled_task:';

export function isScheduledTaskMessage(
  message?: Pick<Message, 'id' | 'role' | 'metadata'> | null,
): boolean {
  if (!message || message.role !== 'user') return false;
  if (typeof message.id === 'string' && message.id.startsWith(scheduledTaskMessagePrefix)) {
    return true;
  }
  const metadata = message.metadata;
  return (
    !!metadata &&
    typeof metadata === 'object' &&
    'aegisSource' in metadata &&
    metadata.aegisSource === 'scheduled_task'
  );
}
