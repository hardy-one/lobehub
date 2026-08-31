import { createContextReferenceMarker } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { ContextSelectionsInjector } from '../ContextSelectionsInjector';

describe('ContextSelectionsInjector', () => {
  const createContext = (messages: any[] = []): PipelineContext => ({
    initialState: {
      messages: [],
      model: 'test-model',
      provider: 'test-provider',
    },
    isAborted: false,
    messages,
    metadata: {
      maxTokens: 4000,
      model: 'test-model',
    },
  });

  describe('enabled/disabled', () => {
    it('should skip injection when disabled', async () => {
      const injector = new ContextSelectionsInjector({ enabled: false });

      const context = createContext([
        {
          content: 'Question',
          metadata: {
            contextSelections: [
              {
                content: 'Selected text',
                id: 'text-1',
                source: 'text',
              },
            ],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content).toBe('Question');
      expect(result.metadata.ContextSelectionsInjectorInjectedCount).toBeUndefined();
    });

    it('should inject text context selections independently from legacy page selections', async () => {
      const injector = new ContextSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'What does this mean?',
          metadata: {
            contextSelections: [
              {
                content: '脚踢自学习',
                id: 'text-1',
                source: 'text',
                title: '脚踢自学习',
              },
            ],
            pageSelections: [
              {
                content: 'Legacy page selection',
                id: 'page-1',
                pageId: 'page-1',
                xml: '<p>Legacy page selection</p>',
              },
            ],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content).toContain('What does this mean?');
      expect(result.messages[0].content).toContain('<user_context_selections>');
      expect(result.messages[0].content).toContain('source="text"');
      expect(result.messages[0].content).toContain('脚踢自学习');
      expect(result.messages[0].content).not.toContain('<user_page_selections>');
      expect(result.messages[0].content).not.toContain('Legacy page selection');
      expect(result.metadata.ContextSelectionsInjectorInjectedCount).toBe(1);
    });
  });

  it('should expand inline references in their original message order without duplicating them', async () => {
    const injector = new ContextSelectionsInjector({ enabled: true });
    const firstMarker = createContextReferenceMarker('text-1');
    const secondMarker = createContextReferenceMarker('text-2');
    const context = createContext([
      {
        content: `before ${firstMarker} between ${secondMarker} after`,
        metadata: {
          contextSelections: [
            {
              content: 'Selected A',
              id: 'text-1',
              source: 'text',
            },
            {
              content: 'Selected B',
              id: 'text-2',
              source: 'text',
            },
          ],
        },
        role: 'user',
      },
    ]);

    const result = await injector.process(context);
    const content = result.messages[0].content as string;

    expect(content.indexOf('before')).toBeLessThan(content.indexOf('Selected A'));
    expect(content.indexOf('Selected A')).toBeLessThan(content.indexOf('between'));
    expect(content.indexOf('between')).toBeLessThan(content.indexOf('Selected B'));
    expect(content.indexOf('Selected B')).toBeLessThan(content.indexOf('after'));
    expect(content).toContain('<context_selection source="text">');
    expect(content).not.toContain('<user_context_selections>');
    expect(result.metadata.ContextSelectionsInjectorInjectedCount).toBeUndefined();
  });

  describe('context sources', () => {
    it('should inject code context selections with source metadata', async () => {
      const injector = new ContextSelectionsInjector({ enabled: true });

      const context = createContext([
        {
          content: 'Review this code',
          metadata: {
            contextSelections: [
              {
                content: 'const value = 1;',
                filePath: 'src/example.ts',
                id: 'code-1',
                lineRange: { endLine: 12, startLine: 12 },
                source: 'code',
              },
            ],
          },
          role: 'user',
        },
      ]);

      const result = await injector.process(context);

      expect(result.messages[0].content).toContain('Review this code');
      expect(result.messages[0].content).toContain('<user_context_selections>');
      expect(result.messages[0].content).toContain('filePath="src/example.ts"');
      expect(result.messages[0].content).toContain('lines="12-12"');
      expect(result.messages[0].content).toContain('const value = 1;');
    });
  });
});
