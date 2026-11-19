import { CURRENT_VERSION } from '@lobechat/const';
import type { ChatModelCard } from '@lobechat/types';
import {
  type AiModelType,
  CHAT_MODEL_IMAGE_GENERATION_PARAMS,
  loadModels,
  ModelProvider,
  type Pricing,
  type PricingUnitName,
} from 'model-bank';
import OpenAI from 'openai';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatible';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatible';
import { processMultiProviderModelList } from '../../utils/modelParse';

type ModelSettings = NonNullable<ChatModelCard['settings']>;

/** magpie's own price for one model, USD a million tokens, with its tiers. */
interface MagpiePrice {
  cache_read?: number;
  cache_write?: number;
  input?: number;
  output?: number;
  /**
   * What a request costs whole once its input goes over `above`, lowest first:
   * OpenAI's gpt-6-astra is 2× input and cache above 272K.
   */
  tiers?: Array<{
    above: number;
    cache_read?: number;
    cache_write?: number;
    input?: number;
    output?: number;
  }>;
}

/**
 * One row of magpie's `GET /v1/models`.
 *
 * magpie serves every model the user has as `provider/model`, so an id is not
 * the vendor's own: `workbuddy/kimi-k3-1`, a routing group's `group/<id>` or
 * `auto/<model>`, and, with bare ids turned on, the model's name alone.
 *
 * The specs magpie can rewrite belong to magpie. Its window and reply limit
 * come from the vendor's list or models.dev and then from what the user set;
 * which modalities a model takes and gives, what it costs and which reasoning
 * levels it has are the user's to override too. Everything magpie neither lists
 * nor rewrites is read from model-bank.
 */
interface MagpieModelCard {
  context_length?: number;
  /** The user's name for the model, else the vendor's. */
  display_name?: string;
  id: string;
  /**
   * Set only on the rows magpie adds for the kind headers it was asked with:
   * `image` for its drawing models, `video` for its video models, `decision`
   * for those it answers at `/v1/systemone`. A chat row never carries one.
   */
  kind?: string;
  /** The model's name as magpie's own lists label it, `· provider` and all. */
  magpie_label?: string;
  /**
   * The same price as `pricing`, USD a million tokens, given when the list was
   * asked for it with `X-Magpie-Prices`: `pricing` is that price a token, and
   * only this one says what a request over a tier's input size costs.
   */
  magpie_price?: MagpiePrice;
  max_input_tokens?: number;
  max_output_tokens?: number;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  native_endpoints?: string[];
  object?: string;
  owned_by?: string;
  pricing?: Record<string, unknown>;
  /** A model thinks when it has levels, or says so. */
  reasoning?: boolean;
  reasoning_levels?: string[];
  /** Whether the model takes tool calls, which magpie reports for every model it serves. */
  supported_parameters?: string[];
  supported_reasoning_levels?: { effort: string }[];
  tool_call?: boolean;
  /**
   * How the model searches the web, given when the list was asked with
   * `X-Magpie-Drawers`: `native` for the vendor searching in its own answer,
   * `magpie` for the gateway searching on the model's behalf. Left out when
   * the model cannot search at all.
   */
  web_search?: string;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:3425';

/**
 * A magpie id reduced to the key model-bank knows the model by, spelt as magpie
 * spells one when it agrees on it (`internal/provider/group.go`'s `sameModel`):
 * lowercased, without the vendor's or the routing group's prefix, a version's
 * dot as a dash, whitespace, `_` and `-` as one dash, a vendor's snapshot date
 * off.
 */
export const magpieModelKey = (id: string): string => {
  let key = id.trim().toLowerCase();

  // A routing group magpie found goes by two ids: `auto/<model>`, the one it
  // hands out, and `group/auto-<slug>`, the one it keeps. The slug carries
  // `auto-` before the model's name, which the model itself never does.
  if (key.startsWith('group/auto-')) key = key.slice('group/auto-'.length);

  const slash = key.lastIndexOf('/');
  if (slash >= 0) key = key.slice(slash + 1);

  key = key.replaceAll(/[\s_-]+/gu, '-');

  // A version's dot, or Fireworks' `p` standing for one (`deepseek-v4p1`), as a
  // dash. Only between two digits, so `gpt-4o` keeps its name and `kimi-k3.1`
  // becomes `kimi-k3-1`, the id magpie serves that model under.
  key = key.replaceAll(/(?<=\d)[.p](?=\d)/g, '-');

  key = key.replace(/[-@]\d{8}$/, '');
  key = key.replace(/[-@]\d{6}$/, '');

  return key;
};

/** model-bank's entries, by the key a magpie id for one reduces to. */
const buildModelBankIndex = async () => {
  const index = new Map<string, any>();

  for (const model of await loadModels()) {
    const key = magpieModelKey(model.id);
    if (key && !index.has(key)) index.set(key, model);
  }

  return index;
};

/**
 * The model-bank entry for a magpie id, when one is the same model: matched on
 * the name after the provider prefix, so `workbuddy/kimi-k3-1` reaches
 * `kimi-k3.1`.
 *
 * A routing group reaches one too. `auto/kimi-k3.1` is the pool magpie found for
 * the model of that name across the providers serving it, so what model-bank
 * says of `kimi-k3.1` is what the group serves: it takes tool calls, it sees
 * images. Only the id stays the group's, since that is what a request reaches.
 */
const findKnownModel = (
  id: string,
  index: Map<string, any>,
  byId: Map<string, any>,
): any | undefined => byId.get(id) ?? index.get(magpieModelKey(id));

/**
 * magpie's own answer on tool calls for one model, when it gave one: its
 * `tool_call` flag, else the `tools` it names among the params it accepts.
 *
 * A gateway that says nothing is no answer, not `false`, since the model-bank
 * entry then decides the same way it does for the specs magpie leaves unsaid.
 */
const takesToolCalls = (model: MagpieModelCard): boolean | undefined => {
  if (typeof model.tool_call === 'boolean') return model.tool_call;
  if (model.supported_parameters) return model.supported_parameters.includes('tools');

  return undefined;
};

/**
 * magpie's own fields for one model, laid over model-bank's.
 *
 * Only what magpie can rewrite is written here, since a field this card hands
 * over wins over model-bank's. Tool calls are among them, and the one that used
 * to be missing: a routing group or an alias whose name model-bank never saw has
 * nothing else to say it takes them, so it was listed with tool calls off.
 */
const fromMagpie = (model: MagpieModelCard): Partial<ChatModelCard> => {
  const contextWindow = model.context_length ?? model.max_input_tokens;

  // magpie answers what a model takes and gives; saying nothing is no answer,
  // not `false`.
  const takes = (kind: string) =>
    model.modalities?.input ? model.modalities.input.includes(kind) : undefined;
  const gives = (kind: string) =>
    model.modalities?.output ? model.modalities.output.includes(kind) : undefined;

  // A model thinks when magpie says so, or when it kept reasoning levels for it.
  // Its `false` is the user switching reasoning off, which must survive rather
  // than fall back to model-bank's answer.
  const levels = model.reasoning_levels ?? model.supported_reasoning_levels?.map((l) => l.effort);
  const thinks =
    model.reasoning === undefined ? (levels?.length ? true : undefined) : model.reasoning;

  const vision = takes('image');
  const audio = takes('audio');
  const video = takes('video');
  const imageOutput = gives('image');
  const pricing = pricingFromMagpiePrice(model.magpie_price) ?? pricingOf(model.pricing);
  const toolCalls = takesToolCalls(model);
  // magpie names how a model searches, `native` in the vendor's own answer or
  // `magpie` on the gateway's behalf, and says nothing at all when it cannot.
  const search = model.web_search ? true : undefined;

  return {
    displayName: plainName(model),
    ...(contextWindow ? { contextWindowTokens: contextWindow } : {}),
    ...(model.max_output_tokens ? { maxOutput: model.max_output_tokens } : {}),
    ...(audio === undefined ? {} : { audio }),
    ...(toolCalls === undefined ? {} : { functionCall: toolCalls }),
    ...(imageOutput === undefined ? {} : { imageOutput }),
    ...(pricing ? { pricing } : {}),
    ...(thinks === undefined ? {} : { reasoning: thinks }),
    ...(search === undefined ? {} : { search }),
    ...(video === undefined ? {} : { video }),
    ...(vision === undefined ? {} : { vision }),
  };
};

/** magpie's price keys, as model-bank names the same unit. */
const PRICE_UNITS: ReadonlyArray<[PricingUnitName, string]> = [
  ['textInput', 'prompt'],
  ['textOutput', 'completion'],
  ['textInput_cacheRead', 'input_cache_read'],
  ['textInput_cacheWrite', 'input_cache_write'],
];

/**
 * A price a token as model-bank writes it, a million tokens.
 *
 * magpie gives USD a token as decimal strings, the shape its list has; the
 * decimal point moves back six places to the unit model-bank prices in, and no
 * further, so $0.3 a million reads 0.3 rather than 0.30000000000000004.
 */
const perMillion = (perToken: unknown): number | undefined => {
  const value =
    typeof perToken === 'number'
      ? perToken
      : typeof perToken === 'string'
        ? Number(perToken)
        : Number.NaN;

  if (!Number.isFinite(value) || value < 0) return undefined;

  return Number((value * 1_000_000).toPrecision(12));
};

/**
 * magpie's pricing for one model as model-bank's units, when it told any: the
 * gateway gives prices to a caller on this computer, and to one it is shared
 * with, and leaves the field out elsewhere.
 */
const pricingOf = (raw: Record<string, unknown> | undefined): Pricing | undefined => {
  if (!raw) return undefined;

  const units: Pricing['units'] = [];
  for (const [name, key] of PRICE_UNITS) {
    const rate = perMillion(raw[key]);
    if (rate !== undefined) units.push({ name, rate, strategy: 'fixed', unit: 'millionTokens' });
  }

  return units.length ? { currency: 'USD', units } : undefined;
};

/** magpie's own price keys, as model-bank names the same unit. */
const MAGPIE_PRICE_UNITS: ReadonlyArray<[PricingUnitName, keyof Omit<MagpiePrice, 'tiers'>]> = [
  ['textInput', 'input'],
  ['textOutput', 'output'],
  ['textInput_cacheRead', 'cache_read'],
  ['textInput_cacheWrite', 'cache_write'],
];

/** A rate magpie gave, when it is one a price can be written from. */
const rateOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * magpie's own price for one model, USD a million tokens, as model-bank's units.
 *
 * The gateway also gives that price a token as `pricing`, which is the same
 * number moved six places and with no word on size. This one knows that a
 * request whose input goes over a tier's size is billed at that tier's prices
 * whole, which model-bank writes as `volume`, not as a ladder its parts climb.
 */
const pricingFromMagpiePrice = (price: MagpiePrice | undefined): Pricing | undefined => {
  if (!price) return undefined;

  const tier = price.tiers?.find((t) => (rateOf(t.above) ?? 0) > 0);
  const units: Pricing['units'] = [];

  for (const [name, key] of MAGPIE_PRICE_UNITS) {
    const rate = rateOf(price[key]);
    if (rate === undefined) continue;

    if (!tier) {
      units.push({ name, rate, strategy: 'fixed', unit: 'millionTokens' });
      continue;
    }

    units.push({
      mode: 'volume',
      name,
      strategy: 'tiered',
      tiers: [
        { rate, upTo: tier.above },
        { rate: rateOf(tier[key]) ?? rate, upTo: 'infinity' },
      ],
      unit: 'millionTokens',
    });
  }

  return units.length ? { currency: 'USD', units } : undefined;
};

/** What magpie appends to a routing group's label, which LobeHub says by its tag. */
const ROUTING_GROUP_SUFFIX = ' · routing group';

/**
 * The name magpie gives a model, without the `· routing group` it appends: the
 * tag says that, drawn from the id.
 *
 * A `· provider` suffix stays. Two vendors serving one model are both listed
 * under magpie, so the row alone cannot tell them apart. Without the suffix the
 * picker shows two entries of one name with nothing to choose between them.
 */
const plainName = (model: MagpieModelCard): string | undefined => {
  const label = model.magpie_label;
  if (!label) return model.display_name;

  return label.endsWith(ROUTING_GROUP_SUFFIX)
    ? label.slice(0, -ROUTING_GROUP_SUFFIX.length)
    : label;
};

/**
 * model-bank's settings for one model, limited to the parts magpie leaves unsaid.
 *
 * `reasoning_levels` says a model thinks, not which levels and default the
 * vendor accepts, so this entry's `reasoningEffort` is what puts the choice in
 * the chat settings at all.
 *
 * The effort spec goes when the user turned thinking off in magpie: the card
 * says `reasoning: false`, and offering a strength beside it would let a
 * choice be made for a model the gateway then pushes back up to its lowest
 * thinking level.
 *
 * `disabledParams` hides controls the vendor refuses. It never reaches a
 * request, since magpie drops what an upstream rejects, but the settings page
 * would otherwise offer a slider that does nothing. `searchImpl` and
 * `searchProvider` stay out: magpie's search is its own, not the vendor's
 * way of implementing it.
 */
const knownSettings = (
  known: any,
  thinks: boolean | undefined,
): Pick<ChatModelCard, 'settings'> => {
  const extendParams: ModelSettings['extendParams'] = known?.settings?.extendParams;
  const disabledParams: ModelSettings['disabledParams'] = known?.settings?.disabledParams;
  const reasoningEffort: ModelSettings['reasoningEffort'] =
    thinks === false ? undefined : known?.settings?.reasoningEffort;

  if (!extendParams?.length && !disabledParams && !reasoningEffort) return {};

  return {
    settings: {
      ...(extendParams?.length ? { extendParams } : {}),
      ...(disabledParams ? { disabledParams } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    },
  };
};

/**
 * The headers that ask magpie's list for more than an agent's list carries:
 * its drawing models, its video models and its decision models, each row
 * marked `kind`, and its own price a million tokens, tiers included (see
 * `provider.DrawersHeader` and its siblings in magpie's
 * `internal/provider/remote_magpie.go`). Without them the gateway lists only
 * models to chat with at a price a token, and LobeHub's image and video
 * pickers have nothing to offer for this provider.
 */
const LIST_HEADERS = {
  'X-Magpie-Deciders': '1',
  'X-Magpie-Drawers': '1',
  'X-Magpie-Prices': '1',
  'X-Magpie-Videomakers': '1',
};

/**
 * What magpie's `kind` says a row is, as the model type LobeHub files it
 * under. A chat row names no kind and keeps the default.
 */
const KIND_TO_TYPE: Record<string, AiModelType | undefined> = {
  decision: 'decision',
  image: 'image',
  video: 'video',
};

/**
 * What magpie serves, as model cards.
 *
 * The gateway's list is the only source: the models come and go with the
 * providers the user turns on there, so nothing is shipped in the card and
 * nothing is kept for a gateway that isn't running. model-bank fills what
 * magpie leaves unsaid, so a model magpie lists without one still takes tool
 * calls as its vendor's entry says.
 */
const fetchMagpieModels = async (client: OpenAI): Promise<ChatModelCard[]> => {
  const response = await client.models.list({ headers: LIST_HEADERS });
  const rows = (response.data as unknown as MagpieModelCard[]).filter((row) => !!row?.id);

  const models = await loadModels();
  const index = await buildModelBankIndex();
  const byId = new Map(models.map((model) => [model.id, model]));

  const prepared = rows.map((row) => {
    const known = findKnownModel(row.id, index, byId);
    const card = fromMagpie(row);
    // magpie answers this one for every model it serves, so model-bank only
    // fills in a gateway that left it out.
    const functionCall = card.functionCall ?? known?.abilities?.functionCall;
    const kind = row.kind ? KIND_TO_TYPE[row.kind] : undefined;

    return {
      id: row.id,
      ...card,
      ...(functionCall === undefined ? {} : { functionCall }),
      // The kind rows name generation models, not ones to chat with, so they
      // are filed under their type. The shared pipeline drops an image card
      // without parameters, so the gateway's plain prompt schema is given when
      // model-bank has none; magpie's `/v1/images/generations` takes it for
      // any drawer. A video card takes no parameters of its own.
      ...(kind === 'image'
        ? { parameters: known?.parameters ?? CHAT_MODEL_IMAGE_GENERATION_PARAMS }
        : {}),
      ...(kind ? { type: kind } : {}),
      // `card.reasoning` is magpie's own answer, so a model it reports as not
      // thinking offers no strength to choose.
      ...knownSettings(known, card.reasoning),
    };
  });

  // A model that both chats and draws comes back twice under one id: its chat
  // row first, then the row the kind header added. The kind row names the role
  // the user turned the gateway on for, so it wins and the chat row of that id
  // is dropped. Two providers serving one model stay apart: their ids differ.
  const unique: typeof prepared = [];
  const positionById = new Map<string, number>();
  for (const card of prepared) {
    const seen = positionById.get(card.id);
    if (seen === undefined) {
      positionById.set(card.id, unique.length);
      unique.push(card);
    } else if (card.type) {
      unique[seen] = card;
    }
  }

  // A gateway listing bare ids beside the prefixed ones names the same model
  // twice; the prefixed row is kept and the alias dropped.
  const names = new Set(
    unique
      .filter((card) => card.id.includes('/'))
      .map((card) => card.id.slice(card.id.lastIndexOf('/') + 1)),
  );
  const kept = unique.filter((card) => card.id.includes('/') || !names.has(card.id));

  const cards = await processMultiProviderModelList(kept, ModelProvider.Magpie, {
    preferCardValues: true,
  });

  return cards.map((card) =>
    // magpie lists a model it only serves for embeddings as a chat row, so it
    // answers `web_search` for it too; a model that embeds does not search.
    card.type === 'embedding' && card.search ? { ...card, search: false } : card,
  );
};

export const params = {
  apiKey: 'placeholder-to-avoid-error',
  baseURL: `${DEFAULT_BASE_URL}/v1`,
  customClient: {
    // The gateway names the caller by its key (`magpie-<app>`) or else by its
    // User-Agent. The OpenAI SDK builds one from its class name, which a
    // minified build shortens to a single letter, so magpie would count
    // LobeHub's calls under that letter.
    createClient: (options: any) =>
      new OpenAI({
        ...options,
        defaultHeaders: {
          'User-Agent': `lobehub/${CURRENT_VERSION}`,
          ...options?.defaultHeaders,
        },
      }),
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_MAGPIE_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_MAGPIE_RESPONSES === '1',
  },
  models: async ({ client }: { client: OpenAI }) => fetchMagpieModels(client),
  provider: ModelProvider.Magpie,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeMagpieAI = createOpenAICompatibleRuntime(params);
