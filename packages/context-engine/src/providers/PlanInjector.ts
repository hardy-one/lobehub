import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    planId?: string;
    planInjected?: boolean;
  }
}

const log = debug('context-engine:provider:PlanContextSyntheticInjector');

/**
 * Plan data structure
 * Represents a high-level plan document
 */
export interface Plan {
  /** Whether the plan is completed */
  completed: boolean;
  /** Detailed context, background, constraints */
  context?: string;
  /** Creation timestamp */
  createdAt: string;
  /** Brief summary of the plan */
  description: string;
  /** The main goal or objective */
  goal: string;
  /** Unique plan identifier */
  id: string;
  /** Last update timestamp */
  updatedAt: string;
}

export interface PlanInjectorConfig {
  /** Whether Plan injection is enabled */
  enabled?: boolean;
  /** The current plan to inject */
  plan?: Plan;
}

/**
 * Format Plan content for injection.
 */
function formatPlan(plan: Plan): string {
  const lines: string[] = ['<plan>', `<goal>${plan.goal}</goal>`];

  if (plan.description) {
    lines.push(`<description>${plan.description}</description>`);
  }

  if (plan.context) {
    lines.push(`<context>${plan.context}</context>`);
  }

  lines.push(`<status>${plan.completed ? 'completed' : 'in_progress'}</status>`);
  lines.push('</plan>');

  return lines.join('\n');
}

/**
 * Injects the current plan as a synthetic tool result after the last user
 * message. Plan state can change frequently during a long-running task, so it
 * must stay at the prompt tail rather than changing the stable prefix before
 * the first user message.
 */
export class PlanContextSyntheticInjector extends BaseProcessor {
  readonly name = 'PlanContextSyntheticInjector';

  constructor(
    private config: PlanInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const { enabled, plan } = this.config;
    if (!enabled || !plan || plan.completed) {
      log('Plan not enabled, missing, or completed; skipping injection');
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    let lastUserIndex = -1;
    for (let i = clonedContext.messages.length - 1; i >= 0; i--) {
      if (clonedContext.messages[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex === -1) {
      log('No user message found, skipping plan injection');
      return this.markAsExecuted(context);
    }

    const toolCallId = `synthetic-getPlanContext-${Date.now()}`;
    const assistantMessage: Message = {
      content: '',
      id: `synthetic-assistant-plan-${Date.now()}`,
      role: 'assistant',
      tool_calls: [
        {
          function: {
            arguments: '{}',
            name: 'getPlanContext',
          },
          id: toolCallId,
          type: 'function',
        },
      ],
    };
    const toolMessage: Message = {
      content: formatPlan(plan),
      id: `synthetic-tool-plan-${Date.now()}`,
      role: 'tool',
      tool_call_id: toolCallId,
    };

    clonedContext.messages.splice(lastUserIndex + 1, 0, assistantMessage, toolMessage);
    clonedContext.metadata.planInjected = true;
    clonedContext.metadata.planId = plan.id;

    log('Injected synthetic getPlanContext pair after user message %d', lastUserIndex);
    return this.markAsExecuted(clonedContext);
  }
}

/**
 * @deprecated Use PlanContextSyntheticInjector. Kept as a compatibility export
 * for callers importing the historical provider name.
 */
export class PlanInjector extends PlanContextSyntheticInjector {}
