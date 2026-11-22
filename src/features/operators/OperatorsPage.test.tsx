import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { createFakeOperatorsService, fakeOperator } from '../../test/fakeOperatorsService';
import type { FakeOperator } from '../../test/fakeOperatorsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { stubLayout } from '../../test/stubLayout';

const PATH = '/impostazioni/operatori';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Giulia (the caller), Andrea admin, Marco invited, Sara deactivated, Zeno removed. */
function wireframeTeam(): FakeOperator[] {
  return [
    fakeOperator({ name: 'Giulia Prova', role: 'admin', hasPin: true }),
    fakeOperator({ name: 'Sara Prova', deactivated: true }),
    fakeOperator({ name: 'andrea Prova', role: 'admin', hasPin: true }),
    fakeOperator({ name: 'Zeno Prova', email: null }),
    fakeOperator({ name: 'Marco Prova', emailConfirmed: false, hasPassword: false }),
  ];
}

/** Renders /impostazioni/operatori for an admin with the operators fake given. */
function renderPage(operators = createFakeOperatorsService({ operators: wireframeTeam() })) {
  const auth = signedInFake();
  const rendered = renderApp(
    PATH,
    auth,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    operators,
  );
  return { ...rendered, auth, operators };
}

function rows(list: HTMLElement): HTMLElement[] {
  return within(list).getAllByRole('listitem');
}

function rowOf(list: HTMLElement, name: string): HTMLElement {
  const row = rows(list).find((item) => item.textContent.includes(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

async function findList() {
  return screen.findByRole('list', { name: 'Operatori del bar' });
}

describe('OperatorsPage: the list', () => {
  it('shows the rows in the order of the server, with role and state under the name', async () => {
    renderPage();
    const list = await findList();
    expect(rows(list).map((row) => row.querySelector('[data-operator-name]')?.textContent)).toEqual(
      ['andrea Prova', 'Giulia Prova (tu)', 'Marco Prova', 'Sara Prova', 'Zeno Prova'],
    );
    expect(rowOf(list, 'andrea')).toHaveTextContent('Amministratore · attivo');
    expect(rowOf(list, 'Giulia')).toHaveTextContent('Amministratore · attivo');
    expect(rowOf(list, 'Marco')).toHaveTextContent('Operatore · invito inviato');
    expect(rowOf(list, 'Sara')).toHaveTextContent(
      'Operatore · disattivato, movimenti nello storico',
    );
    expect(rowOf(list, 'Zeno')).toHaveTextContent(
      'Operatore · disattivato, movimenti nello storico',
    );
    expect(list).not.toHaveTextContent('PIN');
  });

  it('draws the initial in the circle, uppercase, dashed for deactivated and removed people', async () => {
    renderPage();
    const list = await findList();
    const initial = (name: string) => rowOf(list, name).querySelector('[data-initial]');
    expect(initial('andrea')).toHaveTextContent('A');
    expect(initial('andrea')).toHaveAttribute('aria-hidden', 'true');
    expect(initial('Giulia')).not.toHaveAttribute('data-away');
    expect(initial('Marco')).not.toHaveAttribute('data-away');
    expect(initial('Sara')).toHaveAttribute('data-away', 'true');
    expect(initial('Zeno')).toHaveAttribute('data-away', 'true');
    expect(rowOf(list, 'Sara')).toHaveAttribute('data-away', 'true');
    expect(rowOf(list, 'Marco')).not.toHaveAttribute('data-away');
  });

  it('sets an initial Enjoy Display lacks in the body font', async () => {
    renderPage(
      createFakeOperatorsService({
        operators: [
          fakeOperator({ name: 'Giulia Prova', role: 'admin' }),
          fakeOperator({ name: '*Stella Prova' }),
        ],
      }),
    );
    const list = await findList();
    const star = rowOf(list, 'Stella').querySelector('[data-initial]');
    expect(star).toHaveTextContent('*');
    expect(star).toHaveAttribute('data-body-font', 'true');
    expect(rowOf(list, 'Giulia').querySelector('[data-initial]')).toHaveAttribute(
      'data-body-font',
      'false',
    );
  });

  it('gives the own row "(tu)" and no action: no button, no link', async () => {
    renderPage();
    const list = await findList();
    const own = rowOf(list, 'Giulia');
    expect(own).toHaveTextContent('Giulia Prova (tu)');
    expect(within(own).queryByRole('button')).not.toBeInTheDocument();
    expect(within(own).queryByRole('link')).not.toBeInTheDocument();
    expect(rows(list).filter((row) => row.textContent.includes('(tu)'))).toHaveLength(1);
  });

  it('shows the "(tu)" of the server, not the one of the signed-in account', async () => {
    const team = wireframeTeam();
    // On the tablet the acting person is the cashier, whom only the server knows as "me".
    const andrea = team.find((operator) => operator.name === 'andrea Prova');
    renderPage(createFakeOperatorsService({ operators: team, actingId: andrea?.id ?? null }));
    const list = await findList();
    expect(rowOf(list, 'andrea')).toHaveTextContent('andrea Prova (tu)');
    expect(rowOf(list, 'Giulia')).not.toHaveTextContent('(tu)');
  });

  it('tablet layout: adds the PIN to active and invited people only', async () => {
    stubLayout(true);
    renderPage();
    const list = await findList();
    expect(rowOf(list, 'andrea')).toHaveTextContent('Amministratore · attivo · PIN impostato');
    expect(rowOf(list, 'Marco')).toHaveTextContent('Operatore · invito inviato · PIN da impostare');
    expect(rowOf(list, 'Sara')).toHaveTextContent(
      'Operatore · disattivato, movimenti nello storico',
    );
    expect(rowOf(list, 'Sara')).not.toHaveTextContent('PIN');
    expect(rowOf(list, 'Zeno')).not.toHaveTextContent('PIN');
  });

  it('keeps a polite live region for the outcomes above the list', async () => {
    renderPage();
    const list = await findList();
    const region = document.querySelector('[aria-live="polite"][data-operators-messages]');
    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();
    // Above the list: it comes first in the document.
    expect(
      region && region.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('OperatorsPage: loading and errors', () => {
  it('shows the loading state until the server answers', async () => {
    const operators = createFakeOperatorsService({ operators: wireframeTeam() });
    const held = operators.holdNext('list');
    renderPage(operators);
    // The sign-in has its own loading state: wait for the screen first.
    await screen.findByRole('heading', { level: 1, name: 'Operatori' });
    expect(screen.getByText('Caricamento…')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Operatori del bar' })).not.toBeInTheDocument();
    held.release();
    expect(await findList()).toBeInTheDocument();
    expect(screen.queryByText('Caricamento…')).not.toBeInTheDocument();
  });

  it.each([
    ['network', 'Controlla la connessione e riprova.'],
    ['unknown', 'Operazione non riuscita. Riprova tra poco.'],
  ] as const)('%s: an error with "Riprova", which asks the list again', async (failure, text) => {
    const operators = createFakeOperatorsService({ operators: wireframeTeam() });
    operators.failNext('list', failure);
    renderPage(operators);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Operatori non caricati' })).toBeVisible();
    expect(alert).toHaveTextContent(text);

    await userEvent.click(within(alert).getByRole('button', { name: 'Riprova' }));
    expect(await findList()).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(operators.service.list).toHaveBeenCalledTimes(2);
    // The loading state replaced the button: the focus went to the title, not to <body>.
    expect(screen.getByRole('heading', { level: 1, name: 'Operatori' })).toHaveFocus();
  });

  it.each([
    ['misconfigured', 'Servizio non configurato: chiedi a un amministratore.'],
    ['unavailable', 'Servizio momentaneamente non disponibile: riprova tra poco.'],
  ] as const)('a %s server: the words of sign-in', async (kind, text) => {
    const operators = createFakeOperatorsService({ operators: wireframeTeam() });
    operators.failNext('list', new ServerFaultError(kind));
    renderPage(operators);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Operatori non caricati');
    expect(alert).toHaveTextContent(text);
  });

  it('forbidden: reports it to AuthProvider and shows the "solo amministratori" view', async () => {
    const operators = createFakeOperatorsService({ operators: wireframeTeam() });
    operators.failNext('list', 'forbidden');
    const { auth } = renderPage(operators);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Solo per gli amministratori' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Gli operatori li gestiscono gli amministratori.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Operatori del bar' })).not.toBeInTheDocument();
    // Once at sign-in, once more for the refusal.
    await waitFor(() => expect(auth.service.loadIdentity.mock.calls.length).toBeGreaterThan(1));
  });

  it('an operator who opens it by hand gets the "solo amministratori" view, nothing is asked', async () => {
    const operators = createFakeOperatorsService({ operators: wireframeTeam() });
    renderApp(
      PATH,
      signedInFake({ operator: { id: 'op-2', name: 'Marco Prova', role: 'operator' } }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      operators,
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Solo per gli amministratori' }),
    ).toBeInTheDocument();
    expect(operators.service.list).not.toHaveBeenCalled();
  });
});
