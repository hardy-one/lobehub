export type AuthMethod = 'apiKey' | 'authToken';

export interface ClientSecretPayload {
  /**
   * Represents the user's API key
   */
  apiKey?: string;
  /**
   * Authentication method for Anthropic-compatible providers.
   * - 'apiKey': sends API key as x-api-key header (Anthropic default)
   * - 'authToken': sends API key as Authorization: Bearer header
   * @default 'apiKey'
   */
  authMethod?: AuthMethod;

  /**
   * ComfyUI specific authentication fields
   */
  authType?: string;

  awsAccessKeyId?: string;

  awsRegion?: string;

  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  azureApiVersion?: string;
  /**
   * Represents the endpoint of provider
   */
  baseURL?: string;

  bearerToken?: string;

  bearerTokenExpiresAt?: number;

  /**
   * ChatGPT account identifier associated with an OAuth access token.
   */
  chatgptAccountId?: string;
  cloudflareBaseURLOrAccountID?: string;
  customHeaders?: Record<string, string>;
  /**
   * GitHub Copilot OAuth fields
   */
  oauthAccessToken?: string;
  password?: string;

  runtimeProvider?: string;
  /**
   * user id
   * in client db mode it's a uuid
   * in server db mode it's a user id
   */
  userId?: string;
  username?: string;

  vertexAIRegion?: string;
}
