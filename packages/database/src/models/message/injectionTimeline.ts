import type { UIChatMessage } from '@lobechat/types';

/**
 * Merge persisted conversation rows with the injected rows anchored in the
 * same timeline. Both sets are ordered by `(createdAt, id)`; an injected row
 * keeps its stored position so request assembly can replay it in place. On an
 * exact timestamp tie the conversation row stays first, because the writer
 * anchors the injected row at the user turn's millisecond.
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

    // The writer anchors a row at the user turn's millisecond, so a tie means
    // "same turn". The persisted conversation row stays first and the injected
    // context follows it; ordering the tie by id could put the context before
    // the message it belongs to.
    if (!!first.isInjection !== !!second.isInjection) return first.isInjection ? 1 : -1;

    return first.id.localeCompare(second.id);
  });
};
