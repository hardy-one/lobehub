import { describe, expect, it } from 'vitest';

import { SYSTEM_CONTEXT_END, SYSTEM_CONTEXT_START } from '../base/constants';
import type { PipelineContext } from '../types';
import { MessageFactsInjector } from './MessageFactsInjector';

const context = (messages: PipelineContext['messages']): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages,
  metadata: {},
});

describe('MessageFactsInjector', () => {
  it('keeps selections on their own user turns when the conversation grows', async () => {
    const first = {
      content: 'First request',
      editorData: {
        root: {
          children: [
            {
              actionCategory: 'skill',
              actionLabel: 'Review',
              actionType: 'review',
              type: 'action-tag',
            },
            { label: 'Alice', metadata: { id: 'agt_alice', type: 'agent' }, type: 'mention' },
          ],
        },
      },
      role: 'user',
    };
    const second = {
      content: 'Second request',
      metadata: { selectedToolIds: ['search'] },
      role: 'user',
    };
    const injector = new MessageFactsInjector();
    const before = await injector.process(context([first]));
    const after = await injector.process(
      context([first, { content: 'Done', role: 'assistant' }, second]),
    );

    expect(after.messages[0].content).toBe(before.messages[0].content);
    expect(after.messages[0].content).toContain('identifier="review"');
    expect(after.messages[0].content).toContain('id="agt_alice"');
    expect(after.messages[2].content).toContain('identifier="search"');
    expect(after.messages[0].content).not.toContain('identifier="search"');
    expect(after.messages[0].content).not.toContain('MUST call');
  });

  it('handles multimodal, old messages and synthetic user carriers', async () => {
    const injector = new MessageFactsInjector();
    const result = await injector.process(
      context([
        { content: 'old message', role: 'user' },
        {
          content: [{ image_url: { url: 'image' }, type: 'image_url' }],
          metadata: { selectedSkillIds: ['skill-1', 'skill-1'] },
          role: 'user',
        },
        {
          content: 'carrier',
          meta: { systemInjection: true },
          metadata: { selectedSkillIds: ['ignored'] },
          role: 'user',
        },
      ]),
    );

    expect(result.messages[0].content).toBe('old message');
    expect(result.messages[1].content[0]).toEqual({
      image_url: { url: 'image' },
      type: 'image_url',
    });
    expect(result.messages[1].content[1].text.match(/identifier="skill-1"/g)).toHaveLength(1);
    expect(result.messages[2].content).toBe('carrier');
  });

  it('records skill links, topic/document references and all skill-chip categories', async () => {
    const injector = new MessageFactsInjector();
    const result = await injector.process(
      context([
        {
          content:
            'See <refer_topic id="tpc_1" name="Old topic" /> and ' +
            '<refer_document id="docs_1" name="Spec" />. ' +
            'Install https://lobehub.com/skills/demo-skill',
          editorData: {
            root: {
              children: [
                {
                  actionCategory: 'projectSkill',
                  actionLabel: 'Local',
                  actionType: 'projectSkill:local-audit',
                  type: 'action-tag',
                },
                {
                  actionCategory: 'agentSkill',
                  actionLabel: 'Remote',
                  actionType: 'agent-skills:remote-audit',
                  type: 'action-tag',
                },
              ],
            },
          },
          role: 'user',
        },
      ]),
    );

    const content = result.messages[0].content as string;
    expect(content).toContain('identifier="projectSkill:local-audit"');
    expect(content).toContain('identifier="agent-skills:remote-audit"');
    expect(content).toContain('<skill_link method="importFromMarket"');
    expect(content).toContain('<topic_ref id="tpc_1" name="Old topic" />');
    expect(content).toContain('<document_ref id="docs_1" name="Spec" />');
  });

  it('is idempotent when a message already carries the facts block', async () => {
    const injector = new MessageFactsInjector();
    const withBlock = {
      content: `question\n\n${SYSTEM_CONTEXT_START}\n<message_facts>\n<skill identifier="once" name="Once" />\n</message_facts>\n${SYSTEM_CONTEXT_END}`,
      metadata: { selectedSkillIds: ['once'] },
      role: 'user',
    };
    const result = await injector.process(context([withBlock]));
    expect(result.messages[0].content).toBe(withBlock.content);
  });

  it('does not prefilter any facts-bearing message variant', async () => {
    const injector = new MessageFactsInjector();
    const actionTag = (actionCategory: string, actionType: string) => ({
      actionCategory,
      actionLabel: actionType,
      actionType,
      type: 'action-tag',
    });
    const cases = [
      {
        name: 'topic',
        message: {
          content: 'read <refer_topic id="tpc_fixture" name="Topic" />',
          metadata: {},
          role: 'user',
        },
        expected: '<topic_ref id="tpc_fixture" name="Topic" />',
      },
      {
        name: 'document',
        message: {
          content: 'read <refer_document id="docs_fixture" name="Document" />',
          metadata: {},
          role: 'user',
        },
        expected: '<document_ref id="docs_fixture" name="Document" />',
      },
      {
        name: 'skill link',
        message: {
          content: 'install https://lobehub.com/skills/demo-skill',
          metadata: {},
          role: 'user',
        },
        expected: '<skill_link method="importFromMarket"',
      },
      {
        name: 'selected skills',
        message: {
          content: 'plain text',
          metadata: { selectedSkillIds: ['selected-skill'] },
          role: 'user',
        },
        expected: '<skill identifier="selected-skill"',
      },
      {
        name: 'selected tools',
        message: {
          content: 'plain text',
          metadata: { selectedToolIds: ['selected-tool'] },
          role: 'user',
        },
        expected: '<tool identifier="selected-tool"',
      },
      {
        name: 'agent mention',
        message: {
          content: 'plain text',
          editorData: {
            root: {
              children: [
                {
                  children: [
                    {
                      label: 'Alice',
                      metadata: { id: 'agt_fixture', type: 'agent' },
                      type: 'mention',
                    },
                  ],
                  type: 'paragraph',
                },
              ],
              type: 'root',
            },
          },
          metadata: {},
          role: 'user',
        },
        expected: '<agent id="agt_fixture"',
      },
      ...['skill', 'projectSkill', 'agentSkill', 'tool'].map((actionCategory) => ({
        name: `action tag ${actionCategory}`,
        message: {
          content: 'plain text',
          editorData: {
            root: {
              children: [
                {
                  children: [actionTag(actionCategory, `${actionCategory}-fixture`)],
                  type: 'paragraph',
                },
              ],
              type: 'root',
            },
          },
          metadata: {},
          role: 'user',
        },
        expected:
          actionCategory === 'tool' ? '<tool identifier="tool-fixture"' : '<skill identifier=',
      })),
    ];

    for (const { name, message, expected } of cases) {
      const result = await injector.process(context([message]));
      const content = result.messages[0].content as string;
      expect(content, name).toContain('<message_facts>');
      expect(content, name).toContain(expected);
    }
  });

  it('skips messages without any facts source', async () => {
    const injector = new MessageFactsInjector();
    const result = await injector.process(
      context([
        {
          content: 'plain request',
          editorData: {
            root: {
              children: [
                { actionCategory: 'command', actionType: 'help', type: 'action-tag' },
                { label: 'Bob', metadata: { id: 'usr_fixture', type: 'user' }, type: 'mention' },
              ],
              type: 'root',
            },
          },
          metadata: { selectedSkillIds: [], selectedToolIds: [] },
          role: 'user',
        },
      ]),
    );

    expect(result.messages[0].content).toBe('plain request');
    expect(result.metadata).not.toHaveProperty('MessageFactsInjectorInjectedCount');
  });
});
