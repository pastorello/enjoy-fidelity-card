import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScreenTitle } from './ScreenTitle';

describe('ScreenTitle', () => {
  it('is the level-1 heading of the screen', () => {
    render(<ScreenTitle>Impostazioni</ScreenTitle>);
    expect(screen.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeInTheDocument();
  });

  it('takes focus when asked, so a screen reader reads a view that replaced the focused control', () => {
    render(<ScreenTitle focusOnMount>Il link è scaduto</ScreenTitle>);
    const title = screen.getByRole('heading', { level: 1, name: 'Il link è scaduto' });
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute('tabindex', '-1');
  });

  it('is not focusable by default', () => {
    render(<ScreenTitle>Impostazioni</ScreenTitle>);
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveAttribute('tabindex');
  });
});
