import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import {
  AgentDocumentBeforeSystemInjector,
  AgentDocumentMessageInjector,
  AgentDocumentSystemAppendInjector,
  AgentDocumentSystemReplaceInjector,
} from '../AgentDocumentInjector';

const createContext = (messages: any[] = []): PipelineContext => ({
  initialState: {
    messages: [],
    model: 'gpt-4o',
    provider: 'openai',
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4096,
    model: 'gpt-4o',
  },
});

describe('AgentDocumentBeforeSystemInjector (before-system)', () => {
  it('should prepend documents before system message', async () => {
    const provider = new AgentDocumentBeforeSystemInjector({
      documents: [
        {
          content: 'Before system content',
          filename: 'framework.md',
          loadPosition: 'before-system',
          loadRules: { rule: 'always' },
          policyLoad: 'always',
        },
      ],
    });

    const context = createContext([
      { content: 'Original system', id: 'sys-1', role: 'system' },
      { content: 'Hello', id: 'user-1', role: 'user' },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].content).toContain('Before system content');
    expect(result.messages[1].content).toBe('Original system');
  });
});

describe('AgentDocumentSystemAppendInjector (system-append)', () => {
  it('should append documents to existing system message', async () => {
    const provider = new AgentDocumentSystemAppendInjector({
      documents: [
        {
          content: 'System append content',
          filename: 'system.md',
          loadPosition: 'system-append',
          loadRules: { rule: 'always' },
          policyLoad: 'always',
        },
      ],
    });

    const context = createContext([
      { content: 'Original system', id: 'sys-1', role: 'system' },
      { content: 'Hello', id: 'user-1', role: 'user' },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toContain('Original system');
    expect(result.messages[0].content).toContain('System append content');
  });
});

describe('AgentDocumentSystemReplaceInjector (system-replace)', () => {
  it('should replace entire system message', async () => {
    const provider = new AgentDocumentSystemReplaceInjector({
      documents: [
        {
          content: 'Replacement content',
          filename: 'override.md',
          loadPosition: 'system-replace',
          loadRules: { rule: 'always' },
          policyLoad: 'always',
        },
      ],
    });

    const context = createContext([
      { content: 'Original system', id: 'sys-1', role: 'system' },
      { content: 'Hello', id: 'user-1', role: 'user' },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toContain('Replacement content');
    expect(result.messages[0].content).not.toContain('Original system');
  });
});

describe('AgentDocumentMessageInjector (after-first-user, context-end)', () => {
  it('should inject documents at context end', async () => {
    const provider = new AgentDocumentMessageInjector({
      documents: [
        {
          content: 'Session summary memo',
          filename: 'summary.md',
          loadPosition: 'context-end',
          loadRules: { rule: 'always' },
          policyLoad: 'always',
        },
      ],
    });

    const context = createContext([
      { content: 'System prompt', id: 'sys-1', role: 'system' },
      { content: 'Hello', id: 'user-1', role: 'user' },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[2].content).toContain('Session summary memo');
  });

  it('should inject documents after first user message', async () => {
    const provider = new AgentDocumentMessageInjector({
      documents: [
        {
          content: 'After user content',
          filename: 'after.md',
          loadPosition: 'after-first-user',
          loadRules: { rule: 'always' },
          policyLoad: 'always',
        },
      ],
    });

    const context = createContext([
      { content: 'System prompt', id: 'sys-1', role: 'system' },
      { content: 'Hello', id: 'user-1', role: 'user' },
      { content: 'Response', id: 'asst-1', role: 'assistant' },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(4);
    expect(result.messages[2].content).toContain('After user content');
  });
});
