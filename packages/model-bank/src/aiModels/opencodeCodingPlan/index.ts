import { type AIChatModelCard } from '../../types/aiModel';
import { alibabaChatModels } from './alibaba';
import { anthropicChatModels } from './anthropic';
import { deepseekChatModels } from './deepseek';
import { googleChatModels } from './google';
import { meituanChatModels } from './meituan';
import { metaChatModels } from './meta';
import { minimaxChatModels } from './minimax';
import { moonshotChatModels } from './moonshot';
import { openaiChatModels } from './openai';
import { opencodeChatModels } from './opencode';
import { stepfunChatModels } from './stepfun';
import { tencentChatModels } from './tencent';
import { xaiChatModels } from './xai';
import { xiaomiChatModels } from './xiaomi';
import { zhipuChatModels } from './zhipu';

// ref: https://opencode.ai/go | https://opencode.ai/zen/go/v1/models
// Membership mirrors the provider's live `GET /v1/models` list, so the built-in
// catalog matches what the gateway actually serves; models.dev only supplies the
// metadata (abilities, limits, pricing, reasoning params, `sdkType`).
// `settings.extendParams` follows each model's `reasoning_options`:
//   - { type: 'effort', values } → the family's *ReasoningEffort switch (generic 'reasoningEffort' fallback)
//   - { type: 'effort', values: ['max'] } → no switch (native always-on)
//   - { type: 'toggle' } → enableReasoning
//   - { type: 'budget_tokens', max } → reasoningBudgetToken / reasoningBudgetToken80k
// `sdkType` mirrors models.dev's `provider.npm`: @ai-sdk/anthropic → anthropic,
// @ai-sdk/google → google, @ai-sdk/openai → openai-responses, and the provider-level
// @ai-sdk/openai-compatible default → openai (Chat Completions).
// MiMo entries also expose `mimoReasoningEffort`, from the vendor Responses API docs:
//   reasoning.effort — `none` disables thinking, every other level enables it.
// Ids the plan serves but models.dev only lists under its sibling `opencode` provider
// (glm-5.1, grok-4.6, kimi-k2.6, minimax-m2.5, qwen3.6-plus) take their metadata from
// there, and `qwen3.7-max` from the vendor entry; `omen-alpha` has no models.dev entry
// at all and is left out.

export const opencodeCodingPlanChatModels: AIChatModelCard[] = [
  ...alibabaChatModels,
  ...anthropicChatModels,
  ...deepseekChatModels,
  ...googleChatModels,
  ...meituanChatModels,
  ...metaChatModels,
  ...minimaxChatModels,
  ...moonshotChatModels,
  ...openaiChatModels,
  ...opencodeChatModels,
  ...stepfunChatModels,
  ...tencentChatModels,
  ...xaiChatModels,
  ...xiaomiChatModels,
  ...zhipuChatModels,
];

export default opencodeCodingPlanChatModels;
