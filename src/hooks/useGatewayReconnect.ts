import useSWR from 'swr';

import { agentRuntimeService } from '@/services/agentRuntime';
import { useChatStore } from '@/store/chat';
import { useServerConfigStore } from '@/store/serverConfig';

interface RunningOperation {
  assistantMessageId: string;
  operationId: string;
  scope?: string;
  threadId?: string | null;
}

/**
 * Auto-reconnect to a running Gateway / SSE server operation on the given topic.
 *
 * The caller sources `runningOperation` itself — the chat-store topic map
 * (main agent) and the task-detail activity (task drawer) live in different
 * stores, so this hook stays source-agnostic.
 *
 * Uses SWR with operationId as the key so the same operation deduplicates
 * and only one reconnect attempt fires per op.
 *
 * Gateway mode: checks agentGatewayUrl.
 * SSE mode (self-hosted): checks enableServerAgentMode.
 */
export const useGatewayReconnect = (
  topicId: string | null | undefined,
  runningOperation: RunningOperation | null | undefined,
) => {
  const agentGatewayUrl = useServerConfigStore((s) => s.serverConfig.agentGatewayUrl);
  const enableServerAgent = useServerConfigStore((s) => s.serverConfig.enableServerAgentMode);

  const canReconnect = runningOperation && topicId && (!!agentGatewayUrl || !!enableServerAgent);

  useSWR(
    canReconnect ? ['reconnectServerOp', runningOperation.operationId] : null,
    async () => {
      if (!runningOperation || !topicId) return;

      // Check if the operation is still running on the server before reconnecting.
      // This prevents reconnecting to an operation that has already completed
      // but whose runningOperation metadata hasn't been cleared yet (race condition).
      try {
        const status = await agentRuntimeService.getOperationStatus(runningOperation.operationId);
        if (!status || status.status === 'done' || status.status === 'error') {
          console.log(
            `[useGatewayReconnect] Operation ${runningOperation.operationId} is no longer running (status: ${status?.status ?? 'unknown'}), skipping reconnect`,
          );
          return;
        }
      } catch (error) {
        // If the status check fails (e.g., operation not found), skip reconnect
        console.warn(
          `[useGatewayReconnect] Failed to check operation status for ${runningOperation.operationId}:`,
          error,
        );
        return;
      }

      const store = useChatStore.getState();

      if (agentGatewayUrl) {
        await store.reconnectToGatewayOperation({
          assistantMessageId: runningOperation.assistantMessageId,
          operationId: runningOperation.operationId,
          scope: runningOperation.scope,
          threadId: runningOperation.threadId,
          topicId,
        });
      } else if (enableServerAgent) {
        await store.reconnectToServerSseOperation({
          assistantMessageId: runningOperation.assistantMessageId,
          operationId: runningOperation.operationId,
          scope: runningOperation.scope,
          threadId: runningOperation.threadId,
          topicId,
        });
      }
    },
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};
