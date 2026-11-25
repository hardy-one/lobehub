import type { LobeChatDatabase } from '@lobechat/database';
import type { GenerateObjectPayload, ModelRuntime } from '@lobechat/model-runtime';
import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { ExtractorRunOptions, MemoryExtractionJob } from '../types';
import { MemoryExtractionService } from './extractExecutor';

const conversationBody =
  '<chat_topic><message role="user">I prefer concise replies.</message></chat_topic>';
const retrievedMemories =
  '<user_memories><preference>Use bullet points.</preference></user_memories>';
const createService = () => {
  const generateObject = vi.fn(async (payload: GenerateObjectPayload) => {
    if (payload.schema?.name === 'gatekeeper_decision') {
      return Object.fromEntries(
        Object.values(LayersEnum).map((layer) => [
          layer,
          { reasoning: 'extract', shouldExtract: true },
        ]),
      );
    }

    return payload.schema?.name === 'identity_extraction'
      ? { add: [], remove: [], update: [] }
      : { memories: [] };
  });
  const runtime = { generateObject } as unknown as ModelRuntime;
  const service = new MemoryExtractionService<never>({
    config: {
      gateModel: 'gate-model',
      layerModels: Object.fromEntries(
        Object.values(LayersEnum).map((layer) => [layer, 'layer-model']),
      ),
    },
    db: {} as LobeChatDatabase,
    runtimes: { gatekeeper: runtime, layerExtractor: runtime },
  });

  return { generateObject, service };
};

describe('MemoryExtractionService conversation messages', () => {
  it('injects the conversation once into every extractor and gatekeeper request', async () => {
    const { generateObject, service } = createService();
    const buildContext = vi.fn();
    const job: MemoryExtractionJob = {
      source: MemorySourceType.ChatTopic,
      sourceId: 'source-1',
      userId: 'user-1',
    };
    const options: ExtractorRunOptions<never> = {
      availableCategories: ['work'],
      contextProvider: { buildContext },
      gatekeeperLanguage: 'English',
      language: '简体中文',
      retrievedContexts: [conversationBody, retrievedMemories],
      sessionDate: '2026-11-25T00:00:00.000Z',
      topicId: 'topic-1',
      topK: 2,
      username: 'Ada',
    };

    const result = await service.run(job, options);

    expect(result?.processedErrorsCount).toEqual({
      activity: 0,
      context: 0,
      experience: 0,
      identity: 0,
      preference: 0,
    });
    expect(buildContext).not.toHaveBeenCalled();
    expect(generateObject).toHaveBeenCalledTimes(6);

    for (const [payload] of generateObject.mock.calls) {
      const allContent = payload.messages.map((message) => String(message.content)).join('\n');
      expect(
        payload.messages.filter((message) => String(message.content).includes(conversationBody)),
      ).toHaveLength(1);
      expect(
        payload.messages.filter((message) => String(message.content).includes(retrievedMemories)),
      ).toHaveLength(1);
      expect(allContent).not.toContain('{{');

      if (payload.schema?.name === 'gatekeeper_decision') {
        expect(allContent).toContain('Write the reasoning in English.');
        expect(allContent).toContain('top 2');
      } else {
        expect(allContent).toContain('简体中文');
        expect(allContent).toContain('Ada');
        expect(allContent).toContain('2026-11-25T00:00:00.000Z');
      }
    }
  });
});
