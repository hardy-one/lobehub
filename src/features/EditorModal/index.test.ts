import { createModal } from '@lobehub/ui/base-ui';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openEditorModal } from '.';

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
  useModalContext: () => ({ close: vi.fn() }),
  ModalFooter: ({ children }: { children: ReactNode }) => children,
}));

const lastModalProps = () => vi.mocked(createModal).mock.calls.at(-1)![0] as Record<string, any>;

describe('openEditorModal', () => {
  beforeEach(() => {
    vi.mocked(createModal).mockClear();
  });

  it('clears rich-editor data when confirming a source edit', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    openEditorModal({
      value: 'Original',
      editorData: { root: { children: [{ text: 'Original' }] } },
      onConfirm,
    });
    const props = lastModalProps();
    render([props.content, props.footer]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited source' } });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(onConfirm).toHaveBeenCalledWith('Edited source', null);
  });

  it('edits literal Markdown source in a native textarea without formatting it', () => {
    const initial = 'FOO_BAR\n<!-- HTML render -->\n$$\\frac{1}{2}';
    const pasted = 'A_B <tag>\nline two';
    openEditorModal({ value: initial });

    render(lastModalProps().content);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue(initial);

    // The editor is a native textarea: no Markdown/Lexical transform is applied
    // to source text while editing its value.
    fireEvent.change(textarea, { target: { value: pasted } });
    expect(textarea).toHaveValue(pasted);
  });

  it('runs the caller cleanup on any close, not only user dismissal', () => {
    // Regression: `onOpenChange` fires only for Escape / backdrop / the header
    // close button. The footer's Cancel goes through the instance's `close()`,
    // which just flips the stack entry — so wiring cleanup to `onOpenChange`
    // left the caller's editing flag set and the editor could never reopen.
    const onClose = vi.fn();
    openEditorModal({ onClose, value: 'original' });

    const props = lastModalProps();
    expect(props.onOpenChange).toBeUndefined();
    expect(typeof props.onOpenChangeComplete).toBe('function');

    props.onOpenChangeComplete(true);
    expect(onClose).not.toHaveBeenCalled();

    props.onOpenChangeComplete(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tolerates a caller that passes no cleanup', () => {
    openEditorModal({ value: 'original' });

    expect(() => lastModalProps().onOpenChangeComplete(false)).not.toThrow();
  });
});
