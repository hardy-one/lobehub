import { type DocumentType } from '@lobechat/builtin-tool-notebook';
import { type DocumentItem } from '@lobechat/database/schemas';
import { type NotebookDocument } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type SWRResponse, mutate } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { notebookService } from '@/services/notebook';
import { useChatStore } from '@/store/chat';
import { setNamespace } from '@/utils/storeDebug';

import type { DocumentStore } from '../../store';

const n = setNamespace('document/notebook');

const SWR_USE_FETCH_NOTEBOOK_DOCUMENTS = 'SWR_USE_FETCH_NOTEBOOK_DOCUMENTS';

type ExtendedDocumentType = DocumentType | 'agent/plan';

interface CreateDocumentParams {
  content: string;
  description: string;
  title: string;
  topicId: string;
  type?: ExtendedDocumentType;
}

interface UpdateDocumentParams {
  content?: string;
  description?: string;
  id: string;
  title?: string;
}

export interface NotebookAction {
  createDocument: (params: CreateDocumentParams) => Promise<DocumentItem>;
  deleteDocument: (id: string, topicId: string) => Promise<void>;
  refreshDocuments: (topicId: string) => Promise<void>;
  updateDocument: (
    params: UpdateDocumentParams,
    topicId: string,
  ) => Promise<DocumentItem | undefined>;
  useFetchDocuments: (topicId: string | undefined) => SWRResponse<NotebookDocument[]>;
}

export const createNotebookSlice: StateCreator<
  DocumentStore,
  [['zustand/devtools', never]],
  [],
  NotebookAction
> = (set, get) => ({
  createDocument: async (params) => {
    const document = await notebookService.createDocument(params);

    // Optimistically update notebookMap immediately
    const { topicId } = params;
    const currentDocuments = get().notebookMap[topicId] || [];

    // Convert DocumentItem to NotebookDocument for local cache
    const notebookDoc: NotebookDocument = {
      associatedAt: document.createdAt, // Use createdAt as associatedAt for new documents
      content: document.content,
      createdAt: document.createdAt,
      description: document.description,
      fileType: document.fileType,
      id: document.id,
      metadata: document.metadata,
      title: document.title,
      totalCharCount: document.totalCharCount,
      totalLineCount: document.totalLineCount,
      updatedAt: document.updatedAt,
    };

    const newDocuments = [...currentDocuments, notebookDoc];

    set(
      {
        notebookMap: { ...get().notebookMap, [topicId]: newDocuments },
      },
      false,
      n('createDocument', { documentId: document.id, topicId }),
    );

    // Also trigger SWR revalidation to ensure consistency
    mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]).catch(() => {
      // If mutate fails, we still have the optimistic update above
    });

    return document;
  },

  deleteDocument: async (id, topicId) => {
    // If the deleted document is currently open, close it
    const portalDocumentId = useChatStore.getState().portalDocumentId;
    if (portalDocumentId === id) {
      useChatStore.getState().closeDocument();
    }

    // Optimistically update notebookMap immediately
    const currentDocuments = get().notebookMap[topicId] || [];
    const newDocuments = currentDocuments.filter((doc) => doc.id !== id);

    set(
      {
        notebookMap: { ...get().notebookMap, [topicId]: newDocuments },
      },
      false,
      n('deleteDocument', { documentId: id, topicId }),
    );

    // Call API to delete
    try {
      await notebookService.deleteDocument(id);
    } catch (error) {
      // If API call fails, trigger revalidation to restore state
      await mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]);
      throw error;
    }

    // Trigger SWR revalidation to ensure consistency
    mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]).catch(() => {
      // If mutate fails, we still have the optimistic update above
    });
  },

  refreshDocuments: async (topicId) => {
    await mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]);
  },

  updateDocument: async (params, topicId) => {
    const document = await notebookService.updateDocument(params);

    // Optimistically update notebookMap immediately if document returned
    if (document) {
      const currentDocuments = get().notebookMap[topicId] || [];

      // Preserve the associatedAt from existing document if present
      const existingDoc = currentDocuments.find((doc) => doc.id === document.id);
      const associatedAt = existingDoc?.associatedAt || document.createdAt;

      // Convert DocumentItem to NotebookDocument for local cache
      const notebookDoc: NotebookDocument = {
        associatedAt,
        content: document.content,
        createdAt: document.createdAt,
        description: document.description,
        fileType: document.fileType,
        id: document.id,
        metadata: document.metadata,
        title: document.title,
        totalCharCount: document.totalCharCount,
        totalLineCount: document.totalLineCount,
        updatedAt: document.updatedAt,
      };

      const newDocuments = currentDocuments.map((doc) =>
        doc.id === document.id ? notebookDoc : doc,
      );

      set(
        {
          notebookMap: { ...get().notebookMap, [topicId]: newDocuments },
        },
        false,
        n('updateDocument', { documentId: document.id, topicId }),
      );

      // Also trigger SWR revalidation to ensure consistency
      mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]).catch(() => {
        // If mutate fails, we still have the optimistic update above
      });
    }

    return document;
  },

  useFetchDocuments: (topicId) => {
    return useClientDataSWR<NotebookDocument[]>(
      topicId ? [SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId] : null,
      async () => {
        if (!topicId) return [];

        const result = await notebookService.listDocuments({ topicId });

        return result.data;
      },
      {
        onSuccess: (documents) => {
          if (!topicId) return;

          const currentDocuments = get().notebookMap[topicId];

          // Skip update if data is the same
          if (currentDocuments && isEqual(documents, currentDocuments)) return;

          set(
            {
              notebookMap: { ...get().notebookMap, [topicId]: documents },
            },
            false,
            n('useFetchDocuments(onSuccess)', { topicId }),
          );
        },
      },
    );
  },
});
