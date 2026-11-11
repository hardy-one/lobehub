import { describe, expect, it } from 'vitest';

import { shouldUseResponsesAPI } from './apiMode';

describe('shouldUseResponsesAPI', () => {
  it('uses the runtime response API mode when the request has no mode', () => {
    expect(
      shouldUseResponsesAPI(
        {
          model: 'custom-model',
          responseApiMode: 'responses',
        },
        'test',
      ),
    ).toBe(true);
  });

  it('uses the model SDK type when the request has an explicit mode', () => {
    expect(
      shouldUseResponsesAPI(
        {
          model: 'custom-model',
          modelSdkType: 'openai-responses',
          userApiMode: 'chatCompletion',
        },
        'test',
      ),
    ).toBe(true);
  });
});
