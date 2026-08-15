import { Button, createModal, ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface EditorBridge {
  current: string;
}

const EditorSource = memo<{ bridge: EditorBridge; value?: string }>(({ bridge, value }) => {
  const [text, setText] = useState(value ?? '');

  return (
    <textarea
      autoFocus
      value={text}
      style={{
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: 14,
        height: '70vh',
        lineHeight: 1.6,
        outline: 'none',
        overflowY: 'auto',
        padding: 16,
        resize: 'none',
        whiteSpace: 'pre-wrap',
        width: '100%',
      }}
      onChange={(event) => {
        setText(event.target.value);
        bridge.current = event.target.value;
      }}
    />
  );
});

EditorSource.displayName = 'EditorSource';

interface EditorModalFooterProps {
  bridge: EditorBridge;
  okText?: ReactNode;
  onConfirm?: (value: string, editorData?: unknown) => Promise<void>;
}

const EditorModalFooter = memo<EditorModalFooterProps>(({ bridge, okText, onConfirm }) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();
  const [confirmLoading, setConfirmLoading] = useState(false);

  const handleConfirm = async () => {
    setConfirmLoading(true);
    try {
      await onConfirm?.(bridge.current);
      close();
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <ModalFooter>
      <Button onClick={close}>{t('cancel')}</Button>
      <Button loading={confirmLoading} type={'primary'} onClick={handleConfirm}>
        {okText ?? t('ok', { defaultValue: 'OK' })}
      </Button>
    </ModalFooter>
  );
});

EditorModalFooter.displayName = 'EditorModalFooter';

export interface OpenEditorModalOptions {
  editorData?: unknown;
  okText?: ReactNode;
  /** Runs whenever the modal closes, including confirm — clear caller-side editing flags here. */
  onClose?: () => void;
  onConfirm?: (value: string, editorData?: unknown) => Promise<void>;
  value?: string;
}

export const openEditorModal = ({
  okText,
  onClose,
  onConfirm,
  value,
}: OpenEditorModalOptions) => {
  const bridge: EditorBridge = { current: value ?? '' };

  return createModal({
    content: <EditorSource bridge={bridge} value={value} />,
    footer: <EditorModalFooter bridge={bridge} okText={okText} onConfirm={onConfirm} />,
    // NOT `onOpenChange`: that only fires for user dismissal, while the footer's
    // Cancel goes through `instance.close()`. Cancelling would then leave the
    // caller's editing flag set and the editor could never be reopened.
    // `createModal` only ever completes with `false`, but the open flag is
    // honored so this does not depend on that renderer detail.
    onOpenChangeComplete: (open) => {
      if (!open) onClose?.();
    },
    styles: { content: { overflow: 'hidden', padding: 0 } },
    width: 'min(90vw, 920px)',
  });
};
