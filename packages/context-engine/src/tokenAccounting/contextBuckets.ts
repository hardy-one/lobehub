import { estimateTokenCount } from 'tokenx';

import type { ContextBuckets, ContextTokenCounts } from '../types';

/**
 * Count the token cost of the assembled payload per UI bucket, using the
 * same `tokenx` estimator everywhere (client send, server send, TokenTag).
 *
 * All four bucket texts are recorded by MessagesEngine while the pipeline
 * runs (`metadata.contextBuckets`): `chats` already contains the truncated
 * conversation rows plus per-request injectors, so nothing is re-derived
 * from the final messages here. Function schemas are not part of the
 * message list, so they are passed in as `tools` and folded into the
 * `tools` bucket.
 */
export const countContextBuckets = (
  _messages: Array<{ content?: unknown }>,
  buckets: ContextBuckets,
  tools?: Array<{ function?: { description?: string; name?: string; parameters?: unknown } }>,
): ContextTokenCounts => {
  const toolsText = tools?.length
    ? buckets.tools + tools.map((tool) => JSON.stringify(tool.function ?? tool)).join('')
    : buckets.tools;

  return {
    chats: estimateTokenCount(buckets.chats),
    historySummary: estimateTokenCount(buckets.historySummary),
    systemRole: estimateTokenCount(buckets.systemRole),
    tools: estimateTokenCount(toolsText),
  };
};
