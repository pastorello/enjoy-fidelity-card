import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PointsBadge } from './PointsBadge';

describe('PointsBadge', () => {
  it('shows formatted points', () => {
    render(<PointsBadge points={1250} />);
    expect(screen.getByText(/^1\.250\s+pt$/)).toBeInTheDocument();
  });

  it('reads "punti" in full for screen readers, singular when 1', () => {
    const { rerender } = render(<PointsBadge points={45} />);
    expect(screen.getByText('45 punti')).toBeInTheDocument();
    rerender(<PointsBadge points={1} />);
    expect(screen.getByText('1 punto')).toBeInTheDocument();
  });

  it('can prefix a spoken label', () => {
    render(<PointsBadge points={45} label="Saldo" />);
    expect(screen.getByText('Saldo: 45 punti')).toBeInTheDocument();
  });
});
