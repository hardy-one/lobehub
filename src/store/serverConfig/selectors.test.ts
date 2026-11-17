import { describe, expect, it } from 'vitest';

import { DEFAULT_FEATURE_FLAGS, mapFeatureFlagsEnvToState } from '@/config/featureFlags';

import { featureFlagsSelectors, serverConfigSelectors } from './selectors';
import { initServerConfigStore } from './store';

describe('featureFlagsSelectors', () => {
  it('should return feature flags from store', () => {
    const store = initServerConfigStore({
      featureFlags: {
        ...mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS),
        isAgentEditable: false,
        showProvider: true,
        showMarket: true,
        showAiImage: true,
      },
    });

    const result = featureFlagsSelectors(store.getState());

    expect(result.isAgentEditable).toBe(false);
    expect(result.showProvider).toBe(true);
    expect(result.showMarket).toBe(true);
    expect(result.showAiImage).toBe(true);
  });
});

describe('serverConfigSelectors', () => {
  describe('enableDashboard', () => {
    it('is off by default and on only when the flag resolves to true', () => {
      expect(serverConfigSelectors.enableDashboard(initServerConfigStore({}).getState())).toBe(
        false,
      );
      const on = initServerConfigStore({
        featureFlags: {
          ...mapFeatureFlagsEnvToState({ ...DEFAULT_FEATURE_FLAGS, dashboard: true }),
        },
      });
      expect(serverConfigSelectors.enableDashboard(on.getState())).toBe(true);
    });
  });

  describe('enableVoiceDictation', () => {
    it('is off by default and on once the voice_dictation flag resolves to true', () => {
      expect(serverConfigSelectors.enableVoiceDictation(initServerConfigStore({}).getState())).toBe(
        false,
      );
      const on = initServerConfigStore({
        featureFlags: {
          ...mapFeatureFlagsEnvToState({ ...DEFAULT_FEATURE_FLAGS, voice_dictation: true }),
        },
      });
      expect(serverConfigSelectors.enableVoiceDictation(on.getState())).toBe(true);
    });
  });

  describe('voiceDictationMode', () => {
    it('defaults to auto when the deployment pins nothing', () => {
      expect(serverConfigSelectors.voiceDictationMode(initServerConfigStore({}).getState())).toBe(
        'auto',
      );
    });

    it('reports the pinned transport', () => {
      const store = initServerConfigStore({
        serverConfig: { aiProvider: {}, telemetry: {}, voiceDictationMode: 'oneshot' },
      });
      expect(serverConfigSelectors.voiceDictationMode(store.getState())).toBe('oneshot');
    });
  });

  describe('enableVoiceDictationEntry', () => {
    // `auto` must keep behaving exactly like the runtime flag alone: nothing pinned, no entry
    // unless the deployment opted in through `voice_dictation`.
    it('stays off under auto when the runtime flag is off', () => {
      const store = initServerConfigStore({
        featureFlags: mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS),
        serverConfig: { aiProvider: {}, telemetry: {}, voiceDictationMode: 'auto' },
      });
      expect(serverConfigSelectors.enableVoiceDictationEntry(store.getState())).toBe(false);
    });

    it('keeps honouring the runtime flag under auto', () => {
      const store = initServerConfigStore({
        featureFlags: {
          ...mapFeatureFlagsEnvToState({ ...DEFAULT_FEATURE_FLAGS, voice_dictation: true }),
        },
        serverConfig: { aiProvider: {}, telemetry: {}, voiceDictationMode: 'auto' },
      });
      expect(serverConfigSelectors.enableVoiceDictationEntry(store.getState())).toBe(true);
    });

    // A pinned transport declares the capability itself: `oneshot` needs no realtime
    // session endpoint, so requiring the flag would hide a working entry.
    it('opens for oneshot without the runtime flag', () => {
      const store = initServerConfigStore({
        featureFlags: mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS),
        serverConfig: { aiProvider: {}, telemetry: {}, voiceDictationMode: 'oneshot' },
      });
      expect(serverConfigSelectors.enableVoiceDictationEntry(store.getState())).toBe(true);
    });

    it('opens for realtime without the runtime flag', () => {
      const store = initServerConfigStore({
        featureFlags: mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS),
        serverConfig: { aiProvider: {}, telemetry: {}, voiceDictationMode: 'realtime' },
      });
      expect(serverConfigSelectors.enableVoiceDictationEntry(store.getState())).toBe(true);
    });
  });

  describe('enableManagedCloudDevice', () => {
    it('is off by default and on only when the flag resolves to true', () => {
      expect(
        serverConfigSelectors.enableManagedCloudDevice(initServerConfigStore({}).getState()),
      ).toBe(false);
      const on = initServerConfigStore({
        featureFlags: {
          ...mapFeatureFlagsEnvToState({ ...DEFAULT_FEATURE_FLAGS, managed_cloud_device: true }),
        },
      });
      expect(serverConfigSelectors.enableManagedCloudDevice(on.getState())).toBe(true);
    });
  });

  describe('enableGatewayMode', () => {
    it('should return true when gateway mode is enabled', () => {
      const store = initServerConfigStore({
        serverConfig: {
          aiProvider: {},
          enableGatewayMode: true,
          telemetry: {},
        },
      });

      const result = serverConfigSelectors.enableGatewayMode(store.getState());

      expect(result).toBe(true);
    });

    it('should return false when gateway mode is not defined', () => {
      const store = initServerConfigStore({
        serverConfig: {
          aiProvider: {},
          telemetry: {},
        },
      });

      const result = serverConfigSelectors.enableGatewayMode(store.getState());

      expect(result).toBe(false);
    });
  });

  describe('enabledTelemetryChat', () => {
    it('should return langfuse value from store when defined', () => {
      const store = initServerConfigStore({
        serverConfig: {
          telemetry: { langfuse: true },
          aiProvider: {},
        },
      });

      const result = serverConfigSelectors.enabledTelemetryChat(store.getState());

      expect(result).toBe(true);
    });

    it('should return false when langfuse is not defined', () => {
      const store = initServerConfigStore({
        serverConfig: {
          telemetry: {},
          aiProvider: {},
        },
      });

      const result = serverConfigSelectors.enabledTelemetryChat(store.getState());

      expect(result).toBe(false);
    });
  });
});
