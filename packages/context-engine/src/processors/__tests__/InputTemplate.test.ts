import { describe, expect, it, vi } from 'vitest';

import { createContext } from '../../testUtils';
import { InputTemplateProcessor } from '../InputTemplate';

describe('InputTemplateProcessor', () => {
  it('should apply template to user messages', async () => {
    const processor = new InputTemplateProcessor({
      inputTemplate: 'Template: {{text}} - End',
    });

    const context = createContext([
      {
        id: '1',
        role: 'user',
        content: 'Original user message',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '2',
        role: 'assistant',
        content: 'Assistant response',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('Template: Original user message - End');
    expect(result.messages[1].content).toBe('Assistant response'); // Assistant message unchanged
    expect(result.metadata.inputTemplateProcessed).toBe(1);
  });

  it('should skip processing when no template is configured', async () => {
    const processor = new InputTemplateProcessor({});

    const context = createContext([
      {
        id: '1',
        role: 'user',
        content: 'User message',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('User message'); // Unchanged
    expect(result.metadata.inputTemplateProcessed).toBeUndefined();
  });

  it('should handle template without {{text}} placeholder', async () => {
    const processor = new InputTemplateProcessor({
      inputTemplate: 'Static template content',
    });

    const context = createContext([
      {
        id: '1',
        role: 'user',
        content: 'Original message',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('Static template content');
    expect(result.metadata.inputTemplateProcessed).toBe(1);
  });

  it('should handle template compilation errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const processor = new InputTemplateProcessor({
      inputTemplate: '<%- invalid javascript code %>',
    });

    const context = createContext([
      {
        id: '1',
        role: 'user',
        content: 'User message',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const result = await processor.process(context);

    // Should skip processing due to compilation error
    expect(result.messages[0].content).toBe('User message'); // Original content preserved
    expect(result.metadata.inputTemplateProcessed).toBe(0);

    consoleSpy.mockRestore();
  });

  it('should handle template application errors gracefully', async () => {
    const processor = new InputTemplateProcessor({
      inputTemplate: '{{text}} <%- throw new Error("Application error") %>',
    });

    const context = createContext([
      {
        id: '1',
        role: 'user',
        content: 'User message',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const result = await processor.process(context);

    // Should keep original message when template application fails
    expect(result.messages[0].content).toBe('User message');
    expect(result.metadata.inputTemplateProcessed).toBe(0);
  });

  it('should only process user messages, not assistant messages', async () => {
    const processor = new InputTemplateProcessor({
      inputTemplate: 'Processed: {{text}}',
    });

    const context = createContext([
      {
        id: '1',
        role: 'user',
        content: 'User message',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '2',
        role: 'assistant',
        content: 'Assistant message',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '3',
        role: 'system',
        content: 'System message',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('Processed: User message');
    expect(result.messages[1].content).toBe('Assistant message'); // Unchanged
    expect(result.messages[2].content).toBe('System message'); // Unchanged
    expect(result.metadata.inputTemplateProcessed).toBe(1);
  });

  // A background sub-agent's report arrives as a user message from that
  // sub-agent; the template is for what the human typed.
  it('leaves a sub-agent result message untouched', async () => {
    const processor = new InputTemplateProcessor({ inputTemplate: 'Template: {{text}} - End' });

    const result = await processor.process({
      initialState: { messages: [], model: 'gpt-4', provider: 'openai', systemRole: '', tools: [] },
      isAborted: false,
      messages: [
        {
          content: 'The poem',
          createdAt: Date.now(),
          id: '1',
          metadata: { subAgentCallback: { name: 'Poet', status: 'completed', threadId: 'thd' } },
          role: 'user',
          updatedAt: Date.now(),
        },
      ],
      metadata: { maxTokens: 4096, model: 'gpt-4' },
    } as any);

    expect(result.messages[0].content).toBe('The poem');
  });

  // Append-only v2 injection rows are replayed context, not user turns. Even
  // when their body collides with the template they must reach the model
  // byte-identical, while a real user turn in the same context still gets it.
  it('leaves injection rows byte-identical even when their content collides with the template', async () => {
    const processor = new InputTemplateProcessor({ inputTemplate: 'Template: {{text}} - End' });
    const injectionContent = '{{text}}\nTemplate: literal - End 🏷️  spaces  ';
    const injection: any = {
      content: injectionContent,
      createdAt: Date.now(),
      id: 'inj-1',
      isInjection: true,
      metadata: { sourceKey: 'agent-document-message' },
      role: 'user',
      sourceKey: 'agent-document-message',
      updatedAt: Date.now(),
    };
    const real: any = {
      content: 'real user words',
      createdAt: Date.now(),
      id: 'u-1',
      role: 'user',
      updatedAt: Date.now(),
    };

    const result = await processor.process(createContext([injection, real]));

    expect(Buffer.from(String(result.messages[0].content), 'utf8')).toEqual(
      Buffer.from(injectionContent, 'utf8'),
    );
    expect(result.messages[0]).toEqual(injection);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].metadata).toEqual(injection.metadata);
    expect(result.messages[1].content).toBe('Template: real user words - End');
    expect(result.metadata.inputTemplateProcessed).toBe(1);
  });

  // A synthetic user row without the v2 flag keeps the pre-existing behaviour:
  // only the explicit isInjection marker opts a row out of templating.
  it('still templates non-injection synthetic user rows', async () => {
    const processor = new InputTemplateProcessor({ inputTemplate: 'T: {{text}}' });

    const result = await processor.process(
      createContext([
        {
          content: 'synthetic context',
          createdAt: Date.now(),
          id: 'syn-1',
          meta: { systemInjection: true },
          role: 'user',
          updatedAt: Date.now(),
        } as any,
      ]),
    );

    expect(result.messages[0].content).toBe('T: synthetic context');
    expect(result.metadata.inputTemplateProcessed).toBe(1);
  });
});
