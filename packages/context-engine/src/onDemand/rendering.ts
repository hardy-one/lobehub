import type { OnDemandDynamicEntry } from '@lobechat/types';

const escapeAttribute = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const escapeCdataContent = (value: string): string =>
  value
    .replaceAll(/<(\/?)(on_demand_[a-z_]+)(?=[\s/>])/gi, '&lt;$1$2')
    .replaceAll(']]>', ']]]]><![CDATA[>');

/**
 * The exact envelope used when an entry is appended to the request. Entry
 * bodies are always rendered in full; no token estimate may replace or omit
 * them.
 */
export const renderOnDemandContextMessageContent = (entry: OnDemandDynamicEntry): string =>
  [
    `<on_demand_context kind="${escapeAttribute(entry.kind)}" source="${escapeAttribute(
      entry.source.type,
    )}:${escapeAttribute(entry.source.id)}" provenance="${escapeAttribute(
      entry.provenance.contentHash,
    )}" content_format="cdata">`,
    '<![CDATA[',
    escapeCdataContent(entry.content),
    ']]>',
    '</on_demand_context>',
  ].join('\n');
