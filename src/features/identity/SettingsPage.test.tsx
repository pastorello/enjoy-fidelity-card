import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { fakeDevice } from '../../test/fakeAuthService';
import { createFakeKioskService, fakeCashier } from '../../test/fakeKioskService';
import { renderApp, signedInFake } from '../../test/renderApp';

describe('settings page', () => {
  it('shows who is signed in, with the role in Italian', async () => {
    renderApp(
      '/impostazioni',
      signedInFake({ operator: { id: 'op-2', name: 'marco Prova', role: 'operator' } }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Impostazioni' }),
    ).toBeInTheDocument();
    const account = screen.getByRole('region', { name: 'Account' });
    expect(within(account).getByText('marco Prova')).toBeInTheDocument();
    expect(within(account).getByText('Operatore')).toBeInTheDocument();
    expect(within(account).getByText('M')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Indietro' })).toHaveAttribute('href', '/');
  });

  it('labels administrators', async () => {
    renderApp('/impostazioni', signedInFake());
    const account = await screen.findByRole('region', { name: 'Account' });
    expect(within(account).getByText('Amministratore')).toBeInTheDocument();
  });

  it.each([
    ['administrators', 'admin'],
    ['operators', 'operator'],
  ] as const)('offers "Cambia password" to %s', async (_, role) => {
    const { router } = renderApp(
      '/impostazioni',
      signedInFake({ operator: { id: 'op-2', name: 'Marco Prova', role } }),
    );
    const section = await screen.findByRole('region', { name: 'ACCOUNT' });
    expect(within(section).getByRole('heading', { level: 2, name: 'ACCOUNT' })).toBeInTheDocument();
    const row = within(section).getByRole('link', { name: /Cambia password/ });
    expect(row).toHaveTextContent('Ricevi un link via email');
    // The email never travels in the navigation: the destination is the bare path.
    expect(row).toHaveAttribute('href', '/password-dimenticata');
    await userEvent.click(row);
    expect(router.state.location.pathname).toBe('/password-dimenticata');
    expect(router.state.location.search).toBe('');
    expect(router.state.location.state).toBeNull();
  });

  it.each([
    ['administrators', 'admin', false, 'Da impostare'],
    ['operators', 'operator', false, 'Da impostare'],
    ['administrators', 'admin', true, 'Impostato'],
    ['operators', 'operator', true, 'Impostato'],
  ] as const)(
    'offers "PIN della cassa" to %s, under "Cambia password" (PIN set: %s)',
    async (_, role, hasPin, status) => {
      const { router } = renderApp(
        '/impostazioni',
        signedInFake({ operator: { id: 'op-2', name: 'Marco Prova', role }, hasPin }),
      );
      const section = await screen.findByRole('region', { name: 'ACCOUNT' });
      const rows = within(section).getAllByRole('link');
      expect(rows.map((row) => row.getAttribute('href'))).toEqual([
        '/password-dimenticata',
        '/impostazioni/pin',
      ]);
      const row = within(section).getByRole('link', { name: /PIN della cassa/ });
      expect(row).toHaveTextContent(status);
      await userEvent.click(row);
      expect(router.state.location.pathname).toBe('/impostazioni/pin');
    },
  );

  it('keeps the single section order of cross-review.md §1 for operators', async () => {
    renderApp(
      '/impostazioni',
      signedInFake({ operator: { id: 'op-2', name: 'Marco Prova', role: 'operator' } }),
    );
    const account = await screen.findByRole('region', { name: 'Account' });
    const points = screen.getByRole('region', { name: 'PUNTI' });
    const accountSection = screen.getByRole('region', { name: 'ACCOUNT' });
    const note = screen.getByText(/li gestiscono gli amministratori\.$/);
    // account box · PUNTI (settings) · ACCOUNT (identity-password) · final note (settings)
    expect(Array.from(screen.getByRole('main').children)).toEqual([
      account,
      points,
      accountSection,
      note,
    ]);
  });

  it('keeps the single section order of cross-review.md §1 for administrators', async () => {
    renderApp('/impostazioni', signedInFake());
    const account = await screen.findByRole('region', { name: 'Account' });
    const points = screen.getByRole('region', { name: 'PUNTI E CONTROLLI' });
    const accountSection = screen.getByRole('region', { name: 'ACCOUNT' });
    const management = screen.getByRole('region', { name: 'GESTIONE' });
    const exportSection = screen.getByRole('region', { name: 'ESPORTA DATI' });
    // account box · PUNTI E CONTROLLI (settings) · ACCOUNT (identity-password) · GESTIONE
    // (rewards) · ESPORTA DATI (export); no final note
    expect(Array.from(screen.getByRole('main').children)).toEqual([
      account,
      points,
      accountSection,
      management,
      exportSection,
    ]);
  });

  it('"Esci" ends the session and opens the sign-in page', async () => {
    const { router, fake } = renderApp('/impostazioni', signedInFake());
    await userEvent.click(await screen.findByRole('button', { name: 'Esci' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(fake.service.signOut).toHaveBeenCalledOnce();
    // A plain sign-out is not an expired session.
    expect(screen.queryByText(/sessione è scaduta/)).not.toBeInTheDocument();
  });

  it('is reached from the account button of the home', async () => {
    const { router } = renderApp('/', signedInFake());
    await userEvent.click(
      await screen.findByRole('link', { name: 'Account e impostazioni: Giulia Prova' }),
    );
    expect(router.state.location.pathname).toBe('/impostazioni');
  });
});

/** The till tablet with Giulia at the till (SPEC-tablet-kiosk, point 12; wireframe "Tablet: impostazioni"). */
function openOnTablet(role: 'admin' | 'operator') {
  const giulia = fakeCashier({ name: 'Giulia', role, pin: '1234' });
  const kiosk = createFakeKioskService({ cashiers: [giulia], cashierId: giulia.id });
  const fake = signedInFake();
  fake.setDevice(fakeDevice, () => kiosk.device());
  const view = renderApp(
    '/impostazioni',
    fake,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    kiosk,
  );
  return { ...view, fake, kiosk };
}

const DISCONNECT = 'Disconnetti il tablet';

async function tillShown() {
  expect(
    await screen.findByRole('heading', { level: 2, name: 'Chi è alla cassa?' }),
  ).toBeInTheDocument();
}

describe('settings page on the till tablet', () => {
  it.each([
    ['an administrator', 'admin', 'Amministratore'],
    ['an operator', 'operator', 'Operatore'],
  ] as const)(
    'shows the cashier in the account box when %s is at the till',
    async (_, role, label) => {
      openOnTablet(role);
      const account = await screen.findByRole('region', { name: 'Account' });
      expect(within(account).getByText('Giulia')).toBeInTheDocument();
      expect(within(account).getByText(label)).toBeInTheDocument();
      expect(within(account).getByText('G')).toBeInTheDocument();
    },
  );

  it.each([
    ['administrator', 'admin'],
    ['operator', 'operator'],
  ] as const)(
    'has neither "Cambia password" nor "PIN della cassa" with an %s at the till',
    async (_, role) => {
      openOnTablet(role);
      await screen.findByRole('region', { name: 'Account' });
      expect(screen.queryByRole('region', { name: 'ACCOUNT' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Cambia password/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /PIN della cassa/ })).not.toBeInTheDocument();
    },
  );

  it('keeps the order of the wireframe with an administrator at the till', async () => {
    openOnTablet('admin');
    const account = await screen.findByRole('region', { name: 'Account' });
    const points = screen.getByRole('region', { name: 'PUNTI E CONTROLLI' });
    const management = screen.getByRole('region', { name: 'GESTIONE' });
    // LETTORE CARD sits between GESTIONE and ESPORTA DATI (cross-review §1, item 5).
    const reader = screen.getByRole('region', { name: 'LETTORE CARD' });
    const exportSection = screen.getByRole('region', { name: 'ESPORTA DATI' });
    expect(Array.from(screen.getByRole('main').children)).toEqual([
      account,
      points,
      management,
      reader,
      exportSection,
    ]);
  });

  it('keeps the reduced settings with an operator at the till', async () => {
    openOnTablet('operator');
    const account = await screen.findByRole('region', { name: 'Account' });
    const points = screen.getByRole('region', { name: 'PUNTI' });
    const note = screen.getByText(/li gestiscono gli amministratori\.$/);
    expect(Array.from(screen.getByRole('main').children)).toEqual([account, points, note]);
  });

  it('"Esci" ends the turn and opens /cassa, the tablet stays signed in', async () => {
    const { router, fake, kiosk } = openOnTablet('operator');
    const account = await screen.findByRole('region', { name: 'Account' });
    await userEvent.click(within(account).getByRole('button', { name: 'Esci' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    expect(kiosk.service.endTurn).toHaveBeenCalledOnce();
    expect(kiosk.device().cashier).toBeNull();
    expect(fake.service.signOut).not.toHaveBeenCalled();
    await tillShown();
    expect(screen.queryByText('Turno scaduto: inserisci di nuovo il PIN')).not.toBeInTheDocument();
  });

  it('"Esci" opens /cassa even when ending the turn fails', async () => {
    const { router, fake, kiosk } = openOnTablet('admin');
    const account = await screen.findByRole('region', { name: 'Account' });
    kiosk.failNext('endTurn', new ServerFaultError('unavailable'));
    await userEvent.click(within(account).getByRole('button', { name: 'Esci' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    expect(fake.service.signOut).not.toHaveBeenCalled();
    await tillShown();
  });

  it('"Esci" sends one request for two taps', async () => {
    const { router, kiosk } = openOnTablet('operator');
    const account = await screen.findByRole('region', { name: 'Account' });
    const held = kiosk.holdNext('endTurn');
    const esci = within(account).getByRole('button', { name: 'Esci' });
    await userEvent.click(esci);
    await userEvent.click(esci);
    expect(router.state.location.pathname).toBe('/impostazioni');

    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/cassa'));
    expect(kiosk.service.endTurn).toHaveBeenCalledOnce();
  });

  it('offers "Disconnetti il tablet" only with an administrator at the till', async () => {
    openOnTablet('operator');
    await screen.findByRole('region', { name: 'Account' });
    expect(screen.queryByRole('button', { name: DISCONNECT })).not.toBeInTheDocument();
  });

  it('is never offered on a phone', async () => {
    renderApp('/impostazioni', signedInFake());
    await screen.findByRole('region', { name: 'Account' });
    expect(screen.queryByRole('button', { name: DISCONNECT })).not.toBeInTheDocument();
  });

  it('"Disconnetti il tablet" asks first, and "Lascia com’è" keeps everything', async () => {
    const { router, fake, kiosk } = openOnTablet('admin');
    const account = await screen.findByRole('region', { name: 'Account' });
    await userEvent.click(within(account).getByRole('button', { name: DISCONNECT }));

    const dialog = screen.getByRole('dialog', { name: 'Disconnettere il tablet?' });
    expect(dialog).toHaveAccessibleDescription(
      'Per riaccedere servono email e password dell’account del bar.',
    );
    // A dangerous action starts on the safe choice.
    expect(within(dialog).getByRole('button', { name: 'Lascia com’è' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lascia com’è' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.service.signOut).not.toHaveBeenCalled();
    expect(kiosk.service.endTurn).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/impostazioni');
  });

  it('"Disconnetti il tablet" ends the turn, signs the tablet out and opens /accedi', async () => {
    const { router, fake, kiosk } = openOnTablet('admin');
    const account = await screen.findByRole('region', { name: 'Account' });
    await userEvent.click(within(account).getByRole('button', { name: DISCONNECT }));
    const dialog = screen.getByRole('dialog', { name: 'Disconnettere il tablet?' });
    await userEvent.click(within(dialog).getByRole('button', { name: DISCONNECT }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    // The turn is closed first: signing the bar account in again does not bring the cashier back.
    expect(kiosk.service.endTurn).toHaveBeenCalledOnce();
    expect(kiosk.device().cashier).toBeNull();
    expect(fake.service.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByText(/sessione è scaduta/)).not.toBeInTheDocument();
  });

  it('"Disconnetti il tablet" signs out even when ending the turn fails', async () => {
    const { router, fake, kiosk } = openOnTablet('admin');
    const account = await screen.findByRole('region', { name: 'Account' });
    kiosk.setNetworkDown(true);
    await userEvent.click(within(account).getByRole('button', { name: DISCONNECT }));
    const dialog = screen.getByRole('dialog', { name: 'Disconnettere il tablet?' });
    await userEvent.click(within(dialog).getByRole('button', { name: DISCONNECT }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(fake.service.signOut).toHaveBeenCalledOnce();
  });
});
