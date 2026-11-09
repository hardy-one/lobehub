import type { ChatTopicMetadata, SendMessageServerResponse } from '@lobechat/types';

export type SendMessageServerResponseMeta = SendMessageServerResponse & {
  __isPartialMessages?: boolean;
};

export interface OptimisticTopicPlaceholder {
  id: string;
  metadata?: ChatTopicMetadata;
  /** Pinned model snapshot — top-level `topics.model` column, not metadata. */
  model?: string;
  provider?: string;
  title: string;
}
