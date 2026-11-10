import { describe, expect, it } from 'vitest';

import { ToolSystemRoleProvider } from '../ToolSystemRole';

const createContext = (messages: any[]) => ({
  initialState: { messages: [], model: 'gpt-4', provider: 'openai', systemRole: '', tools: [] },
  isAborted: false,
  messages: [
    {
      content: 'You are a helpful assistant.',
      createdAt: Date.now(),
      id: 'system-1',
      role: 'system',
      updatedAt: Date.now(),
    },
    ...messages,
  ],
  metadata: { maxTokens: 4096, model: 'gpt-4' },
});

const manifest = (identifier: string, title: string, systemRole: string) => ({
  api: [{ description: `${title} api`, name: 'run' }],
  identifier,
  meta: { description: `${title} one line capability`, title },
  systemRole,
  type: 'builtin' as const,
});

const localSystem = manifest('lobe-local-system', 'Local System', 'LOCAL_SYSTEM_MANUAL_BODY');
const documents = manifest('lobe-agent-documents', 'Documents', 'DOCUMENTS_MANUAL_BODY');

describe('ToolSystemRoleProvider on-demand switch', () => {
  it('keeps every manual inline when the switch is off', async () => {
    const provider = new ToolSystemRoleProvider({
      isCanUseFC: () => true,
      manifests: [localSystem, documents],
      model: 'gpt-4',
      provider: 'openai',
    });

    const result = await provider.process(createContext([]) as any);
    const content = result.messages[0].content as string;

    expect(content).toContain('LOCAL_SYSTEM_MANUAL_BODY');
    expect(content).toContain('DOCUMENTS_MANUAL_BODY');
    expect(content).not.toContain('<available_tools');
  });

  it('indexes non-pinned manuals and keeps the pinned one inline', async () => {
    const provider = new ToolSystemRoleProvider({
      isCanUseFC: () => true,
      manifests: [localSystem, documents],
      model: 'gpt-4',
      onDemand: true,
      provider: 'openai',
    });

    const result = await provider.process(createContext([]) as any);
    const content = result.messages[0].content as string;

    expect(content).toContain('LOCAL_SYSTEM_MANUAL_BODY');
    expect(content).not.toContain('DOCUMENTS_MANUAL_BODY');
    expect(content).toContain('<available_tools');
    expect(content).toContain('lobe-agent-documents');
    expect(content).toContain('Documents one line capability');
  });

  it('records the active mode in metadata', async () => {
    const provider = new ToolSystemRoleProvider({
      isCanUseFC: () => true,
      manifests: [localSystem],
      model: 'gpt-4',
      onDemand: true,
      provider: 'openai',
    });

    const result = await provider.process(createContext([]) as any);

    expect(result.metadata.toolSystemRole?.manualLoading).toBe('on-demand');
  });

  it('lists disabled tools in the same block as unloaded manuals', async () => {
    const provider = new ToolSystemRoleProvider({
      availableTools: [
        { description: 'DISABLED_TOOL_CAPABILITY', identifier: 'lobe-creds', name: 'Credentials' },
        { description: 'already listed', identifier: 'lobe-agent-documents', name: 'Documents' },
        { description: 'pinned, must not repeat', identifier: 'lobe-local-system', name: 'Local' },
      ],
      isCanUseFC: () => true,
      manifests: [localSystem, documents],
      model: 'gpt-4',
      onDemand: true,
      provider: 'openai',
    });

    const content = (await provider.process(createContext([]) as any)).messages[0]
      .content as string;

    expect(content).toContain('DISABLED_TOOL_CAPABILITY');
    const indexBlock = content.slice(content.indexOf('<available_tools'));
    expect(indexBlock.match(/lobe-agent-documents/g)?.length).toBe(1);
    expect(indexBlock).not.toContain('lobe-local-system');
  });
});
