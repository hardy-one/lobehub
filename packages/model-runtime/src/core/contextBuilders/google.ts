import {
  Content,
  FunctionDeclaration,
  Tool as GoogleFunctionCallTool,
  Part,
  Type as SchemaType,
} from '@google/genai';
import { imageUrlToBase64 } from '@lobechat/utils';

import { ChatCompletionTool, OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { safeParseJSON } from '../../utils/safeParseJSON';
import { parseDataUri } from '../../utils/uriParser';

/**
 * Magic thoughtSignature
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures#model-behavior:~:text=context_engineering_is_the_way_to_go
 */
export const GEMINI_MAGIC_THOUGHT_SIGNATURE = 'context_engineering_is_the_way_to_go';

/**
 * Convert OpenAI content part to Google Part format
 */
export const buildGooglePart = async (
  content: UserMessageContentPart,
): Promise<Part | undefined> => {
  switch (content.type) {
    default: {
      return undefined;
    }

    case 'text': {
      return {
        text: content.text,
        thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
      };
    }

    case 'image_url': {
      const { mimeType, base64, type } = parseDataUri(content.image_url.url);

      if (type === 'base64') {
        if (!base64) {
          throw new TypeError("Image URL doesn't contain base64 data");
        }

        return {
          inlineData: { data: base64, mimeType: mimeType || 'image/png' },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      if (type === 'url') {
        const { base64, mimeType } = await imageUrlToBase64(content.image_url.url);

        return {
          inlineData: { data: base64, mimeType },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      throw new TypeError(`currently we don't support image url: ${content.image_url.url}`);
    }

    case 'video_url': {
      const { mimeType, base64, type } = parseDataUri(content.video_url.url);

      if (type === 'base64') {
        if (!base64) {
          throw new TypeError("Video URL doesn't contain base64 data");
        }

        return {
          inlineData: { data: base64, mimeType: mimeType || 'video/mp4' },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      if (type === 'url') {
        // Use imageUrlToBase64 for SSRF protection (works for any binary data including videos)
        // Note: This might need size/duration limits for practical use
        const { base64, mimeType } = await imageUrlToBase64(content.video_url.url);

        return {
          inlineData: { data: base64, mimeType },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      throw new TypeError(`currently we don't support video url: ${content.video_url.url}`);
    }
  }
};

/**
 * Convert OpenAI message to Google Content format
 */
export const buildGoogleMessage = async (
  message: OpenAIChatMessage,
  toolCallNameMap?: Map<string, string>,
): Promise<Content> => {
  const content = message.content as string | UserMessageContentPart[];

  // Handle assistant messages with tool_calls
  if (!!message.tool_calls) {
    return {
      parts: message.tool_calls.map<Part>((tool) => ({
        functionCall: {
          args: safeParseJSON(tool.function.arguments)!,
          name: tool.function.name,
        },
        // Always use the magic signature if tool doesn't have thoughtSignature
        // This ensures Google API requirements are met
        thoughtSignature: tool.thoughtSignature || GEMINI_MAGIC_THOUGHT_SIGNATURE,
      })),
      role: 'model',
    };
  }

  // Convert tool_call result to functionResponse part
  if (message.role === 'tool' && toolCallNameMap && message.tool_call_id) {
    const functionName = toolCallNameMap.get(message.tool_call_id);
    if (functionName) {
      return {
        parts: [
          {
            functionResponse: {
              name: functionName,
              response: { result: message.content },
            },
          },
        ],
        role: 'user',
      };
    }
  }

  const getParts = async () => {
    if (typeof content === 'string')
      return [{ text: content, thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }];

    const parts = await Promise.all(content.map(async (c) => await buildGooglePart(c)));
    return parts.filter(Boolean) as Part[];
  };

  return {
    parts: await getParts(),
    role: message.role === 'assistant' ? 'model' : 'user',
  };
};

/**
 * Convert messages from the OpenAI format to Google GenAI SDK format
 */
export const buildGoogleMessages = async (messages: OpenAIChatMessage[]): Promise<Content[]> => {
  const toolCallNameMap = new Map<string, string>();

  // Build tool call id to name mapping
  messages.forEach((message) => {
    if (message.role === 'assistant' && message.tool_calls) {
      message.tool_calls.forEach((toolCall) => {
        if (toolCall.type === 'function') {
          toolCallNameMap.set(toolCall.id, toolCall.function.name);
        }
      });
    }
  });

  const pools = messages
    .filter((message) => message.role !== 'function')
    .map(async (msg) => await buildGoogleMessage(msg, toolCallNameMap));

  const contents = await Promise.all(pools);

  // Filter out empty messages: contents.parts must not be empty.
  const filteredContents = contents.filter(
    (content: Content) => content.parts && content.parts.length > 0,
  );

  // Ensure all functionCall parts carry a thoughtSignature as required by Gemini
  for (const content of filteredContents) {
    if (content.role === 'model' && content.parts) {
      for (const part of content.parts) {
        if (part.functionCall && !part.thoughtSignature) {
          part.thoughtSignature = GEMINI_MAGIC_THOUGHT_SIGNATURE;
        }
      }
    }
  }

  return filteredContents;
};

/**
 * Normalize OpenAI JSON Schema to be compatible with Google Gemini API.
 * Google Gemini does not support: const, nullable, additionalProperties
 */
const normalizeGoogleSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;

  // Remove Google unsupported fields
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { const: constValue, nullable, additionalProperties, ...rest } = schema;

  // Convert const to enum (Google compatible)
  // e.g., { const: "insert", type: "string" } -> { enum: ["insert"], type: "string" }
  if (constValue !== undefined) {
    rest.enum = [constValue];
  }

  // Recursively process nested properties
  if (rest.properties) {
    rest.properties = Object.fromEntries(
      Object.entries(rest.properties).map(([key, value]: [string, any]) => [
        key,
        normalizeGoogleSchema(value),
      ]),
    );
  }

  // Handle items (array elements)
  if (rest.items) {
    rest.items = normalizeGoogleSchema(rest.items);
  }

  // Handle oneOf, anyOf, allOf
  if (rest.oneOf) {
    rest.oneOf = rest.oneOf.map((item: any) => normalizeGoogleSchema(item));
  }
  if (rest.anyOf) {
    rest.anyOf = rest.anyOf.map((item: any) => normalizeGoogleSchema(item));
  }
  if (rest.allOf) {
    rest.allOf = rest.allOf.map((item: any) => normalizeGoogleSchema(item));
  }

  return rest;
};

/**
 * Convert ChatCompletionTool to Google FunctionDeclaration
 */
export const buildGoogleTool = (tool: ChatCompletionTool): FunctionDeclaration => {
  const functionDeclaration = tool.function;
  const parameters = functionDeclaration.parameters;

  // Normalize parameters for Google compatibility
  const normalizedParams = parameters ? normalizeGoogleSchema(parameters) : null;

  const properties =
    normalizedParams?.properties && Object.keys(normalizedParams.properties).length > 0
      ? normalizedParams.properties
      : { dummy: { type: 'string' } }; // dummy property to avoid empty object

  // Sanitize properties to remove unsupported JSON Schema keywords for Google
  const properties = sanitizeSchemaForGoogle(rawProperties);

  return {
    description: functionDeclaration.description,
    name: functionDeclaration.name,
    parameters: {
      description: normalizedParams?.description,
      properties: properties,
      required: normalizedParams?.required,
      type: SchemaType.OBJECT,
    },
  };
};

/**
 * Build Google function declarations from ChatCompletionTool array
 */
export const buildGoogleTools = (
  tools: ChatCompletionTool[] | undefined,
): GoogleFunctionCallTool[] | undefined => {
  if (!tools || tools.length === 0) return;

  return [
    {
      functionDeclarations: tools.map((tool) => buildGoogleTool(tool)),
    },
  ];
};
