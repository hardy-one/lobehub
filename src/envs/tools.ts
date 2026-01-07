import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const getToolsConfig = () => {
  return createEnv({
    runtimeEnv: {
      CRAWLER_IMPLS: process.env.CRAWLER_IMPLS,
      ENABLE_STANDARD_INBOX_TOOLS: process.env.ENABLE_STANDARD_INBOX_TOOLS,
      SEARCH_PROVIDERS: process.env.SEARCH_PROVIDERS,
      SEARXNG_URL: process.env.SEARXNG_URL,
    },

    server: {
      CRAWLER_IMPLS: z.string().optional(),
      /**
       * Enable standard tools (GTD, Notebook, etc.) for inbox agent.
       * Set to '0' or 'false' to disable.
       * Default: true (enabled)
       */
      ENABLE_STANDARD_INBOX_TOOLS: z
        .string()
        .optional()
        .transform((val) => val !== '0' && val?.toLowerCase() !== 'false'),
      SEARCH_PROVIDERS: z.string().optional(),
      SEARXNG_URL: z.string().url().optional(),
    },
  });
};

export const toolsEnv = getToolsConfig();
