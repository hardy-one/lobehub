import type { ChatContextContent } from '@lobechat/types';
import { Flexbox, Icon, Popover } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import type { LexicalEditor } from 'lexical';
import { $createNodeSelection, $setSelection, CLICK_COMMAND, COMMAND_PRIORITY_LOW } from 'lexical';
import { QuoteIcon } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef } from 'react';

import { TAG_MARGIN_INLINE_END } from '../constants';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    max-width: 360px;
  `,
  preview: css`
    overflow: auto;
    max-height: 180px;
    white-space: pre-wrap;
  `,
  tag: css`
    cursor: default;
    user-select: none;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    max-width: 260px;
    margin-inline-end: ${TAG_MARGIN_INLINE_END}px;
    padding-inline: 4px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorInfo};
    vertical-align: baseline;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  label: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface ContextReferenceTriggerProps extends Omit<
  ComponentPropsWithRef<'span'>,
  'children' | 'className' | 'title'
> {
  children: ReactNode;
  className?: string;
  editor?: LexicalEditor;
  nodeKey?: string;
  title?: string;
}

const ContextReferenceTrigger = memo<ContextReferenceTriggerProps>(
  ({ children, className, editor, nodeKey, ref: forwardedRef, title, ...rest }) => {
    const spanRef = useRef<HTMLSpanElement>(null);

    const setSpanRef = useCallback(
      (element: HTMLSpanElement | null) => {
        spanRef.current = element;
        if (!forwardedRef) return;
        if (typeof forwardedRef === 'function') {
          forwardedRef(element);
          return;
        }
        forwardedRef.current = element;
      },
      [forwardedRef],
    );

    const onClick = useCallback(
      (event: MouseEvent) => {
        if (!editor || !nodeKey) return false;
        if (event.target !== spanRef.current && !spanRef.current?.contains(event.target as Node)) {
          return false;
        }

        event.preventDefault();
        editor.update(() => {
          const selection = $createNodeSelection();
          selection.add(nodeKey);
          $setSelection(selection);
        });
        return true;
      },
      [editor, nodeKey],
    );

    useEffect(() => {
      if (!editor || !nodeKey) return;
      return editor.registerCommand(CLICK_COMMAND, onClick, COMMAND_PRIORITY_LOW);
    }, [editor, nodeKey, onClick]);

    return (
      <span {...rest} className={cx(styles.tag, className)} ref={setSpanRef} title={title}>
        {children}
      </span>
    );
  },
);

ContextReferenceTrigger.displayName = 'ContextReferenceTrigger';

export interface ContextReferenceProps {
  className?: string;
  editor?: LexicalEditor;
  nodeKey?: string;
  selection: ChatContextContent;
}

export const ContextReference = memo<ContextReferenceProps>(
  ({ className, editor, nodeKey, selection }) => {
    const label =
      selection.title?.trim() ||
      selection.preview?.trim() ||
      selection.content.replaceAll(/\s+/g, ' ').trim().slice(0, 32);
    const preview = selection.content.trim();

    const content = (
      <Flexbox className={styles.content} gap={6}>
        {selection.title ? <Text strong>{selection.title}</Text> : null}
        {preview ? <Text className={styles.preview}>{preview}</Text> : null}
      </Flexbox>
    );

    return (
      <Popover content={content} styles={{ content: { padding: 8 } }} trigger={'click'}>
        <ContextReferenceTrigger
          className={className}
          editor={editor}
          nodeKey={nodeKey}
          title={preview}
        >
          <Icon icon={QuoteIcon} size={14} />
          <span className={styles.label}>{label || '…'}</span>
        </ContextReferenceTrigger>
      </Popover>
    );
  },
);

ContextReference.displayName = 'ContextReference';

export { ContextReferenceTrigger };
