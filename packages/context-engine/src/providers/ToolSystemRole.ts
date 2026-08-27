import type { API, Tool } from '@lobechat/prompts';
import { pluginPrompts } from '@lobechat/prompts';
import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import { ToolNameResolver } from '../engine/tools';
import type { LobeToolManifest } from '../engine/tools/types';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    toolSystemRole?: {
      contentLength: number;
      injected: boolean;
      supportsFunctionCall: boolean;
      toolsCount: number;
    };
  }
}

const log = debug('context-engine:provider:ToolSystemRoleProvider');

/**
 * 轻量 ("generalized tools") mode, driven by `config.promptMode === 'lean'`.
 *
 * In lean mode the nine per-plugin teaching blocks (core_capabilities /
 * workflow / best_practices …) are NOT injected. Tools are treated as
 * ordinary tools: their contract lives in the `tools[]` schema, and only a
 * compact cross-tool usage policy (product rules the schema cannot carry)
 * stays in the system prompt.
 */
/**
 * Compact cross-tool usage policy for 轻量 mode.
 *
 * Only product-level rules are kept here — the things the `tools[]` schema
 * cannot express (output quality, behavior tuning, tool arbitration, security
 * conventions). Everything that is "how to use this tool" lives in the tool
 * schema description instead.
 */
export const LEAN_TOOL_USAGE_POLICY = `<lobe_tool_policy>
- **Search citations**: all web search results must cite sources with markdown footnotes ([^1]) and list referenced URLs at the end. (lobe-web-browsing)
- **Memory writes**: default to medium memory effort; search existing memories before writing to avoid duplicates; never persist security-sensitive data. (lobe-user-memory)
- **Command arbitration**: run skill-bundled scripts with execScript; use runCommand for general CLI commands; prefer lobe-local-system runCommand on a routed device. (lobe-skills / lobe-local-system)
- **File lookup**: most uploaded files live in the resource library, not knowledge bases — locate user files with lobe-knowledge-base listFiles and cite the sources you retrieve. (lobe-knowledge-base)
- **Credentials**: when a task needs third-party auth, API keys or secrets, activate lobe-creds first and never ask the user to paste keys in chat. (lobe-activator)
- **Skill activation**: when the task matches an available skill, call activateSkill to load its instructions, then follow them. (lobe-skills)
- **Plan/Todo**: keep plans stable (strategic "what/why"); split work into actionable todos. (lobe-agent)
- **Media fallback**: for audio/video or other media the active model cannot inspect natively, activate lobe-agent and answer via its analyzeMedia tool. (lobe-agent)
</lobe_tool_policy>`;

/**
 * Tool System Role Configuration
 */
export interface ToolSystemRoleConfig {
  enabled?: boolean;
  /** Function to check if function calling is supported */
  isCanUseFC: (model: string, provider: string) => boolean | undefined;
  /** Tool manifests with systemRole and API definitions */
  manifests?: LobeToolManifest[];
  /** Model name */
  model: string;
  /** 'lean' drops the teaching blocks (generalized tools). Undefined/'full' = legacy. */
  promptMode?: 'full' | 'lean';
  /** Provider name */
  provider: string;
}

/**
 * Select the manifests whose systemRole / API descriptions get injected into the
 * system prompt by ToolSystemRoleProvider.
 *
 * Exported so ActivationResultTrimProcessor can decide, with the exact same
 * predicate, whether an activation tool result's full documentation is already
 * carried by the system prompt and can therefore be trimmed from history.
 */
export const selectToolPromptManifests = (manifests?: LobeToolManifest[]): LobeToolManifest[] =>
  (manifests ?? []).filter((manifest) => manifest.api.length > 0 || manifest.systemRole);

/**
 * Tool System Role Provider
 * Responsible for injecting tool-related system roles for models that support tool calling
 */
export class ToolSystemRoleProvider extends BaseSystemRoleProvider {
  readonly name = 'ToolSystemRoleProvider';

  private toolNameResolver: ToolNameResolver;

  constructor(
    private config: ToolSystemRoleConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
    this.toolNameResolver = new ToolNameResolver();
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) return null;

    // 轻量 mode: tools are ordinary tools — drop the nine teaching
    // blocks and the compact policy. A minimal `<available_tools>` discovery
    // block is injected separately by AvailableToolsInjector.
    const isLean = this.config.promptMode === 'lean';
    if (isLean) {
      log('轻量 mode: skipping compact tool usage policy (available_tools injector handles discovery)');
      return null;
    }

    const toolSystemRole = this.getToolSystemRole();

    if (!toolSystemRole) {
      log('No need to inject tool system role, skipping processing');
      return null;
    }

    log(`Tool system role injection completed, tools count: ${this.config.manifests?.length ?? 0}`);
    return toolSystemRole;
  }

  protected onInjected(context: PipelineContext, content: string): void {
    context.metadata.toolSystemRole = {
      contentLength: content.length,
      injected: true,
      supportsFunctionCall: !!this.config.isCanUseFC(this.config.model, this.config.provider),
      toolsCount: this.config.manifests?.length ?? 0,
    };
  }

  /**
   * Get tool system role content
   */
  private getToolSystemRole(): string | undefined {
    const { manifests, model, provider } = this.config;

    if (!manifests || manifests.length === 0) {
      log('No available tool manifests');
      return undefined;
    }

    const hasFC = this.config.isCanUseFC(model, provider);
    if (!hasFC) {
      log(`Model ${model} (${provider}) does not support function calling`);
      return undefined;
    }

    const tools: Tool[] = selectToolPromptManifests(manifests).map((manifest) => ({
      apis: manifest.api.map((api): API => ({
        desc: api.description,
        name: this.toolNameResolver.generate(manifest.identifier, api.name, manifest.type),
      })),
      description: manifest.meta?.description,
      identifier: manifest.identifier,
      name: manifest.meta?.title || manifest.identifier,
      systemRole: manifest.systemRole,
    }));

    if (tools.length === 0) {
      log('No meaningful tools to inject (all manifests have empty APIs and no systemRole)');
      return undefined;
    }

    const toolSystemRole = pluginPrompts({ tools });

    if (!toolSystemRole) {
      log('Failed to generate tool system role content');
      return undefined;
    }

    log(`Generated tool system role for ${manifests.length} tools`);
    return toolSystemRole;
  }
}
