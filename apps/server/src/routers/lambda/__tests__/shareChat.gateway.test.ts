// @vitest-environment node
import type * as BusinessConst from '@lobechat/business-const';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MessageModelModule from '@/database/models/message';
import { createContextInner } from '@/libs/trpc/lambda/context';
import type * as ErrorLoggerModule from '@/libs/trpc/utils/errorLogger';

const mockServerDB = {
  transaction: vi.fn(async (fn: (trx: unknown) => Promise<unknown>) => fn({ trx: true })),
};
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return mockServerDB;
  }),
}));

// Pin the cloud-only capability open so the visitor procedures under test are
// reachable: ENABLE_BUSINESS_FEATURES is false in OSS builds, and the
// shareChatProcedure middleware (`_helpers/agentShareFeatureGate.ts`) would
// otherwise reject everything with FORBIDDEN. A getter (not a static spread)
// keeps per-test mutation of `mocks.businessConst` visible to every later read,
// including inside the already-imported gate helper.
const mocks = vi.hoisted(() => ({
  businessConst: { ENABLE_BUSINESS_FEATURES: true },
}));
vi.mock('@lobechat/business-const', async () => {
  const actual = await vi.importActual<typeof BusinessConst>('@lobechat/business-const');
  return {
    ...actual,
    // `packages/utils/src/apiKey.ts` reads this dynamically (`import * as
    // businessConst`), pulled in transitively via the unmocked
    // `createContextInner` -> `ApiKeyModel` chain below. `actual` here
    // resolves to the cloud override, which omits this key entirely, so
    // vitest's mock-export validation has no own property to find unless it is
    // listed explicitly.
    API_KEY_PREFIX: (actual as Record<string, unknown>).API_KEY_PREFIX,
    get ENABLE_BUSINESS_FEATURES() {
      return mocks.businessConst.ENABLE_BUSINESS_FEATURES;
    },
  };
});

const mockGetFeatureFlagsState = vi.fn();
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: (...args: unknown[]) =>
    mockGetFeatureFlagsState(...args),
}));

const mockAccessCheck = vi.fn();
const mockIsRunStillAuthorized = vi.fn();
const mockLockScopedAgentRow = vi.fn();
const mockLockUploadAdmission = vi.fn();
vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: {
    findByShareIdWithAccessCheck: (...args: any[]) => mockAccessCheck(...args),
    isRunStillAuthorized: (...args: any[]) => mockIsRunStillAuthorized(...args),
    lockScopedAgentRow: (...args: any[]) => mockLockScopedAgentRow(...args),
    lockUploadAdmission: (...args: any[]) => mockLockUploadAdmission(...args),
  },
}));

const mockFindById = vi.fn();
const mockIsRunningOperationAlive = vi.fn();
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return {
      findById: mockFindById,
      isRunningOperationAlive: mockIsRunningOperationAlive,
    };
  }),
}));

// Keep the real module so `errorLogger`'s own contract still applies; only the
// silent marker is observed.
const mockMarkSilentTRPCErrorLog = vi.fn();
vi.mock('@/libs/trpc/utils/errorLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof ErrorLoggerModule>();
  return {
    ...actual,
    markSilentTRPCErrorLog: (...args: unknown[]) => mockMarkSilentTRPCErrorLog(...args),
  };
});

const mockSignUserJWT = vi.fn();
vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signUserJWT: (...args: any[]) => mockSignUserJWT(...args),
}));

vi.mock('@/database/models/message', async (importOriginal) => {
  const actual = await importOriginal<typeof MessageModelModule>();
  return {
    ...actual,
    MessageModel: vi.fn(function () {
      return {};
    }),
  };
});

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function () {
    return { getUserSettings: vi.fn().mockResolvedValue({}) };
  }),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/agent-run/agentInterventionReview', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveAgentInterventionBySource: vi.fn(),
}));

vi.mock('../aiAgent', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bridgeLegacyResumeToSourceIntervention: vi.fn(),
  dispatchClaimedAgentIntervention: vi.fn(),
}));

const { shareChatRouter } = await import('../shareChat');

const VISITOR = 'visitor-1';
const OWNER = 'owner-1';

const share = {
  agentId: 'agt_share',
  ownerId: OWNER,
  shareConfig: {
    allowReadMemory: false,
    toolGrants: [],
    maxTopicsPerVisitor: 2,
    maxTurnsPerTopic: 3,
  },
  shareId: 'share-1',
  visibility: 'link',
  workspaceId: null,
};

const visitorTopic = {
  agentId: share.agentId,
  id: 'tpc_visitor',
  metadata: { runningOperation: { operationId: 'op-1' } },
  senderId: VISITOR,
};

const createCaller = async () =>
  shareChatRouter.createCaller(await createContextInner({ userId: VISITOR }));

describe('shareChatRouter gateway tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.businessConst.ENABLE_BUSINESS_FEATURES = true;
    mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare: true });
    mockAccessCheck.mockResolvedValue(share);
    mockIsRunStillAuthorized.mockResolvedValue(true);
    mockLockScopedAgentRow.mockResolvedValue({ id: share.agentId, workspaceId: null });
    mockFindById.mockResolvedValue(visitorTopic);
    mockIsRunningOperationAlive.mockResolvedValue(true);
    mockSignUserJWT.mockResolvedValue('visitor-jwt');
  });

  describe('issueGatewayUserToken', () => {
    it('signs the per-user hub token for the VISITOR, never the creator', async () => {
      const caller = await createCaller();

      await expect(caller.issueGatewayUserToken({ shareId: 'share-1' })).resolves.toEqual({
        token: 'visitor-jwt',
      });
      expect(mockSignUserJWT).toHaveBeenCalledWith(VISITOR);
      expect(mockAccessCheck).toHaveBeenCalledWith(expect.anything(), 'share-1', VISITOR);
    });

    // The v2 hub socket is per user, not per operation: the hub authorizes
    // each `subscribe` against the op's registered owner, so minting must not
    // depend on a topic marker or a live run (a visitor opens the socket
    // before their first send).
    it('does not require a topic or a running operation', async () => {
      mockFindById.mockResolvedValue(undefined);
      mockIsRunningOperationAlive.mockResolvedValue(false);
      const caller = await createCaller();

      await expect(caller.issueGatewayUserToken({ shareId: 'share-1' })).resolves.toEqual({
        token: 'visitor-jwt',
      });
      expect(mockFindById).not.toHaveBeenCalled();
      expect(mockIsRunningOperationAlive).not.toHaveBeenCalled();
    });

    it('rejects an unknown share without signing anything', async () => {
      mockAccessCheck.mockRejectedValue(
        new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' }),
      );
      const caller = await createCaller();

      await expect(caller.issueGatewayUserToken({ shareId: 'missing' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(mockSignUserJWT).not.toHaveBeenCalled();
    });

    it('rejects a share that is not link-visible', async () => {
      mockAccessCheck.mockResolvedValue({ ...share, visibility: 'private' });
      const caller = await createCaller();

      await expect(caller.issueGatewayUserToken({ shareId: 'share-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mockSignUserJWT).not.toHaveBeenCalled();
    });
  });

  describe('refreshGatewayToken', () => {
    it('signs the token for the VISITOR, never the creator', async () => {
      const caller = await createCaller();

      await expect(
        caller.refreshGatewayToken({ shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).resolves.toEqual({ token: 'visitor-jwt' });
      expect(mockSignUserJWT).toHaveBeenCalledWith(VISITOR);
    });

    it('rejects when the topic has no running operation', async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, metadata: {} });
      const caller = await createCaller();

      await expect(
        caller.refreshGatewayToken({ shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockSignUserJWT).not.toHaveBeenCalled();
    });

    // The client treats this 404 as "stale marker, clear it" on every topic
    // switch, so it must not reach the shared tRPC error log.
    it('marks the stale-marker NOT_FOUND as silent in the handler log', async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, metadata: {} });
      const caller = await createCaller();

      let thrown: TRPCError | undefined;
      try {
        await caller.refreshGatewayToken({ shareId: 'share-1', topicId: 'tpc_visitor' });
      } catch (error) {
        thrown = error as TRPCError;
      }

      expect(thrown).toBeInstanceOf(TRPCError);
      expect(thrown!.cause).toBeInstanceOf(Error);
      expect(mockMarkSilentTRPCErrorLog).toHaveBeenCalledWith(thrown!.cause);
    });

    // The marker is cleared best-effort at finish, so a stale one must not
    // send the visitor's browser to reconnect to a finished run (it would
    // register the topic as "running" locally and freeze its message list).
    it('rejects when the marker points at a run that already ended', async () => {
      mockIsRunningOperationAlive.mockResolvedValue(false);
      const caller = await createCaller();

      await expect(
        caller.refreshGatewayToken({ shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockIsRunningOperationAlive).toHaveBeenCalledWith(
        expect.anything(),
        visitorTopic.metadata.runningOperation,
      );
      expect(mockSignUserJWT).not.toHaveBeenCalled();
      expect(mockMarkSilentTRPCErrorLog).toHaveBeenCalled();
    });
  });

  describe('visitor capability', () => {
    it('rejects on a deployment without business features, before any share lookup', async () => {
      mocks.businessConst.ENABLE_BUSINESS_FEATURES = false;
      const caller = await createCaller();

      await expect(caller.getTopics({ shareId: 'share-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mockAccessCheck).not.toHaveBeenCalled();
    });
  });
});
