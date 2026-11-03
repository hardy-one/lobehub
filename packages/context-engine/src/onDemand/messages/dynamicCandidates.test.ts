import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { MessagesEngineParams } from '../../engine/messages/types';
import {
  collectOnDemandDynamicCandidates,
  createOnDemandDynamicCandidate,
  mergeOnDemandDynamicCandidates,
} from './dynamicCandidates';

const message = (content: string): UIChatMessage =>
  ({
    content,
    createdAt: 1_700_000_000_000,
    id: 'message',
    role: 'user',
    updatedAt: 1_700_000_000_000,
  }) as UIChatMessage;

describe('collectOnDemandDynamicCandidates', () => {
  it('keeps an unrelated discovery card below the first-turn relevance threshold', () => {
    const params: MessagesEngineParams = {
      messages: [message('summarize quarterly revenue')],
      model: 'gpt-4',
      provider: 'openai',
      toolsConfig: {
        discoveryCards: [
          {
            capability: 'Create and edit cooking recipes',
            executionEnvironment: 'server',
            hash: 'sha256:card',
            identifier: 'cooking',
            name: 'Cooking',
            source: 'builtin',
            version: '1.0.0',
          },
        ],
      },
    };

    const card = collectOnDemandDynamicCandidates(params, 'summarize quarterly revenue').find(
      (candidate) => candidate.entry.key === 'tool:cooking:card',
    );

    expect(card?.entry.relevance).toBe(0.2);
    expect(card?.firstTurnEligible).toBe(true);
  });
});

describe('mergeOnDemandDynamicCandidates', () => {
  it('keeps the higher-priority candidate for a duplicate key', () => {
    const optional = createOnDemandDynamicCandidate({
      content: 'optional',
      firstTurnEligible: true,
      key: 'shared-key',
      kind: 'environment',
      priority: 1,
      relevance: 1,
      source: { id: 'optional', type: 'system' },
    });
    const required = createOnDemandDynamicCandidate({
      content: 'required',
      firstTurnEligible: true,
      key: 'shared-key',
      kind: 'environment',
      priority: 1,
      relevance: 1,
      required: true,
      source: { id: 'required', type: 'system' },
    });

    const merged = mergeOnDemandDynamicCandidates([[optional], [required]]);

    expect(merged).toHaveLength(1);
    expect(merged[0].entry.content).toBe('required');
  });
});
