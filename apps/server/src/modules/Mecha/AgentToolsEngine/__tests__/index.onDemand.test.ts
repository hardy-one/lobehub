// @vitest-environment node
import { onDemandBootstrapToolIds } from '@lobechat/builtin-tools';
import { ON_DEMAND_BOOTSTRAP_ALLOWLIST } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { createServerAgentToolsEngine } from '../index';
import type { InstalledPlugin, ServerAgentToolsContext } from '../types';

const installedPlugins: InstalledPlugin[] = [
  {
    identifier: 'test-plugin',
    manifest: {
      api: [{ description: 'Test API', name: 'testApi', parameters: { type: 'object' } }],
      identifier: 'test-plugin',
      meta: { description: 'A test plugin', title: 'Test Plugin' },
      type: 'default',
    },
    runtimeType: 'default',
    type: 'plugin',
  },
  {
    identifier: 'another-plugin',
    manifest: {
      api: [{ description: 'Another API', name: 'anotherApi', parameters: { type: 'object' } }],
      identifier: 'another-plugin',
      meta: { description: 'Another test plugin', title: 'Another Plugin' },
      type: 'default',
    },
    runtimeType: 'default',
    type: 'plugin',
  },
];

const createMockContext = (): ServerAgentToolsContext => ({
  installedPlugins,
  isModelSupportToolUse: () => true,
});

describe('createServerAgentToolsEngine on-demand', () => {
  it('exposes exactly the closed bootstrap API set in on-demand mode', () => {
    const engine = createServerAgentToolsEngine(createMockContext(), {
      agentConfig: {
        chatConfig: { contextMode: 'on-demand', enableAgentMode: true },
        plugins: ['test-plugin', 'another-plugin'],
      },
      contextMode: 'on-demand',
      globalMemoryEnabled: true,
      hasEnabledKnowledgeBases: true,
      model: 'gpt-4',
      provider: 'openai',
      useApplicationBuiltinSearchTool: true,
    });

    const result = engine.generateToolsDetailed({
      model: 'gpt-4',
      provider: 'openai',
      toolIds: [...onDemandBootstrapToolIds],
    });
    const expectedNames = onDemandBootstrapToolIds.flatMap((identifier) =>
      ON_DEMAND_BOOTSTRAP_ALLOWLIST[identifier].map((apiName) => `${identifier}____${apiName}`),
    );

    expect(result.tools?.map((tool) => tool.function.name)).toEqual(expectedNames);
    expect(result.tools).toHaveLength(5);
    expect(result.tools?.some((tool) => tool.function.name.includes('invoke'))).toBe(false);
    expect(result.enabledToolIds).toEqual([...onDemandBootstrapToolIds]);
  });
});
