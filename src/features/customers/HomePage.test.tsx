import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeCustomerService,
  fakeCustomer,
  type FakeCustomerFixture,
} from '../../test/fakeCustomerService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { installFakeIntersectionObserver } from '../../test/fakeIntersectionObserver';
import { ServerFaultError } from '../../lib/serverFault';
import type { CustomerListCursor } from './types';

// SPEC-customers-v2 point 6 and success criterion 5: the CLIENTI section of the home. Invented
// customers and addresses only.

/**
 * The field is "Oppure cerca per nome o email" under the full card panel (wireframe Cerca cliente)
 * and "Cerca per nome o email" under the compact one (wireframe Ricerca senza risultati).
 */
const SEARCH_LABEL = /^(Oppure cerca|Cerca) per nome o email$/;

/** Now, minus `minutes`: an activity of today in any time zone only a few minutes ago. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function customersFake() {
  return createFakeCustomerService({
    customers: [
      fakeCustomer({
        name: 'Rosa Bianchi',
        balance: 0,
        createdAt: '2025-03-01T10:00:00.000000+00:00',
      }),
      fakeCustomer({
        name: 'Paolo Verdi',
        balance: 80,
        email: 'paolo.verdi@example.com',
        lastActivityAt: '2025-11-12T09:00:00.123456+00:00',
      }),
      fakeCustomer({
        name: 'Maria Rossi',
        balance: 120,
        email: 'maria.rossi@example.com',
        lastActivityAt: minutesAgo(5),
      }),
    ],
  });
}

/** `count` customers "Cliente Prova 01"…, each newer than the one before (listed last first). */
function archive(count: number): FakeCustomerFixture[] {
  return Array.from({ length: count }, (_, index) =>
    fakeCustomer({ name: `Cliente Prova ${String(index + 1).padStart(2, '0')}` }),
  );
}

async function renderHome(path = '/', customers = customersFake()) {
  const rendered = renderApp(path, signedInFake(), createFakeSettingsService(), customers);
  const field = await screen.findByRole('searchbox', { name: SEARCH_LABEL });
  return { ...rendered, field };
}

function listCalls(customers: ReturnType<typeof createFakeCustomerService>) {
  return customers.service.list.mock.calls.map(([input]) => input);
}

/** Types `text` one character at a time, as a person would. */
function typeSlowly(field: HTMLElement, text: string) {
  for (let end = 1; end <= text.length; end += 1) {
    fireEvent.change(field, { target: { value: text.slice(0, end) } });
  }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function section() {
  return screen.getByRole('region', { name: 'CLIENTI' });
}

/** `value`, or a failure when it is missing (so a test cannot pass on a missing element). */
function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
}

/** The customer rows of CLIENTI, in order. */
function rows() {
  return within(section()).queryAllByRole('link');
}

async function findRows(count: number) {
  await waitFor(() => expect(rows()).toHaveLength(count));
  return rows();
}

function becomeVisible() {
  act(() => {
    fireEvent(document, new Event('visibilitychange'));
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HomePage: Cerca cliente', () => {
  it('shows the logo, the account button, the search field and "Nuovo cliente"', async () => {
    const { field } = await renderHome();
    expect(screen.getByRole('heading', { level: 1, name: 'Enjoy Card' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Account e impostazioni/ })).toBeInTheDocument();
    expect(field).toHaveAccessibleName('Oppure cerca per nome o email');
    expect(field).toHaveAttribute('placeholder', 'Es. Rossi o rossi@');
    expect(screen.getByRole('link', { name: 'Nuovo cliente' })).toHaveAttribute(
      'href',
      '/clienti/nuovo',
    );
  });
});

describe('HomePage: CLIENTI', () => {
  it('lists every customer by last activity: name, activity, balance, never the email', async () => {
    const customers = customersFake();
    const [rosa, paolo, maria] = customers.customers();
    await renderHome('/', customers);

    expect(within(section()).getByRole('heading', { level: 2, name: 'CLIENTI' })).toBeVisible();
    const shown = await findRows(3);
    expect(shown[0]).toHaveTextContent('Maria Rossi');
    expect(shown[0]).toHaveTextContent(/Oggi, \d{2}:\d{2}/);
    expect(shown[0]).toHaveTextContent('120 punti');
    expect(shown[0]).toHaveAttribute('href', `/clienti/${maria?.id}`);
    expect(shown[1]).toHaveTextContent('Paolo Verdi');
    expect(shown[1]).toHaveTextContent('12 nov 2025');
    expect(shown[1]).toHaveTextContent('80 punti');
    expect(shown[1]).toHaveAttribute('href', `/clienti/${paolo?.id}`);
    expect(shown[2]).toHaveTextContent('Rosa Bianchi');
    expect(shown[2]).toHaveTextContent('Nessun movimento');
    expect(shown[2]).toHaveAttribute('href', `/clienti/${rosa?.id}`);
    // The email stays on the customer page (Open Question 5), and nothing contacts the customer.
    expect(section()).not.toHaveTextContent('@');
    expect(document.querySelector('[href^="mailto:"], [href^="tel:"], [href^="sms:"]')).toBeNull();
    expect(listCalls(customers)).toEqual([{ query: '', after: null }]);
  });

  it('shows "Carico i clienti…" while the first page is on its way', async () => {
    const customers = customersFake();
    const held = customers.holdNext('list');
    await renderHome('/', customers);
    expect(within(section()).getByRole('status')).toHaveTextContent('Carico i clienti…');
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    await findRows(3);
    expect(screen.queryByText('Carico i clienti…')).not.toBeInTheDocument();
  });

  it('a failed first page shows "Clienti non caricati", and "Riprova" loads it again', async () => {
    const customers = customersFake();
    customers.failNext('list', 'network');
    await renderHome('/', customers);

    const alert = await within(section()).findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Clienti non caricati' })).toBeVisible();
    expect(alert).toHaveTextContent('Controlla la connessione e riprova.');
    const held = customers.holdNext('list');
    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(screen.getByText('Carico i clienti…')).toBeInTheDocument();
    // The focus does not fall back to <body> while the button is replaced.
    expect(document.activeElement).not.toBe(document.body);
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    await findRows(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listCalls(customers)).toHaveLength(2);
  });

  it('a server fault is worded apart from a network error', async () => {
    const customers = customersFake();
    customers.failNext('list', new ServerFaultError('misconfigured'));
    await renderHome('/', customers);
    const alert = await within(section()).findByRole('alert');
    expect(alert).toHaveTextContent('Servizio non configurato: chiedi a un amministratore.');
  });

  it('an empty archive says "Ancora nessun cliente"', async () => {
    await renderHome('/', createFakeCustomerService());
    expect(
      await within(section()).findByRole('heading', { level: 2, name: 'Ancora nessun cliente' }),
    ).toBeVisible();
    expect(section()).toHaveTextContent('Registra il primo con «Nuovo cliente».');
    expect(screen.queryByRole('button', { name: 'Mostra altri clienti' })).not.toBeInTheDocument();
  });

  it('loads the next page when the sentinel comes near the window, with the cursor as received', async () => {
    const observer = installFakeIntersectionObserver();
    const customers = createFakeCustomerService({ customers: archive(45) });
    await renderHome('/', customers);
    const first = await findRows(20);
    expect(first[0]).toHaveTextContent('Cliente Prova 45');
    expect(first[19]).toHaveTextContent('Cliente Prova 26');

    // The window scrolls on the phone and on the tablet: root null, 400 px ahead.
    expect(observer.live()).toHaveLength(1);
    const options = observer.observers.at(-1)?.options;
    expect(options?.root ?? null).toBeNull();
    expect(options?.rootMargin).toBe('400px');

    const last = customers.customers().find((customer) => customer.name === 'Cliente Prova 26');
    observer.enter();
    await findRows(40);
    const cursor: CustomerListCursor = present(listCalls(customers)[1]?.after);
    expect(cursor.id).toBe(last?.id);
    expect(cursor.activityAt).toBeNull();
    // The creation time goes back as the string received, microseconds included.
    expect(cursor.createdAt).toMatch(/^2026-11-01T08:\d{2}:\d{2}\.\d{6}\+00:00$/);

    observer.enter();
    const all = await findRows(45);
    expect(new Set(all.map((row) => row.getAttribute('href'))).size).toBe(45);
    expect(all[44]).toHaveTextContent('Cliente Prova 01');
    // The end: a page with fewer than 20 rows; no more sentinel nor button.
    expect(observer.live()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Mostra altri clienti' })).not.toBeInTheDocument();
    observer.enter();
    expect(listCalls(customers)).toHaveLength(3);
  });

  it('"Mostra altri clienti" loads the next page too (keyboard, TalkBack, no IntersectionObserver)', async () => {
    const customers = createFakeCustomerService({ customers: archive(25) });
    await renderHome('/', customers);
    await findRows(20);
    const held = customers.holdNext('list');
    await userEvent.click(screen.getByRole('button', { name: 'Mostra altri clienti' }));

    expect(within(section()).getByRole('status')).toHaveTextContent('Carico altri clienti…');
    expect(screen.queryByRole('button', { name: 'Mostra altri clienti' })).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    await act(async () => {
      held.release();
      await Promise.resolve();
    });
    await findRows(25);
    expect(listCalls(customers)[1]?.after).toMatchObject({ activityAt: null });
    expect(screen.queryByText('Carico altri clienti…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mostra altri clienti' })).not.toBeInTheDocument();
  });

  it('a failed next page keeps the rows, says so, and "Riprova" loads it', async () => {
    const customers = createFakeCustomerService({ customers: archive(25) });
    await renderHome('/', customers);
    await findRows(20);
    customers.failNext('list', 'network');
    await userEvent.click(screen.getByRole('button', { name: 'Mostra altri clienti' }));

    const alert = await within(section()).findByRole('alert');
    expect(alert).toHaveTextContent('Non riesco a caricare altri clienti.');
    expect(rows()).toHaveLength(20);
    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    await findRows(25);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listCalls(customers)[2]).toEqual(listCalls(customers)[1]);
  });

  it('does not load more from the sentinel after a failed page, until "Riprova"', async () => {
    const observer = installFakeIntersectionObserver();
    const customers = createFakeCustomerService({ customers: archive(25) });
    await renderHome('/', customers);
    await findRows(20);
    customers.failNext('list', 'network');
    observer.enter();
    await within(section()).findByRole('alert');
    observer.enter();
    expect(listCalls(customers)).toHaveLength(2);
  });

  it('loads the first page again when the page becomes visible, only with the first page loaded', async () => {
    const customers = createFakeCustomerService({ customers: archive(45) });
    await renderHome('/', customers);
    await findRows(20);
    becomeVisible();
    await waitFor(() => expect(listCalls(customers)).toHaveLength(2));
    expect(listCalls(customers)[1]).toEqual({ query: '', after: null });

    await userEvent.click(screen.getByRole('button', { name: 'Mostra altri clienti' }));
    await findRows(40);
    becomeVisible();
    expect(listCalls(customers)).toHaveLength(3);
    expect(rows()).toHaveLength(40);
  });

  it('not_operator: back to /accedi with "Account non abilitato"', async () => {
    const auth = signedInFake();
    const customers = customersFake();
    const { router } = renderApp('/', auth, createFakeSettingsService(), customers);
    await findRows(3);
    auth.removeProfile();
    customers.failNext('list', 'not_operator');
    becomeVisible();

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(
      await screen.findByText('Account non abilitato: chiedi a un amministratore.'),
    ).toBeInTheDocument();
  });
});

describe('HomePage: search in CLIENTI', () => {
  it('filters the same list 250 ms after the last key, in the same order', async () => {
    const customers = customersFake();
    const { field } = await renderHome('/', customers);
    await findRows(3);
    vi.useFakeTimers();
    typeSlowly(field, 'ross');
    await advance(249);
    expect(listCalls(customers)).toHaveLength(1);
    await advance(1);
    expect(listCalls(customers)).toEqual([
      { query: '', after: null },
      { query: 'ross', after: null },
    ]);
    const found = rows();
    expect(found).toHaveLength(1);
    expect(found[0]).toHaveTextContent('Maria Rossi');
    await advance(1000);
    expect(listCalls(customers)).toHaveLength(2);
  });

  it('finds by part of the email, and the URL never carries the text', async () => {
    const customers = customersFake();
    const { router, field } = await renderHome('/', customers);
    await findRows(3);
    const seen: string[] = [];
    const stop = router.subscribe((state) => seen.push(state.location.search));
    await userEvent.type(field, 'paolo.verdi@exa');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent('Paolo Verdi');
    stop();
    expect(router.state.location.search).toBe('');
    expect(seen.every((search) => !search.includes('@') && !search.includes('%40'))).toBe(true);
    expect(router.state.location.state).toEqual({ q: 'paolo.verdi@exa' });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('under 2 characters lists everyone; "Cancella la ricerca" clears the text and the state', async () => {
    const customers = customersFake();
    const { router, field } = await renderHome('/', customers);
    await findRows(3);
    await userEvent.type(field, 'ro');
    await waitFor(() => expect(rows()).toHaveLength(2));
    await userEvent.type(field, '{Backspace}');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(listCalls(customers).at(-1)).toEqual({ query: '', after: null });

    await userEvent.type(field, 'ossi');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancella la ricerca' }));
    expect(field).toHaveValue('');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(router.state.location.state).toBeNull();
  });

  it('ignores an older answer that arrives after the newer one', async () => {
    const customers = customersFake();
    const { field } = await renderHome('/', customers);
    await findRows(3);
    vi.useFakeTimers();
    const first = customers.holdNext('list');
    fireEvent.change(field, { target: { value: 'ro' } });
    await advance(250);
    fireEvent.change(field, { target: { value: 'rossi' } });
    await advance(250);
    expect(rows()).toHaveLength(1);
    await act(async () => {
      first.release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Maria Rossi');
  });

  it('opens with the text of the history state, and finds it again after "Indietro"', async () => {
    const customers = customersFake();
    const [, , maria] = customers.customers();
    const { router } = renderApp(
      '/impostazioni',
      signedInFake(),
      createFakeSettingsService(),
      customers,
    );
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });
    await act(async () => {
      await router.navigate('/', { state: { q: 'rossi' } });
    });
    expect(await screen.findByRole('searchbox', { name: SEARCH_LABEL })).toHaveValue('rossi');
    await findRows(1);
    expect(listCalls(customers)).toEqual([{ query: 'rossi', after: null }]);

    await userEvent.click(present(rows()[0]));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${maria?.id}`));
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.search).toBe('');
    expect(await screen.findByRole('searchbox', { name: SEARCH_LABEL })).toHaveValue('rossi');
    await findRows(1);
  });

  it('the "Indietro" of the customer page brings the text back without the URL', async () => {
    const customers = customersFake();
    const [, paolo] = customers.customers();
    const { router, field } = await renderHome('/', customers);
    await userEvent.type(field, 'verdi@exa');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await userEvent.click(present(rows()[0]));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${paolo?.id}`));

    const back = await screen.findByRole('link', { name: 'Indietro' });
    expect(back).toHaveAttribute('href', '/');
    await userEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.location.search).toBe('');
    expect(await screen.findByRole('searchbox', { name: SEARCH_LABEL })).toHaveValue('verdi@exa');
    await findRows(1);
  });

  it('no results for a name: says so and turns the button into "Nuovo cliente «<testo>»"', async () => {
    const { field } = await renderHome();
    await findRows(3);
    await userEvent.type(field, '  neri   luca ');

    expect(
      await within(section()).findByRole('heading', { level: 2, name: 'Nessun cliente trovato' }),
    ).toBeInTheDocument();
    expect(section()).toHaveTextContent('Controlla come è scritto, o cerca con l’email.');
    expect(rows()).toEqual([]);
    const links = screen.getAllByRole('link', { name: /^Nuovo cliente/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Nuovo cliente «neri luca»');
    expect(links[0]).toHaveAttribute('href', '/clienti/nuovo?nome=neri+luca');
  });

  it('"Nuovo cliente «<testo>»" opens Nuovo cliente with the name in the URL', async () => {
    const { router, field } = await renderHome();
    await userEvent.type(field, "D'Angelo & figli");
    await userEvent.click(await screen.findByRole('link', { name: /^Nuovo cliente «/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/clienti/nuovo'));
    expect(new URLSearchParams(router.state.location.search).get('nome')).toBe("D'Angelo & figli");
  });

  it('no results for a text with @: the button stays "Nuovo cliente" with nothing prefilled', async () => {
    const { router, field } = await renderHome();
    await userEvent.type(field, 'nessuno@example');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Nessun cliente trovato' }),
    ).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /^Nuovo cliente/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Nuovo cliente');
    expect(links[0]).toHaveAttribute('href', '/clienti/nuovo');
    expect(router.state.location.search).toBe('');
  });

  it('a failed search shows "Clienti non caricati", and "Riprova" searches again', async () => {
    const customers = customersFake();
    const { field } = await renderHome('/', customers);
    await findRows(3);
    customers.failNext('list', 'network');
    await userEvent.type(field, 'rossi');

    const alert = await within(section()).findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Clienti non caricati' })).toBeVisible();
    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    await findRows(1);
    expect(listCalls(customers).slice(-2)).toEqual([
      { query: 'rossi', after: null },
      { query: 'rossi', after: null },
    ]);
  });
});

/** The live region under the search, on the page from the start (TalkBack ignores late ones). */
function announcer() {
  return screen.getByTestId('search-announcer');
}

describe('HomePage: announcements', () => {
  it('says how a search ended in a live region that was already on the page', async () => {
    const { field } = await renderHome();
    const live = announcer();
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveClass('visually-hidden');
    await findRows(3);
    // The plain list is not a search: nothing is said.
    expect(live).toBeEmptyDOMElement();

    await userEvent.type(field, 'rossi');
    await waitFor(() => expect(live).toHaveTextContent('Clienti trovati'));
    expect(announcer()).toBe(live);

    await userEvent.clear(field);
    await userEvent.type(field, 'neri');
    await waitFor(() => expect(live).toHaveTextContent('Nessun cliente trovato'));
    expect(announcer()).toBe(live);

    await userEvent.clear(field);
    expect(live).toBeEmptyDOMElement();
  });

  it('the home message is written into its status row after the row is on the page', async () => {
    const { router } = renderApp('/impostazioni', signedInFake());
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });
    await act(async () => {
      await router.navigate('/', {
        replace: true,
        state: { notice: 'Dati del cliente cancellati.' },
      });
    });
    // Mounted empty first: a live region that arrives with its text is not read out.
    const status = present(screen.getAllByRole('status')[0]);
    expect(status).toBeEmptyDOMElement();
    await waitFor(() => expect(status).toHaveTextContent('Dati del cliente cancellati.'));
    expect(screen.getAllByRole('status')[0]).toBe(status);
  });
});

describe('HomePage: status message', () => {
  const NOTICE = 'Dati del cliente cancellati.';

  function notice() {
    return screen.getByText(NOTICE).closest('output');
  }

  it('shows the message passed in the navigation state, at the top, once', async () => {
    const { router } = renderApp('/impostazioni', signedInFake());
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });

    await act(async () => {
      await router.navigate('/', { replace: true, state: { notice: NOTICE } });
    });
    await screen.findByText(NOTICE);
    // At the top of the content, before the search.
    const field = screen.getByRole('searchbox', { name: SEARCH_LABEL });
    expect(notice()?.compareDocumentPosition(field)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // The history entry no longer carries it: coming back does not show it again.
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(screen.getByText(NOTICE)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: /^Account e impostazioni/ }));
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByRole('searchbox', { name: SEARCH_LABEL });
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it('keeps the search of the history state when it drops the message', async () => {
    const { router } = renderApp('/impostazioni', signedInFake());
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });
    await act(async () => {
      await router.navigate('/', { state: { notice: NOTICE, q: 'rossi' } });
    });
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.state).toEqual({ q: 'rossi' }));
    expect(screen.getByRole('searchbox', { name: SEARCH_LABEL })).toHaveValue('rossi');
  });

  it('shows no message without one, or with a state of another shape', async () => {
    const { router } = renderApp('/impostazioni', signedInFake());
    await screen.findByRole('heading', { level: 1, name: 'Impostazioni' });
    await act(async () => {
      await router.navigate('/', { state: { notice: 42 } });
    });
    await screen.findByRole('searchbox', { name: SEARCH_LABEL });
    await screen.findByRole('heading', { level: 2, name: 'Ancora nessun cliente' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

const HOME_TITLE = 'Avvicina la card';
const HOME_TEXT =
  'Lettura attiva: appoggia la card sul retro del telefono. Una card nuova apre la registrazione del cliente.';

async function renderWithCard(path = '/', card = createTestCardReader()) {
  const rendered = renderApp(
    path,
    signedInFake(),
    createFakeSettingsService(),
    customersFake(),
    createFakeRewardsService(),
    card,
  );
  const field = await screen.findByRole('searchbox', { name: SEARCH_LABEL });
  return { ...rendered, field };
}

function cardPanel() {
  return screen.getByRole('region', { name: 'Lettura card' });
}

describe('HomePage: Lettura card', () => {
  it('shows the full panel above "Oppure cerca per nome o email", as in the wireframe', async () => {
    const { field } = await renderWithCard();
    expect(await within(cardPanel()).findByText(HOME_TITLE)).toBeInTheDocument();
    expect(within(cardPanel()).getByText(HOME_TEXT)).toBeInTheDocument();
    expect(field).toHaveAccessibleName('Oppure cerca per nome o email');
    // The panel comes before the field in the page, the field before CLIENTI.
    expect(cardPanel().compareDocumentPosition(field)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(field.compareDocumentPosition(section())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps the full panel while CLIENTI lists everyone (the list does not shrink it)', async () => {
    await renderWithCard();
    await findRows(3);
    expect(within(cardPanel()).getByText(HOME_TITLE)).toBeInTheDocument();
  });

  it('asks for the permission with "Attiva la lettura" above the search', async () => {
    const card = createTestCardReader({ permission: 'prompt' });
    const { field } = await renderWithCard('/', card);
    await userEvent.click(await screen.findByRole('button', { name: 'Attiva la lettura' }));
    expect(await within(cardPanel()).findByText(HOME_TITLE)).toBeInTheDocument();
    expect(field).toHaveAccessibleName('Oppure cerca per nome o email');
  });

  it('shrinks to the compact line only from 2 characters, and back once cleared', async () => {
    const { field } = await renderWithCard();
    await within(cardPanel()).findByText(HOME_TITLE);

    await userEvent.type(field, 'r');
    expect(within(cardPanel()).getByText(HOME_TITLE)).toBeInTheDocument();
    expect(field).toHaveAccessibleName('Oppure cerca per nome o email');
    await userEvent.type(field, ' ');
    expect(within(cardPanel()).getByText(HOME_TITLE)).toBeInTheDocument();

    await userEvent.type(field, 'o');
    expect(cardPanel()).toHaveTextContent('Lettura attiva: puoi anche avvicinare la card');
    expect(within(cardPanel()).queryByText(HOME_TITLE)).not.toBeInTheDocument();
    expect(field).toHaveAccessibleName('Cerca per nome o email');

    await userEvent.click(screen.getByRole('button', { name: 'Cancella la ricerca' }));
    expect(await within(cardPanel()).findByText(HOME_TITLE)).toBeInTheDocument();
    expect(field).toHaveAccessibleName('Oppure cerca per nome o email');
  });

  it('a card read is handed to cards: an unknown card opens Nuovo cliente with it', async () => {
    const card = createTestCardReader();
    const { router } = await renderWithCard('/', card);
    await within(cardPanel()).findByText(HOME_TITLE);

    act(() => {
      card.nfc.read('04:a1:b2:c3:d4:e5:f6');
    });
    expect(card.vibrate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(router.state.location.pathname).toBe('/clienti/nuovo'));
    expect(router.state.location.search).toBe('?card=04A1B2C3D4E5F6');
  });

  it('reads a card while the first page of CLIENTI is still on its way', async () => {
    const card = createTestCardReader();
    const customers = customersFake();
    customers.holdNext('list');
    const rendered = renderApp(
      '/',
      signedInFake(),
      createFakeSettingsService(),
      customers,
      createFakeRewardsService(),
      card,
    );
    await within(await screen.findByRole('region', { name: 'Lettura card' })).findByText(
      HOME_TITLE,
    );
    act(() => {
      card.nfc.read('04:a1:b2:c3:d4:e5:f6');
    });
    await waitFor(() => expect(rendered.router.state.location.pathname).toBe('/clienti/nuovo'));
  });
});
