import type { UIChatMessage } from '@lobechat/types';

/**
 * Merge persisted conversation rows with injected rows in the single timeline
 * order `(createdAt ASC, isInjection ASC, id ASC)`. `parentId` carries ownership
 * and branch metadata; it never changes a row's position in this ordering.
 *
 * An empty injection timeline returns the conversation untouched: a topic
 * written before append-only v2 must assemble exactly as it did before.
 */
export const mergeInjectionTimeline = (
  messages: UIChatMessage[],
  injectedMessages: UIChatMessage[],
): UIChatMessage[] => {
  if (injectedMessages.length === 0) return messages;
  if (messages.length === 0) return injectedMessages;

  return [...messages, ...injectedMessages].sort((first, second) => {
    if (first.createdAt !== second.createdAt) return first.createdAt - second.createdAt;
    if (!!first.isInjection !== !!second.isInjection) return first.isInjection ? 1 : -1;
    return first.id.localeCompare(second.id);
  });
};
