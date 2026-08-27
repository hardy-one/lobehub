import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    availableToolsInjected?: boolean;
  }
}

export interface AvailableToolItem {
  identifier: string;
  name: string;
  description: string;
}

export interface AvailableToolsInjectorConfig {
  enabled?: boolean;
  availableTools?: AvailableToolItem[];
}

/**
 * Injects a compact `<available_tools>` discovery block into the system prompt.
 *
 * 轻量 mode does not render full builtin tool teaching blocks. Tools
 * that are not initially enabled are listed here so the model can still see
 * what `lobe-activator` can dynamically activate.
 */
export class AvailableToolsInjector extends BaseSystemRoleProvider {
  readonly name = 'AvailableToolsInjector';

  constructor(
    private config: AvailableToolsInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) return null;
    const items = this.config.availableTools ?? [];
    if (items.length === 0) return null;

    const toolTags = items
      .map(
        (item) =>
          `  <tool identifier="${item.identifier}" name="${item.name}">${item.description}</tool>`,
      )
      .join('\n');

    return `<available_tools>\n${toolTags}\n</available_tools>`;
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.availableToolsInjected = true;
  }
}
