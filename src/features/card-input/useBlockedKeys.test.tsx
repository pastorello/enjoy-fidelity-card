import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBlockedKeys } from './useBlockedKeys';

function Blocking({ onClick }: { onClick: () => void }) {
  useBlockedKeys();
  return (
    <button type="button" onClick={onClick}>
      Tasto
    </button>
  );
}

const onDocumentKey = vi.fn<() => void>();

afterEach(() => {
  document.removeEventListener('keydown', onDocumentKey, true);
  onDocumentKey.mockReset();
});

describe('useBlockedKeys', () => {
  it('stops every key in the capture phase, before any document listener (the USB wedge)', () => {
    document.addEventListener('keydown', onDocumentKey, true);
    render(<Blocking onClick={vi.fn<() => void>()} />);

    expect(fireEvent.keyDown(document.body, { key: '1' })).toBe(false);
    expect(fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyUp(screen.getByRole('button'), { key: ' ' })).toBe(false);
    expect(onDocumentKey).not.toHaveBeenCalled();
  });

  it('keeps Enter and Space from pressing the focused button', async () => {
    const onClick = vi.fn<() => void>();
    render(<Blocking onClick={onClick} />);
    screen.getByRole('button').focus();

    await userEvent.keyboard('{Enter}[Space]1');

    expect(onClick).not.toHaveBeenCalled();
  });

  it('lets keys through again once unmounted', () => {
    document.addEventListener('keydown', onDocumentKey, true);
    const { unmount } = render(<Blocking onClick={vi.fn<() => void>()} />);
    unmount();

    expect(fireEvent.keyDown(document.body, { key: '1' })).toBe(true);
    expect(onDocumentKey).toHaveBeenCalledOnce();
  });
});
