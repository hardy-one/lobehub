import type { AgentDocumentPolicyLoad } from '@lobechat/types';

import type {
  AgentDocumentLoadRule,
  AgentDocumentLoadRules,
} from '../../policies/agentDocumentLoadPolicy';
import { matchesLoadRules } from '../../policies/agentDocumentLoadPolicy';

export type { AgentDocumentLoadRule, AgentDocumentLoadRules };
export type { AgentDocumentPolicyLoad };

export const AGENT_DOCUMENT_INJECTION_POSITIONS = [
  'after-first-user',
  'before-first-user',
  'before-system',
  'context-end',
  'manual',
  'on-demand',
  'system-append',
  'system-replace',
] as const;

export type AgentDocumentInjectionPosition = (typeof AGENT_DOCUMENT_INJECTION_POSITIONS)[number];

export type AgentDocumentLoadFormat = 'file' | 'raw';

export type AgentDocumentSourceType = 'agent' | 'agent-signal' | 'api' | 'file' | 'topic' | 'web';

export interface AgentContextDocument {
  content?: string;
  contentCharCount?: number;
  createdAt?: Date | string;
  description?: string;
  filename: string;
  /**
   * Title of the containing parent — a `custom/folder`, or an ordinary document
   * that holds nested docs (e.g. a workflow with its run records) — resolved at
   * the DB→context mapping boundary. Present only when the doc has such a
   * parent; used by the progressive index to fold siblings into one summary row.
   */
  folderTitle?: string;
  id?: string;
  loadPosition?: AgentDocumentInjectionPosition;
  loadRules?: AgentDocumentLoadRules;
  /**
   * Parent folder's `documentId` (the `documents.id` of the `custom/folder`
   * row). Doubles as the grouping key for folder folding and the value the
   * model passes to `listDocuments(parentId=…)` to expand a folded folder.
   */
  parentId?: string | null;
  /** What `parentId` points at; `document` parents fold under a 📄 row instead of 📁. */
  parentKind?: 'document' | 'folder';
  policyId?: string | null;
  policyLoad?: AgentDocumentPolicyLoad;
  policyLoadFormat?: AgentDocumentLoadFormat;
  sourceType?: AgentDocumentSourceType;
  title?: string;
  updatedAt?: Date | string;
}

export interface AgentDocumentFilterContext {
  currentTime?: Date;
  currentUserMessage?: string;
  /**
   * When the current run started (the latest user message by default). Documents
   * created at or after it are marked in the progressive index; the index is
   * rebuilt every step, so without a marker a document the agent just created
   * looks like one that already existed. Documents are listed per agent, not per
   * topic or run, so the marker only states the timestamp fact: a marked doc may
   * also come from another topic or tab.
   */
  runStartedAt?: Date | number | string;
  truncateContent?: (content: string, maxTokens: number) => string;
}

const toTime = (value: Date | number | string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
};

/**
 * Anchor the run to the latest user message: documents created after it are
 * marked as new. An explicit `runStartedAt` wins.
 */
export function withRunStartedAt<T extends AgentDocumentFilterContext>(
  context: T,
  messages: { createdAt?: Date | number | string; role: string }[],
): T {
  if (context.runStartedAt !== undefined) return context;

  const lastUserMessage = messages.findLast((message) => message.role === 'user');
  return lastUserMessage?.createdAt === undefined
    ? context
    : { ...context, runStartedAt: lastUserMessage.createdAt };
}

/**
 * Filter documents by load rules (always, by-keywords, by-regexp, by-time-range)
 */
export function filterDocumentsByRules(
  docs: AgentContextDocument[],
  context: AgentDocumentFilterContext,
): AgentContextDocument[] {
  return docs.filter((doc) =>
    matchesLoadRules(doc, {
      currentTime: context.currentTime,
      currentUserMessage: context.currentUserMessage,
    }),
  );
}

/**
 * Sort documents by priority (lower number = higher priority)
 */
export function sortByPriority(docs: AgentContextDocument[]): AgentContextDocument[] {
  return [...docs].sort((a, b) => {
    const aPriority = a.loadRules?.priority ?? 999;
    const bPriority = b.loadRules?.priority ?? 999;
    return aPriority - bPriority;
  });
}

/**
 * Get documents for specific positions, filtered and sorted
 */
export function getDocumentsForPositions(
  allDocuments: AgentContextDocument[],
  positions: AgentDocumentInjectionPosition[],
  context: AgentDocumentFilterContext,
): AgentContextDocument[] {
  const positionSet = new Set(positions);
  const docs = allDocuments.filter(
    (doc) =>
      doc.policyLoad !== 'disabled' && positionSet.has(doc.loadPosition || 'before-first-user'),
  );
  const filtered = filterDocumentsByRules(docs, context);
  return sortByPriority(filtered);
}

/**
 * Format a single document for injection
 */
export function formatDocument(
  doc: AgentContextDocument,
  context: AgentDocumentFilterContext,
): string {
  const maxTokens = doc.loadRules?.maxTokens;
  let content = doc.content || '';
  if (maxTokens && maxTokens > 0) {
    content = context.truncateContent
      ? context.truncateContent(content, maxTokens)
      : approximateTokenTruncate(content, maxTokens);
  }

  if (doc.policyLoadFormat === 'file') {
    const attributes = formatDocumentAttributes(doc);
    return `<agent_document${attributes}>\n${content}\n</agent_document>`;
  }

  return content;
}

/**
 * Bucket the document size instead of printing the exact count, so a folder
 * summary only moves when a document crosses an order of magnitude. Empty
 * content renders as "empty" so the LLM does not retry reading it.
 */
function formatSize(doc: Pick<AgentContextDocument, 'content' | 'contentCharCount'>): string {
  const len = doc.contentCharCount ?? doc.content?.length ?? 0;
  if (len === 0) return 'empty';
  if (len < 1_000) return '<1k';
  if (len < 10_000) return '~1k';
  if (len < 100_000) return '~10k';
  if (len < 1_000_000) return '~100k';
  return '~1M';
}

const TITLE_MAX_WIDTH = 60;

function pickRowTitle(doc: AgentContextDocument): string {
  return doc.title || doc.filename || '(untitled)';
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const NEW_SINCE_USER_MESSAGE_MARK = '(new since last user message)';

/** Collapsed folders hide their rows, so the folder summary carries the count instead. */
const withNewSinceUserMessageCount = (summary: string, count: number) =>
  count > 0 ? `${summary} (${count} new since last user message)` : summary;

function isNewSinceUserMessage(doc: AgentContextDocument, context: AgentDocumentFilterContext) {
  const runStartedAt = toTime(context.runStartedAt);
  const createdAt = toTime(doc.createdAt);
  return runStartedAt !== undefined && createdAt !== undefined && createdAt >= runStartedAt;
}

/**
 * Render a list of progressive docs as a fixed-width table:
 *
 *   TITLE                ID                                    SIZE    UPDATED
 *   daily-brief.txt      2af6eb88-8bdb-468f-887f-620baa394efa  ~1k     2026-04-27
 */
/**
 * Keep at most two docs per folder collapsed, and this many loose docs listed.
 * The index exists to say what is there; the ids and metadata a read needs come
 * from `listDocuments` at that point.
 */
const MAX_INDEX_ROWS = 12;

function buildIndexTable(
  docs: AgentContextDocument[],
  context: AgentDocumentFilterContext,
): string {
  const sorted = sortByRecency(docs);
  const shown = sorted.slice(0, MAX_INDEX_ROWS);

  const lines = shown.map((doc) => {
    const title = truncate(pickRowTitle(doc), TITLE_MAX_WIDTH);
    const mark = isNewSinceUserMessage(doc, context) ? ` ${NEW_SINCE_USER_MESSAGE_MARK}` : '';
    return `- ${title}${mark}`;
  });

  const hidden = sorted.length - shown.length;
  if (hidden > 0) {
    lines.push(`- … ${hidden} more; listDocuments lists them.`);
  }

  return lines.join('\n');
}

const FOLDER_ICON = '📁';
const PARENT_DOCUMENT_ICON = '📄';

interface FolderGroup {
  docs: AgentContextDocument[];
  kind: 'document' | 'folder';
  parentId: string;
  title: string;
}

/** Newest `updatedAt` among a group of docs as epoch ms (0 when none is set). */
function newestTime(docs: AgentContextDocument[]): number {
  return docs.reduce((max, d) => {
    const t = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
    return Number.isNaN(t) ? max : Math.max(max, t);
  }, 0);
}

/**
 * Split progressive docs into folders worth collapsing and the loose docs that
 * stay flat. A folder is collapsed only when it holds ≥2 docs carrying a
 * resolved `folderTitle` — a lone doc-in-folder reads better as its own row so
 * its id stays directly `readDocument`-able. Docs with no known folder (root
 * docs, or docs whose folder was filtered out upstream) always stay flat.
 */
function partitionFolders(docs: AgentContextDocument[]): {
  flat: AgentContextDocument[];
  folders: FolderGroup[];
} {
  const byParent = new Map<string, AgentContextDocument[]>();
  const flat: AgentContextDocument[] = [];
  for (const doc of docs) {
    if (doc.parentId && doc.folderTitle) {
      const arr = byParent.get(doc.parentId);
      if (arr) arr.push(doc);
      else byParent.set(doc.parentId, [doc]);
    } else {
      flat.push(doc);
    }
  }

  const folders: FolderGroup[] = [];
  for (const [parentId, group] of byParent) {
    if (group.length >= 2) {
      folders.push({
        docs: group,
        kind: group[0].parentKind ?? 'folder',
        parentId,
        title: group[0].folderTitle!,
      });
    } else flat.push(...group);
  }
  return { flat, folders };
}

/**
 * "18 docs, ~1k–~10k" — count plus a size range when the folder's docs differ
 * meaningfully in size; just the count when they're uniform or all empty.
 */
function formatFolderSummary(docs: AgentContextDocument[]): string {
  const count = `${docs.length} docs`;
  const lens = docs.map((d) => d.contentCharCount ?? d.content?.length ?? 0);
  const max = Math.max(...lens);
  if (max === 0) return count;
  const min = Math.min(...lens.filter((l) => l > 0));
  const minStr = formatSize({ contentCharCount: min });
  const maxStr = formatSize({ contentCharCount: max });
  return minStr === maxStr ? `${count}, ${maxStr}` : `${count}, ${minStr}–${maxStr}`;
}

/**
 * Render collapsed folders as a fixed-width table, newest folder first:
 *
 *   📁 dailyBrief  2af6…394efa  18 docs, ~1k–~10k  2026-03-29
 *   📁 周报         6b1c…07d21  9 docs             2026-03-27
 *
 * The ID column is the folder's `documentId` — the value the model passes to
 * `listDocuments(parentId=…)` to expand the folder on demand.
 */
function buildFolderTable(folders: FolderGroup[], context: AgentDocumentFilterContext): string {
  return folders
    .map((f) => ({
      id: f.parentId,
      summary: withNewSinceUserMessageCount(
        formatFolderSummary(f.docs),
        f.docs.filter((doc) => isNewSinceUserMessage(doc, context)).length,
      ),
      time: newestTime(f.docs),
      title: `${f.kind === 'document' ? PARENT_DOCUMENT_ICON : FOLDER_ICON} ${truncate(f.title, TITLE_MAX_WIDTH)}`,
    }))
    .sort((a, b) => b.time - a.time)
    .map((row) => `- ${row.title} [${row.id}] ${row.summary}`)
    .join('\n');
}

/**
 * Sort documents by recency (most-recently-updated first); rows missing
 * `updatedAt` sink to the end and keep stable input order between themselves.
 */
function sortByRecency(docs: AgentContextDocument[]): AgentContextDocument[] {
  return [...docs]
    .map((doc, index) => ({ doc, index }))
    .sort((a, b) => {
      const ta = a.doc.updatedAt ? new Date(a.doc.updatedAt).getTime() : 0;
      const tb = b.doc.updatedAt ? new Date(b.doc.updatedAt).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return a.index - b.index;
    })
    .map(({ doc }) => doc);
}

/**
 * Combine multiple documents into a single string.
 * Progressive documents are grouped into an `<agent_documents_index>` block
 * (web-crawled docs are hidden behind a stable hint and surfaced via listDocuments);
 * full-content documents are formatted individually.
 */
export function combineDocuments(
  docs: AgentContextDocument[],
  context: AgentDocumentFilterContext,
): string {
  // Missing `policyLoad` defaults to progressive (matches the DB default and
  // `AgentDocumentModel.createWithTx`'s fallback). A doc must be explicitly
  // marked `'always'` to land in the inline bucket; everything else that
  // survived `getDocumentsForPositions` (which already drops `'disabled'`)
  // is routed through the progressive index. Doing the default here means
  // hand-rolled `AgentContextDocument` callers can't silently lose their
  // content by forgetting the field.
  const fullDocs = docs.filter((d) => d.policyLoad === 'always');
  const progressiveDocs = docs.filter((d) => (d.policyLoad ?? 'progressive') === 'progressive');

  const parts: string[] = [];

  if (fullDocs.length > 0) {
    parts.push(fullDocs.map((doc) => formatDocument(doc, context)).join('\n\n'));
  }

  if (progressiveDocs.length > 0) {
    const userDocs = progressiveDocs.filter((d) => d.sourceType !== 'web');
    const hasHiddenWebDocs = progressiveDocs.length > userDocs.length;

    // Loose docs render as flat rows; docs sharing a folder (≥2) collapse into
    // one summary row so archive-heavy agents don't spend tokens on every entry.
    const { flat, folders } = partitionFolders(userDocs);

    const headerLines: string[] = [
      'User-created docs by title. Resolve a title with listDocuments; readDocument(id) reads it.',
    ];
    if (hasHiddenWebDocs) {
      headerLines.push(`Web-crawled docs are omitted; call listDocuments(sourceType='web').`);
    }
    if (userDocs.some((doc) => isNewSinceUserMessage(doc, context))) {
      headerLines.push(
        `Docs marked ${NEW_SINCE_USER_MESSAGE_MARK} were created after the user's latest message.`,
      );
    }
    const folderCount = folders.filter((f) => f.kind === 'folder').length;
    const parentDocCount = folders.length - folderCount;
    if (folderCount > 0) {
      headerLines.push(
        `${folderCount} folder${folderCount === 1 ? '' : 's'} collapsed (${FOLDER_ICON}); listDocuments(parentId=<id>) expands one.`,
      );
    }
    if (parentDocCount > 0) {
      headerLines.push(
        `${parentDocCount} document${parentDocCount === 1 ? '' : 's'} with nested docs (${PARENT_DOCUMENT_ICON}) collapsed; listDocuments(parentId=<id>) lists the children.`,
      );
    }

    const bodyBlocks: string[] = [];
    if (flat.length > 0) bodyBlocks.push(buildIndexTable(sortByRecency(flat), context));
    if (folders.length > 0) bodyBlocks.push(buildFolderTable(folders, context));
    const tableBlock = bodyBlocks.length > 0 ? `\n\n${bodyBlocks.join('\n\n')}` : '';

    parts.push(
      `<agent_documents_index>\n${headerLines.join('\n')}${tableBlock}\n</agent_documents_index>`,
    );
  }

  return parts.join('\n\n');
}

function approximateTokenTruncate(content: string, maxTokens: number): string {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return content;
  const parts = content.split(/\s+/);
  if (parts.length <= maxTokens) return content;
  return `${parts.slice(0, maxTokens).join(' ')}\n...[truncated]`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatDocumentAttributes(doc: AgentContextDocument): string {
  const attrs: string[] = [];
  if (doc.id) attrs.push(`id="${escapeAttribute(doc.id)}"`);
  if (doc.filename) attrs.push(`filename="${escapeAttribute(doc.filename)}"`);
  if (doc.title) attrs.push(`title="${escapeAttribute(doc.title)}"`);
  return attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
}
