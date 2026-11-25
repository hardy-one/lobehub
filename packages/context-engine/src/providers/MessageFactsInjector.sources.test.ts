import { escapeXml } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import { parseReferDocumentTags } from '../engine/documentReference/resolveDocumentReferences';
import { parseReferTopicTags } from '../engine/topicReference/resolveTopicReferences';
import { extractSkillImportRoutes } from './SkillImportRouteInjector';

/**
 * The message-facts injector walks the same persisted text that these shared
 * resolvers read when deciding what needs a current-turn lookup. If a tag or a
 * skill URL stops being recognized here, the per-message record would silently
 * disappear from stable prefixes.
 */
describe('message facts source parity with shared resolvers', () => {
  it('parses topic and document references from earlier-turn message text', () => {
    const messages = [
      {
        content:
          'read <refer_topic id="tpc_1" name="Old topic" /> and ' +
          '<refer_document id="docs_1" name="Spec" />',
        role: 'user',
      },
    ];

    expect(parseReferTopicTags(messages)).toEqual([{ topicId: 'tpc_1', topicTitle: 'Old topic' }]);
    expect(parseReferDocumentTags(messages)).toEqual([
      { documentId: 'docs_1', latest: true, title: 'Spec' },
    ]);
  });

  it('classifies a marketplace skill link the same way the injector records it', () => {
    const url = 'https://lobehub.com/skills/demo-skill';
    const [route] = extractSkillImportRoutes(`see ${url}`);

    expect(route).toEqual({ identifier: 'demo-skill', method: 'importFromMarket', url });
    expect(escapeXml(route.url)).toBe(url);
  });
});
