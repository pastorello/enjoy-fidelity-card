import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CardWriteFailure,
  CardWriteResult,
  CardWriteStep,
  WriteUrlOptions,
} from '../card-input/webNfcWriter';
import { CardReaderProvider } from '../card-input/CardReaderProvider';
import { AuthProvider } from '../identity/AuthProvider';
import { signedInFake } from '../../test/renderApp';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCardsService, fakeCard } from '../../test/fakeCardsService';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { CardLinkWriter, CardLinkWriterActions } from './CardLinkWriter';
import { CardsServiceProvider } from './CardsServiceProvider';
import type { CardSummary } from './types';
import { useCardLinkWriter } from './useCardLinkWriter';

// SPEC-cards, point 8 (task 15); boards "Associa-link" and "Associa-link-errore". Invented data only.

const MARIA = fakeCustomer({ name: 'Maria Rossi' });
const UID = '04A1B2C3D4E5F6';
const LINK = /^https?:\/\/[^/]+\/s\/[A-Za-z0-9_-]{22}$/;

const SKIP = 'Salta, lo scrivo più tardi';
const WRITE_AGAIN = 'Scrivi di nuovo il link';
const LATER = 'Più tardi';
const WRITTEN_TEXT =
  'Link scritto: il cliente può vedere i suoi punti avvicinando la card al suo telefono.';
const DEVICE_TEXT = 'Per scrivere il link serve un telefono Android con l’NFC attivo.';

/** Lets the pending promises (permission query, scan, service answers) settle. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** One `writeUrl` call of the fake writer, ended by the test with `finish`. */
type WriteCall = {
  url: string;
  options: WriteUrlOptions;
  step: (step: CardWriteStep) => void;
  finish: (result: CardWriteResult) => void;
};

/** The section and its buttons, as a screen lays them out. */
function Harness({
  card,
  onWritten,
  onLater,
}: {
  card: CardSummary;
  onWritten: (card: CardSummary) => void;
  onLater: () => void;
}) {
  const writing = useCardLinkWriter({ cardId: card.id, uid: card.uid, onWritten });
  return (
    <>
      <CardLinkWriter writing={writing} uid={card.uid} customerName={MARIA.name} />
      <CardLinkWriterActions writing={writing} onLater={onLater} />
    </>
  );
}

type FakeCards = ReturnType<typeof createFakeCardsService>;

/**
 * Renders the writer for Maria's card, with the reader active. `program` sets up the cards fake
 * (failures, held answers) before the writer mounts and issues its first token.
 */
async function setup({
  writable = true,
  program,
  strict = false,
}: { writable?: boolean; program?: (cards: FakeCards) => void; strict?: boolean } = {}) {
  const customers = createFakeCustomerService({ customers: [MARIA] });
  const card = fakeCard({ uid: UID, customerId: MARIA.id });
  const cards = createFakeCardsService({ customers, cards: [card] });
  program?.(cards);
  const reader = createTestCardReader({ permission: 'granted', writable });
  const writes: WriteCall[] = [];
  const writeUrl = vi.spyOn(reader.reader, 'writeUrl').mockImplementation(
    (url, options) =>
      new Promise<CardWriteResult>((resolve) => {
        const call: WriteCall = {
          url,
          options,
          step: (step) => act(() => options.onStep?.(step)),
          finish: resolve,
        };
        options.signal?.addEventListener('abort', () => resolve({ ok: false, reason: 'aborted' }));
        writes.push(call);
      }),
  );
  const onWritten = vi.fn<(card: CardSummary) => void>();
  const onLater = vi.fn<() => void>();
  const tree = (
    <AuthProvider service={signedInFake().service}>
      <CardsServiceProvider service={cards.service}>
        <CardReaderProvider reader={reader.reader}>
          <Harness card={card} onWritten={onWritten} onLater={onLater} />
        </CardReaderProvider>
      </CardsServiceProvider>
    </AuthProvider>
  );
  // Reading is already on, as on Associa card after the read: the writer can write when it mounts.
  reader.reader.activate({ usbFormat: null });
  await settle();
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  await settle();
  return { cards, card, writes, writeUrl, onWritten, onLater, view };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** The write in progress (the last `writeUrl` call), once it has started. */
async function currentWrite(fixture: Setup): Promise<WriteCall> {
  await waitFor(() => expect(fixture.writes.length).toBeGreaterThan(0));
  const write = fixture.writes.at(-1);
  if (!write) throw new Error('no write');
  return write;
}

/** The token the `index`-th `issueLink` call answered. */
async function tokenOf(fixture: Setup, index = 0): Promise<string> {
  const value = await fixture.cards.service.issueLink.mock.results[index]?.value;
  if (typeof value !== 'string') throw new Error('no token issued');
  return value;
}

function region() {
  return screen.getByRole('region', { name: 'Scrittura del link' });
}

/** The whole page, where the token must never appear. */
function html(): string {
  return document.body.innerHTML;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CardLinkWriter: issue, write, confirm (SPEC-cards, point 8)', () => {
  it('issues a token, writes its link on the expected card and confirms that same token once', async () => {
    const fixture = await setup();
    const write = await currentWrite(fixture);
    const token = await tokenOf(fixture);

    expect(fixture.cards.service.issueLink).toHaveBeenCalledExactlyOnceWith(fixture.card.id);
    expect(write.url).toMatch(LINK);
    expect(write.url.endsWith(`/s/${token}`)).toBe(true);
    expect(write.url).not.toContain(UID);
    expect(write.options.expectedUid).toBe(UID);
    expect(write.options.signal).toBeInstanceOf(AbortSignal);

    await act(async () => write.finish({ ok: true }));
    await settle();

    expect(fixture.cards.service.confirmLink).toHaveBeenCalledExactlyOnceWith(
      fixture.card.id,
      token,
    );
    expect(fixture.onWritten).toHaveBeenCalledOnce();
    expect(fixture.onWritten.mock.calls[0]?.[0]).toMatchObject({
      id: fixture.card.id,
      linkState: 'written',
    });
    expect(screen.getByRole('status')).toHaveTextContent(WRITTEN_TEXT);
    expect(screen.queryByRole('button', { name: SKIP })).toBeNull();
    expect(fixture.onLater).not.toHaveBeenCalled();
  });

  it('starts by itself also under StrictMode (mounted twice in development)', async () => {
    const fixture = await setup({ strict: true });
    const write = await currentWrite(fixture);
    expect(write.options.signal?.aborted).toBe(false);
    await act(async () => write.finish({ ok: true }));
    await settle();
    expect(fixture.onWritten).toHaveBeenCalledOnce();
  });

  it('shows each step with the texts of the "Associa-link" board, live', async () => {
    const fixture = await setup();
    const write = await currentWrite(fixture);
    const live = region().querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();

    // Right after the association the card is still on the phone (board "Associa-link").
    expect(region()).toHaveTextContent('Tieni la card appoggiata');
    expect(region()).toHaveTextContent('Scrivo il link per vedere i punti…');

    write.step('waiting-card');
    expect(region()).toHaveTextContent('Avvicina la card …E5F6');
    expect(region()).not.toHaveTextContent('Tieni la card appoggiata');

    write.step('writing');
    expect(region()).toHaveTextContent('Tieni la card appoggiata');
    expect(region()).toHaveTextContent('Scrivo il link per vedere i punti…');

    write.step('verifying');
    expect(region()).toHaveTextContent('Controllo del link: allontana la card e riavvicinala');

    expect(screen.getByRole('button', { name: SKIP })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WRITE_AGAIN })).toBeNull();
  });

  it('«Salta, lo scrivo più tardi» aborts the write through its signal and confirms nothing', async () => {
    const fixture = await setup();
    const write = await currentWrite(fixture);
    write.step('writing');

    await userEvent.click(screen.getByRole('button', { name: SKIP }));

    expect(write.options.signal?.aborted).toBe(true);
    expect(fixture.onLater).toHaveBeenCalledOnce();
    await settle();
    expect(fixture.cards.service.confirmLink).not.toHaveBeenCalled();
    expect(fixture.onWritten).not.toHaveBeenCalled();
  });

  it('«Salta» while the token is being issued: no write starts afterwards', async () => {
    let hold: { release: () => void } | undefined;
    const fixture = await setup({
      program: (cards) => {
        hold = cards.holdNext('issueLink');
      },
    });
    expect(region()).toHaveTextContent('Tieni la card appoggiata');

    await userEvent.click(screen.getByRole('button', { name: SKIP }));
    hold?.release();
    await settle();

    expect(fixture.onLater).toHaveBeenCalledOnce();
    expect(fixture.writeUrl).not.toHaveBeenCalled();
    expect(fixture.cards.service.confirmLink).not.toHaveBeenCalled();
  });
});

type FailureCase = {
  reason: Exclude<CardWriteFailure, 'aborted' | 'cannot-write'>;
  title: string | null;
  text: string;
  hint: boolean;
};

const WRITE_FAILURES: FailureCase[] = [
  {
    reason: 'timeout',
    title: 'Link non scritto',
    text: 'La card è associata a Maria e funziona alla cassa. Il link per vedere i punti non è stato scritto: la card si è staccata troppo presto.',
    hint: true,
  },
  {
    reason: 'io',
    title: 'Link non scritto',
    text: 'La card è associata a Maria e funziona alla cassa. Il link per vedere i punti non è stato scritto: la card si è staccata troppo presto.',
    hint: true,
  },
  {
    reason: 'verify-failed',
    title: null,
    text: 'Il link sulla card non risulta giusto. Riprova.',
    hint: false,
  },
  {
    reason: 'not-allowed',
    title: null,
    text: 'Il telefono non permette di scrivere la card: controlla il permesso NFC di Chrome.',
    hint: false,
  },
  {
    reason: 'wrong-card',
    title: null,
    text: 'Questa non è la card …E5F6: il link non è stato scritto.',
    hint: false,
  },
];

describe('CardLinkWriter: outcomes that did not write the link (SPEC-cards, point 8.4)', () => {
  it.each(WRITE_FAILURES)(
    '$reason: its alert, «Scrivi di nuovo il link» and «Più tardi»',
    async (failure) => {
      const fixture = await setup();
      const write = await currentWrite(fixture);
      await act(async () => write.finish({ ok: false, reason: failure.reason }));
      await settle();

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(failure.text);
      expect(within(alert).queryByRole('heading')?.textContent ?? null).toBe(failure.title);
      const hint = screen.queryByText('Puoi scriverlo anche dopo, da Modifica cliente.');
      expect(hint !== null).toBe(failure.hint);
      expect(screen.getByRole('button', { name: WRITE_AGAIN })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: LATER })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: SKIP })).toBeNull();
      expect(fixture.cards.service.confirmLink).not.toHaveBeenCalled();
      expect(fixture.onWritten).not.toHaveBeenCalled();
    },
  );

  it('«Scrivi di nuovo il link» starts again from a new token; «Più tardi» leaves', async () => {
    const fixture = await setup();
    const first = await currentWrite(fixture);
    await act(async () => first.finish({ ok: false, reason: 'io' }));
    await settle();

    await userEvent.click(screen.getByRole('button', { name: WRITE_AGAIN }));
    await waitFor(() => expect(fixture.writes).toHaveLength(2));
    expect(fixture.cards.service.issueLink).toHaveBeenCalledTimes(2);
    const [oldToken, newToken] = [await tokenOf(fixture, 0), await tokenOf(fixture, 1)];
    expect(newToken).not.toBe(oldToken);
    const second = fixture.writes[1];
    expect(second?.url.endsWith(`/s/${newToken}`)).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(region()).toHaveTextContent('Tieni la card appoggiata');

    await act(async () => second?.finish({ ok: false, reason: 'timeout' }));
    await settle();
    await userEvent.click(screen.getByRole('button', { name: LATER }));
    expect(fixture.onLater).toHaveBeenCalledOnce();
    expect(fixture.cards.service.issueLink).toHaveBeenCalledTimes(2);
  });

  it('no answer to the issue: «Link non scritto: controlla la connessione.», no write', async () => {
    const fixture = await setup({ program: (cards) => cards.failNext('issueLink', 'network') });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Link non scritto: controlla la connessione.',
    );
    expect(fixture.writeUrl).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: WRITE_AGAIN })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LATER })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: WRITE_AGAIN }));
    await currentWrite(fixture);
    expect(fixture.cards.service.issueLink).toHaveBeenCalledTimes(2);
  });

  it('cannot-write during the write: the device text, no «Scrivi di nuovo il link»', async () => {
    const fixture = await setup();
    const write = await currentWrite(fixture);
    await act(async () => write.finish({ ok: false, reason: 'cannot-write' }));
    await settle();

    expect(region()).toHaveTextContent(DEVICE_TEXT);
    expect(screen.queryByRole('button', { name: WRITE_AGAIN })).toBeNull();
    expect(screen.queryByRole('button', { name: SKIP })).toBeNull();
    expect(fixture.cards.service.confirmLink).not.toHaveBeenCalled();
  });

  it('a phone that cannot write: the device text, no write button, no token issued', async () => {
    const fixture = await setup({ writable: false });
    expect(region()).toHaveTextContent(DEVICE_TEXT);
    expect(screen.queryByRole('button', { name: WRITE_AGAIN })).toBeNull();
    expect(screen.queryByRole('button', { name: SKIP })).toBeNull();
    expect(fixture.cards.service.issueLink).not.toHaveBeenCalled();
    expect(fixture.writeUrl).not.toHaveBeenCalled();
  });
});

describe('CardLinkWriter: the token never reaches the page (criterion 10)', () => {
  it('is absent from the DOM in every step and outcome', async () => {
    const fixture = await setup();
    const write = await currentWrite(fixture);
    const token = await tokenOf(fixture);
    expect(html()).not.toContain(token);
    for (const step of ['waiting-card', 'writing', 'verifying'] as const) {
      write.step(step);
      expect(html()).not.toContain(token);
    }
    await act(async () => write.finish({ ok: false, reason: 'verify-failed' }));
    await settle();
    expect(html()).not.toContain(token);

    await userEvent.click(screen.getByRole('button', { name: WRITE_AGAIN }));
    const again = await currentWrite(fixture);
    await act(async () => again.finish({ ok: true }));
    await settle();
    expect(fixture.onWritten).toHaveBeenCalledOnce();
    const tokens = [await tokenOf(fixture, 0), await tokenOf(fixture, 1)];
    for (const issued of tokens) expect(html()).not.toContain(issued);
    expect(fixture.cards.tokens(fixture.card.id).written).toBe(tokens[1]);
  });
});

// Task 16: the hard cases of SPEC-cards, point 8.4.

const RETRY = 'Riprova';
const WRITE_ANYWAY = 'Scrivi comunque';

describe('CardLinkWriter: no answer to the confirmation (criterion 15)', () => {
  it('«Riprova» confirms the same token again, without a new issue nor a new write', async () => {
    const fixture = await setup({ program: (cards) => cards.failNext('confirmLink', 'network') });
    const write = await currentWrite(fixture);
    const token = await tokenOf(fixture);
    await act(async () => write.finish({ ok: true }));
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Link scritto ma non registrato: controlla la connessione.',
    );
    expect(screen.getByRole('button', { name: RETRY })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LATER })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WRITE_AGAIN })).toBeNull();
    expect(fixture.onWritten).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: RETRY }));
    await settle();

    expect(fixture.cards.service.issueLink).toHaveBeenCalledOnce();
    expect(fixture.writeUrl).toHaveBeenCalledOnce();
    expect(fixture.cards.service.confirmLink).toHaveBeenCalledTimes(2);
    expect(fixture.cards.service.confirmLink).toHaveBeenLastCalledWith(fixture.card.id, token);
    expect(fixture.onWritten).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent(WRITTEN_TEXT);
    expect(fixture.cards.tokens(fixture.card.id).written).toBe(token);
    expect(html()).not.toContain(token);
  });

  it('an answer lost after the confirmation applied: «Riprova» is idempotent', async () => {
    const fixture = await setup({ program: (cards) => cards.failNext('confirmLink', 'lost') });
    const write = await currentWrite(fixture);
    await act(async () => write.finish({ ok: true }));
    await settle();

    await userEvent.click(screen.getByRole('button', { name: RETRY }));
    await settle();
    expect(fixture.onWritten).toHaveBeenCalledOnce();
    expect(fixture.cards.service.issueLink).toHaveBeenCalledOnce();
  });

  it('«Riprova» that fails again keeps offering «Riprova» with the same token', async () => {
    const fixture = await setup({
      program: (cards) => {
        cards.failNext('confirmLink', 'network');
        cards.failNext('confirmLink', 'network');
      },
    });
    const write = await currentWrite(fixture);
    const token = await tokenOf(fixture);
    await act(async () => write.finish({ ok: true }));
    await settle();
    await userEvent.click(screen.getByRole('button', { name: RETRY }));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Link scritto ma non registrato');

    await userEvent.click(screen.getByRole('button', { name: RETRY }));
    await settle();
    expect(fixture.cards.service.confirmLink).toHaveBeenCalledTimes(3);
    for (const call of fixture.cards.service.confirmLink.mock.calls) expect(call[1]).toBe(token);
    expect(fixture.onWritten).toHaveBeenCalledOnce();
    expect(fixture.writeUrl).toHaveBeenCalledOnce();
  });

  it('«Più tardi» leaves the token pending: the link is not registered', async () => {
    const fixture = await setup({ program: (cards) => cards.failNext('confirmLink', 'network') });
    const write = await currentWrite(fixture);
    const token = await tokenOf(fixture);
    await act(async () => write.finish({ ok: true }));
    await settle();

    await userEvent.click(screen.getByRole('button', { name: LATER }));
    await settle();
    expect(fixture.onLater).toHaveBeenCalledOnce();
    expect(fixture.cards.service.confirmLink).toHaveBeenCalledOnce();
    expect(fixture.cards.tokens(fixture.card.id)).toEqual({ written: null, pending: token });
    expect(fixture.onWritten).not.toHaveBeenCalled();
  });
});

describe('CardLinkWriter: another card, an unreadable card (SPEC-cards, point 8.4)', () => {
  it('wrong-card with otherUid names both cards; «Scrivi di nuovo il link» stays', async () => {
    const fixture = await setup();
    const write = await currentWrite(fixture);
    await act(async () =>
      write.finish({ ok: false, reason: 'wrong-card', otherUid: '04FFEEDDCCABCD' }),
    );
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Il link potrebbe essere finito sulla card …ABCD. Avvicina la card …E5F6 e riprova; poi riscrivi il link della card …ABCD dalla scheda del suo cliente.',
    );
    expect(screen.getByRole('button', { name: WRITE_AGAIN })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LATER })).toBeInTheDocument();
    expect(fixture.cards.service.confirmLink).not.toHaveBeenCalled();
  });

  it('wrong-card without otherUid: the short text', async () => {
    const fixture = await setup();
    const write = await currentWrite(fixture);
    await act(async () => write.finish({ ok: false, reason: 'wrong-card' }));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Questa non è la card …E5F6: il link non è stato scritto.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('potrebbe');
  });

  it('unreadable: «Scrivi comunque» writes again with allowUnreadable on the same card', async () => {
    const fixture = await setup();
    const write = await currentWrite(fixture);
    expect(write.options.allowUnreadable).not.toBe(true);
    await act(async () => write.finish({ ok: false, reason: 'unreadable' }));
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'La card non si legge. È la card …E5F6? Puoi riscriverla.',
    );
    expect(screen.queryByRole('button', { name: WRITE_AGAIN })).toBeNull();
    expect(screen.getByRole('button', { name: LATER })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: WRITE_ANYWAY }));
    await waitFor(() => expect(fixture.writes).toHaveLength(2));
    const again = fixture.writes[1];
    expect(again?.options.allowUnreadable).toBe(true);
    expect(again?.options.expectedUid).toBe(UID);
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => again?.finish({ ok: true }));
    await settle();
    expect(fixture.onWritten).toHaveBeenCalledOnce();
    const token = await tokenOf(fixture, 1);
    expect(fixture.cards.service.confirmLink).toHaveBeenCalledExactlyOnceWith(
      fixture.card.id,
      token,
    );
  });

  it('unreadable: «Più tardi» leaves', async () => {
    const fixture = await setup();
    const write = await currentWrite(fixture);
    await act(async () => write.finish({ ok: false, reason: 'unreadable' }));
    await settle();
    await userEvent.click(screen.getByRole('button', { name: LATER }));
    expect(fixture.onLater).toHaveBeenCalledOnce();
    expect(fixture.writes).toHaveLength(1);
  });
});

describe('CardLinkWriter: a card deactivated meanwhile (SPEC-cards, point 8.4)', () => {
  it.each(['issueLink', 'confirmLink'] as const)(
    'card_inactive on %s: «Questa card non è più attiva.», only «Più tardi»',
    async (method) => {
      const fixture = await setup({ program: (cards) => cards.failNext(method, 'card_inactive') });
      if (method === 'confirmLink') {
        const write = await currentWrite(fixture);
        await act(async () => write.finish({ ok: true }));
        await settle();
      }

      expect(screen.getByRole('alert')).toHaveTextContent('Questa card non è più attiva.');
      expect(screen.queryByRole('button', { name: WRITE_AGAIN })).toBeNull();
      expect(screen.queryByRole('button', { name: RETRY })).toBeNull();
      expect(screen.queryByRole('button', { name: WRITE_ANYWAY })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: LATER }));
      expect(fixture.onLater).toHaveBeenCalledOnce();
      expect(fixture.onWritten).not.toHaveBeenCalled();
    },
  );
});

describe('CardLinkWriter: the token never reaches the logs (criterion 10)', () => {
  it('no console call carries the token, in success and in failures', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const fixture = await setup({ program: (cards) => cards.failNext('confirmLink', 'network') });
    const first = await currentWrite(fixture);
    await act(async () => first.finish({ ok: true }));
    await settle();
    await userEvent.click(screen.getByRole('button', { name: RETRY }));
    await settle();
    expect(fixture.onWritten).toHaveBeenCalledOnce();

    const token = await tokenOf(fixture);
    for (const spy of spies) {
      for (const args of spy.mock.calls) {
        expect(args.map((arg) => String(arg)).join(' ')).not.toContain(token);
      }
    }
  });
});
