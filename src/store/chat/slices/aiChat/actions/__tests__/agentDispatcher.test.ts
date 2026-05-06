import { describe, expect, it } from 'vitest';

import { selectRuntimeType } from '../agentDispatcher';

const heteroProvider = { command: 'claude', type: 'claude-code' as const };

const defaults = { isServerSseMode: false };

describe('selectRuntimeType', () => {
  describe('on web (isDesktop = false)', () => {
    const opts = { isDesktop: false };

    it('returns client when no signal is set', () => {
      expect(selectRuntimeType({ isGatewayMode: false, ...defaults }, opts)).toBe('client');
    });

    it('returns gateway when gateway mode is enabled', () => {
      expect(selectRuntimeType({ isGatewayMode: true, ...defaults }, opts)).toBe('gateway');
    });

    it('returns serverSse when serverSse mode is enabled and gateway is not', () => {
      expect(
        selectRuntimeType({ isGatewayMode: false, isServerSseMode: true }, opts),
      ).toBe('serverSse');
    });

    it('returns serverSse when both gateway and serverSse are enabled (gateway wins on server config)', () => {
      expect(
        selectRuntimeType({ isGatewayMode: true, isServerSseMode: true }, opts),
      ).toBe('gateway');
    });

    it('ignores heterogeneousProvider on web — falls through to gateway/client', () => {
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: true, ...defaults }, opts),
      ).toBe('gateway');
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: false, ...defaults }, opts),
      ).toBe('client');
    });
  });

  describe('on desktop (isDesktop = true)', () => {
    const opts = { isDesktop: true };

    it('returns hetero when a heterogeneousProvider is configured', () => {
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: true, ...defaults }, opts),
      ).toBe('hetero');
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: false, ...defaults }, opts),
      ).toBe('hetero');
    });

    it('falls back to gateway/client when no hetero provider', () => {
      expect(selectRuntimeType({ isGatewayMode: true, ...defaults }, opts)).toBe('gateway');
      expect(selectRuntimeType({ isGatewayMode: false, ...defaults }, opts)).toBe('client');
    });
  });

  describe('parentRuntime override', () => {
    it('parentRuntime wins over every other signal', () => {
      expect(
        selectRuntimeType(
          {
            parentRuntime: 'client',
            heterogeneousProvider: heteroProvider,
            isGatewayMode: true,
            isServerSseMode: true,
          },
          { isDesktop: true },
        ),
      ).toBe('client');

      expect(
        selectRuntimeType(
          { parentRuntime: 'gateway', isGatewayMode: false, ...defaults },
          { isDesktop: false },
        ),
      ).toBe('gateway');

      expect(
        selectRuntimeType(
          { parentRuntime: 'hetero', isGatewayMode: true, ...defaults },
          { isDesktop: false },
        ),
      ).toBe('hetero');

      expect(
        selectRuntimeType(
          { parentRuntime: 'serverSse', isGatewayMode: false, ...defaults },
          { isDesktop: false },
        ),
      ).toBe('serverSse');
    });
  });
});
