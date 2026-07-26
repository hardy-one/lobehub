export interface OllamaToolCall {
  function: {
    arguments: Record<string, unknown>;
    name: string;
  };
}

export interface OllamaMessage {
  content: string;
  images?: string[];
  role: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string; // Required for tool messages to identify which function the result is for
}
