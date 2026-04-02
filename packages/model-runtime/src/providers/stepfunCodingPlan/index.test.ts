// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeStepFunCodingPlanAI } from './index';

const provider = ModelProvider.StepFunCodingPlan;
const defaultBaseURL = 'https://api.stepfun.com/step_plan/v1';

testProvider({
  Runtime: LobeStepFunCodingPlanAI,
  chatDebugEnv: 'DEBUG_STEPFUN_CODING_PLAN_CHAT_COMPLETION',
  chatModel: 'step-3.5-flash',
  defaultBaseURL,
  provider,
  test: {
    skipAPICall: true,
  },
});

describe('LobeStepFunCodingPlanAI', () => {
  let instance: InstanceType<typeof LobeStepFunCodingPlanAI>;

  beforeEach(() => {
    instance = new LobeStepFunCodingPlanAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('handlePayload', () => {
    it('should set stream to true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.stream).toBe(true);
    });

    it('should filter out thinking parameter', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
        thinking: { budget_tokens: 1000, type: 'enabled' },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toBeUndefined();
      expect(calledPayload.enable_thinking).toBeUndefined();
    });

    it('should filter out enabledSearch parameter', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.enabledSearch).toBeUndefined();
    });

    it('should add parallel_tool_calls when tools are present', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
        tools: [{ function: { name: 'test' }, type: 'function' }],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.parallel_tool_calls).toBe(true);
    });

    it('should not add parallel_tool_calls when no tools', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.parallel_tool_calls).toBeUndefined();
    });

    it('should preserve other payload properties', async () => {
      await instance.chat({
        max_tokens: 100,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
        temperature: 0.7,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.7);
      expect(calledPayload.max_tokens).toBe(100);
    });
  });
});
