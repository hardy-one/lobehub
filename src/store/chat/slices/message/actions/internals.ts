import { parse } from '@lobechat/conversation-flow';
import { type TraceEventPayloads, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import isEqual from 'fast-deep-equal';

import { traceService } from '@/services/trace';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { displayMessageSelectors } from '../../../selectors';
import { messageMapKey } from '../../../utils/messageMapKey';
import { type MessageDispatch } from '../reducer';
import { messagesReducer } from '../reducer';

const log = debug('lobe-store:message-internals');

/**
 * Internal core methods that serve as building blocks for other actions
 */

type Setter = StoreSetter<ChatStore>;
export const messageInternals = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new MessageInternalsActionImpl(set, get, _api);

export class MessageInternalsActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_dispatchMessage = (
    payload: MessageDispatch,
    context?: { operationId?: string },
  ): void => {
    // Get full conversation context (including scope) from operation or global state
    const ctx = this.#get().internal_getConversationContext(context);
    log(
      '[internal_dispatchMessage] context: agentId=%s, topicId=%s, threadId=%s, scope=%s',
      ctx.agentId,
      ctx.topicId,
      ctx.threadId,
      ctx.scope,
    );

    const messagesKey = messageMapKey(ctx);

    // Get raw messages from dbMessagesMap and apply reducer
    const rawMessages = this.#get().dbMessagesMap[messagesKey] || [];
    const updatedRawMessages = messagesReducer(rawMessages, payload);

    const nextDbMap = { ...this.#get().dbMessagesMap, [messagesKey]: updatedRawMessages };

    if (isEqual(nextDbMap, this.#get().dbMessagesMap)) return;

    // parse to get display messages
    const { flatList } = parse(updatedRawMessages);
    const nextDisplayMap = { ...this.#get().messagesMap, [messagesKey]: flatList };

    this.#set({ dbMessagesMap: nextDbMap, messagesMap: nextDisplayMap }, false, {
      payload,
      type: `dispatchMessage/${payload.type}`,
    });
  };

  /**
   * Trigger a Zustand re-render by creating new references for messagesMap and dbMessagesMap
   * at a specific key. Used by SSE streaming to sync mutated message content through the
   * ChatStore -> ConversationArea -> StoreUpdater -> ConversationStore bridge without
   * re-running parse() in the ChatStore.
   *
   * When `displayMessages` and/or `dbMessages` are provided, they are used instead of
   * cloning from the current store. This lets callers pass arrays that already contain
   * new object references, so downstream memo(isEqual) checks detect the changes
   * (otherwise fast-deep-equal short-circuits on same-reference objects).
   */
  internal_refreshMessageMaps = (
    key: string,
    displayMessages?: UIChatMessage[],
    dbMessages?: any[],
  ): void => {
    console.log(
      `[ChatStore.internal_refreshMessageMaps] key=${key}, ` +
      `dbLen=${dbMessages?.length ?? (this.#get().dbMessagesMap[key] || []).length}, ` +
      `msgLen=${displayMessages?.length ?? (this.#get().messagesMap[key] || []).length}`,
    );
    this.#set(
      {
        dbMessagesMap: {
          ...this.#get().dbMessagesMap,
          [key]: dbMessages ?? [...(this.#get().dbMessagesMap[key] || [])],
        },
        messagesMap: {
          ...this.#get().messagesMap,
          [key]: displayMessages ?? [...(this.#get().messagesMap[key] || [])],
        },
      },
      false,
      'sseStreamChunk',
    );
  };

  internal_traceMessage = async (id: string, payload: TraceEventPayloads): Promise<void> => {
    // tracing the diff of update
    const message = displayMessageSelectors.getDisplayMessageById(id)(this.#get());
    if (!message) return;

    const traceId = message?.traceId;
    const observationId = message?.observationId;

    if (traceId && message?.role === 'assistant') {
      traceService
        .traceEvent({ content: message.content, observationId, traceId, ...payload })
        .catch();
    }
  };
}

export type MessageInternalsAction = Pick<
  MessageInternalsActionImpl,
  keyof MessageInternalsActionImpl
>;
