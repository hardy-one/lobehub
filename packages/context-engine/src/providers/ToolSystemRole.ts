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
      manualLoading: 'inline' | 'on-demand';
      supportsFunctionCall: boolean;
      toolsCount: number;
    };
  }
}

const log = debug('context-engine:provider:ToolSystemRoleProvider');

/**
 * Tool System Role Configuration
 */
export interface ToolSystemRoleConfig {
  /**
   * Installed but disabled tools. In on-demand mode they join the same list as
   * enabled tools whose manual is not loaded, since both need activation.
   */
  availableTools?: AvailableToolEntry[];
  enabled?: boolean;
  /** Function to check if function calling is supported */
  isCanUseFC: (model: string, provider: string) => boolean | undefined;
  /** Tool manifests with systemRole and API definitions */
  manifests?: LobeToolManifest[];
  /** Model name */
  model: string;
  /**
   * Resolved per run from the user's Lab preference. When true the manuals are
   * meant to load per tool on activation instead of staying inline; the switch
   * is carried through so the choice is recorded and observable before the
   * per-tool loading path is wired up.
   */
  onDemand?: boolean;
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
 * Tools whose manual stays in the system prompt even in on-demand mode.
 *
 * `lobe-local-system` covers the shell/file work nearly every session needs, and
 * `lobe-activator` is the only way to load any other manual, so neither can be
 * left behind an activation step. Everything else is announced as a one-line
 * index entry.
 */
export const ON_DEMAND_PINNED_TOOL_IDS = ['lobe-activator', 'lobe-local-system'] as const;

/** Longest index line kept for a non-pinned tool. */
const TOOL_INDEX_ENTRY_MAX_CHARS = 120;

const escapeXmlAttr = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const escapeXmlText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * One line per tool: enough for the model to decide whether to activate it,
 * short enough that a dozen of them cost less than a single manual.
 */
const summarizeText = (text: string | undefined): string => {
  const raw = (text ?? '').trim().replaceAll(/\s+/g, ' ');
  if (raw.length <= TOOL_INDEX_ENTRY_MAX_CHARS) return raw;

  const firstSentence = raw.match(/^.*?[.!?。！？](?=\s|$)/)?.[0] ?? raw;
  const clipped =
    firstSentence.length <= TOOL_INDEX_ENTRY_MAX_CHARS
      ? firstSentence
      : `${firstSentence.slice(0, TOOL_INDEX_ENTRY_MAX_CHARS - 1)}…`;

  return clipped;
};

const summarizeCapability = (manifest: LobeToolManifest): string =>
  summarizeText(manifest.meta?.description ?? manifest.systemRole);

export interface AvailableToolEntry {
  description: string;
  identifier: string;
  name: string;
}

/**
 * The single list of tools the model cannot call yet: installed tools that are
 * disabled, and enabled tools whose manual has not been loaded. Both become
 * callable the same way, so they share one block instead of two lists whose
 * difference the model would have to remember.
 */
const renderAvailableTools = (entries: AvailableToolEntry[]): string => {
  const lines = entries
    .map(
      (entry) =>
        `  <tool identifier="${escapeXmlAttr(entry.identifier)}" name="${escapeXmlAttr(entry.name)}">${escapeXmlText(entry.description)}</tool>`,
    )
    .join('\n');

  return [
    '<available_tools description="These tools cannot be called yet. Call activateTools with the identifier to load one before first use.">',
    lines,
    '</available_tools>',
  ].join('\n');
};

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
      manualLoading: this.config.onDemand ? 'on-demand' : 'inline',
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

    const promptManifests = selectToolPromptManifests(manifests);
    const pinnedManifests = this.config.onDemand
      ? promptManifests.filter((manifest) =>
          (ON_DEMAND_PINNED_TOOL_IDS as readonly string[]).includes(manifest.identifier),
        )
      : promptManifests;
    const indexedManifests = this.config.onDemand
      ? promptManifests.filter(
          (manifest) =>
            !(ON_DEMAND_PINNED_TOOL_IDS as readonly string[]).includes(manifest.identifier),
        )
      : [];

    const tools: Tool[] = pinnedManifests.map((manifest) => ({
      apis: manifest.api.map((api): API => ({
        desc: api.description,
        name: this.toolNameResolver.generate(manifest.identifier, api.name, manifest.type),
      })),
      description: manifest.meta?.description,
      identifier: manifest.identifier,
      name: manifest.meta?.title || manifest.identifier,
      systemRole: manifest.systemRole,
    }));

    const manualSection = tools.length > 0 ? (pluginPrompts({ tools }) ?? '') : '';
    const indexedEntries: AvailableToolEntry[] = this.config.onDemand
      ? [
          ...indexedManifests.map((manifest) => ({
            description: summarizeCapability(manifest),
            identifier: manifest.identifier,
            name: manifest.meta?.title || manifest.identifier,
          })),
          ...(this.config.availableTools ?? [])
            .filter(
              (tool) =>
                !pinnedManifests.some((manifest) => manifest.identifier === tool.identifier) &&
                !indexedManifests.some((manifest) => manifest.identifier === tool.identifier),
            )
            .map((tool) => ({
              description: summarizeText(tool.description),
              identifier: tool.identifier,
              name: tool.name,
            })),
        ]
      : [];
    const indexSection = indexedEntries.length > 0 ? renderAvailableTools(indexedEntries) : '';
    const toolSystemRole = [manualSection, indexSection].filter(Boolean).join('\n\n');

    if (!toolSystemRole) {
      log('No meaningful tools to inject (all manifests have empty APIs and no systemRole)');
      return undefined;
    }

    log(`Generated tool system role for ${manifests.length} tools`);
    return toolSystemRole;
  }
}
