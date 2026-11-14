import {
  xiaomimimoTTSSchema,
  xiaomimimoTTSVoices,
  xiaomimimoVoiceCloneSchema,
  xiaomimimoVoiceDesignSchema,
} from '../const/ttsParameters';
import type { AIASRModelCard, AIChatModelCard, AITTSModelCard } from '../types/aiModel';

// Overseas (USD) price: https://mimo.mi.com/docs/en-US/pricing
const xiaomimimoChatModels: AIChatModelCard[] = [
  {
    abilities: {
      audio: true,
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      "MiMo-V2.6-Pro is Xiaomi's open-source multimodal flagship (1.02T total / 42B active) for long-horizon coding and computer use, accepting text, image, video, and audio input with a 1M context window at the previous Pro price.",
    displayName: 'MiMo-V2.6 Pro',
    enabled: true,
    family: 'mimo',
    generation: 'mimo-v2.6',
    id: 'mimo-v2.6-pro',
    isOfficial: true,
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0036, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.435, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.87, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-22',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      audio: true,
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'MiMo-V2.6-Pro-UltraSpeed serves the same weights as MiMo-V2.6-Pro at up to 20x the output speed for latency-sensitive agents.',
    displayName: 'MiMo-V2.6 Pro UltraSpeed',
    enabled: true,
    family: 'mimo',
    generation: 'mimo-v2.6',
    id: 'mimo-v2.6-pro-ultraspeed',
    isOfficial: true,
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.036, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-22',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      audio: true,
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'MiMo-V2.6-Flash is a low-cost omni-modal agent model (about 310B total / 15B active) that surpasses MiMo-V2.5-Pro on agent benchmarks at the previous MiMo-V2.5 price, with a 1M context window.',
    displayName: 'MiMo-V2.6 Flash',
    enabled: true,
    family: 'mimo',
    generation: 'mimo-v2.6',
    id: 'mimo-v2.6-flash',
    isOfficial: true,
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0028, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-22',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      "MiMo-V2.5-Pro is Xiaomi's most capable flagship model to date, delivering significant improvements in general agentic capabilities, complex software engineering, and long-horizon tasks. It retains the 1T total / 42B active hybrid-attention architecture with a 1M context window, and can sustain complex long-horizon tasks spanning more than a thousand tool calls. Performance on demanding agentic benchmarks (ClawEval, GDPVal, SWE-bench Pro) is comparable to Claude Opus 4.6.",
    displayName: 'MiMo-V2.5 Pro',
    enabled: true,
    family: 'mimo',
    id: 'mimo-v2.5-pro',
    knowledgeCutoff: '2024-12',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0036, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.435, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.87, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-22',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'MiMo-V2.5 is a native omni-modal Agent foundation model that understands images, video, audio, and text in a unified architecture, with a 1M context window. It delivers Pro-level agentic performance at roughly half the inference cost of MiMo-V2.5-Pro, with improved multimodal perception over MiMo-V2-Omni. Its built-in agentic capabilities (browsing, understanding, reasoning, execution) and faster inference make it well-suited to latency-sensitive and multi-step agent frameworks such as OpenClaw.',
    displayName: 'MiMo-V2.5',
    enabled: true,
    family: 'mimo',
    id: 'mimo-v2.5',
    knowledgeCutoff: '2024-12',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0028, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-22',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

/**
 * Speech synthesis. All three models run through `/chat/completions` with a top-level
 * `audio` argument rather than an `/audio/speech` endpoint, and return a wav container.
 * @see https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5
 */
const xiaomimimoTTSModels: AITTSModelCard[] = [
  {
    description:
      'MiMo-V2.5-TTS synthesizes speech with the nine preset voices and follows natural-language style instructions or inline style tags. Currently free of charge.',
    displayName: 'MiMo-V2.5 TTS',
    enabled: true,
    id: 'mimo-v2.5-tts',
    parameters: xiaomimimoTTSSchema,
    type: 'tts',
    voices: xiaomimimoTTSVoices,
  },
  {
    description:
      'MiMo-V2.5 TTS Voice Design derives a timbre from a text description instead of a preset voice: the instruction becomes the voice, and no audio sample is needed. Currently free of charge.',
    displayName: 'MiMo-V2.5 TTS Voice Design',
    enabled: true,
    id: 'mimo-v2.5-tts-voicedesign',
    parameters: xiaomimimoVoiceDesignSchema,
    type: 'tts',
  },
  {
    description:
      'MiMo-V2.5 TTS Voice Clone clones a timbre from a wav or mp3 sample supplied as a base64 data URL in the voice field. Currently free of charge.',
    displayName: 'MiMo-V2.5 TTS Voice Clone',
    enabled: true,
    id: 'mimo-v2.5-tts-voiceclone',
    parameters: xiaomimimoVoiceCloneSchema,
    type: 'tts',
  },
];

/**
 * Speech recognition. Audio arrives as a base64 data URL inside a user message and the
 * transcript comes back in the assistant message.
 * @see https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/Speech-Recognition
 */
const xiaomimimoASRModels: AIASRModelCard[] = [
  {
    description:
      'MiMo-V2.5-ASR transcribes wav and mp3 audio (up to 10 MB base64) in Mandarin, English, and Chinese dialects such as Cantonese, Wu, Minnan, and Sichuanese, with automatic punctuation.',
    displayName: 'MiMo-V2.5 ASR',
    enabled: true,
    id: 'mimo-v2.5-asr',
    pricing: {
      currency: 'USD',
      units: [
        // $0.074 per audio hour, billed per second
        { name: 'audioInput', rate: 0.074 / 3600, strategy: 'fixed', unit: 'second' },
      ],
    },
    type: 'asr',
  },
];

export const allModels = [...xiaomimimoChatModels, ...xiaomimimoTTSModels, ...xiaomimimoASRModels];

export default allModels;
