import type { OpenAIChatMessage, UIChatMessage } from '@lobechat/types';

import type { PlaceholderVariant } from '@/features/ChatInput/InputEditor/Placeholder';
import { chatHelpers } from '@/store/chat/helpers';

type SupportedChatInputRole = Extract<OpenAIChatMessage['role'], 'assistant' | 'tool' | 'user'>;

interface ChatInputMessage {
  content: string;
  /** Message id — carried so the TokenTag baseline can anchor on it. */
  id: string;
  role: SupportedChatInputRole;
}

const isSupportedChatInputMessage = (
  message: UIChatMessage,
): message is UIChatMessage & { role: SupportedChatInputRole | 'compressedGroup' } =>
  message.role === 'user' ||
  message.role === 'assistant' ||
  message.role === 'tool' ||
  message.role === 'compressedGroup';
export const toChatInputMessages = (messages: UIChatMessage[]): ChatInputMessage[] =>
  messages.filter(isSupportedChatInputMessage).map((m) => ({
    content: typeof m.content === 'string' ? m.content : '',
    id: m.id,
    // `compressedGroup` is a UI-only role: the server transforms it into a
    // user message before sending (CompressedGroupRoleTransform). Normalize it
    // here the same way so compressed summaries are counted in the context
    // window (token details) without leaking a non-OpenAI role downstream.
    role: m.role === 'compressedGroup' ? 'user' : m.role,
  }));

/**
 * Build the message window for the chat input context details (TokenTag).
 *
 * Compressed history summaries (`role='compressedGroup'`) represent an entire
 * chunk of summarized history, so they must NOT consume historyCount slots:
 * they are kept unconditionally — mirroring the server side, where the
 * truncated window keeps the oldest compressed group as one logical group and
 * CompressedGroupRoleTransform sends its content as a user message. The only
 * exception is `historyCount <= 0` (history fully disabled): the server then
 * sends no history at all, so the summary must not be counted either.
 */
export const getContextWindowMessages = (
  messages: UIChatMessage[],
  options: {
    enableHistoryCount?: boolean;
    historyCount?: number;
  },
) => {
  const { enableHistoryCount, historyCount } = options;

  const keepCompressedGroups =
    !enableHistoryCount || historyCount === undefined || historyCount > 0;

  const compressedGroups = keepCompressedGroups
    ? messages.filter((m) => m.role === 'compressedGroup')
    : [];

  // Slice only the uncompressed messages so summaries never occupy a history slot.
  const sliced = chatHelpers.getSlicedMessages(
    messages.filter((m) => m.role !== 'compressedGroup'),
    options,
  );

  // Preserve the original order (compressed groups sit at the head of history).
  const order = new Map(messages.map((m, i) => [m.id, i]));
  const merged = [...compressedGroups, ...sliced].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );

  return toChatInputMessages(merged);
};

export interface ConversationChatInputUiState {
  placeholderVariant: PlaceholderVariant;
  showSendMenu: boolean;
  showStopButton: boolean;
}

export interface GetConversationChatInputUiStateParams {
  /**
   * When true, the placeholder never flips to the followUp variant — used by
   * surfaces (e.g. onboarding) that have no follow-up / pending-message design.
   */
  disableFollowUpVariant?: boolean;
  isInputEmpty: boolean;
  isInputLoading: boolean;
}

export const getConversationChatInputUiState = ({
  disableFollowUpVariant,
  isInputEmpty,
  isInputLoading,
}: GetConversationChatInputUiStateParams): ConversationChatInputUiState => {
  // Keep the Stop button up for the entire loading window — including when the
  // user starts typing a follow-up. Previously this flipped to Send the moment
  // the composer had any text, which read as "agent finished" and made queued
  // sends look like fresh sends. Pressing Enter still enqueues; the QueueTray
  // exposes per-item Send-now and Edit/Delete for explicit control.
  const followUp = !disableFollowUpVariant && isInputLoading && isInputEmpty;
  return {
    placeholderVariant: followUp ? 'followUp' : 'default',
    showSendMenu: !isInputLoading,
    showStopButton: isInputLoading,
  };
};
