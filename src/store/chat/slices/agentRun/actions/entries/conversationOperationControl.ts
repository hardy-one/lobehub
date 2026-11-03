import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { type ConversationContext } from '@lobechat/types';

import { type ChatInputEditor } from '@/features/ChatInput';
import { type OptimisticUpdateContext } from '@/store/chat/slices/message/actions/optimisticUpdate';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { type ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

export const stopGenerateMessage = (get: () => ChatStore): void => {
  const { activeAgentId, activeTopicId, cancelOperations } = get();

  // Cancel running agent-runtime operations in the current context —
  // client-side (execAgentRuntime), heterogeneous agent (execHeterogeneousAgent),
  // and Gateway-mode (execServerAgentRuntime).
  cancelOperations(
    {
      type: AI_RUNTIME_OPERATION_TYPES,
      status: 'running',
      agentId: activeAgentId,
      topicId: activeTopicId,
    },
    MESSAGE_CANCEL_FLAT,
  );
};

interface CancelSendMessageInServerParams {
  editor?: ChatInputEditor | null;
  get: () => ChatStore;
  target?: string | ConversationContext;
}

export const cancelSendMessageInServer = ({
  editor,
  get,
  target,
}: CancelSendMessageInServerParams): void => {
  const { activeAgentId, activeGroupId, activeThreadId, activeTopicId } = get();

  const activeContext: ConversationContext = {
    agentId: activeAgentId,
    groupId: activeGroupId,
    threadId: activeThreadId,
    topicId: activeTopicId,
  };
  const targetContext =
    typeof target === 'object'
      ? target
      : {
          ...activeContext,
          topicId: target ?? activeTopicId,
        };
  const contextKey = messageMapKey(targetContext);

  // Cancel operations in the operation system
  const operationIds = get().operationsByContext[contextKey] || [];

  operationIds.forEach((opId) => {
    const operation = get().operations[opId];
    if (operation && operation.type === 'sendMessage' && operation.status === 'running') {
      get().cancelOperation(opId, 'User cancelled');
    }
  });

  // An embedded conversation (for example the create-thread portal) owns a
  // separate editor even though ChatStore only tracks the most recently
  // mounted editor globally. Prefer the explicitly supplied editor. The
  // active-conversation fallback preserves the legacy call sites.
  const targetEditor =
    editor ?? (contextKey === messageMapKey(activeContext) ? get().mainInputEditor : null);
  if (targetEditor) {
    // Only the latest send can own the draft. Never fall back to a stale
    // snapshot from an earlier turn when stopping an accepted message.
    const operationId = [...operationIds]
      .reverse()
      .find((id) => get().operations[id]?.type === 'sendMessage');
    const operation = operationId ? get().operations[operationId] : undefined;
    if (operation?.status === 'cancelled' && operation.metadata.inputEditorTempState) {
      const snapshot = operation.metadata.inputEditorTempState;
      get().updateOperationMetadata(operation.id, { inputEditorTempState: null });
      targetEditor.setJSONState(snapshot);
    }
  }
};

export const clearSendMessageError = (get: () => ChatStore): void => {
  const { activeAgentId, activeGroupId, activeThreadId, activeTopicId } = get();
  const contextKey = messageMapKey({
    agentId: activeAgentId,
    groupId: activeGroupId,
    threadId: activeThreadId,
    topicId: activeTopicId,
  });
  const operationIds = get().operationsByContext[contextKey] || [];

  // Clear error message from all sendMessage operations in current context
  operationIds.forEach((opId) => {
    const op = get().operations[opId];
    if (op && op.type === 'sendMessage' && op.metadata.inputSendErrorMsg) {
      get().updateOperationMetadata(opId, { inputSendErrorMsg: undefined });
    }
  });
};

interface SwitchMessageBranchParams {
  branchIndex: number;
  context?: OptimisticUpdateContext;
  get: () => ChatStore;
  messageId: string;
}

export const switchMessageBranch = async ({
  branchIndex,
  context,
  get,
  messageId,
}: SwitchMessageBranchParams): Promise<void> => {
  const store = get();
  const messageContext = store.internal_getConversationContext(context);
  // A branch change only changes the displayed reply; it does not authorize
  // recovery of an old failure when its card mounts.
  store.revokeHeteroAutoRetry(messageContext);
  await get().optimisticUpdateMessageMetadata(
    messageId,
    { activeBranchIndex: branchIndex },
    context,
  );
};
