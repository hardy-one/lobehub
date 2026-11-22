import type { GroundingSearch } from '../../search';
import type { MessageMetadata, ModelReasoning, ModelUsage, ToolIntervention } from '../common';

export interface DBMessageItem {
  agentId: string | null;

  clientId: string | null;
  content: string;
  createdAt: Date;
  error: any | null;
  favorite: boolean | null;

  id: string;
  /**
   * Append-only v2: `true` marks a persisted injected-context row. Such rows
   * always carry `sourceKey`; real conversation rows never do.
   */
  isInjection: boolean;
  metadata?: MessageMetadata | null;
  model: string | null;
  observationId: string | null;

  parentId: string | null;
  provider: string | null;
  quotaId: string | null;
  reasoning: ModelReasoning | null;
  role: string;
  search: GroundingSearch | null;
  sessionId: string | null;

  sourceKey: string | null;
  threadId: string | null;
  tools: any | null;

  topicId: string | null;

  traceId: string | null;
  updatedAt: Date;
  /**
   * Token usage + cost, promoted out of `metadata.usage` into a dedicated
   * column. Reads prefer this, falling back to `metadata.usage` for legacy rows.
   */
  usage?: ModelUsage | null;
  userId: string;
  workspaceId: string | null;
}

export interface MessagePluginItem {
  apiName?: string;
  arguments?: string;
  clientId?: string;
  error?: any;
  id: string;
  identifier?: string;
  intervention?: ToolIntervention;
  state?: any;
  toolCallId?: string;
  type: string;
  userId: string;
}
