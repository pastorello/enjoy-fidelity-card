import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { CardTakenError } from './types';

const NAME = 'Nome e cognome';
const PHONE = 'Telefono (facoltativo)';
const CONSENT = /Ha letto l’informativa privacy/;
const SECTION_TEXT =
  'Lettura attiva: avvicina una card nuova per associarla adesso, oppure fallo più tardi dalla scheda.';
const ONE_CUSTOMER = 'Una card può essere di un solo cliente: usa un’altra card.';

const MARIA = fakeCustomer({ name: 'Maria Rossi', phone: '+393330004521', balance: 120 });
const ERASED = fakeCustomer({ name: 'cancellato-7f3a', anonymizedAt: '2026-11-17T09:00:00.000Z' });

/** Uids as Web NFC gives them, and as the app keeps them. Invented. */
const NEW_ONE = { read: '04:de:ad:be:ef:00:01', uid: '04DEADBEEF0001' };
const NEW_TWO = { read: '04:de:ad:be:ef:00:02', uid: '04DEADBEEF0002' };
const OF_MARIA = { read: '04:a1:b2:c3:d4:e5:f6', uid: '04A1B2C3D4E5F6' };
const LOST = { read: '04:11:22:33:44:55:66', uid: '04112233445566' };
const OF_ERASED = { read: '04:77:88:99:aa:bb:cc', uid: '04778899AABBCC' };

function setup({
  card = createTestCardReader(),
  auth = signedInFake(),
}: {
  card?: ReturnType<typeof createTestCardReader>;
  auth?: ReturnType<typeof signedInFake>;
} = {}) {
  const customers = createFakeCustomerService({ customers: [MARIA, ERASED] });
  const cards = createFakeCardsService({
    customers,
    cards: [
      fakeCard({ uid: OF_MARIA.uid, customerId: MARIA.id }),
      fakeCard({
        uid: LOST.uid,
        customerId: MARIA.id,
        active: false,
        deactivatedAt: '2026-11-16T10:00:00.000Z',
      }),
      fakeCard({ uid: OF_ERASED.uid, customerId: ERASED.id, active: false }),
    ],
  });
  return { customers, cards, card, auth };
}

type Fixture = ReturnType<typeof setup>;

async function renderNew(fixture: Fixture = setup(), path = '/clienti/nuovo') {
  const rendered = renderApp(
    path,
    fixture.auth,
    createFakeSettingsService(),
    fixture.customers,
    createFakeRewardsService(),
    fixture.card,
    fixture.cards,
  );
  await screen.findByRole('textbox', { name: NAME });
  return rendered;
}

/** The section once reading is on. */
async function activeSection() {
  const section = await screen.findByRole('region', { name: 'Card' });
  await within(section).findByText(SECTION_TEXT);
  return section;
}

function tap(fixture: Fixture, read: string) {
  act(() => {
    fixture.card.nfc.read(read);
  });
}

async function fillValid(name = 'Giulia Bianchi', phone = '333 123 9876') {
  await userEvent.type(screen.getByRole('textbox', { name: NAME }), name);
  if (phone !== '') await userEvent.type(screen.getByRole('textbox', { name: PHONE }), phone);
  await userEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: /^(Salva cliente|Riprova)$/ }));
}

function lookups(fixture: Fixture) {
  return fixture.cards.calls.filter((call) => call.method === 'lookup').map((call) => call.args);
}

function newCustomers(fixture: Fixture) {
  return fixture.customers.customers().filter((c) => c.id !== MARIA.id && c.id !== ERASED.id);
}

describe('Nuovo cliente senza card: the section "Card (facoltativa)"', () => {
  it('shows the section after the form, with the texts of the wireframe', async () => {
    await renderNew();
    const section = await activeSection();
    expect(section).toHaveTextContent('Card (facoltativa)');
    // After PRIVACY, as in the wireframe.
    const consent = screen.getByRole('checkbox', { name: CONSENT });
    expect(
      consent.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();
  });

  it('an unknown card becomes "Card letta", saved with the customer; the customer page opens', async () => {
    const fixture = setup();
    const { router } = await renderNew(fixture);
    await activeSection();
    await fillValid();
    tap(fixture, NEW_ONE.read);

    const panel = await screen.findByRole('region', { name: 'Card letta' });
    expect(panel).toHaveTextContent(
      `Codice ${NEW_ONE.uid}: non è di nessun cliente, verrà associata a questo.`,
    );
    expect(screen.queryByRole('region', { name: 'Card' })).not.toBeInTheDocument();
    expect(lookups(fixture)).toEqual([[NEW_ONE.uid]]);
    // The data typed stay.
    expect(screen.getByRole('textbox', { name: NAME })).toHaveValue('Giulia Bianchi');

    save();
    const [saved] = await waitFor(() => {
      const created = newCustomers(fixture);
      expect(created).toHaveLength(1);
      return created;
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved?.id}`));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(fixture.customers.service.create).not.toHaveBeenCalled();
    expect(fixture.cards.service.createCustomerWithCard.mock.calls[0]?.[0]).toMatchObject({
      uid: NEW_ONE.uid,
      name: 'Giulia Bianchi',
      privacyConsent: true,
    });
    expect(fixture.cards.cards()).toContainEqual(
      expect.objectContaining({ uid: NEW_ONE.uid, customerId: saved?.id, active: true }),
    );
  });

  it('a second unknown card replaces the first: the last one read is saved', async () => {
    const fixture = setup();
    await renderNew(fixture);
    await activeSection();
    tap(fixture, NEW_ONE.read);
    await screen.findByText(new RegExp(`Codice ${NEW_ONE.uid}`));
    tap(fixture, NEW_TWO.read);
    await screen.findByText(new RegExp(`Codice ${NEW_TWO.uid}`));
    expect(screen.queryByText(new RegExp(`Codice ${NEW_ONE.uid}`))).not.toBeInTheDocument();

    await fillValid();
    save();
    await waitFor(() =>
      expect(fixture.cards.service.createCustomerWithCard).toHaveBeenCalledTimes(1),
    );
    expect(fixture.cards.service.createCustomerWithCard.mock.calls[0]?.[0].uid).toBe(NEW_TWO.uid);
  });

  it('says "Lettura della card…" while looking up, and ignores other reads meanwhile', async () => {
    const fixture = setup();
    await renderNew(fixture);
    const section = await activeSection();
    const hold = fixture.cards.holdNext('lookup');
    tap(fixture, NEW_ONE.read);
    expect(await within(section).findByText('Lettura della card…')).toBeVisible();
    tap(fixture, NEW_TWO.read);
    await act(async () => hold.release());

    await screen.findByText(new RegExp(`Codice ${NEW_ONE.uid}`));
    expect(lookups(fixture)).toEqual([[NEW_ONE.uid]]);
  });

  describe('a card already known (criterion 5)', () => {
    it('an active card: "Card già associata" with the owner, the data intact, saved without a card', async () => {
      const fixture = setup();
      const { router } = await renderNew(fixture);
      await activeSection();
      await fillValid();
      tap(fixture, OF_MARIA.read);

      const notice = await screen.findByRole('alert');
      expect(within(notice).getByRole('heading', { name: 'Card già associata' })).toBeVisible();
      expect(notice).toHaveTextContent(`Questa card è di Maria Rossi. ${ONE_CUSTOMER}`);
      expect(within(notice).getByRole('link', { name: 'Apri la scheda di Maria' })).toHaveAttribute(
        'href',
        `/clienti/${MARIA.id}`,
      );
      expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: NAME })).toHaveValue('Giulia Bianchi');
      expect(screen.getByRole('textbox', { name: PHONE })).toHaveValue('333 123 9876');
      expect(screen.getByRole('checkbox', { name: CONSENT })).toBeChecked();
      expect(router.state.location.pathname).toBe('/clienti/nuovo');

      save();
      await waitFor(() => expect(newCustomers(fixture)).toHaveLength(1));
      expect(fixture.cards.service.createCustomerWithCard).not.toHaveBeenCalled();
      expect(fixture.customers.service.create).toHaveBeenCalledTimes(1);
    });

    it('a known card after an unknown one drops it: the customer is saved without a card', async () => {
      const fixture = setup();
      await renderNew(fixture);
      await activeSection();
      tap(fixture, NEW_ONE.read);
      await screen.findByRole('region', { name: 'Card letta' });
      tap(fixture, OF_MARIA.read);
      await screen.findByRole('alert');
      expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();

      await fillValid();
      save();
      await waitFor(() => expect(newCustomers(fixture)).toHaveLength(1));
      expect(fixture.cards.service.createCustomerWithCard).not.toHaveBeenCalled();
    });

    it('a deactivated card says "era di"', async () => {
      const fixture = setup();
      await renderNew(fixture);
      await activeSection();
      tap(fixture, LOST.read);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        `Questa card era di Maria Rossi. ${ONE_CUSTOMER}`,
      );
    });

    it('a card of an erased customer: no name, no "Apri la scheda"', async () => {
      const fixture = setup();
      await renderNew(fixture);
      await activeSection();
      tap(fixture, OF_ERASED.read);
      const notice = await screen.findByRole('alert');
      expect(notice).toHaveTextContent(
        `Questa card era di un cliente i cui dati sono stati cancellati. ${ONE_CUSTOMER}`,
      );
      expect(notice).not.toHaveTextContent('cancellato-7f3a');
      expect(within(notice).queryByRole('link')).not.toBeInTheDocument();
    });

    it('reading stays on: an unknown card replaces the notice', async () => {
      const fixture = setup();
      await renderNew(fixture);
      await activeSection();
      tap(fixture, OF_MARIA.read);
      await screen.findByRole('alert');
      tap(fixture, NEW_ONE.read);
      await screen.findByRole('region', { name: 'Card letta' });
      expect(screen.queryByRole('heading', { name: 'Card già associata' })).not.toBeInTheDocument();
    });
  });

  it('a lookup without answer: "Card non letta" and "Riprova" looks the same card up again', async () => {
    const fixture = setup();
    await renderNew(fixture);
    const section = await activeSection();
    fixture.cards.failNext('lookup', 'lost');
    tap(fixture, NEW_ONE.read);
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent('Card non letta: controlla la connessione.');
    fireEvent.click(within(section).getByRole('button', { name: 'Riprova' }));

    await screen.findByRole('region', { name: 'Card letta' });
    expect(lookups(fixture)).toEqual([[NEW_ONE.uid], [NEW_ONE.uid]]);
  });

  it('a lookup without answer after a known card: the error replaces the notice', async () => {
    const fixture = setup();
    await renderNew(fixture);
    await activeSection();
    tap(fixture, OF_MARIA.read);
    await screen.findByRole('heading', { name: 'Card già associata' });
    fixture.cards.failNext('lookup', 'lost');
    tap(fixture, NEW_ONE.read);
    const section = await screen.findByRole('region', { name: 'Card' });
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Card non letta: controlla la connessione.',
    );
    expect(screen.queryByRole('heading', { name: 'Card già associata' })).not.toBeInTheDocument();
  });

  it('card taken meanwhile: no customer, the notice, then saved without the card', async () => {
    const fixture = setup();
    const { router } = await renderNew(fixture);
    await activeSection();
    await fillValid();
    tap(fixture, NEW_ONE.read);
    await screen.findByRole('region', { name: 'Card letta' });
    fixture.cards.failNext(
      'createCustomerWithCard',
      new CardTakenError({ customerId: MARIA.id, name: 'Maria Rossi', active: true }),
    );
    save();

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(`Questa card è di Maria Rossi. ${ONE_CUSTOMER}`);
    expect(newCustomers(fixture)).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: NAME })).toHaveValue('Giulia Bianchi');

    save();
    const [saved] = await waitFor(() => {
      const created = newCustomers(fixture);
      expect(created).toHaveLength(1);
      return created;
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved?.id}`));
    // Nothing was created by the refused send: the same operation_id is reused.
    expect(fixture.customers.service.create.mock.calls[0]?.[0].operationId).toBe(
      fixture.cards.service.createCustomerWithCard.mock.calls[0]?.[0].operationId,
    );
  });

  it('not_operator on the lookup: back to /accedi', async () => {
    const fixture = setup();
    const { router } = await renderNew(fixture);
    await activeSection();
    fixture.cards.failNext('lookup', 'not_operator');
    const held = fixture.cards.holdNext('lookup');
    tap(fixture, NEW_ONE.read);
    fixture.auth.removeProfile();
    await act(async () => {
      held.release();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });

  describe('reading not available: the customer is saved without a card', () => {
    it('iPhone (no Web NFC): "Lettura card spenta", saved with create', async () => {
      const fixture = setup({ card: createTestCardReader({ supported: false }) });
      const { router } = await renderNew(fixture);
      const section = await screen.findByRole('region', { name: 'Card' });
      expect(await within(section).findByText('Lettura card spenta')).toBeVisible();
      expect(section).toHaveTextContent('Su iPhone le card non si leggono');

      await fillValid();
      save();
      const [saved] = await waitFor(() => {
        const created = newCustomers(fixture);
        expect(created).toHaveLength(1);
        return created;
      });
      await waitFor(() => expect(router.state.location.pathname).toBe(`/clienti/${saved?.id}`));
      expect(fixture.cards.service.createCustomerWithCard).not.toHaveBeenCalled();
    });

    it('NFC off: "Riprova la lettura" in the section, saved with create', async () => {
      const fixture = setup({
        card: createTestCardReader({ scanOutcomes: ['NotReadableError'] }),
      });
      await renderNew(fixture);
      const section = await screen.findByRole('region', { name: 'Card' });
      expect(await within(section).findByText('Lettura card spenta')).toBeVisible();
      expect(within(section).getByRole('button', { name: 'Riprova la lettura' })).toBeVisible();

      await fillValid();
      save();
      await waitFor(() => expect(newCustomers(fixture)).toHaveLength(1));
      expect(fixture.cards.service.createCustomerWithCard).not.toHaveBeenCalled();
    });

    it('the permission to ask: "Attiva la lettura" in the section', async () => {
      const fixture = setup({ card: createTestCardReader({ permission: 'prompt' }) });
      await renderNew(fixture);
      const section = await screen.findByRole('region', { name: 'Card' });
      expect(
        await within(section).findByRole('button', { name: 'Attiva la lettura' }),
      ).toBeVisible();
    });
  });

  it('on /clienti/nuovo?card= an unknown card read replaces the card of the link', async () => {
    const fixture = setup();
    const { router } = await renderNew(fixture, `/clienti/nuovo?card=${NEW_ONE.uid}`);
    await screen.findByText(new RegExp(`Codice ${NEW_ONE.uid}`));
    tap(fixture, NEW_TWO.read);
    await screen.findByText(new RegExp(`Codice ${NEW_TWO.uid}`));
    expect(router.state.location.search).toBe(`?card=${NEW_TWO.uid}`);
  });

  it('on /clienti/nuovo?card= a lookup without answer is said under the form, the card kept', async () => {
    const fixture = setup();
    const { router } = await renderNew(fixture, `/clienti/nuovo?card=${NEW_ONE.uid}`);
    await screen.findByText(new RegExp(`Codice ${NEW_ONE.uid}`));
    fixture.cards.failNext('lookup', 'lost');
    tap(fixture, NEW_TWO.read);
    const section = await screen.findByRole('region', { name: 'Card' });
    expect(await within(section).findByRole('alert')).toHaveTextContent('Card non letta');
    expect(screen.getByRole('region', { name: 'Card letta' })).toHaveTextContent(NEW_ONE.uid);
    expect(router.state.location.search).toBe(`?card=${NEW_ONE.uid}`);
  });

  it('on /clienti/nuovo?card= a known card read drops the card of the link', async () => {
    const fixture = setup();
    const { router } = await renderNew(fixture, `/clienti/nuovo?card=${NEW_ONE.uid}`);
    await screen.findByText(new RegExp(`Codice ${NEW_ONE.uid}`));
    tap(fixture, OF_MARIA.read);
    expect(await screen.findByRole('alert')).toHaveTextContent('Questa card è di Maria Rossi.');
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.queryByRole('region', { name: 'Card letta' })).not.toBeInTheDocument();
  });
});
