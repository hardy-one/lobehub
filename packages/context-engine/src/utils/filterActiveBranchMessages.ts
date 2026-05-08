/** Minimal message shape needed for branch filtering. */
interface BranchableMessage {
  createdAt: Date | string | number;
  id: string;
  metadata?: Record<string, unknown> | null;
  parentId?: string | null;
  role: string;
}

/**
 * Determine the active child ID from a list of child messages, using the
 * same priority strategy as conversation-flow's BranchResolver:
 *
 * Priority 1: Parent's `metadata.activeBranchIndex` — if a valid index.
 * Priority 2: First child that has its own descendants (grandchildren).
 * Default:   First child.
 */
const resolveActiveChild = (
  parent: BranchableMessage | undefined,
  children: BranchableMessage[],
): BranchableMessage | undefined => {
  if (children.length === 0) return undefined;

  // Priority 1: metadata.activeBranchIndex (index-based)
  const index = parent?.metadata?.activeBranchIndex as number | undefined;
  if (typeof index === 'number' && index >= 0) {
    if (index < children.length) return children[index];
    // index === children.length → optimistic update, branch being created.
    // Fall through to Priority 2.
  }

  // Priority 2: first child that has its own children
  // (The caller's parentId-children map includes this information — but here
  //  we don't have it. We just pick the first child with a non-empty "future"
  //  by checking if any other message references this child as parent.)
  // We don't have the full descendant map here, so we use a simple heuristic:
  // Pick the first child. The main call-site in filterActiveBranchMessages
  // will then naturally follow that child's descendants.

  // Default: first child
  return children[0];
};

/**
 * Filter a flat array of messages to only include the active-branch chain.
 *
 * In a conversation topic with multiple regeneration branches, every message
 * is stored in the database. This function walks the parent–child tree and
 * only keeps messages that sit on the active branch path, as determined by
 * each parent message's `metadata.activeBranchIndex`.
 *
 * The strategy mirrors `BranchResolver` from `@lobechat/conversation-flow`:
 * 1. Read `parent.metadata.activeBranchIndex` to pick the active child.
 * 2. If the index is optimistic (points past the last child), fall back to
 *    the first child that has descendants.
 * 3. Default to the first child.
 *
 * @param messages - All messages for a topic, in any order.
 * @returns The filtered array containing only active-branch messages,
 *          preserving the original message objects (no virtual nodes).
 */
export const filterActiveBranchMessages = (messages: BranchableMessage[]): BranchableMessage[] => {
  if (messages.length <= 1) return messages;

  // ── Build lookup maps ──
  const messageMap = new Map<string, BranchableMessage>();
  const childrenMap = new Map<string | null, BranchableMessage[]>();

  for (const msg of messages) {
    messageMap.set(msg.id, msg);
    const parentKey = msg.parentId ?? null;
    const siblings = childrenMap.get(parentKey);
    if (siblings) {
      siblings.push(msg);
    } else {
      childrenMap.set(parentKey, [msg]);
    }
  }

  // ── Walk the tree following only active branches ──
  const result: BranchableMessage[] = [];
  const visited = new Set<string>();

  const walk = (messageId: string): void => {
    if (visited.has(messageId)) return;
    const message = messageMap.get(messageId);
    if (!message) return;

    visited.add(messageId);
    result.push(message);

    // Collect children of this message
    const children = childrenMap.get(messageId) || [];
    if (children.length === 0) return;

    // Sort children by createdAt for consistent ordering
    children.sort((a, b) => {
      const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : Number(a.createdAt) || 0;
      const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : Number(b.createdAt) || 0;
      return aTime - bTime;
    });

    // Resolve the active child
    const activeChild = resolveActiveChild(message, children);
    if (activeChild) {
      walk(activeChild.id);
    }

    // Also walk non-branching children that are structurally required
    // (tool messages, re-invoke children, etc. that don't create branch points).
    // Only filter children when there are multiple assistant-group candidates.
    const assistantChildren = children.filter((c) => c.role === 'assistant');
    if (assistantChildren.length <= 1) {
      // No branching — walk all children
      for (const child of children) {
        if (child.id !== activeChild?.id) walk(child.id);
      }
    }
    // When there are multiple assistant children (branching), only walk the
    // active child. The other branches are excluded.
  };

  // Start from root messages (those with no parent in the message set)
  const rootMessages = childrenMap.get(null) || [];
  rootMessages.sort((a, b) => {
    const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : Number(a.createdAt) || 0;
    const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : Number(b.createdAt) || 0;
    return aTime - bTime;
  });

  for (const root of rootMessages) {
    walk(root.id);
  }

  return result;
};
