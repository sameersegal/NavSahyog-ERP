import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { LanguageProvider } from '../src/i18n';

function wrap(ui: React.ReactNode) {
  return <LanguageProvider>{ui}</LanguageProvider>;
}

describe('ConfirmDialog', () => {
  it('is not rendered when open=false', () => {
    render(
      wrap(
        <ConfirmDialog
          open={false}
          title="Title"
          message="Body"
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      ),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('focuses the confirm button on open', () => {
    render(
      wrap(
        <ConfirmDialog
          open
          title="Delete?"
          message="Really?"
          confirmLabel="Yes"
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      ),
    );
    expect(document.activeElement).toBe(screen.getByText('Yes'));
  });

  it('calls onCancel on Escape', () => {
    const onCancel = vi.fn();
    render(
      wrap(
        <ConfirmDialog
          open
          title="T"
          message="M"
          onConfirm={() => {}}
          onCancel={onCancel}
        />,
      ),
    );
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('ignores backdrop click when destructive', () => {
    const onCancel = vi.fn();
    render(
      wrap(
        <ConfirmDialog
          open
          destructive
          title="T"
          message="M"
          onConfirm={() => {}}
          onCancel={onCancel}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels on backdrop click when not destructive', () => {
    const onCancel = vi.fn();
    render(
      wrap(
        <ConfirmDialog
          open
          title="T"
          message="M"
          onConfirm={() => {}}
          onCancel={onCancel}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the previously focused element on close', () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-testid="trigger" onClick={() => setOpen(true)}>
            open
          </button>
          <ConfirmDialog
            open={open}
            title="T"
            message="M"
            onConfirm={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }

    render(wrap(<Host />));
    const trigger = screen.getByTestId('trigger');
    act(() => {
      trigger.focus();
      trigger.click();
    });
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(document.activeElement).toBe(trigger);
  });
});
