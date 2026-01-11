import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import {
  type DocumentAction,
  createDocumentSlice,
} from './slices/document';
import {
  type NotebookAction,
  createNotebookSlice,
} from './slices/notebook/action';
import {
  type EditorAction,
  type EditorState,
  createEditorSlice,
  initialEditorState,
} from './slices/editor';

// State type
export type DocumentState = EditorState;

// Action type
export type DocumentStoreAction = DocumentAction & EditorAction & NotebookAction;

// Full store type
export type DocumentStore = DocumentState & DocumentStoreAction;

// Initial state
const initialState: DocumentState = {
  ...initialEditorState,
};

const createStore: StateCreator<DocumentStore, [['zustand/devtools', never]]> = (
  ...parameters
) => ({
  ...initialState,
  ...createDocumentSlice(...parameters),
  ...createEditorSlice(...parameters),
  ...createNotebookSlice(...parameters),
});

const devtools = createDevtools('document');

export const useDocumentStore = createWithEqualityFn<DocumentStore>()(
  devtools(createStore),
  shallow,
);

export const getDocumentStoreState = () => useDocumentStore.getState();
