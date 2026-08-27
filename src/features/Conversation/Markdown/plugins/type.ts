import { type FC, type ReactNode } from 'react';

export interface MarkdownElementProps<T = any> {
  /** fade-in animation flag for streaming-aware plugins */
  animated?: boolean;
  children: ReactNode;
  id: string;
  node: {
    properties: T;
  };
  /** true while the message is still receiving tokens */
  streaming?: boolean;
  tagName: string;
  type: string;
}

export type MarkdownPluginScope = 'user' | 'assistant' | 'all';

export interface MarkdownElement {
  Component: FC<MarkdownElementProps>;
  rehypePlugin?: any;
  remarkPlugin?: any;
  scope: MarkdownPluginScope;
  tag: string;
}
