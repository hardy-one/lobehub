import type { ChatStreamPayload, ModelRuntimeHooks } from '@lobechat/model-runtime';
import type { UnknownRecord } from '@lobechat/utils/object';
import { pickString, toRecord } from '@lobechat/utils/object';

import type { PromptDumpCallContext, PromptDumpCallRecorder } from './index';
import { getPromptDumpService } from './index';

export interface CreatePromptDumpHookParams {
  provider: string;
  runtimeProvider?: string;
  userId?: string;
  workspaceId?: string;
}

/**
 * Mirror every `chat()` this runtime performs. Built as a `ModelRuntimeHooks`
 * slice so it composes onto whichever provider adapter the call ends up using
 * — the payload it sees is the fully assembled context (system prompt, history,
 * tool results, tool schemas) for all of them, which is the layer prompt-cache
 * behaviour is decided at.
 */
export const createPromptDumpHook = (params: CreatePromptDumpHookParams): ModelRuntimeHooks => {
  const service = getPromptDumpService();
  if (!service.isEnabled()) return {};

  /**
   * Keyed by the payload object, which is the one identity `beforeChat` and the
   * terminal hooks share: `ModelRuntime` passes the same `payload` reference to
   * both, while the options object may be a fresh `{}` when a hook exists and
   * the caller passed none.
   */
  const pending = new WeakMap<ChatStreamPayload, PromptDumpCallRecorder>();

  const resolveContext = (
    payload: ChatStreamPayload,
    options: UnknownRecord | undefined,
  ): PromptDumpCallContext => {
    const metadata = toRecord(options?.metadata);
    const tracing = toRecord(options?.tracing);

    return {
      model: payload.model,
      operationId: pickString(metadata?.operationId),
      provider: params.provider,
      runtimeProvider: params.runtimeProvider,
      // An agent run carries the topic on the call metadata; the chat route
      // passes the same id through the client trace header instead.
      topicId: pickString(metadata?.topicId) ?? pickString(tracing?.topicId),
      trigger: pickString(metadata?.trigger),
      userId: params.userId,
      workspaceId: params.workspaceId,
    };
  };

  return {
    beforeChat: (payload, options) => {
      const recorder = service.beginCall(resolveContext(payload, toRecord(options)));
      if (!recorder) return;

      // Not awaited: mirroring is observability, and the write must not sit on
      // the path between the user's turn and the provider call.
      void recorder.recordRequest(payload);
      pending.set(payload, recorder);
    },
    onChatError: (error, context) => {
      void pending.get(context.payload)?.recordError(error);
    },
    onChatFinal: (data, context) => {
      void pending.get(context.payload)?.recordResponse(data);
    },
    onChatStreamError: (error, context) => {
      void pending.get(context.payload)?.recordError(error);
    },
  };
};
