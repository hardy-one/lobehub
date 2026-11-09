// @vitest-environment node
import type { LobeChatDatabase } from '@lobehub/database';
import { describe, expect, it, vi } from 'vitest';

import type * as AgentDocumentsModels from '@/database/models/agentDocuments';

import { AgentDocumentsService } from './index';

const { mockFindById } = vi.hoisted(() => ({ mockFindById: vi.fn() }));

vi.mock('@/database/models/agentDocuments', async (importOriginal) => ({
  ...(await importOriginal<typeof AgentDocumentsModels>()),
  AgentDocumentModel: vi.fn(function () {
    return { findById: mockFindById };
  }),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(),
}));

vi.mock('../document', () => ({
  DocumentService: vi.fn(),
}));

describe('AgentDocumentsService document authorization', () => {
  it('should fail closed when the binding belongs to another agent', async () => {
    const agentDocumentId = '11111111-1111-4111-8111-111111111111';
    mockFindById.mockResolvedValue({
      agentId: 'agent-2',
      content: 'other agent content',
      id: agentDocumentId,
      title: 'Private',
    });

    const service = new AgentDocumentsService({} as LobeChatDatabase, 'user-1');
    const result = await service.getDocumentSnapshotById(agentDocumentId, 'agent-1');

    expect(result).toBeUndefined();
  });
});
