// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../types/error';
import { ModelRuntime, type ModelRuntimeHooks } from './ModelRuntime';

const getModelType = vi.hoisted(() => vi.fn());
vi.mock('../utils/getModelPricing', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getModelType,
}));

vi.mock('../providers/lobehub', () => ({
  LobeHubAI: class LobeHubAI {},
}));

const createMockRuntime = (hooks?: ModelRuntimeHooks) => {
  const mockRuntimeAI = { chat: vi.fn() } as any;
  return { runtime: new ModelRuntime(mockRuntimeAI, hooks), mockRuntimeAI };
};

const decidePayload = {
  model: 'typesafe/jev-1.13',
  questions: {
    refund: {
      criteria: { false: 'No refund requested.', true: 'Asks for money back.' },
      instructions: 'Is the customer asking for a refund?',
      type: 'boolean' as const,
    },
  },
  state: 'I was charged twice and want my money back.',
};

const decision = {
  answers: { refund: { probability: 0.99, type: 'boolean' } },
  model: 'typesafe/jev-1.13-20260917',
};

beforeEach(() => {
  getModelType.mockReset();
  getModelType.mockResolvedValue('decision');
});

describe('ModelRuntime decide hooks', () => {
  it('passes the response and provider usage to onDecideFinal after beforeDecide', async () => {
    const usage = { cost: 0.000_018, inputTextTokens: 436, totalInputTokens: 436 };
    const beforeDecide = vi.fn();
    const onDecideFinal = vi.fn();
    const { runtime, mockRuntimeAI } = createMockRuntime({ beforeDecide, onDecideFinal });
    mockRuntimeAI.decide = vi.fn(async (_payload: any, options: any) => {
      await options.onUsage(usage);
      return decision;
    });

    const options = { user: 'u1' };
    const result = await runtime.decide(decidePayload, options);

    const expected = {
      ...decision,
      providerMetadata: { lobehub: { decisionMode: 'native' } },
      usage,
    };
    expect(result).toEqual(expected);
    expect(beforeDecide).toHaveBeenCalledWith(decidePayload, options);
    expect(onDecideFinal).toHaveBeenCalledWith(
      { latencyMs: expect.any(Number), response: expected, usage },
      { options, payload: decidePayload },
    );
  });

  it('passes the provider-reported charge to onDecideFinal and the caller callback', async () => {
    const onDecideFinal = vi.fn();
    const onProviderReportedCost = vi.fn();
    const { runtime, mockRuntimeAI } = createMockRuntime({ onDecideFinal });
    mockRuntimeAI.decide = vi.fn(async (_payload: any, options: any) => {
      await options.onProviderReportedCost(0.000_018);
      return decision;
    });

    const result = await runtime.decide(decidePayload, { onProviderReportedCost });

    const expected = { ...decision, providerMetadata: { lobehub: { decisionMode: 'native' } } };
    expect(result).toEqual(expected);
    expect(onProviderReportedCost).toHaveBeenCalledWith(0.000_018);
    expect(onDecideFinal).toHaveBeenCalledWith(
      expect.objectContaining({ providerReportedCost: 0.000_018, response: expected }),
      expect.anything(),
    );
  });

  it('calls onDecideError and re-throws when the provider fails', async () => {
    const providerError = { errorType: 'ProviderBizError', error: { message: 'boom' } };
    const onDecideError = vi.fn();
    const onDecideFinal = vi.fn();
    const { runtime, mockRuntimeAI } = createMockRuntime({ onDecideError, onDecideFinal });
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(providerError);

    await expect(runtime.decide(decidePayload)).rejects.toBe(providerError);
    expect(onDecideFinal).not.toHaveBeenCalled();
    expect(onDecideError).toHaveBeenCalledWith(providerError, {
      options: undefined,
      payload: decidePayload,
    });
  });

  it('rejects instead of resolving undefined when the provider can neither decide nor emulate', async () => {
    const beforeDecide = vi.fn();
    const { runtime } = createMockRuntime({ beforeDecide });

    await expect(runtime.decide(decidePayload)).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.CapabilityNotSupported,
    });
    expect(beforeDecide).not.toHaveBeenCalled();
  });
});

describe('ModelRuntime decide emulation fallback', () => {
  const emulatedOutput = {
    q0: { evidence: 'Asks for money back.', refused: false, value: 0.93 },
  };

  it('emulates a chat model through generateObject and still runs the decide hooks', async () => {
    getModelType.mockResolvedValue('chat');
    const usage = { inputTextTokens: 300, outputTextTokens: 40, totalTokens: 340 };
    const beforeDecide = vi.fn();
    const onDecideFinal = vi.fn();
    const beforeGenerateObject = vi.fn();
    const { runtime, mockRuntimeAI } = createMockRuntime({
      beforeDecide,
      beforeGenerateObject,
      onDecideFinal,
    });
    mockRuntimeAI.decide = vi.fn();
    mockRuntimeAI.generateObject = vi.fn(async (_payload: any, options: any) => {
      await options.onUsage(usage);
      return emulatedOutput;
    });

    const onUsage = vi.fn();
    const payload = { ...decidePayload, model: 'gpt-5-mini' };
    const result = await runtime.decide(payload, { onUsage });

    const expected = {
      answers: { refund: { probability: 0.93, type: 'boolean' } },
      model: 'gpt-5-mini',
      providerMetadata: {
        lobehub: { decisionMode: 'emulated', evidence: { refund: 'Asks for money back.' } },
      },
      usage,
    };
    expect(mockRuntimeAI.decide).not.toHaveBeenCalled();
    expect(result).toEqual(expected);
    expect(onUsage).toHaveBeenCalledWith(usage);
    expect(beforeDecide).toHaveBeenCalledWith(payload, { onUsage });
    expect(onDecideFinal).toHaveBeenCalledWith(
      { latencyMs: expect.any(Number), response: expected, usage },
      { options: { onUsage }, payload },
    );
    expect(onDecideFinal.mock.calls[0][0].providerReportedCost).toBeUndefined();
    // The emulation is one decide call: generateObject hooks (billing) stay silent.
    expect(beforeGenerateObject).not.toHaveBeenCalled();
  });

  it('calls onDecideError when the emulated output stays invalid', async () => {
    getModelType.mockResolvedValue('chat');
    const onDecideError = vi.fn();
    const { runtime, mockRuntimeAI } = createMockRuntime({ onDecideError });
    mockRuntimeAI.generateObject = vi.fn().mockResolvedValue({});

    await expect(runtime.decide(decidePayload)).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.ProviderBizError,
    });
    expect(onDecideError).toHaveBeenCalledTimes(1);
  });

  it('emulates when the provider has no native decide, without a model-bank lookup', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    mockRuntimeAI.generateObject = vi.fn().mockResolvedValue(emulatedOutput);

    const result = await runtime.decide({ ...decidePayload, model: 'llama3' });

    expect(result.providerMetadata?.lobehub?.decisionMode).toBe('emulated');
    expect(getModelType).not.toHaveBeenCalled();
    expect(mockRuntimeAI.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'llama3' }),
      expect.anything(),
    );
  });

  it('treats a failed model-bank lookup as an unlisted model', async () => {
    getModelType.mockRejectedValue(new Error('redis down'));
    const { runtime, mockRuntimeAI } = createMockRuntime();
    mockRuntimeAI.decide = vi.fn();
    mockRuntimeAI.generateObject = vi.fn().mockResolvedValue(emulatedOutput);

    await expect(runtime.decide(decidePayload)).resolves.toMatchObject({
      providerMetadata: { lobehub: { decisionMode: 'emulated' } },
    });
    expect(mockRuntimeAI.decide).not.toHaveBeenCalled();
  });

  it('falls back to the emulated path when the native endpoint fails', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    mockRuntimeAI.decide = vi
      .fn()
      .mockRejectedValue(new Error('400 Codex has no OpenAI-style API for /decisions'));
    mockRuntimeAI.generateObject = vi.fn().mockResolvedValue(emulatedOutput);

    const result = await runtime.decide(decidePayload);

    expect(result.providerMetadata?.lobehub?.decisionMode).toBe('emulated');
    expect(mockRuntimeAI.decide).toHaveBeenCalledTimes(1);
    expect(mockRuntimeAI.generateObject).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the provider cannot generate a structured object', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(new Error('400 unsupported'));

    await expect(runtime.decide(decidePayload)).rejects.toThrow('400 unsupported');
  });

  it('strips the decision suffix before retrying as a chat call', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    mockRuntimeAI.decide = vi
      .fn()
      .mockRejectedValue(new Error('400 Codex has no OpenAI-style API for /decisions'));
    mockRuntimeAI.generateObject = vi.fn().mockResolvedValue(emulatedOutput);

    await runtime.decide({ ...decidePayload, model: 'gpt-6-luna:decision' });

    expect(mockRuntimeAI.generateObject.mock.calls[0][0].model).toBe('gpt-6-luna');
  });

  it('does not retry a cancelled decision call', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(abort);
    mockRuntimeAI.generateObject = vi.fn();

    await expect(runtime.decide(decidePayload)).rejects.toBe(abort);
    expect(mockRuntimeAI.generateObject).not.toHaveBeenCalled();
  });

  it('does not retry a rejected request format', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    const invalid = Object.assign(new Error('empty questions'), {
      errorType: 'InvalidRequestFormat',
    });
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(invalid);
    mockRuntimeAI.generateObject = vi.fn();

    await expect(runtime.decide(decidePayload)).rejects.toBe(invalid);
    expect(mockRuntimeAI.generateObject).not.toHaveBeenCalled();
  });

  it('does not retry a normalized auth failure', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    const unauthorized = Object.assign(new Error('401 Unauthorized'), {
      errorType: 'InvalidProviderAPIKey',
    });
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(unauthorized);
    mockRuntimeAI.generateObject = vi.fn();

    await expect(runtime.decide(decidePayload)).rejects.toBe(unauthorized);
    expect(mockRuntimeAI.generateObject).not.toHaveBeenCalled();
  });

  it('does not retry a cancellation the adapter wrapped', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    const aborted = Object.assign(new Error('aborted'), { errorType: 'AbortError' });
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(aborted);
    mockRuntimeAI.generateObject = vi.fn();

    await expect(runtime.decide(decidePayload)).rejects.toBe(aborted);
    expect(mockRuntimeAI.generateObject).not.toHaveBeenCalled();
  });

  it('surfaces the native error when the emulated path also fails', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    const native = new Error('400 Codex has no OpenAI-style API for /decisions');
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(native);
    mockRuntimeAI.generateObject = vi.fn().mockRejectedValue(new Error('schema rejected'));

    await expect(runtime.decide(decidePayload)).rejects.toBe(native);
  });

  it('does not retry when the abort marker is nested inside a wrapped error', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    const wrapped = Object.assign(new Error('upstream failed'), {
      error: { name: 'AbortError' },
      errorType: 'ProviderBizError',
    });
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(wrapped);
    mockRuntimeAI.generateObject = vi.fn();

    await expect(runtime.decide(decidePayload)).rejects.toBe(wrapped);
    expect(mockRuntimeAI.generateObject).not.toHaveBeenCalled();
  });

  it('does not retry once the caller has aborted', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    const controller = new AbortController();
    controller.abort();
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(new Error('boom'));
    mockRuntimeAI.generateObject = vi.fn();

    await expect(runtime.decide(decidePayload, { signal: controller.signal })).rejects.toThrow(
      'boom',
    );
    expect(mockRuntimeAI.generateObject).not.toHaveBeenCalled();
  });

  it('does not retry after the caller deadline passed', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(timeout);
    mockRuntimeAI.generateObject = vi.fn();

    await expect(runtime.decide(decidePayload)).rejects.toBe(timeout);
    expect(mockRuntimeAI.generateObject).not.toHaveBeenCalled();
  });

  it('keeps a cancellation that lands during the fallback', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    const native = new Error('400 Codex has no OpenAI-style API for /decisions');
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockRuntimeAI.decide = vi.fn().mockRejectedValue(native);
    mockRuntimeAI.generateObject = vi.fn().mockRejectedValue(aborted);

    await expect(runtime.decide(decidePayload)).rejects.toBe(aborted);
  });
});
