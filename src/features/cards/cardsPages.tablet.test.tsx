import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDevice } from '../../test/fakeAuthService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService, fakeReward } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { stubLayout } from '../../test/stubLayout';

// SPEC-tablet-kiosk, point 10 (wireframes "Tablet: nuovo cliente", "Tablet: associa card" and
// "Tablet: catalogo premi"): Nuovo cliente with the form on the left and the Card panel (440 px) on
// the right, Associa card in one wide column, Catalogo premi with the list and the "Nuovo premio"
// column (480 px). The actions sit in the columns, never in a footer at the bottom edge. Same texts
// and services as on the phone. Invented customers and uids only.

const MARIA = fakeCustomer({ name: 'Maria Rossi', balance: 120 });
const OF_MARIA = '04A1B2C3D4E5F6';
const admin = { id: 'op-1', name: 'Admin Prova', role: 'admin' as const };

function renderTill(path: string) {
  const customers = createFakeCustomerService({ customers: [MARIA] });
  const rewards = createFakeRewardsService({
    rewards: [fakeReward({ name: 'Caffè', points: 50 })],
  });
  return renderApp(
    path,
    signedInFake({ device: fakeDevice, cashier: admin }),
    createFakeSettingsService(),
    customers,
    rewards,
    createTestCardReader(),
    createFakeCardsService({
      customers,
      cards: [fakeCard({ uid: OF_MARIA, customerId: MARIA.id })],
    }),
  );
}

function column(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-tablet-column="${name}"]`);
  if (!found) throw new Error(`no ${name} column`);
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Nuovo cliente at 1280×800 (wireframe "Tablet: nuovo cliente")', () => {
  it('the form and "Salva cliente" on the left, the Card panel in the 440 px column', async () => {
    stubLayout(true);
    const { router } = renderTill('/clienti/nuovo');
    const name = await screen.findByRole('textbox', { name: 'Nome e cognome' });
    const left = column('main');
    expect(left).toContainElement(name);
    const card = column('card');
    expect(card).toHaveAttribute('data-width', '440');
    expect(within(card).getByRole('region', { name: 'Card' })).toHaveTextContent(
      'Card (facoltativa)',
    );
    expect(screen.queryByRole('contentinfo')).toBeNull();

    await userEvent.type(name, 'Lia Prova');
    await userEvent.click(screen.getByRole('checkbox', { name: /Ha letto l’informativa privacy/ }));
    await userEvent.click(within(left).getByRole('button', { name: 'Salva cliente' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toMatch(/^\/clienti\/[^/]+$/));
  });

  it('keeps the phone layout under the tablet size: "Salva cliente" in the footer', async () => {
    stubLayout(false);
    renderApp('/clienti/nuovo', signedInFake());
    const footer = await screen.findByRole('contentinfo');
    expect(within(footer).getByRole('button', { name: 'Salva cliente' })).toBeInTheDocument();
    expect(document.querySelector('[data-tablet="true"]')).toBeNull();
  });
});

describe('Associa card at 1280×800 (wireframe "Tablet: associa card")', () => {
  it('the reader panel, the note and "Annulla" in one wide column, no footer', async () => {
    stubLayout(true);
    renderTill(`/clienti/${MARIA.id}/card`);
    const reading = await screen.findByRole('region', { name: 'Lettura card' });
    const wide = column('associate');
    expect(wide).toContainElement(reading);
    expect(within(wide).getByText(/La card attuale .* verrà disattivata/)).toBeInTheDocument();
    expect(within(wide).getByRole('link', { name: 'Annulla' })).toHaveAttribute(
      'href',
      `/clienti/${MARIA.id}/modifica`,
    );
    expect(screen.queryByRole('contentinfo')).toBeNull();
  });
});

describe('Catalogo premi at 1280×800 (wireframe "Tablet: catalogo premi")', () => {
  it('the list on the left, "Nuovo premio" in the 480 px column', async () => {
    stubLayout(true);
    renderTill('/impostazioni/premi');
    const list = await screen.findByRole('list', { name: 'Premi del catalogo' });
    expect(column('main')).toContainElement(list);
    const form = column('new-reward');
    expect(form).toHaveAttribute('data-width', '480');
    expect(within(form).getByRole('heading', { level: 2, name: 'Nuovo premio' })).toBeVisible();
    expect(screen.queryByRole('contentinfo')).toBeNull();
  });
});

describe('«Card non attiva» at 1280×800 (SPEC-customers-v2, point 4)', () => {
  it('one wide column, no footer at the bottom edge', async () => {
    stubLayout(true);
    const customers = createFakeCustomerService({ customers: [MARIA] });
    const lost = fakeCard({
      uid: '04112233445566',
      customerId: MARIA.id,
      active: false,
      deactivatedAt: '2026-11-12T10:00:00.000Z',
    });
    renderApp(
      `/card/${lost.id}`,
      signedInFake({ device: fakeDevice, cashier: admin }),
      createFakeSettingsService(),
      customers,
      createFakeRewardsService(),
      createTestCardReader(),
      createFakeCardsService({ customers, cards: [lost] }),
    );
    const card = await screen.findByText('Card …5566');
    expect(column('inactive-card')).toContainElement(card);
    expect(
      within(column('inactive-card')).getByRole('link', { name: /Era di Maria Rossi/ }),
    ).toBeInTheDocument();
    // Riattiva stays on the till (criterion 12), in the column.
    expect(
      within(column('inactive-card')).getByRole('button', { name: 'Riattiva la card' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).toBeNull();
  });
});
