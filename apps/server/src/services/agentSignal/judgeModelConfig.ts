import type { UserSystemAgentConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { resolveSystemAgentModelConfig } from '@/server/services/systemAgent/modelConfig';

/**
 * Resolves the model the Agent Signal intent classifiers run on: feedback satisfaction, feedback
 * domain, and skill intent.
 *
 * They are short structured classifications that fire on every user message, so they read their
 * own service-model slot instead of following `expertise`. That slot also drives the knowledge
 * generation calls, which need a different model profile: long output over long transcripts rather
 * than a strict answer schema under a latency budget.
 */
export const resolveAgentSignalJudgeModelConfig = async (db: LobeChatDatabase, userId: string) => {
  const settings = await new UserModel(db, userId).getUserSettings();
  const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;

  return resolveSystemAgentModelConfig({
    taskConfig: systemAgent?.agentSignalJudge,
    taskKey: 'agentSignalJudge',
  });
};
