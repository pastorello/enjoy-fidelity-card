import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeCardsService } from '../../test/fakeCardsService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeLedgerService } from '../../test/fakeLedgerService';
import { createFakeRewardsService, fakeReward } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { stubLayout } from '../../test/stubLayout';

// SPEC-tablet-kiosk, point 10 (wireframes "Tablet: registra spesa", "Tablet: riscatta premio",
// "Tablet: premio libero"): the same screens in two columns, the keypad (480 px) or the summary
// (400 px) on the right, the actions in the columns rather than in a footer at the bottom edge.
// Same texts, states and services as on the phone. Invented customers only.

const MARIA = fakeCustomer({ name: 'Maria Rossi', balance: 120 });
const CAFFE = fakeReward({ name: 'Caffè', points: 50 });
const CORNETTO = fakeReward({ name: 'Cornetto e cappuccino', points: 100 });
const APERITIVO = fakeReward({ name: 'Aperitivo', points: 200 });

function open(path: string) {
  const customers = createFakeCustomerService({ customers: [MARIA] });
  const settings = createFakeSettingsService();
  const rewards = createFakeRewardsService({ rewards: [CAFFE, CORNETTO, APERITIVO] });
  const ledger = createFakeLedgerService({ customers, rewards, settings });
  return renderApp(
    path,
    signedInFake(),
    settings,
    customers,
    rewards,
    createTestCardReader(),
    createFakeCardsService({ customers }),
    ledger,
  );
}

function mainColumn(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-tablet-column="main"]');
  if (!found) throw new Error('no main column');
  return found;
}

async function press(group: HTMLElement, ...names: string[]) {
  await names.reduce<Promise<void>>(
    (previous, name) =>
      previous.then(() => userEvent.click(within(group).getByRole('button', { name }))),
    Promise.resolve(),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Registra spesa at 1280×800 (wireframe "Tablet: registra spesa")', () => {
  it('IMPORTO, the points and the actions on the left, the large keypad on the right, no footer', async () => {
    stubLayout(true);
    open(`/clienti/${MARIA.id}/spesa`);
    const keypadColumn = await screen.findByRole('complementary', { name: 'Tastierino' });
    expect(keypadColumn).toHaveAttribute('data-width', '480');
    const keypad = within(keypadColumn).getByRole('group', { name: 'Tastierino numerico' });
    expect(keypad).toHaveAttribute('data-size', 'tablet');
    expect(within(keypad).getByRole('button', { name: 'Doppio zero' })).toBeInTheDocument();

    const left = mainColumn();
    expect(await within(left).findByRole('link', { name: /Maria Rossi/ })).toBeInTheDocument();
    expect(within(left).getByRole('region', { name: 'Importo' })).toBeInTheDocument();
    expect(within(left).getByRole('link', { name: 'Riscatta premio' })).toBeInTheDocument();
    expect(await within(left).findByRole('button', { name: /^Conferma/ })).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).toBeNull();
  });

  it('records the purchase as on the phone', async () => {
    stubLayout(true);
    open(`/clienti/${MARIA.id}/spesa`);
    const keypadColumn = await screen.findByRole('complementary', { name: 'Tastierino' });
    await press(within(keypadColumn).getByRole('group'), '1', '2', '5', '0');
    await userEvent.click(await screen.findByRole('button', { name: 'Conferma +12' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Spesa registrata' }),
    ).toBeInTheDocument();
    // Wireframe "Tablet: spesa registrata": no header, one 480 px column in the middle.
    expect(screen.getByTestId('done-screen')).toHaveAttribute('data-tablet', 'true');
  });

  it('keeps the phone layout under the tablet size: the actions in the footer', async () => {
    stubLayout(false);
    open(`/clienti/${MARIA.id}/spesa`);
    const footer = await screen.findByRole('contentinfo');
    expect(await within(footer).findByRole('button', { name: /^Conferma/ })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('group', { name: 'Tastierino numerico' })).not.toHaveAttribute(
      'data-size',
    );
  });
});

describe('Riscatta premio at 1280×800 (wireframe "Tablet: riscatta premio")', () => {
  it('CATALOGO and "Premio libero" on the left, Riepilogo and "Riscatta" on the right', async () => {
    stubLayout(true);
    open(`/clienti/${MARIA.id}/premi`);
    const summary = await screen.findByRole('complementary', { name: 'Riepilogo' });
    expect(summary).toHaveAttribute('data-width', '400');
    expect(within(summary).getByRole('heading', { level: 2, name: 'Riepilogo' })).toBeVisible();
    expect(within(summary).getByText('Saldo attuale')).toBeInTheDocument();
    expect(within(summary).getByText('120 punti')).toBeInTheDocument();
    expect(within(summary).getByRole('button', { name: 'Riscatta' })).toBeDisabled();

    const left = mainColumn();
    const catalog = await within(left).findByRole('group', { name: 'CATALOGO' });
    expect(within(left).getByRole('link', { name: /Premio libero/ })).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).toBeNull();

    await userEvent.click(within(catalog).getByRole('radio', { name: /Cornetto e cappuccino/ }));
    expect(within(summary).getByText('Premio')).toBeInTheDocument();
    expect(within(summary).getByText('Cornetto e cappuccino')).toBeInTheDocument();
    expect(within(summary).getByText('Dopo il riscatto')).toBeInTheDocument();
    expect(within(summary).getByText('20 punti')).toBeInTheDocument();
    await userEvent.click(within(summary).getByRole('button', { name: 'Riscatta 100 punti' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Premio riscattato' }),
    ).toBeInTheDocument();
  });
});

describe('Premio libero at 1280×800 (wireframe "Tablet: premio libero")', () => {
  it('the description and PUNTI DA SCALARE on the left, the keypad and "Riscatta" on the right', async () => {
    stubLayout(true);
    open(`/clienti/${MARIA.id}/premi?libero`);
    const keypadColumn = await screen.findByRole('complementary', { name: 'Tastierino' });
    expect(keypadColumn).toHaveAttribute('data-width', '480');
    const keypad = within(keypadColumn).getByRole('group', { name: 'Tastierino numerico' });
    expect(keypad).toHaveAttribute('data-size', 'tablet');
    expect(keypad).toHaveAttribute('data-variant', 'points');

    const left = mainColumn();
    await userEvent.type(
      within(left).getByRole('textbox', { name: 'Descrizione del premio' }),
      'Dolce del giorno',
    );
    expect(within(left).getByRole('region', { name: 'Punti da scalare' })).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).toBeNull();

    await press(keypad, '3', '0');
    await userEvent.click(within(keypadColumn).getByRole('button', { name: 'Riscatta 30 punti' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Premio riscattato' }),
    ).toBeInTheDocument();
  });
});
