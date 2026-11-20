import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    evalContextInjected?: boolean;
  }
}

const log = debug('context-engine:provider:EvalContextSystemInjector');

export interface EvalContext {
  envPrompt?: string;
  /**
   * The attempt's clock (ISO date or instant), rendered into `envPrompt` only.
   * The system date line and eval-driven date pinning were removed; all other
   * "today" values (temporal placeholders, tool prompts, time reminders) now
   * render from the real wall clock or from each message's own `createdAt`.
   */
  sessionDate?: string;
  /** IANA timezone the clock renders in; UTC when absent. */
  timezone?: string;
}

export interface EvalContextSystemInjectorConfig {
  enabled?: boolean;
  evalContext?: EvalContext;
}

/**
 * Eval Context Injector
 * Appends eval environment prompt to the system message.
 * Should run after SystemRoleInjector in the pipeline.
 */
export class EvalContextSystemInjector extends BaseSystemRoleProvider {
  readonly name = 'EvalContextSystemInjector';

  constructor(
    private config: EvalContextSystemInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (!this.config.enabled || !this.config.evalContext?.envPrompt) {
      log('Disabled or no envPrompt configured, skipping injection');
      return null;
    }

    return this.config.evalContext.envPrompt;
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.evalContextInjected = true;
  }
}
