import { describe, expect, it, vi } from 'vitest';

import { LobeGoogleAI } from './index';

describe('models — model-bank card merge', () => {
  it('should fall back to the model-bank card when the endpoint omits token limits and display name', async () => {
    // Relay gateways proxying /v1beta/models commonly return only `name`. The
    // merge in processModelList is remote-first (`model.X ?? knownModel?.X`),
    // so absent fields must stay absent here — otherwise a synthesized 0 or
    // id-equal name overrides the card.
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ models: [{ name: 'models/gemini-3.8-flash' }] }),
      ok: true,
    } as Response);

    const models = await new LobeGoogleAI({ apiKey: 'test' }).models();

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      contextWindowTokens: 1_048_576 + 65_536,
      displayName: 'Gemini 3.8 Flash',
      id: 'gemini-3.8-flash',
    });
    expect(models[0].maxOutput).toBe(65_536);
  });

  it('should prefer endpoint-provided token limits and display name over the card', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: () =>
        Promise.resolve({
          models: [
            {
              displayName: 'My Custom Label',
              inputTokenLimit: 100_000,
              name: 'models/gemini-3.8-flash',
              outputTokenLimit: 8000,
            },
          ],
        }),
      ok: true,
    } as Response);

    const models = await new LobeGoogleAI({ apiKey: 'test' }).models();

    expect(models[0]).toMatchObject({
      contextWindowTokens: 108_000,
      displayName: 'My Custom Label',
      maxOutput: 8000,
    });
  });
});
