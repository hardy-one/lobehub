import type { ConversationContext } from '@lobechat/types';

import { getEffectiveAgentModePreference } from '@/features/ChatInput/hooks/effectiveAgentModePreference';
import {
  getRawAudioMessageCapability,
  getVoiceMessageCapability,
  useRawAudioMessageCapability,
  useVoiceMessageCapability,
} from '@/features/ChatInput/VoiceMessage/useVoiceMessageCapability';
import {
  getEffectiveConversationModelConfig,
  useEffectiveConversationModelConfig,
} from '@/features/Conversation/store/utils/effectiveModel';
import { getAgentStoreState, useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { getAiInfraStoreState, useAiInfraStore } from '@/store/aiInfra';
import type { AiInfraStore } from '@/store/aiInfra/store';
import { getUserStoreState, useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

/**
 * A chosen speech-to-text model only counts once its provider is enabled: the default points at
 * a provider a deployment may not have configured, and a button that can only fail is worse than
 * none.
 */
const isAsrProviderEnabled = (provider: string) => (s: AiInfraStore) =>
  !!provider && !!s.enabledAiProviders?.some((item) => item.id === provider);

export type VoiceMessageSendMode = 'transcribe' | 'raw-audio';

interface VoiceMessageSendModeInput {
  canSendRawAudio: boolean;
  canUseAgentFallback: boolean;
  isAgentHeterogeneous: boolean;
  isAsrConfigured: boolean;
  isAsrProviderEnabled: boolean;
}

/**
 * Resolve every voice-message path in one place. Raw audio wins over ASR so adding a configured
 * speech-to-text model never changes a model's native audio behavior. The Agent-only media path is
 * intentionally represented as raw-audio because it keeps the existing send-without-transcribe
 * contract while remaining the final fallback.
 */
const resolveVoiceMessageSendMode = ({
  canSendRawAudio,
  canUseAgentFallback,
  isAgentHeterogeneous,
  isAsrConfigured,
  isAsrProviderEnabled,
}: VoiceMessageSendModeInput): VoiceMessageSendMode | undefined => {
  if (isAgentHeterogeneous) {
    return isAsrConfigured && isAsrProviderEnabled ? 'transcribe' : undefined;
  }

  if (canSendRawAudio) return 'raw-audio';
  if (isAsrConfigured && isAsrProviderEnabled) return 'transcribe';
  if (canUseAgentFallback) return 'raw-audio';

  return undefined;
};

const getVoiceMessageSendModeInput = (context: ConversationContext) => {
  const { model, provider } = getEffectiveConversationModelConfig(context);
  const userState = getUserStoreState();
  const { provider: asrProvider } = systemAgentSelectors.asr(userState);
  const isAgentHeterogeneous = agentByIdSelectors.isAgentHeterogeneousById(context.agentId)(
    getAgentStoreState(),
  );
  const enableAgentMode = getEffectiveAgentModePreference(context.agentId);

  return {
    canSendRawAudio: getRawAudioMessageCapability({ model, provider }),
    canUseAgentFallback: getVoiceMessageCapability({ enableAgentMode, model, provider }),
    isAgentHeterogeneous,
    isAsrConfigured: systemAgentSelectors.isAsrConfigured(userState),
    isAsrProviderEnabled: isAsrProviderEnabled(asrProvider)(getAiInfraStoreState()),
  };
};

/** Resolve the send mode for the effective model and route of a conversation. */
export const resolveVoiceSendMode = (context: ConversationContext) =>
  resolveVoiceMessageSendMode(getVoiceMessageSendModeInput(context));

/**
 * Heterogeneous agents take text only: their voice turns are transcribed before sending, so the
 * recorder depends on a configured speech-to-text model rather than on the conversation model
 * accepting audio.
 */
export const isVoiceMessageTranscribed = (context: ConversationContext) =>
  resolveVoiceSendMode(context) === 'transcribe';

export const canSendVoiceMessage = (context: ConversationContext) =>
  resolveVoiceSendMode(context) !== undefined;

export const useVoiceMessageSendMode = (context: ConversationContext) => {
  const { model, provider } = useEffectiveConversationModelConfig(context);
  const isAgentHeterogeneous = useAgentStore(
    agentByIdSelectors.isAgentHeterogeneousById(context.agentId),
  );
  const isAsrConfigured = useUserStore(systemAgentSelectors.isAsrConfigured);
  const asrProvider = useUserStore((s) => systemAgentSelectors.asr(s).provider);
  const isAsrProviderReady = useAiInfraStore(isAsrProviderEnabled(asrProvider));
  const canSendRawAudio = useRawAudioMessageCapability(model, provider);
  const canUseAgentFallback = useVoiceMessageCapability(model, provider, context.agentId);

  return resolveVoiceMessageSendMode({
    canSendRawAudio,
    canUseAgentFallback,
    isAgentHeterogeneous,
    isAsrConfigured,
    isAsrProviderEnabled: isAsrProviderReady,
  });
};

export const useCanSendVoiceMessage = (context: ConversationContext) =>
  useVoiceMessageSendMode(context) !== undefined;
