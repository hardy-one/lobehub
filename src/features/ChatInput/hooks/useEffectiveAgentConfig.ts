import { useEffectiveAgentConfig } from '@/hooks/useEffectiveAgentConfig';

import { useChatInputStore } from '../store';
import { useAgentId } from './useAgentId';

export const useChatInputEffectiveAgentConfig = () => {
  const agentId = useAgentId();
  const topicContext = useChatInputStore((s) => s.topicModelContext);
  const context = { ...topicContext, agentId };
  const result = useEffectiveAgentConfig(context);

  return { ...result, context };
};
