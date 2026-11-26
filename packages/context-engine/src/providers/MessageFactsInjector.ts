import { escapeXml } from '@lobechat/prompts';
import { isRecord } from '@lobechat/utils/object';

import { BaseEveryUserContentProvider } from '../base/BaseEveryUserContentProvider';
import { SYSTEM_CONTEXT_START } from '../base/constants';
import type { Message } from '../types';
import { extractSkillImportRoutes } from './SkillImportRouteInjector';

interface Selection {
  identifier: string;
  name: string;
}

interface Mention {
  id: string;
  name: string;
}

interface SkillLink {
  method: string;
  url: string;
}

interface Reference {
  id: string;
  name: string;
}

const addSelection = (items: Map<string, Selection>, identifier: unknown, name: unknown) => {
  if (typeof identifier !== 'string' || !identifier || items.has(identifier)) return;
  items.set(identifier, { identifier, name: typeof name === 'string' && name ? name : identifier });
};

const addMention = (items: Map<string, Mention>, id: unknown, name: unknown) => {
  if (typeof id !== 'string' || !id || items.has(id)) return;
  items.set(id, { id, name: typeof name === 'string' && name ? name : id });
};

const addSkillLink = (items: Map<string, SkillLink>, url: unknown, method: unknown) => {
  if (typeof url !== 'string' || !url || items.has(url)) return;
  items.set(url, { method: typeof method === 'string' && method ? method : 'importSkill', url });
};

const addReference = (items: Map<string, Reference>, id: unknown, name: unknown) => {
  if (typeof id !== 'string' || !id || items.has(id)) return;
  items.set(id, { id, name: typeof name === 'string' && name ? name : id });
};

/**
 * Read the message's own structured data. Walking `editorData` mirrors the
 * composer's `parseCommands` / `parseMentionedAgents` contracts; only skill and
 * tool action tags and agent mentions are recorded here. Commands, delegation
 * and install actions stay on the current-turn providers.
 */
const readEditorNode = (
  node: unknown,
  skills: Map<string, Selection>,
  tools: Map<string, Selection>,
  agents: Map<string, Mention>,
): void => {
  if (!isRecord(node)) return;
  if (node.type === 'action-tag') {
    // Every skill chip category is a skill fact. Keep its recorded identifier
    // verbatim (project/agent skills carry their own prefix in the chip).
    if (
      node.actionCategory === 'skill' ||
      node.actionCategory === 'projectSkill' ||
      node.actionCategory === 'agentSkill'
    ) {
      addSelection(skills, node.actionType, node.actionLabel);
    }
    if (node.actionCategory === 'tool') addSelection(tools, node.actionType, node.actionLabel);
  }
  if (node.type === 'mention' && isRecord(node.metadata) && node.metadata.type === 'agent') {
    addMention(agents, node.metadata.id, node.label);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) readEditorNode(child, skills, tools, agents);
  }
};

/** Text parts of a message, including multimodal content. Links and refs live in text. */
const readText = (content: Message['content']): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text as string)
      .join('\n');
  }
  return '';
};

const attr = (tag: string, key: string): string | undefined =>
  new RegExp(`\\b${key}="([^"]*)"`).exec(tag)?.[1];

/**
 * Read `<refer_topic>` / `<refer_document>` tags out of this message's own
 * text. The dedicated resolvers still own lookup + full content on the current
 * turn; these records only preserve the fact that this turn pointed at them.
 */
const readReferences = (
  text: string,
  topics: Map<string, Reference>,
  documents: Map<string, Reference>,
): void => {
  for (const match of text.matchAll(/<refer_topic\s([^>]*)>/g)) {
    const tag = match[1];
    addReference(topics, attr(tag, 'id'), attr(tag, 'name'));
  }
  for (const match of text.matchAll(/<refer_document\s([^>]*)>/g)) {
    const tag = match[1];
    addReference(documents, attr(tag, 'id'), attr(tag, 'name'));
  }
};

/**
 * Attach facts from the message that owns them. These are records, not actions:
 * they say which agents/skills/tools/links this turn involved, while the
 * current-turn providers keep the full instructions, delegation and install
 * steps. Because every block is derived from the message's own persisted data,
 * an earlier turn renders byte-identically as the conversation grows — the
 * property the model prefix cache needs.
 */
export class MessageFactsInjector extends BaseEveryUserContentProvider {
  readonly name = 'MessageFactsInjector';

  protected buildContentForMessage(
    message: Message,
  ): { content: string; contextType: string } | null {
    if (
      message.meta?.systemInjection ||
      message.meta?.virtualLastUser ||
      message.meta?.injectType === 'agent-mention-delegation'
    ) {
      return null;
    }

    // Idempotence: a message already carrying this block (a replay of processed
    // content) must not receive a second copy on reprocessing.
    const text = readText(message.content);
    if (text.includes(SYSTEM_CONTEXT_START) && text.includes('<message_facts>')) return null;

    const skills = new Map<string, Selection>();
    const tools = new Map<string, Selection>();
    const agents = new Map<string, Mention>();
    const skillLinks = new Map<string, SkillLink>();
    const topics = new Map<string, Reference>();
    const documents = new Map<string, Reference>();

    if (isRecord(message.editorData)) {
      readEditorNode(message.editorData.root, skills, tools, agents);
    }
    if (Array.isArray(message.metadata?.selectedSkillIds)) {
      for (const id of message.metadata.selectedSkillIds) addSelection(skills, id, id);
    }
    if (Array.isArray(message.metadata?.selectedToolIds)) {
      for (const id of message.metadata.selectedToolIds) addSelection(tools, id, id);
    }
    for (const route of extractSkillImportRoutes(text)) {
      addSkillLink(skillLinks, route.url, route.method);
    }
    readReferences(text, topics, documents);

    if (
      !skills.size &&
      !tools.size &&
      !agents.size &&
      !skillLinks.size &&
      !topics.size &&
      !documents.size
    ) {
      return null;
    }

    const lines = [
      ...[...agents.values()].map(
        ({ id, name }) => `<agent id="${escapeXml(id)}" name="${escapeXml(name)}" />`,
      ),
      ...[...skills.values()].map(
        ({ identifier, name }) =>
          `<skill identifier="${escapeXml(identifier)}" name="${escapeXml(name)}" />`,
      ),
      ...[...tools.values()].map(
        ({ identifier, name }) =>
          `<tool identifier="${escapeXml(identifier)}" name="${escapeXml(name)}" />`,
      ),
      ...[...skillLinks.values()].map(
        ({ method, url }) => `<skill_link method="${escapeXml(method)}" url="${escapeXml(url)}" />`,
      ),
      ...[...topics.values()].map(
        ({ id, name }) => `<topic_ref id="${escapeXml(id)}" name="${escapeXml(name)}" />`,
      ),
      ...[...documents.values()].map(
        ({ id, name }) => `<document_ref id="${escapeXml(id)}" name="${escapeXml(name)}" />`,
      ),
    ];

    return { content: lines.join('\n'), contextType: 'message_facts' };
  }
}
