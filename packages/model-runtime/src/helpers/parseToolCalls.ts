import { type MessageToolCall, type MessageToolCallChunk, MessageToolCallSchema } from '../types';

/**
 * Parse and merge tool calls from streaming chunks
 * Uses native Map for O(1) lookup instead of Immer for better performance
 *
 * @param origin - Existing accumulated tool calls
 * @param value - New tool call chunks from current stream event
 * @returns Merged tool calls array
 */
export const parseToolCalls = (
  origin: MessageToolCall[],
  value: MessageToolCallChunk[],
): MessageToolCall[] => {
  // Early return if no new data
  if (!value || value.length === 0) return origin;

  // Build ID map for O(1) lookup
  const idMap = new Map(origin.map((t) => [t.id, t]));

  for (const item of value) {
    // Try to find existing tool call by id first
    if (item.id && idMap.has(item.id)) {
      // Tool call exists by ID - merge arguments
      const existing = idMap.get(item.id)!;
      if (item.function?.arguments) {
        existing.function.arguments += item.function.arguments;
      }
    }
    // Check if same index but different ID (parallel tool calls from Gemini)
    else if (
      typeof item.index === 'number' &&
      origin[item.index] &&
      item.id &&
      origin[item.index].id !== item.id
    ) {
      // Different ID at same index - this is a new parallel tool call
      // Add to map and list as a new entry
      const parsed = MessageToolCallSchema.parse(item);
      idMap.set(parsed.id, parsed);
    }
    // Try to find by index if id not present or not found
    else if (typeof item.index === 'number' && origin[item.index]) {
      // Match by index - merge arguments
      const existing = origin[item.index];
      if (item.function?.arguments) {
        existing.function.arguments += item.function.arguments;
      }
    }
    // New tool call - validate and add
    else {
      const parsed = MessageToolCallSchema.parse(item);
      idMap.set(parsed.id, parsed);
    }
  }

  // Return as array, maintaining order of original calls
  return Array.from(idMap.values());
};
