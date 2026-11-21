import debug from 'debug';

import type { GenerateObjectOptions, GenerateObjectPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { getModelPricing } from '../../utils/getModelPricing';
import { detectModelProvider } from '../../utils/modelParse';
import {
  generateObjectViaJsonSchema,
  generateObjectViaToolCalling,
  generateToolCallsViaChatCompletions,
} from '../protocols/openaiChatCompletions/generateObject';
import {
  generateObjectViaResponses,
  generateToolCallsViaResponses,
} from '../protocols/openaiResponses/generateObject';
import type { OpenAICompatibleRuntimeContext } from './context';
import { resolveErrorTypes } from './errors';
import type { OpenAICompatibleFactoryOptions } from './factoryOptions';
import { StructuredOutputError } from './structuredOutput';

type Runtime = OpenAICompatibleRuntimeContext;
type Factory = OpenAICompatibleFactoryOptions;

/**
 * Total attempts for a forced tool call that comes back with no tool call at
 * all. Some providers treat `tool_choice` as a soft hint and answer in plain
 * text instead (observed on DashScope-family gateways at a ~10% rate), which
 * is a transient, retryable shape failure — not a contract violation.
 */
const STRUCTURED_OUTPUT_MAX_ATTEMPTS = 3;

/**
 * A tool-call response with no tool call, retried with an explicit reminder.
 * Other StructuredOutputError reasons (malformed arguments, unparseable text)
 * mean the model did answer through the contract and a resend would not help.
 */
const isMissingToolCallError = (error: unknown): error is StructuredOutputError =>
  error instanceof StructuredOutputError && error.reason === 'no tool calls returned';

const reinforceToolCallRequest = (payload: GenerateObjectPayload): GenerateObjectPayload => ({
  ...payload,
  messages: [
    ...payload.messages,
    {
      content:
        'Your previous response did not call a tool. You must call one of the provided tools now to return your result — do not answer in plain text.',
      role: 'user' as const,
    },
  ],
});

/** Factory-level Responses API routing control (supports instance override). */
const shouldUseResponsesForGenerateObject = (
  runtime: Runtime,
  factory: Factory,
  { model, responseApi }: GenerateObjectPayload,
  context: string,
) => {
  const instanceGenerateObject = ((runtime._options as any).generateObject || {}) as {
    useResponse?: boolean;
    useResponseModels?: Array<string | RegExp>;
  };
  const flagUseResponse =
    instanceGenerateObject.useResponse ??
    (factory.generateObject ? factory.generateObject.useResponse : undefined);
  const flagUseResponseModels =
    instanceGenerateObject.useResponseModels ?? factory.generateObject?.useResponseModels;

  return runtime.shouldUseResponsesAPI({
    context,
    flagUseResponse,
    flagUseResponseModels,
    model,
    responseApi,
  });
};

/**
 * Runs a forced tool-call request, retrying the "answered in plain text"
 * shape failure up to STRUCTURED_OUTPUT_MAX_ATTEMPTS total attempts. The
 * final error carries `attempts` in its diagnostic context.
 */
const retryMissingToolCalls = async <T>(
  payload: GenerateObjectPayload,
  attemptCall: (payload: GenerateObjectPayload) => Promise<T>,
  log?: debug.Debugger,
): Promise<T> => {
  let current = payload;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await attemptCall(current);
    } catch (error) {
      if (!isMissingToolCallError(error) || attempt >= STRUCTURED_OUTPUT_MAX_ATTEMPTS) {
        if (isMissingToolCallError(error)) error.context = { ...error.context, attempts: attempt };
        throw error;
      }
      log?.('structured output: attempt %d returned no tool calls, retrying', attempt);
      current = reinforceToolCallRequest(current);
    }
  }
};

export const generateObject = async (
  runtime: Runtime,
  factory: Factory,
  payload: GenerateObjectPayload,
  options?: GenerateObjectOptions,
) => {
  const ErrorType = resolveErrorTypes(factory);
  try {
    const { schema, model, tools } = payload;

    const log = debug(`${runtime.logPrefix}:generateObject`);
    log(
      'generateObject called with model: %s, hasTools: %s, hasSchema: %s',
      model,
      !!tools,
      !!schema,
    );

    const pricing = await getModelPricing(model, runtime.id, options?.pricingContext);
    const usagePayload = { model, pricing, provider: runtime.id };

    if (tools) {
      log('using tools-based generation');
      log('generateObjectWithTools called with model: %s, toolsCount: %d', model, tools.length);

      const useResponses = shouldUseResponsesForGenerateObject(
        runtime,
        factory,
        payload,
        'tool calling',
      );
      const attempt = (current: GenerateObjectPayload) =>
        useResponses
          ? generateToolCallsViaResponses(runtime, factory, current, options, usagePayload, log)
          : generateToolCallsViaChatCompletions(
              runtime,
              factory,
              current,
              options,
              usagePayload,
              log,
            );

      return await retryMissingToolCalls(payload, attempt, log);
    }

    if (!schema) throw new Error('tools or schema is required');

    // Use tool calling fallback if configured, or when the model is known to
    // reject `response_format: { type: 'json_schema' }`. The DeepSeek API only
    // supports `json_object` and replies `400 This response_format type is
    // unavailable now` to json_schema requests, so DeepSeek-family models served
    // through generic OpenAI-compatible providers (aggregator gateways, custom
    // endpoints) must simulate structured output via forced tool calling.
    if (factory.generateObject?.useToolsCalling || detectModelProvider(model) === 'deepseek') {
      log('using tool calling fallback for structured output');
      return await retryMissingToolCalls(
        payload,
        (current) => generateObjectViaToolCalling(runtime, factory, current, options, usagePayload),
        log,
      );
    }

    const shouldUseResponses = shouldUseResponsesForGenerateObject(
      runtime,
      factory,
      payload,
      'generateObject',
    );

    // Apply schema transformation if configured
    const processedSchema = factory.generateObject?.handleSchema
      ? { ...schema, schema: factory.generateObject.handleSchema(schema.schema) }
      : schema;

    return shouldUseResponses
      ? await generateObjectViaResponses(
          runtime,
          factory,
          payload,
          processedSchema,
          options,
          usagePayload,
          log,
        )
      : await generateObjectViaJsonSchema(
          runtime,
          factory,
          payload,
          processedSchema,
          options,
          usagePayload,
          log,
        );
  } catch (error) {
    // Provider HTTP normalization must not hide the structured-output recovery signal.
    if (error instanceof StructuredOutputError) throw error;

    const handledError = runtime.handleError(error);

    if (
      handledError.errorType === AgentRuntimeErrorType.AgentRuntimeError ||
      handledError.errorType === ErrorType.bizError
    ) {
      throw error;
    }

    throw handledError;
  }
};
