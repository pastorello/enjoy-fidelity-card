import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, signedInFake } from '../../test/renderApp';
import { stubLayout } from '../../test/stubLayout';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function operatorsRow() {
  const section = await screen.findByRole('region', { name: 'GESTIONE' });
  return within(section).getByRole('link', { name: /^Operatori/ });
}

describe('"Operatori" row of GESTIONE', () => {
  it('phone: "Account, ruoli e inviti", and a tap opens /impostazioni/operatori', async () => {
    stubLayout(false);
    const { router } = renderApp('/impostazioni', signedInFake());
    const row = await operatorsRow();
    expect(row).toHaveTextContent('Account, ruoli e inviti');
    expect(row).toHaveAttribute('href', '/impostazioni/operatori');

    await userEvent.click(row);
    expect(router.state.location.pathname).toBe('/impostazioni/operatori');
    expect(await screen.findByRole('heading', { level: 1, name: 'Operatori' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/impostazioni');
  });

  it('tablet layout: "Account, ruoli, inviti e PIN"', async () => {
    stubLayout(true);
    renderApp('/impostazioni', signedInFake());
    const row = await operatorsRow();
    expect(row).toHaveTextContent('Account, ruoli, inviti e PIN');
    expect(row).not.toHaveTextContent('Account, ruoli e inviti');
  });
});

describe('/impostazioni/operatori', () => {
  it('shows an operator who opens it by hand the "solo amministratori" view', async () => {
    renderApp(
      '/impostazioni/operatori',
      signedInFake({ operator: { id: 'op-2', name: 'Marco Prova', role: 'operator' } }),
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Solo per gli amministratori' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Gli operatori li gestiscono gli amministratori.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Operatori' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Torna alle impostazioni' })).toHaveAttribute(
      'href',
      '/impostazioni',
    );
  });
});
