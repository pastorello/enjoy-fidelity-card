import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScreenTitle } from './ScreenTitle';

describe('ScreenTitle', () => {
  it('is the level-1 heading of the screen', () => {
    render(<ScreenTitle>Impostazioni</ScreenTitle>);
    expect(screen.getByRole('heading', { level: 1, name: 'Impostazioni' })).toBeInTheDocument();
  });
});
