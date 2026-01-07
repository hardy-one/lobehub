import { GTDIdentifier } from '@lobechat/builtin-tool-gtd';
import { NotebookIdentifier } from '@lobechat/builtin-tool-notebook';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRole } from './systemRole';

/**
 * Standard tools for inbox agent when enableStandardInboxTools is true
 * These tools are forced-enabled and cannot be disabled by users when the feature is on
 */
export const STANDARD_INBOX_TOOLS = [GTDIdentifier, NotebookIdentifier] as const;

/**
 * Inbox Agent - the default assistant agent for general conversations
 *
 * Note: model and provider are intentionally undefined to use user's default settings
 */
export const INBOX: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',
  runtime: (ctx) => {
    // Only include standard tools if enableStandardInboxTools is true (default behavior)
    const standardTools = ctx.enableStandardInboxTools !== false ? STANDARD_INBOX_TOOLS : [];

    return {
      plugins: [...standardTools, ...(ctx.plugins || [])],
      systemRole: systemRole,
    };
  },

  slug: BUILTIN_AGENT_SLUGS.inbox,
};
