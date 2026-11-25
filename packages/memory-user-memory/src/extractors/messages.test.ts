import type { GenerateObjectPayload, ModelRuntime } from '@lobechat/model-runtime';
import { LayersEnum } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { ActivityExtractor } from './activity';
import { ContextExtractor } from './context';
import { ExperienceExtractor } from './experience';
import { UserMemoryGateKeeper } from './gatekeeper';
import { IdentityExtractor } from './identity';
import { PreferenceExtractor } from './preference';

type ExtractorName =
  | 'gatekeeper'
  | 'layer-activity'
  | 'layer-context'
  | 'layer-experience'
  | 'layer-identity'
  | 'layer-preference';

const conversationBody =
  '<chat_topic><message role="user">I prefer concise replies.</message></chat_topic>';
const retrievedMemories =
  '<user_memories><preference>Use bullet points.</preference></user_memories>';

const createExtractor = (name: ExtractorName) => {
  const generateObject = vi.fn(async (payload: GenerateObjectPayload) =>
    payload.schema?.name === 'gatekeeper_decision'
      ? Object.fromEntries(
          Object.values(LayersEnum).map((layer) => [
            layer,
            { reasoning: 'extract', shouldExtract: true },
          ]),
        )
      : payload.schema?.name === 'identity_extraction'
        ? { add: [], remove: [], update: [] }
        : { memories: [] },
  );
  const config = {
    agent: name,
    model: 'mock-model',
    modelRuntime: { generateObject } as unknown as ModelRuntime,
  } as const;

  switch (name) {
    case 'layer-activity': {
      return { extractor: new ActivityExtractor(config), generateObject };
    }
    case 'layer-context': {
      return { extractor: new ContextExtractor(config), generateObject };
    }
    case 'layer-experience': {
      return { extractor: new ExperienceExtractor(config), generateObject };
    }
    case 'layer-identity': {
      return { extractor: new IdentityExtractor(config), generateObject };
    }
    case 'layer-preference': {
      return { extractor: new PreferenceExtractor(config), generateObject };
    }
    case 'gatekeeper': {
      return { extractor: new UserMemoryGateKeeper(config), generateObject };
    }
    default: {
      throw new Error(`Unknown extractor: ${name}`);
    }
  }
};

describe.each<ExtractorName>([
  'layer-activity',
  'layer-context',
  'layer-experience',
  'layer-identity',
  'layer-preference',
  'gatekeeper',
])('%s message construction', (name) => {
  it('renders the system template once and keeps the conversation in the user message', async () => {
    const { extractor, generateObject } = createExtractor(name);

    await extractor.structuredCall({
      availableCategories: ['work', 'personal'],
      existingIdentitiesContext: '<identities>Existing engineer.</identities>',
      gateKeeperLanguage: 'English',
      language: '简体中文',
      retrievedContexts: [conversationBody, retrievedMemories],
      sessionDate: '2026-11-25T00:00:00.000Z',
      topK: 2,
      username: 'Ada',
    });

    const payload = generateObject.mock.calls[0][0];
    const [systemMessage, ...remainingMessages] = payload.messages;
    const userMessages = remainingMessages.filter((message) => message.role === 'user');
    const userMessage = userMessages.at(-1);

    expect(systemMessage?.role).toBe('system');
    expect(userMessage?.role).toBe('user');
    expect(userMessage?.content).not.toBe(systemMessage?.content);
    expect(String(userMessage?.content).length).toBeLessThan(String(systemMessage?.content).length);
    const allContent = payload.messages.map((message) => String(message?.content)).join('\n');
    expect(allContent).toContain(conversationBody);
    expect(
      payload.messages.filter((message) => String(message.content).includes(conversationBody)),
    ).toHaveLength(1);
    expect(
      payload.messages.filter((message) => String(message.content).includes(retrievedMemories)),
    ).toHaveLength(1);
    expect(allContent).not.toContain('{{');

    if (name === 'layer-identity') {
      expect(String(systemMessage?.content)).toContain(
        '<identities>Existing engineer.</identities>',
      );
    }
  });
});
