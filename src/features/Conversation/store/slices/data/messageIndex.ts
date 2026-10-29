import type { AssistantContentBlock, UIChatMessage } from '@lobechat/types';

interface DisplayMessageIndex {
  /**
   * Every assistant content block reachable from `displayMessages`, including
   * the ones nested in task summaries and compressed groups. Tool and content
   * rows look themselves up here by block id on every store snapshot, so the
   * lookup must not walk the message tree each time.
   */
  blockById: Map<string, AssistantContentBlock>;
  byId: Map<string, UIChatMessage>;
  groupOfBlock: Map<string, UIChatMessage>;
}

const indexBlock = (
  blockById: Map<string, AssistantContentBlock>,
  block: AssistantContentBlock,
) => {
  blockById.set(block.id, block);
};

const indexMessages = (
  byId: Map<string, UIChatMessage>,
  blockById: Map<string, AssistantContentBlock>,
  messages: UIChatMessage[],
) => {
  for (const message of messages) {
    byId.set(message.id, message);

    if (message.compressedMessages) {
      indexMessages(byId, blockById, message.compressedMessages);
    }

    if (message.role === 'agentCouncil' && (message as { members?: UIChatMessage[] }).members) {
      indexMessages(byId, blockById, (message as { members: UIChatMessage[] }).members);
    }

    if (message.role !== 'assistantGroup') continue;

    for (const block of message.children ?? []) indexBlock(blockById, block);
    for (const block of message.taskCompletions ?? []) indexBlock(blockById, block);
  }
};

const buildIndex = (messages: UIChatMessage[]): DisplayMessageIndex => {
  const byId = new Map<string, UIChatMessage>();
  const blockById = new Map<string, AssistantContentBlock>();
  const groupOfBlock = new Map<string, UIChatMessage>();

  indexMessages(byId, blockById, messages);

  for (const message of messages) {
    if (message.role !== 'assistantGroup') continue;
    for (const block of message.children ?? []) groupOfBlock.set(block.id, message);
  }

  return { blockById, byId, groupOfBlock };
};

// Streaming swaps the displayMessages array on every chunk; keying on the array
// identity keeps the pass to once per snapshot no matter how many rows read it.
const indexCache = new WeakMap<UIChatMessage[], DisplayMessageIndex>();

export const indexDisplayMessages = (messages: UIChatMessage[]): DisplayMessageIndex => {
  let index = indexCache.get(messages);
  if (!index) {
    index = buildIndex(messages);
    indexCache.set(messages, index);
  }
  return index;
};
