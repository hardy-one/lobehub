import { useDocumentStore } from '@/store/document';
import { notebookSelectors } from '@/store/notebook/selectors';

/**
 * Fetch notebook documents for the current topic
 */
export const useFetchNotebookDocuments = (topicId?: string) => {
  const useFetchDocuments = useDocumentStore((s) => s.useFetchDocuments);
  const documents = useDocumentStore((s) => notebookSelectors.getDocumentsByTopicId(topicId)(s));

  const { isLoading } = useFetchDocuments(topicId);

  return {
    documents,
    isLoading,
    topicId,
  };
};
