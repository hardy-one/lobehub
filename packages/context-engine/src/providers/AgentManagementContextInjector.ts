import { escapeXml } from '@lobechat/prompts';
import { agentIdentityLabel, type RuntimeMentionedAgent } from '@lobechat/types';
import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import { BaseProcessor } from '../base/BaseProcessor';
import {
  type InjectionSnapshotStore,
  mentionedAgentsKey,
  type MentionedAgentsSnapshot,
} from '../injection/InjectionSnapshotStore';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    agentManagementContextInjected?: boolean;
    agentMentionDelegationInjectionCreatedAt?: number;
    /** T-218 B1 P2: source-derived tail-slot identity (no Date.now()/random). */
    agentMentionDelegationInjectionId?: string;
  }
}

const log = debug('context-engine:provider:AgentManagementContextInjector');

/**
 * Available model info for Agent Management context
 */
export interface AvailableModelInfo {
  /** Model abilities */
  abilities?: {
    files?: boolean;
    functionCall?: boolean;
    reasoning?: boolean;
    vision?: boolean;
  };
  /** Model description */
  description?: string;
  /** Model ID */
  id: string;
  /** Model display name */
  name: string;
}

/**
 * Available provider info for Agent Management context
 */
export interface AvailableProviderInfo {
  /** Provider ID */
  id: string;
  /** Available models under this provider */
  models: AvailableModelInfo[];
  /** Provider display name */
  name: string;
}

/**
 * Available agent info for Agent Management context
 */
export interface AvailableAgentInfo {
  /** Agent description */
  description?: string;
  /** Agent ID */
  id: string;
  /** Personal name the agent is addressed by; wins over `title` as its label */
  name?: string;
  /** The role the agent plays */
  title: string;
}

/**
 * Available plugin info for Agent Management context
 */
export interface AvailablePluginInfo {
  /** Plugin description */
  description?: string;
  /** Plugin identifier */
  identifier: string;
  /** Plugin display name */
  name: string;
  /**
   * Plugin source: 'builtin' for built-in tools, 'composio' for Composio servers,
   * 'lobehub-skill' for LobehubSkill providers, 'custom' for user-added custom
   * MCP connectors (aligns with ConnectorSourceType.custom).
   */
  type: 'builtin' | 'composio' | 'lobehub-skill' | 'custom';
}

/**
 * Agent Management context
 */
export interface AgentManagementContext {
  /**
   * User's recently updated agents — surfaced so the model can callAgent without
   * searchAgent first. The current/responding agent is NEVER included here, so
   * the model has no exposure to its own id from this section and cannot
   * accidentally delegate to itself. Filtering happens at the caller side
   * (server `aiAgent` and client `contextEngineering`).
   */
  availableAgents?: AvailableAgentInfo[];
  /** Whether the user has more agents than the ones listed in `availableAgents` */
  availableAgentsHasMore?: boolean;
  /** Available plugins (all types) */
  availablePlugins?: AvailablePluginInfo[];
  /** Available providers and models */
  availableProviders?: AvailableProviderInfo[];
  /**
   * The current responding agent's id and title.
   * Exposed so the model can use Agent Management tools (updateAgent, getAgentDetail,
   * installPlugin, etc.) to manage itself when the user asks to modify the current agent.
   */
  currentAgent?: { id: string; name?: string; title?: string };
  /** Agents @mentioned by the user — supervisor should delegate to these via callAgent */
  mentionedAgents?: RuntimeMentionedAgent[];
}

export interface AgentManagementContextInjectorConfig {
  /** Agent Management context to inject */
  context?: AgentManagementContext;
  /** Whether Agent Management tool is enabled */
  enabled?: boolean;
  /** Function to format Agent Management context */
  formatContext?: (context: AgentManagementContext) => string;
}

/**
 * Format Agent Management context as XML for injection
 */
const defaultFormatContext = (context: AgentManagementContext): string => {
  const parts: string[] = [];

  // Add current agent identity so the model can self-manage
  if (context.currentAgent) {
    // Both fields: `name` is what people call it by, `title` its role. Either may be blank.
    const { id, name, title } = context.currentAgent;
    const nameAttr = name?.trim() ? ` name="${escapeXml(name.trim())}"` : '';
    const titleAttr = title?.trim() ? ` title="${escapeXml(title.trim())}"` : '';
    parts.push(`<current_agent id="${escapeXml(id)}"${nameAttr}${titleAttr} />`);
  }

  // Add available models section
  if (context.availableProviders && context.availableProviders.length > 0) {
    const providersXml = context.availableProviders
      .map((provider) => {
        const modelsXml = provider.models
          .map((model) => {
            const attrs: string[] = [`id="${model.id}"`];
            if (model.abilities) {
              if (model.abilities.functionCall) attrs.push('functionCall="true"');
              if (model.abilities.vision) attrs.push('vision="true"');
              if (model.abilities.files) attrs.push('files="true"');
              if (model.abilities.reasoning) attrs.push('reasoning="true"');
            }
            const desc = model.description ? ` - ${escapeXml(model.description)}` : '';
            return `      <model ${attrs.join(' ')}>${escapeXml(model.name)}${desc}</model>`;
          })
          .join('\n');
        return `    <provider id="${provider.id}" name="${escapeXml(provider.name)}">\n${modelsXml}\n    </provider>`;
      })
      .join('\n');

    parts.push(`<available_models>\n${providersXml}\n</available_models>`);
  }

  // Add available agents section (user's existing agents — never includes the current agent;
  // the caller filters self out so the model has no exposure to its own id from this section)
  if (context.availableAgents && context.availableAgents.length > 0) {
    const agentsXml = context.availableAgents
      .map((agent) => {
        const desc = agent.description ? ` - ${escapeXml(agent.description)}` : '';
        // "Nasa (Shadow Arvin)": the name a user would ask for, and the role.
        const label = agentIdentityLabel(agent, agent.title);
        return `    <agent id="${escapeXml(agent.id)}">${escapeXml(label)}${desc}</agent>`;
      })
      .join('\n');
    const hasMoreNote = context.availableAgentsHasMore
      ? `\n  <note>Only the ${context.availableAgents.length} most recently updated agents are listed here. The user has more agents — use the Agent Management \`searchAgent\` tool (source="user" + keyword) to find others.</note>`
      : '';
    parts.push(`<available_agents>${hasMoreNote}\n${agentsXml}\n</available_agents>`);
  }

  // Add available plugins section
  if (context.availablePlugins && context.availablePlugins.length > 0) {
    const builtinPlugins = context.availablePlugins.filter((p) => p.type === 'builtin');
    const composioPlugins = context.availablePlugins.filter((p) => p.type === 'composio');
    const lobehubSkillPlugins = context.availablePlugins.filter((p) => p.type === 'lobehub-skill');
    const customPlugins = context.availablePlugins.filter((p) => p.type === 'custom');

    const pluginsSections: string[] = [];

    if (builtinPlugins.length > 0) {
      const builtinItems = builtinPlugins
        .map((p) => {
          const desc = p.description ? ` - ${escapeXml(p.description)}` : '';
          return `    <plugin id="${p.identifier}">${escapeXml(p.name)}${desc}</plugin>`;
        })
        .join('\n');
      pluginsSections.push(`  <builtin_plugins>\n${builtinItems}\n  </builtin_plugins>`);
    }

    if (composioPlugins.length > 0) {
      const composioItems = composioPlugins
        .map((p) => {
          const desc = p.description ? ` - ${escapeXml(p.description)}` : '';
          return `    <plugin id="${p.identifier}">${escapeXml(p.name)}${desc}</plugin>`;
        })
        .join('\n');
      pluginsSections.push(`  <composio_plugins>\n${composioItems}\n  </composio_plugins>`);
    }

    if (lobehubSkillPlugins.length > 0) {
      const lobehubSkillItems = lobehubSkillPlugins
        .map((p) => {
          const desc = p.description ? ` - ${escapeXml(p.description)}` : '';
          return `    <plugin id="${p.identifier}">${escapeXml(p.name)}${desc}</plugin>`;
        })
        .join('\n');
      pluginsSections.push(
        `  <lobehub_skill_plugins>\n${lobehubSkillItems}\n  </lobehub_skill_plugins>`,
      );
    }

    if (customPlugins.length > 0) {
      const customItems = customPlugins
        .map((p) => {
          const desc = p.description ? ` - ${escapeXml(p.description)}` : '';
          return `    <plugin id="${p.identifier}">${escapeXml(p.name)}${desc}</plugin>`;
        })
        .join('\n');
      pluginsSections.push(`  <custom_plugins>\n${customItems}\n  </custom_plugins>`);
    }

    if (pluginsSections.length > 0) {
      parts.push(`<available_plugins>\n${pluginsSections.join('\n')}\n</available_plugins>`);
    }
  }

  if (parts.length === 0) {
    return '';
  }

  // Build instruction dynamically based on which sections are actually present.
  // (e.g. in "auto" mode we may inject only <available_agents> without models/plugins.)
  const hasModelsOrPlugins =
    (context.availableProviders && context.availableProviders.length > 0) ||
    (context.availablePlugins && context.availablePlugins.length > 0);
  const hasAgents = context.availableAgents && context.availableAgents.length > 0;

  const instructionParts: string[] = [];
  if (context.currentAgent) {
    instructionParts.push(
      'The `current_agent` tag is YOU — your own agent ID. When the user asks to modify your settings (model, plugins, system prompt, etc.), use this ID with updateAgent, getAgentDetail, installPlugin, or other Agent Management tools to manage yourself. Do NOT call yourself via callAgent.',
    );
  }
  if (hasModelsOrPlugins) {
    instructionParts.push(
      'When creating or updating agents using the Agent Management tools, you can select from these available models and plugins. Use the exact IDs from this context when specifying model/provider/plugins parameters.',
    );
  }
  if (hasAgents) {
    instructionParts.push(
      "The `available_agents` section lists the user's other existing agents (you are not in this list). When the user's request clearly matches one of them, you may delegate to it via the Agent Management `callAgent` tool (activating the tool first if it is not already enabled). If no listed agent matches, use `searchAgent` to look further (including the marketplace).",
    );
  }

  return `<agent_management_context>
<instruction>${instructionParts.join(' ')}</instruction>
${parts.join('\n')}
</agent_management_context>`;
};

/**
 * Format mentioned agents as delegation context for injection after the user message.
 * Instructs the AI to delegate to the mentioned agent(s) via callAgent.
 */
export const formatMentionedAgentsContext = (mentionedAgents: RuntimeMentionedAgent[]): string => {
  const agentsXml = mentionedAgents
    .map((a) => `  <agent id="${escapeXml(a.id)}" name="${escapeXml(a.name)}" />`)
    .join('\n');

  return `<mentioned_agents>
<instruction>The user has @mentioned the following agent(s) in their message. You MUST call the \`lobe-agent-management____callAgent\` tool to delegate the user's request to the mentioned agent. Do NOT attempt to handle the request yourself — call the agent and let them respond.</instruction>
${agentsXml}
</mentioned_agents>`;
};

/**
 * Agent Management Context Injector
 *
 * Has two injection points:
 *
 * 1. **Before first user message** — providers/plugins/availableAgents XML.
 *    Goes through `BaseFirstUserContentProvider` so it merges with other
 *    `systemInjection: true` providers (UserMemory, Knowledge, AgentBuilder,
 *    ...) into a single consolidated message, preserving Phase 3 ordering
 *    and prefix-cache friendliness.
 *
 * 2. **`<mentioned_agents>` delegation hint** — a separate injection point
 *    (T-193 §2.7 B1) implemented by {@link AgentMentionDelegationInjector}:
 *    projected into the virtual tail slot with a deterministic identity.
 */
export class AgentManagementContextInjector extends BaseFirstUserContentProvider {
  readonly name = 'AgentManagementContextInjector';

  constructor(
    private config: AgentManagementContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  /**
   * Build the providers/plugins/availableAgents context block for the
   * before-first-user merged injection. Excludes `mentionedAgents` — those
   * have a different injection position and are handled in `doProcess`.
   */
  protected buildContent(_context: PipelineContext): string | null {
    if (!this.config.enabled) {
      log('Agent Management not enabled, skipping before-first-user injection');
      return null;
    }

    if (!this.config.context) {
      log('No Agent Management context provided, skipping before-first-user injection');
      return null;
    }

    // Use a destructure-rest copy so future fields (e.g. currentAgent) don't
    // silently get dropped here.
    const { mentionedAgents: _mentioned, ...contextWithoutMentions } = this.config.context;

    const formatFn = this.config.formatContext || defaultFormatContext;
    const formattedContent = formatFn(contextWithoutMentions);

    if (!formattedContent) {
      log('No agent-management content to inject after formatting');
      return null;
    }

    log('Agent Management context prepared for before-first-user merge');
    return formattedContent;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    // 1) Let BaseFirstUserContentProvider handle the before-first-user merge
    const result = await super.doProcess(context);

    // Track metadata when we actually injected content
    if (this.config.enabled && this.config.context) {
      const { mentionedAgents: _m, ...rest } = this.config.context;
      const formatFn = this.config.formatContext || defaultFormatContext;
      if (formatFn(rest)) {
        result.metadata.agentManagementContextInjected = true;
      }
    }

    // 2) The `<mentioned_agents>` delegation hint is a separate injection point
    // (T-193 §2.7 B1). It is handled by `AgentMentionDelegationInjector`, which
    // the engine runs at the end of the pipeline so the hint lands in the
    // virtual tail slot (messages.length-1) with a source-derived identity.
    return result;
  }
}

/**
 * Deterministic epoch from an unknown createdAt value (never wall clock).
 * Mirrors the C3 helper: identity must derive from the source message only (P2).
 */
const toEpoch = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return 0;
};

/**
 * T-193 §2.7.1 anchor u: the last real user message — role 'user' without any
 * injection carrier marker (systemInjection / injectType / virtualLastUser / steer).
 */
const findLastRealUserIndex = (messages: PipelineContext['messages']): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const meta: any = (m as any).meta;
    if (meta?.systemInjection || meta?.injectType || meta?.virtualLastUser || meta?.steer) continue;
    return i;
  }
  return -1;
};

export interface AgentMentionDelegationInjectorConfig {
  /** Agent Management context (only `mentionedAgents` is consumed here). */
  context?: AgentManagementContext;
  /** Whether Agent Management tool is enabled */
  enabled?: boolean;
  /**
   * T-218 B1 (M1): session-scoped injection snapshot store. When supplied, the
   * formatted block is solidified under `<topicId>:mentionedAgents` and reused
   * byte-identically while the mentioned-agent set is unchanged. A different set
   * re-projects immediately (fingerprint check) so delegation semantics never
   * freeze on a stale set (T-193 §3.1 功能优先).
   */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

/**
 * Agent Mention Delegation Injector (T-193 §2.7 B1, = F2)
 *
 * Projects the `<mentioned_agents>` delegation hint into the **virtual tail
 * slot** — the last message of the payload (index `messages.length-1`) — only
 * when `mentionedAgents` is non-empty.
 *
 * Changes versus the original per-operation splice:
 *  - position: was `splice(lastUserIndex + 1, 0, …)`, now the tail slot, so the
 *    hint can never shift messages that follow it (the `[0,k)` prefix stays
 *    byte-identical even when the mention disappears on a later operation);
 *  - identity: was `agent-mention-delegation-${Date.now()}` with
 *    `createdAt: Date.now()`, now derived from the immutable mentioned-agent
 *    set and the carrier user message (`inject:agent-mention-delegation:<md5>`);
 *  - no mention → no injection and no empty placeholder block (functional
 *    semantics fully preserved).
 *
 * The trigger expression and the injection template are byte-for-byte the
 * original ones (P5). The message deliberately is NOT tagged `systemInjection`
 * (kept from the original implementation) — only `injectType` identifies it.
 */
export class AgentMentionDelegationInjector extends BaseProcessor {
  readonly name = 'AgentMentionDelegationInjector';

  constructor(
    private config: AgentMentionDelegationInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    // ---- Original trigger expressions, verbatim (P5) ----
    if (!this.config.enabled || !this.config.context) {
      return this.markAsExecuted(context);
    }

    const hasMentionedAgents =
      this.config.context.mentionedAgents && this.config.context.mentionedAgents.length > 0;

    if (!hasMentionedAgents) {
      return this.markAsExecuted(context);
    }

    const mentionedAgents = this.config.context.mentionedAgents!;

    const clonedContext = this.cloneContext(context);

    // Anchor for the carrier createdAt: the real last user message (source
    // object), never the wall clock.
    const lastUserIndex = findLastRealUserIndex(clonedContext.messages);

    if (lastUserIndex === -1) {
      log('No real user message found, skipping mention delegation injection');
      return this.markAsExecuted(context);
    }

    const carrierCreatedAt = toEpoch(clonedContext.messages[lastUserIndex].createdAt);

    // ---- Original injection template, verbatim (P5) ----
    const mentionedContent = formatMentionedAgentsContext(mentionedAgents);

    // Source-derived identity: mentioned-agent set only — no Date.now()/random (P2).
    const fingerprint = Md5.hashStr(JSON.stringify(mentionedAgents.map((a) => [a.id, a.name])));
    const injectionId = `inject:agent-mention-delegation:${fingerprint}`;

    // M1: reuse the solidified bytes while the set fingerprint matches; a new
    // set re-projects immediately (functional semantics first).
    let content = mentionedContent;
    const { snapshotStore, topicId } = this.config;
    if (snapshotStore && topicId) {
      const key = mentionedAgentsKey(topicId);
      const stored = snapshotStore.getIfFresh<MentionedAgentsSnapshot>(key, fingerprint);
      if (stored) {
        content = stored.content;
      } else {
        snapshotStore.refresh(key, { content: mentionedContent, fingerprint, id: injectionId });
      }
    }

    const mentionMessage: Message = {
      content,
      createdAt: carrierCreatedAt,
      // NOTE: deliberately NOT tagging this with `systemInjection: true`
      // (unchanged from the original). The hint is a standalone user turn.
      id: injectionId,
      meta: { injectType: 'agent-mention-delegation' },
      role: 'user' as const,
      updatedAt: carrierCreatedAt,
    };

    // T form: fixed virtual tail slot, index messages.length-1.
    clonedContext.messages.push(mentionMessage);
    clonedContext.metadata.agentMentionDelegationInjectionId = injectionId;
    clonedContext.metadata.agentMentionDelegationInjectionCreatedAt = carrierCreatedAt;

    log('Mentioned agents delegation projected to tail slot (id=%s)', injectionId);

    return this.markAsExecuted(clonedContext);
  }
}
