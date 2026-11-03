import type { ChatPluginPayload, ChatToolPayload, UIChatMessage } from '@lobechat/types';

type ApprovedToolCall = Partial<Omit<ChatToolPayload, 'id'>> & { id?: string };

export interface AddressableApprovalDecision {
  decision: 'approved';
  parentMessageId: string;
  toolCallId: string;
}

/**
 * The stored plugin columns deliberately omit the call id (it lives on
 * `tool_call_id`), but the runtime replays the approved call by id. Without
 * this merge a client-runtime approval cannot match its pending tool row.
 */
export const createApprovedToolCall = (
  toolCall: ApprovedToolCall | ChatPluginPayload | undefined,
  toolCallId: string | undefined,
): ApprovedToolCall => ({
  ...toolCall,
  id: toolCallId,
});

export const refreshApprovedToolCall = (
  approvedToolCall: ApprovedToolCall,
  refreshedToolMessage: Pick<UIChatMessage, 'plugin'> | undefined,
): ApprovedToolCall =>
  createApprovedToolCall(refreshedToolMessage?.plugin ?? approvedToolCall, approvedToolCall.id);

export const getAddressableApprovalDecisions = (
  toolMessageIds: string[],
  getToolMessage: (toolMessageId: string) => Pick<UIChatMessage, 'tool_call_id'> | undefined,
): AddressableApprovalDecision[] =>
  toolMessageIds.flatMap((toolMessageId) => {
    const toolCallId = getToolMessage(toolMessageId)?.tool_call_id;
    return toolCallId && !toolMessageId.startsWith('tmp_')
      ? [{ decision: 'approved' as const, parentMessageId: toolMessageId, toolCallId }]
      : [];
  });
