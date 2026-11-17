import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Button, ButtonLink } from './Button';

describe('Button', () => {
  it('is a native button named by its text, type="button" by default', () => {
    render(<Button>Conferma</Button>);
    const button = screen.getByRole('button', { name: 'Conferma' });
    expect(button).toHaveAttribute('type', 'button');
  });

  it('can submit a form when asked', () => {
    render(<Button type="submit">Salva</Button>);
    expect(screen.getByRole('button', { name: 'Salva' })).toHaveAttribute('type', 'submit');
  });

  it.each(['primary', 'secondary', 'danger', 'danger-secondary'] as const)(
    'exposes the %s variant for styling',
    (variant) => {
      render(<Button variant={variant}>Azione</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('data-variant', variant);
    },
  );

  it('calls onClick when pressed', async () => {
    const onClick = vi.fn<() => void>();
    render(<Button onClick={onClick}>Conferma</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('while busy ignores presses and announces it, keeping focus', async () => {
    const onClick = vi.fn<() => void>();
    render(
      <Button busy onClick={onClick}>
        Conferma
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Conferma' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled(); // stays focusable
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('when disabled cannot be pressed', async () => {
    const onClick = vi.fn<() => void>();
    render(
      <Button disabled onClick={onClick}>
        Conferma
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('hides its icon from assistive technology', () => {
    render(<Button icon="plus">Nuovo cliente</Button>);
    expect(
      screen.getByRole('button', { name: 'Nuovo cliente' }).querySelector('svg'),
    ).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('ButtonLink', () => {
  it('is a link that looks like a button', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/clienti/nuovo" variant="secondary" icon="plus">
          Nuovo cliente
        </ButtonLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Nuovo cliente' });
    expect(link).toHaveAttribute('href', '/clienti/nuovo');
    expect(link).toHaveAttribute('data-variant', 'secondary');
  });
});
