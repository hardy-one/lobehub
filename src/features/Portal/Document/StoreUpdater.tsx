'use client';

import { type NotebookDocument } from '@lobechat/types';
import debug from 'debug';
import { memo, useEffect, useRef, useState } from 'react';
import { mutate } from 'swr';
import { createStoreUpdater } from 'zustand-utils';

import { notebookService } from '@/services/notebook';
import { useDocumentStore } from '@/store/document';
import { notebookSelectors } from '@/store/notebook/selectors';

import { useDocumentEditorStore, useDocumentEditorStoreApi } from './store';

const log = debug('portal:document-store-updater');

const SWR_USE_FETCH_NOTEBOOK_DOCUMENTS = 'SWR_USE_FETCH_NOTEBOOK_DOCUMENTS';

interface StoreUpdaterProps {
  documentId: string | undefined;
  topicId: string | undefined;
}

const StoreUpdater = memo<StoreUpdaterProps>(({ documentId, topicId }) => {
  const storeApi = useDocumentEditorStoreApi();
  const useStoreUpdater = createStoreUpdater(storeApi);

  const editor = useDocumentEditorStore((s) => s.editor);

  const document = useDocumentStore(notebookSelectors.getDocumentById(topicId, documentId));

  const [editorInit, setEditorInit] = useState(false);
  const [contentInit, setContentInit] = useState(false);
  const [fetchedDocument, setFetchedDocument] = useState<NotebookDocument | null>(null);
  const lastLoadedDocIdRef = useRef<string | undefined>(undefined);
  const fetchingRef = useRef<string | undefined>(undefined);

  // Update store with props
  useStoreUpdater('documentId', documentId);
  useStoreUpdater('topicId', topicId);

  // Reset fetched document when documentId or topicId changes
  useEffect(() => {
    setFetchedDocument(null);
    fetchingRef.current = undefined;
  }, [documentId, topicId]);

  // Fetch single document when not found in notebookMap
  useEffect(() => {
    const fetchSingleDocument = async () => {
      if (!documentId || !topicId || document || fetchingRef.current === documentId) return;

      fetchingRef.current = documentId;
      log('Document not found in cache, fetching from API:', documentId);

      try {
        const fetchedDoc = await notebookService.getDocument(documentId, topicId);

        if (fetchedDoc) {
          log('Document fetched successfully:', documentId);

          // Add the document to notebookMap (ensure it's a NotebookDocument)
          const currentDocuments = useDocumentStore.getState().notebookMap[topicId] || [];
          const docExists = currentDocuments.some((doc) => doc.id === documentId);

          if (!docExists && 'associatedAt' in fetchedDoc) {
            useDocumentStore.setState({
              notebookMap: {
                ...useDocumentStore.getState().notebookMap,
                [topicId]: [...currentDocuments, fetchedDoc],
              },
            });

            setFetchedDocument(fetchedDoc);
          }
        }
      } catch (error) {
        log('Failed to fetch document:', documentId, error);
      } finally {
        fetchingRef.current = undefined;
      }
    };

    fetchSingleDocument();
  }, [documentId, topicId, document]);

  // Trigger SWR revalidation when document is not found but we have documentId and topicId
  // This ensures the entire document list is up-to-date
  useEffect(() => {
    if (documentId && topicId && !document && !fetchedDocument) {
      log('Triggering SWR revalidation for topic:', topicId);
      mutate([SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId]);
    }
  }, [documentId, topicId, document, fetchedDocument]);

  // Load content into editor when document changes
  useEffect(() => {
    // Use either cached document or fetched document
    const docToLoad = document || fetchedDocument;
    if (!editorInit || !editor || !docToLoad) return;

    // Skip if already initialized for this document
    if (contentInit && lastLoadedDocIdRef.current === documentId) return;

    // Reset content init when document changes
    if (lastLoadedDocIdRef.current !== documentId) {
      setContentInit(false);
    }

    queueMicrotask(() => {
      try {
        log('Loading content for document:', documentId);

        const content = docToLoad.content || '';

        // Set state before setDocument to ensure lastSavedContent is correct
        // when handleContentChange is triggered
        storeApi.setState({
          currentTitle: docToLoad.title || '',
          lastSavedContent: content,
        });

        editor.setDocument('markdown', content || ' ');

        lastLoadedDocIdRef.current = documentId;
        setContentInit(true);
      } catch (error) {
        log('Failed to load editor content:', error);
      }
    });
  }, [editorInit, editor, document, fetchedDocument, documentId, contentInit, storeApi]);

  // Track editor initialization
  useEffect(() => {
    if (editor && !editorInit) {
      setEditorInit(true);
    }
  }, [editor, editorInit]);

  return null;
});

export default StoreUpdater;
