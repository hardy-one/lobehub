import { type AIChatModelCard } from '../../types/aiModel';
import { alibabaChatModels } from './alibaba';
import { anthropicChatModels } from './anthropic';
import { deepseekChatModels } from './deepseek';
import { googleChatModels } from './google';
import { meituanChatModels } from './meituan';
import { metaChatModels } from './meta';
import { minimaxChatModels } from './minimax';
import { mistralChatModels } from './mistral';
import { moonshotChatModels } from './moonshot';
import { nvidiaChatModels } from './nvidia';
import { openaiChatModels } from './openai';
import { opencodeChatModels } from './opencode';
import { xaiChatModels } from './xai';
import { xiaomiChatModels } from './xiaomi';
import { zhipuChatModels } from './zhipu';

// ref: https://opencode.ai/zen | https://opencode.ai/inference/v1/models
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
// Not in this catalog although listed: `jev-1.13` / `jev-1.13-free` are served by the
// separate System One endpoint (no chat completions), and `test` is a gateway placeholder.
// `claude-opus-5-5-backup` has no models.dev entry and reuses `claude-opus-5-5`'s metadata.

export const opencodeZenChatModels: AIChatModelCard[] = [
  ...alibabaChatModels,
  ...anthropicChatModels,
  ...deepseekChatModels,
  ...googleChatModels,
  ...meituanChatModels,
  ...metaChatModels,
  ...minimaxChatModels,
  ...mistralChatModels,
  ...moonshotChatModels,
  ...nvidiaChatModels,
  ...openaiChatModels,
  ...opencodeChatModels,
  ...xaiChatModels,
  ...xiaomiChatModels,
  ...zhipuChatModels,
];

export default opencodeZenChatModels;
