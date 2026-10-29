import { deserializeParts } from '@lobechat/utils';
import { type MarkdownProps } from '@lobehub/ui';
import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import { usePreparedMessage } from '@/features/Conversation/hooks/usePreparedMessage';
import MarkdownMessage from '@/features/Conversation/Markdown';

import ContentLoading from './ContentLoading';
import { RichContentRenderer } from './RichContentRenderer';

const DisplayContent = memo<{
  addIdOnDOM?: boolean;
  content: string;
  generating?: boolean;
  hasImages?: boolean;
  id: string;
  isMultimodal?: boolean;
  isToolCallGenerating?: boolean;
  markdownProps?: Omit<MarkdownProps, 'className' | 'style' | 'children'>;
  tempDisplayContent?: string;
}>(
  ({
    markdownProps,
    content,
    generating,
    isToolCallGenerating,
    hasImages,
    isMultimodal,
    tempDisplayContent,
    id,
  }) => {
    // Only the plain-text branch needs the rewritten message; multimodal parts
    // and the placeholder states never read it. Preparing it first spent the
    // full-text passes on renders that returned a skeleton or parts instead.
    const needsPrintableMessage = !isToolCallGenerating && !isMultimodal;
    const preparedMessage = usePreparedMessage(needsPrintableMessage ? content : '');
    if (isToolCallGenerating) return;

    if (content === LOADING_FLAT) return generating ? <ContentLoading id={id} /> : null;
    if (!content && !hasImages) return <ContentLoading id={id} />;

    const contentParts = isMultimodal ? deserializeParts(tempDisplayContent || content) : null;

    return contentParts ? (
      <RichContentRenderer parts={contentParts} />
    ) : (
      <MarkdownMessage {...markdownProps}>{preparedMessage}</MarkdownMessage>
    );
  },
);

export default DisplayContent;
