import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { SelectedToolInjector } from '../SelectedToolInjector';

const createContext = (messages: any[] = []): PipelineContext => ({
  initialState: {
    messages: [],
    model: 'gpt-4',
    provider: 'openai',
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4096,
    model: 'gpt-4',
  },
});

describe('SelectedToolInjector', () => {
  it('should skip when no tools selected', async () => {
    const provider = new SelectedToolInjector({ selectedTools: [] });

    const context = createContext([{ content: 'Current request', id: 'user-1', role: 'user' }]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Current request');
    expect(result.metadata.selectedToolContext).toBeUndefined();
  });

  // T-202 批 B 剩余 / C4: tools are projected to a deterministic tail slot instead
  // of being appended into the last real user message, so per-operation churn
  // stays out of the [0,k) prefix. The original user messages are untouched.
  it('should project selected tools to a tail slot, leaving the last user message untouched', async () => {
    const provider = new SelectedToolInjector({
      selectedTools: [
        { identifier: 'web-search', name: 'Web Search' },
        { identifier: 'code-interpreter', name: 'Code Interpreter' },
      ],
    });

    const context = createContext([
      { content: 'Earlier question', id: 'user-1', role: 'user' },
      { content: 'Assistant reply', id: 'assistant-1', role: 'assistant' },
      { content: 'Current request', id: 'user-2', role: 'user' },
    ]);

    const result = await provider.process(context);

    // original 3 messages unchanged + 1 deterministic tail slot
    expect(result.messages).toHaveLength(4);
    expect(result.messages[2].content).toBe('Current request');
    const tail = result.messages[3].content as string;
    expect(tail).toContain('<selected_tool_context>');
    expect(tail).toContain('<selected_tools>');
    expect(tail).toContain('<tool identifier="web-search" name="Web Search" />');
    expect((result.messages[3] as any).meta.virtualLastUser).toBe(true);
    expect(result.metadata.selectedToolContext).toEqual({
      injected: true,
      toolsCount: 2,
    });
  });

  it('should inject tool content inline in the tail slot when available', async () => {
    const provider = new SelectedToolInjector({
      selectedTools: [
        {
          content: 'Search the web for information.\n\nAvailable APIs:\n- search: Search the web',
          identifier: 'web-search',
          name: 'Web Search',
        },
        { identifier: 'dalle', name: 'DALL-E' },
      ],
    });

    const context = createContext([
      { content: 'Find info about cats', id: 'user-1', role: 'user' },
    ]);

    const result = await provider.process(context);

    // index 0 = untouched real user, index 1 = tail slot
    expect(result.messages[0].content).toBe('Find info about cats');
    const content = result.messages[1].content as string;
    // Tool with content: rendered as open/close tag with content inside
    expect(content).toContain('<tool identifier="web-search" name="Web Search">');
    expect(content).toContain('Search the web for information.');
    expect(content).toContain('</tool>');
    // Tool without content: self-closing tag
    expect(content).toContain('<tool identifier="dalle" name="DALL-E" />');
  });

  it('should skip when disabled', async () => {
    const provider = new SelectedToolInjector({
      enabled: false,
      selectedTools: [{ identifier: 'web-search', name: 'Web Search' }],
    });

    const context = createContext([{ content: 'Current request', id: 'user-1', role: 'user' }]);

    const result = await provider.process(context);

    expect(result.messages[0].content).toBe('Current request');
    expect(result.metadata.selectedToolContext).toBeUndefined();
  });
});
