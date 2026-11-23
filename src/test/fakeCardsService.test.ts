import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../lib/serverFault';
import {
  CardInactiveError,
  CardNotFoundError,
  CardTakenError,
  CustomerUnavailableError,
  InvalidUidError,
  LinkTokenMismatchError,
  NetworkError,
  NotOperatorError,
} from '../features/cards/types';
import type { CreateCustomerWithCardInput } from '../features/cards/types';
import { CustomerError } from '../features/customers/types';
import { createFakeCardsService, fakeCard } from './fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from './fakeCustomerService';

const OP_1 = '11111111-1111-4111-8111-111111111111';
const OP_2 = '22222222-2222-4222-8222-222222222222';
const UID_1 = '04AABBCCDDEE01';
const UID_2 = '04AABBCCDDEE02';
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

function newCustomer(
  overrides: Partial<CreateCustomerWithCardInput> = {},
): CreateCustomerWithCardInput {
  return {
    operationId: OP_1,
    name: 'Maria Rossi',
    email: '',
    privacyConsent: true,
    notes: '',
    uid: UID_1,
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

/** Two customers in a customers fake, and a cards fake that reads them. */
function setup(options: { cards?: ReturnType<typeof fakeCard>[] } = {}) {
  const maria = fakeCustomer({ name: 'Maria Rossi' });
  const antonio = fakeCustomer({ name: 'Antonio Esposito' });
  const customers = createFakeCustomerService({ customers: [maria, antonio] });
  const cards = createFakeCardsService({ customers, cards: options.cards ?? [] });
  return { maria, antonio, customers, cards };
}

describe('createFakeCardsService: lookup and associate', () => {
  it('an unknown uid is unknown; after associate it is the customer active card', async () => {
    const { maria, cards } = setup();
    const { service } = cards;
    await expect(service.lookup(UID_1)).resolves.toEqual({ status: 'unknown' });

    const { card, replacedCardId } = await service.associate(maria.id, UID_1);
    expect(card).toMatchObject({
      uid: UID_1,
      customerId: maria.id,
      active: true,
      deactivatedAt: null,
      linkWrittenAt: null,
      linkPendingAt: null,
      linkState: 'not-written',
    });
    expect(replacedCardId).toBeNull();
    await expect(service.lookup(UID_1)).resolves.toEqual({
      status: 'active',
      cardId: card.id,
      customerId: maria.id,
      customerName: 'Maria Rossi',
    });
    await expect(service.getActiveCard(maria.id)).resolves.toEqual(card);
  });

  it('refuses a uid that is not canonical, like private.is_card_uid', async () => {
    const { maria, cards } = setup();
    const refused = ['04aabbccddee01', '04:AA:BB:CC', '04AABBCCD', '04AABB', '0000000000', ''];
    const outcomes = await Promise.all(
      refused.flatMap((uid) => [
        rejection(cards.service.lookup(uid)),
        rejection(cards.service.associate(maria.id, uid)),
      ]),
    );
    for (const outcome of outcomes) expect(outcome).toBeInstanceOf(InvalidUidError);
    // 4 and 10 bytes are the limits.
    await expect(cards.service.lookup('04AABBCC')).resolves.toEqual({ status: 'unknown' });
    await expect(cards.service.lookup('04AABBCCDDEEFF001122')).resolves.toEqual({
      status: 'unknown',
    });
    await expect(cards.service.lookup('04AABBCCDDEEFF00112233')).rejects.toBeInstanceOf(
      InvalidUidError,
    );
    expect(cards.cards()).toEqual([]);
  });

  it('associating the same active card again changes nothing (a resent request)', async () => {
    const { maria, cards } = setup();
    const first = await cards.service.associate(maria.id, UID_1);
    const again = await cards.service.associate(maria.id, UID_1);
    expect(again).toEqual({ card: first.card, replacedCardId: null });
    expect(cards.cards()).toHaveLength(1);
  });

  it('a new card replaces the active one, whose link stops working', async () => {
    const { maria, cards } = setup();
    const { service } = cards;
    const old = (await service.associate(maria.id, UID_1)).card;
    await service.confirmLink(old.id, await service.issueLink(old.id));

    const { card, replacedCardId } = await service.associate(maria.id, UID_2);
    expect(replacedCardId).toBe(old.id);
    expect(card).toMatchObject({ uid: UID_2, active: true });
    await expect(service.lookup(UID_1)).resolves.toMatchObject({
      status: 'inactive',
      cardId: old.id,
    });
    expect(cards.cards().find((row) => row.id === old.id)).toMatchObject({
      active: false,
      deactivatedAt: expect.any(String),
      linkWrittenAt: null,
      linkPendingAt: null,
      linkState: 'not-written',
    });
    expect(cards.tokens(old.id)).toEqual({ written: null, pending: null });
    await expect(service.getActiveCard(maria.id)).resolves.toEqual(card);
  });

  it('the customer own deactivated card is reactivated, from "link not written"', async () => {
    const { maria, cards } = setup();
    const { service } = cards;
    const first = (await service.associate(maria.id, UID_1)).card;
    const second = (await service.associate(maria.id, UID_2)).card;

    const { card, replacedCardId } = await service.associate(maria.id, UID_1);
    expect(card).toMatchObject({ id: first.id, active: true, deactivatedAt: null });
    expect(card.linkState).toBe('not-written');
    expect(replacedCardId).toBe(second.id);
    expect(cards.cards()).toHaveLength(2);
  });

  it('a uid of another customer is card_taken with its owner, active or not', async () => {
    const { maria, antonio, cards } = setup();
    const { service } = cards;
    await service.associate(maria.id, UID_1);

    const taken = await rejection(service.associate(antonio.id, UID_1));
    expect(taken).toBeInstanceOf(CardTakenError);
    expect(taken).toMatchObject({
      kind: 'card_taken',
      owner: { customerId: maria.id, name: 'Maria Rossi', active: true },
    });

    await service.associate(maria.id, UID_2);
    await expect(service.associate(antonio.id, UID_1)).rejects.toMatchObject({
      owner: { customerId: maria.id, name: 'Maria Rossi', active: false },
    });
    await expect(service.getActiveCard(antonio.id)).resolves.toBeNull();
  });

  it('an anonymized customer: its card stops working, is anonymized and taken without a name', async () => {
    const { maria, antonio, customers, cards } = setup();
    const { service } = cards;
    const card = (await service.associate(maria.id, UID_1)).card;
    await service.confirmLink(card.id, await service.issueLink(card.id));
    await customers.service.anonymize(maria.id);

    await expect(service.lookup(UID_1)).resolves.toEqual({
      status: 'anonymized',
      cardId: card.id,
      customerId: maria.id,
    });
    await expect(service.getActiveCard(maria.id)).resolves.toBeNull();
    expect(cards.tokens(card.id)).toEqual({ written: null, pending: null });
    await expect(service.associate(antonio.id, UID_1)).rejects.toMatchObject({
      owner: { customerId: maria.id, name: null, active: false },
    });
    const refused = await rejection(service.associate(maria.id, UID_2));
    expect(refused).toBeInstanceOf(CustomerUnavailableError);
    expect(refused).toMatchObject({ reason: 'anonymized' });
    await expect(
      service.associate('00000000-0000-4000-8000-000000000999', UID_2),
    ).rejects.toMatchObject({ reason: 'not-found' });
  });

  it('starts from the cards it receives, and fakeCard gives a valid card', async () => {
    const maria = fakeCustomer({ name: 'Maria Rossi' });
    const customers = createFakeCustomerService({ customers: [maria] });
    const seeded = fakeCard({ customerId: maria.id, uid: UID_1 });
    expect(seeded).toMatchObject({ active: true, linkState: 'not-written' });
    const cards = createFakeCardsService({ customers, cards: [seeded] });

    await expect(cards.service.lookup(UID_1)).resolves.toMatchObject({
      status: 'active',
      cardId: seeded.id,
    });
    await expect(cards.service.getActiveCard(maria.id)).resolves.toEqual(seeded);
  });
});

describe('createFakeCardsService: deactivate', () => {
  it('deactivates once; repeating it changes nothing; an unknown card is card_not_found', async () => {
    const { maria, cards } = setup();
    const { service } = cards;
    const card = (await service.associate(maria.id, UID_1)).card;

    const off = await service.deactivate(card.id);
    expect(off).toMatchObject({ id: card.id, active: false, deactivatedAt: expect.any(String) });
    await expect(service.deactivate(card.id)).resolves.toEqual(off);
    await expect(service.getActiveCard(maria.id)).resolves.toBeNull();
    await expect(service.deactivate('00000000-0000-4000-8000-000000000999')).rejects.toBeInstanceOf(
      CardNotFoundError,
    );
  });
});

describe('createFakeCardsService: createCustomerWithCard', () => {
  it('creates the customer and its card together, in the customers fake too', async () => {
    const customers = createFakeCustomerService();
    const cards = createFakeCardsService({ customers });
    const created = await cards.service.createCustomerWithCard(
      newCustomer({ email: ' Maria.Rossi@Example.com' }),
    );

    // Only the summary's fields: no phone (SPEC-customers-v2, point 1).
    expect(Object.keys(created).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'anonymizedAt',
      'balance',
      'email',
      'id',
      'lastServedAt',
      'name',
      'notes',
    ]);
    expect(created).toMatchObject({
      name: 'Maria Rossi',
      email: 'maria.rossi@example.com',
      balance: 0,
    });
    await expect(customers.service.get(created.id)).resolves.toEqual(created);
    await expect(cards.service.lookup(UID_1)).resolves.toMatchObject({
      status: 'active',
      customerId: created.id,
      customerName: 'Maria Rossi',
    });
  });

  it('the same operation_id returns the same customer without touching the cards', async () => {
    const customers = createFakeCustomerService();
    const cards = createFakeCardsService({ customers });
    const first = await cards.service.createCustomerWithCard(newCustomer());
    const again = await cards.service.createCustomerWithCard(
      newCustomer({ name: 'Altro Nome', uid: UID_2 }),
    );

    expect(again).toEqual(first);
    expect(customers.customers()).toHaveLength(1);
    expect(cards.cards()).toHaveLength(1);
    await expect(cards.service.lookup(UID_2)).resolves.toEqual({ status: 'unknown' });
  });

  it('is all or nothing: card_taken or a form error leaves neither customer nor card', async () => {
    const { maria, customers, cards } = setup();
    await cards.service.associate(maria.id, UID_1);

    await expect(
      cards.service.createCustomerWithCard(newCustomer({ name: 'Luca Bianchi' })),
    ).rejects.toMatchObject({ kind: 'card_taken', owner: { customerId: maria.id } });
    const nameTaken = await rejection(
      cards.service.createCustomerWithCard(newCustomer({ operationId: OP_2, uid: UID_2 })),
    );
    expect(nameTaken).toBeInstanceOf(CustomerError);
    expect(nameTaken).toMatchObject({ kind: 'customer_name_taken', existingCustomerId: maria.id });
    await expect(
      cards.service.createCustomerWithCard(newCustomer({ name: 'Luca Bianchi', uid: 'xx' })),
    ).rejects.toBeInstanceOf(InvalidUidError);

    expect(customers.customers()).toHaveLength(2);
    expect(cards.cards()).toHaveLength(1);
    // The operation_id of a refused request is still free.
    await expect(
      cards.service.createCustomerWithCard(newCustomer({ name: 'Luca Bianchi', uid: UID_2 })),
    ).resolves.toMatchObject({ name: 'Luca Bianchi' });
  });
});

describe('createFakeCardsService: createCustomerWithCard with an email', () => {
  it('email_invalid or customer_email_taken (with the other id) leave neither customer nor card', async () => {
    const maria = fakeCustomer({ name: 'Maria Rossi', email: 'maria.rossi@example.com' });
    const customers = createFakeCustomerService({ customers: [maria] });
    const cards = createFakeCardsService({ customers });

    await expect(
      cards.service.createCustomerWithCard(newCustomer({ name: 'Luca Bianchi', email: 'luca@' })),
    ).rejects.toMatchObject({ kind: 'email_invalid', existingCustomerId: null });
    const taken = await rejection(
      cards.service.createCustomerWithCard(
        newCustomer({ name: 'Luca Bianchi', email: 'MARIA.rossi@example.com' }),
      ),
    );
    expect(taken).toBeInstanceOf(CustomerError);
    expect(taken).toMatchObject({ kind: 'customer_email_taken', existingCustomerId: maria.id });

    expect(customers.customers()).toHaveLength(1);
    expect(cards.cards()).toHaveLength(0);
    await expect(cards.service.lookup(UID_1)).resolves.toEqual({ status: 'unknown' });
  });

  it('an email freed by the anonymization can be given to a new customer with a card', async () => {
    const maria = fakeCustomer({ name: 'Maria Rossi', email: 'maria.rossi@example.com' });
    const customers = createFakeCustomerService({ customers: [maria] });
    const cards = createFakeCardsService({ customers });
    await customers.service.anonymize(maria.id);

    await expect(
      cards.service.createCustomerWithCard(
        newCustomer({ name: 'Luca Bianchi', email: 'maria.rossi@example.com' }),
      ),
    ).resolves.toMatchObject({ name: 'Luca Bianchi', email: 'maria.rossi@example.com' });
  });
});

describe('createFakeCardsService: link to the points', () => {
  it('issue gives a pending token, confirm makes it the written link, confirm again changes nothing', async () => {
    const { maria, cards } = setup();
    const { service } = cards;
    const card = (await service.associate(maria.id, UID_1)).card;

    const token = await service.issueLink(card.id);
    expect(token).toMatch(TOKEN);
    expect(cards.tokens(card.id)).toEqual({ written: null, pending: token });
    expect(await service.getActiveCard(maria.id)).toMatchObject({
      linkPendingAt: expect.any(String),
      linkState: 'not-written',
    });

    const confirmed = await service.confirmLink(card.id, token);
    expect(confirmed).toMatchObject({
      linkWrittenAt: expect.any(String),
      linkPendingAt: null,
      linkState: 'written',
    });
    expect(cards.tokens(card.id)).toEqual({ written: token, pending: null });
    await expect(service.confirmLink(card.id, token)).resolves.toEqual(confirmed);
  });

  it('a newer issue leaves the written link valid, unverified, and replaces the pending token', async () => {
    const { maria, cards } = setup();
    const { service } = cards;
    const card = (await service.associate(maria.id, UID_1)).card;
    const written = await service.issueLink(card.id);
    await service.confirmLink(card.id, written);

    const stale = await service.issueLink(card.id);
    const fresh = await service.issueLink(card.id);
    expect(new Set([written, stale, fresh]).size).toBe(3);
    expect(await service.getActiveCard(maria.id)).toMatchObject({ linkState: 'unverified' });
    expect(cards.tokens(card.id)).toEqual({ written, pending: fresh });

    await expect(service.confirmLink(card.id, stale)).rejects.toBeInstanceOf(
      LinkTokenMismatchError,
    );
    await expect(service.confirmLink(card.id, 'not a token')).rejects.toBeInstanceOf(
      LinkTokenMismatchError,
    );
    await expect(service.confirmLink(card.id, written)).resolves.toMatchObject({
      linkState: 'unverified',
    });
    await expect(service.confirmLink(card.id, fresh)).resolves.toMatchObject({
      linkState: 'written',
    });
    expect(cards.tokens(card.id)).toEqual({ written: fresh, pending: null });
  });

  it('no link for a deactivated or unknown card', async () => {
    const { maria, cards } = setup();
    const { service } = cards;
    const card = (await service.associate(maria.id, UID_1)).card;
    const token = await service.issueLink(card.id);
    await service.deactivate(card.id);

    await expect(service.issueLink(card.id)).rejects.toBeInstanceOf(CardInactiveError);
    await expect(service.confirmLink(card.id, token)).rejects.toBeInstanceOf(CardInactiveError);
    const unknown = '00000000-0000-4000-8000-000000000999';
    await expect(service.issueLink(unknown)).rejects.toBeInstanceOf(CardNotFoundError);
    await expect(service.confirmLink(unknown, token)).rejects.toBeInstanceOf(CardNotFoundError);
  });
});

describe('createFakeCardsService: calls and failures', () => {
  it('logs every call with its arguments', async () => {
    const { maria, cards } = setup();
    await cards.service.lookup(UID_1);
    await cards.service.associate(maria.id, UID_1);
    expect(cards.calls).toEqual([
      { method: 'lookup', args: [UID_1] },
      { method: 'associate', args: [maria.id, UID_1] },
    ]);
  });

  it('failNext rejects with the typed error of a kind, or the error given, changing nothing', async () => {
    const { maria, cards } = setup();
    cards.failNext('associate', 'card_taken');
    cards.failNext('associate', new ServerFaultError('unavailable'));
    cards.failNext('lookup', 'not_operator');

    await expect(cards.service.associate(maria.id, UID_1)).rejects.toBeInstanceOf(CardTakenError);
    await expect(cards.service.associate(maria.id, UID_1)).rejects.toBeInstanceOf(ServerFaultError);
    await expect(cards.service.lookup(UID_1)).rejects.toBeInstanceOf(NotOperatorError);
    expect(cards.cards()).toEqual([]);
    await expect(cards.service.associate(maria.id, UID_1)).resolves.toMatchObject({
      card: { uid: UID_1 },
    });
  });

  it("'lost': the call is applied but the answer is a network error; resending is safe", async () => {
    const customers = createFakeCustomerService();
    const cards = createFakeCardsService({ customers });
    cards.failNext('createCustomerWithCard', 'lost');

    await expect(cards.service.createCustomerWithCard(newCustomer())).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(customers.customers()).toHaveLength(1);
    expect(cards.cards()).toHaveLength(1);
    const resent = await cards.service.createCustomerWithCard(newCustomer());
    expect(resent.id).toBe(customers.customers()[0]?.id);
    expect(cards.cards()).toHaveLength(1);
  });

  it('while the network is down every call fails with network and changes nothing', async () => {
    const { maria, cards } = setup();
    cards.setNetworkDown(true);
    await expect(cards.service.associate(maria.id, UID_1)).rejects.toBeInstanceOf(NetworkError);
    await expect(cards.service.lookup(UID_1)).rejects.toBeInstanceOf(NetworkError);
    expect(cards.cards()).toEqual([]);
    cards.setNetworkDown(false);
    await expect(cards.service.lookup(UID_1)).resolves.toEqual({ status: 'unknown' });
  });

  it('holdNext delays an answer until released', async () => {
    const { cards } = setup();
    const held = cards.holdNext('lookup');
    let answered = false;
    const pending = cards.service.lookup(UID_1).then(() => {
      answered = true;
    });
    await Promise.resolve();
    expect(answered).toBe(false);
    held.release();
    await pending;
    expect(answered).toBe(true);
  });

  it('an account that is not an active operator gets not_operator from every call', async () => {
    const maria = fakeCustomer();
    const customers = createFakeCustomerService({ customers: [maria] });
    const cards = createFakeCardsService({ customers, operator: false });
    await expect(cards.service.lookup(UID_1)).rejects.toBeInstanceOf(NotOperatorError);
    await expect(cards.service.getActiveCard(maria.id)).rejects.toBeInstanceOf(NotOperatorError);
    await expect(cards.service.associate(maria.id, UID_1)).rejects.toBeInstanceOf(NotOperatorError);
  });

  it('without a customers fake it makes its own, returned as `customers`', async () => {
    const cards = createFakeCardsService();
    const created = await cards.service.createCustomerWithCard(newCustomer());
    expect(cards.customers.customers()).toEqual([created]);
  });
});
