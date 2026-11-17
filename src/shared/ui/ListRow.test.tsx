import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ListRow } from './ListRow';
import { PointsBadge } from './PointsBadge';

describe('ListRow', () => {
  it('as a link: the whole row is one link named by its content', () => {
    render(
      <MemoryRouter>
        <ul>
          <ListRow
            to="/clienti/1"
            title="Antonio Esposito"
            subtitle="••• 0388 · 10:15"
            trailing={<PointsBadge points={45} />}
          />
        </ul>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/clienti/1');
    expect(link).toHaveTextContent('Antonio Esposito');
    expect(link).toHaveTextContent('45');
    expect(screen.getByRole('listitem')).toContainElement(link);
  });

  it('as a button: calls onClick', async () => {
    const onClick = vi.fn<() => void>();
    render(
      <ul>
        <ListRow title="Cornetto e cappuccino" onClick={onClick} />
      </ul>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Cornetto e cappuccino/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('as static content: no interactive element', () => {
    render(
      <ul>
        <ListRow title="Spesa 12,50 €" subtitle="10:42 · Giulia" />
      </ul>,
    );
    const item = screen.getByRole('listitem');
    expect(within(item).queryByRole('link')).not.toBeInTheDocument();
    expect(within(item).queryByRole('button')).not.toBeInTheDocument();
    expect(item).toHaveTextContent('10:42 · Giulia');
  });
});
