import type { ModelRuntime } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryTypeValues } from '../schemas';
import type { ExtractorTemplateProps } from '../types';
import { ContextExtractor } from './context';

const runtimeMock = { generateObject: vi.fn() } as unknown as ModelRuntime;
const extractorConfig = {
  agent: 'layer-context' as const,
  model: 'gpt-mock',
  modelRuntime: runtimeMock,
};

const templateOptions: ExtractorTemplateProps = {
  availableCategories: ['work', 'personal'],
  language: 'English',
  retrievedContexts: ['existing context'],
  sessionDate: '2024-06-01',
  topK: 3,
  username: 'User',
};

describe('ContextExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds generate object schema with context constraints', () => {
    const extractor = new ContextExtractor(extractorConfig);

    const schema = extractor.getSchema();
    expect(schema?.name).toBe('context_extraction');
    expect(schema?.strict).toBe(true);

    const memories = (schema?.schema as any).properties.memories;
    const memoryItem = memories.items;

    expect(memories.type).toBe('array');
    // memoryCategory is a plain string in schema, not an enum
    expect(memoryItem.properties.memoryCategory.type).toBe('string');
    expect(memoryItem.properties.memoryType.enum).toEqual(memoryTypeValues);
    expect((schema?.schema as any).additionalProperties).toBe(false);
  });

  it('returns full template props from options', () => {
    const extractor = new ContextExtractor(extractorConfig);

    expect(extractor.getTemplateProps(templateOptions)).toEqual({
      availableCategories: templateOptions.availableCategories,
      language: templateOptions.language,
      retrievedContext:
        templateOptions.retrievedContexts?.join('\n\n') || 'No similar memories retrieved.',
      sessionDate: templateOptions.sessionDate,
      topK: templateOptions.topK,
      username: templateOptions.username,
    });
  });

  it('builds a short user prompt without loading the system template', () => {
    const extractor = new ContextExtractor(extractorConfig);

    const result = extractor.buildUserPrompt(templateOptions);

    expect(result).toContain('Extract context memories from the conversation above.');
    expect(result).toContain('Respond in English.');
    expect(result).toContain('Use the session date 2024-06-01');
    expect(result).toContain('available categories work, personal');
    expect(result).toContain('top 3 retrieved memories');
    expect(result).toContain('Current user: User.');
    expect(result).not.toContain('You are a focused memory extraction assistant');
  });

  it('does not repeat the system template in the user prompt', async () => {
    const extractor = new ContextExtractor(extractorConfig);

    await extractor.ensurePromptTemplate();
    const result = extractor.buildUserPrompt(templateOptions);

    expect(result).not.toBe(extractor.getPrompt());
    expect(result.length).toBeLessThan(extractor.getPrompt().length);
  });

  it('keeps a memory whose type the model made up, filed under other', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.mocked(runtimeMock.generateObject).mockResolvedValue({
      memories: [
        {
          details: '',
          memoryCategory: 'work',
          memoryType: 'project',
          summary: 'Migrating search',
          tags: [],
          title: 'Search migration',
          withContext: {
            associatedObjects: [],
            associatedSubjects: [],
            currentStatus: 'ongoing',
            description: 'Moving search to Elasticsearch',
            labels: [],
            scoreImpact: 0.5,
            scoreUrgency: 0.5,
            title: 'Search migration',
            type: 'project',
          },
        },
      ],
    });

    const result = await new ContextExtractor(extractorConfig).structuredCall(templateOptions);

    expect(result.memories).toEqual([
      expect.objectContaining({ memoryType: 'other', title: 'Search migration' }),
    ]);
    expect(JSON.parse(info.mock.calls.at(-1)![0])).toMatchObject({
      agent: 'layer-context',
      event: 'memory.output.repaired',
      repairs: ['memories.0.memoryType: other'],
    });
    info.mockRestore();
  });
});
