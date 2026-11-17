import { type ServerConfigStore } from './store';

export const featureFlagsSelectors = (s: ServerConfigStore) => s.featureFlags;

const EMPTY_PROVIDERS: string[] = [];

export const serverConfigSelectors = {
  agentIdentityProviders: (s: ServerConfigStore) =>
    s.serverConfig.agentIdentityProviders ?? EMPTY_PROVIDERS,
  /**
   * Self-hosted switch for Artifact deployment. Cloud never sets it: there the
   * capability ships with the deployment instead of being opt-in.
   */
  enableArtifactDeployment: (s: ServerConfigStore) =>
    s.serverConfig.enableArtifactDeployment || false,
  disableEmailPassword: (s: ServerConfigStore) => s.serverConfig.disableEmailPassword || false,
  enableBusinessFeatures: (s: ServerConfigStore) => s.serverConfig.enableBusinessFeatures || false,
  /**
   * Runtime flag `voice_dictation`, which business deployments set from the business gate: the
   * dictation entry only makes sense where the realtime ASR session endpoint exists.
   */
  enableVoiceDictation: (s: ServerConfigStore) => s.featureFlags.enableVoiceDictation === true,
  /**
   * Whether the dictation entry renders. A deployment that pins a transport through
   * `VOICE_DICTATION_MODE` has declared dictation available, so the runtime flag is not
   * required — `oneshot` in particular needs no realtime ASR session endpoint.
   *
   * Pinning `realtime` is a deliberate statement that the gateway is deployed. That mode
   * surfaces a persistent error instead of hiding the control when the endpoint is missing,
   * which is the accepted trade-off for letting the pin itself open the entry.
   */
  enableVoiceDictationEntry: (s: ServerConfigStore) =>
    (s.serverConfig.voiceDictationMode ?? 'auto') !== 'auto' ||
    s.featureFlags.enableVoiceDictation === true,
  /**
   * Transport the deployment pinned. `auto` probes the realtime gateway and falls back to
   * one-shot transcription; the other two values skip the probe entirely.
   */
  voiceDictationMode: (s: ServerConfigStore) => s.serverConfig.voiceDictationMode ?? 'auto',
  enableEmailVerification: (s: ServerConfigStore) =>
    s.serverConfig.enableEmailVerification || false,
  enableComposio: (s: ServerConfigStore) => s.serverConfig.enableComposio || false,
  /** Runtime flag `dashboard`: dashboards, widget previews and the builtin-dashboard tool. */
  enableChannels: (s: ServerConfigStore) => s.featureFlags.enableChannels === true,
  enableDashboard: (s: ServerConfigStore) => s.featureFlags.enableDashboard === true,
  /** Runtime flag `managed_cloud_device`: the entry that creates a managed cloud device. */
  enableManagedCloudDevice: (s: ServerConfigStore) =>
    s.featureFlags.enableManagedCloudDevice === true,
  enableGatewayMode: (s: ServerConfigStore) => s.serverConfig.enableGatewayMode || false,
  enableTopicPreview: (s: ServerConfigStore) => s.featureFlags.enableTopicPreview === true,
  enableLobehubSkill: (s: ServerConfigStore) => s.serverConfig.enableLobehubSkill || false,
  enableMagicLink: (s: ServerConfigStore) => s.serverConfig.enableMagicLink || false,
  /** Runtime flag `mcp_apps`: MCP Apps views in the conversation. */
  enableMcpApps: (s: ServerConfigStore) => s.featureFlags.enableMcpApps === true,
  enableWebhook: (s: ServerConfigStore) => s.featureFlags.enableWebhook === true,
  enableAgentKnowledgeSpace: (s: ServerConfigStore) =>
    s.featureFlags.enableAgentKnowledgeSpace === true,
  enableMarketTrustedClient: (s: ServerConfigStore) =>
    s.serverConfig.enableMarketTrustedClient || false,
  enableWorkspacePageCollab: (s: ServerConfigStore) =>
    s.serverConfig.enableWorkspacePageCollab || false,
  enableUploadFileToServer: (s: ServerConfigStore) => s.serverConfig.enableUploadFileToServer,
  enableMultimodalUnderstanding: (s: ServerConfigStore) =>
    s.serverConfig.enableMultimodalUnderstanding || false,
  enabledTelemetryChat: (s: ServerConfigStore) => s.serverConfig.telemetry.langfuse || false,
  isMobile: (s: ServerConfigStore) => s.isMobile || false,
  oAuthSSOProviders: (s: ServerConfigStore) => s.serverConfig.oAuthSSOProviders,
  oidcIssuer: (s: ServerConfigStore) => s.serverConfig.oidcIssuer,
  sandbox: (s: ServerConfigStore) => s.serverConfig.sandbox ?? 'market',
  multimodalUnderstanding: (s: ServerConfigStore) => s.serverConfig.multimodalUnderstanding,
};
