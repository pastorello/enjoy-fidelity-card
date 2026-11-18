import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeWebNfc, type FakeScanOutcome } from '../../test/fakeWebNfc';
import { CardReadPanel, CardReadPanelView } from './CardReadPanel';
import { createCardReader, type CardReader, type NfcStatus } from './cardReader';
import { CardReaderProvider } from './CardReaderProvider';
import { createWebNfcAdapter, type NfcPermission } from './webNfcAdapter';

// SPEC-card-input, point 6; success criteria 2, 3 and 4.

const HOME_TITLE = 'Avvicina la card';
const HOME_TEXT =
  'Lettura attiva: appoggia la card sul retro del telefono. Una card nuova apre la registrazione del cliente.';
const OFF_TEXT =
  'Attiva l’NFC nelle impostazioni del telefono e torna qui. Su iPhone le card non si leggono: cerca il cliente per nome o telefono.';
const DENIED_TEXT =
  'Il permesso NFC è negato: consentilo a Enjoy Card nelle impostazioni di Chrome (Impostazioni sito → NFC) e riprova.';

/** Lets the pending promises (permission query, scan) settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(
  options: {
    supported?: boolean;
    permission?: NfcPermission | null;
    scanOutcomes?: FakeScanOutcome[];
  } = {},
) {
  const nfc = createFakeWebNfc(options);
  let clock = 1_000_000;
  const reader = createCardReader({
    now: () => (clock += 5000),
    adapters: [],
    nfc: createWebNfcAdapter(nfc.api),
  });
  return { nfc, reader };
}

function renderPanel(
  reader: CardReader,
  props: { mode?: 'web-nfc' | 'usb'; variant?: 'full' | 'compact' } = {},
) {
  return render(
    <CardReaderProvider reader={reader}>
      <CardReadPanel title={HOME_TITLE} description={HOME_TEXT} {...props} />
    </CardReaderProvider>,
  );
}

async function activate(reader: CardReader) {
  await act(async () => {
    reader.activate({ usbFormat: null });
    await settle();
  });
}

async function tap(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await settle();
  });
}

const noop = () => {};

const panel = () => screen.getByRole('region', { name: 'Lettura card' });

/** Focuses the button, as TalkBack or a keyboard does, then presses it. */
async function focusAndTap(name: string) {
  act(() => {
    screen.getByRole('button', { name }).focus();
  });
  await tap(name);
}

/** The panel as a pure view of a status. */
const view = (status: NfcStatus) => (
  <CardReadPanelView title={HOME_TITLE} description={HOME_TEXT} status={status} onStart={noop} />
);

describe('CardReadPanel', () => {
  it('shows the start-up text before the reader is known', () => {
    const { reader } = setup();
    renderPanel(reader);
    expect(within(panel()).getByText(HOME_TITLE)).toBeInTheDocument();
    expect(within(panel()).getByText('Avvio della lettura…')).toBeInTheDocument();
    expect(within(panel()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('granted: active with the consumer text, no tap and no button (criterion 2)', async () => {
    const { nfc, reader } = setup({ permission: 'granted' });
    renderPanel(reader);
    await activate(reader);
    expect(within(panel()).getByText(HOME_TITLE)).toBeInTheDocument();
    expect(within(panel()).getByText(HOME_TEXT)).toBeInTheDocument();
    expect(within(panel()).queryByRole('button')).not.toBeInTheDocument();
    expect(nfc.activeScans()).toBe(1);
  });

  it('prompt: "Attiva la lettura" starts the scan on tap, then active (criterion 2)', async () => {
    const { nfc, reader } = setup({ permission: 'prompt' });
    renderPanel(reader);
    await activate(reader);
    expect(within(panel()).getByText('Lettura delle card')).toBeInTheDocument();
    expect(
      within(panel()).getByText(
        'Serve una volta sola: il telefono chiede il permesso di usare l’NFC.',
      ),
    ).toBeInTheDocument();
    expect(nfc.scanCount()).toBe(0);

    await tap('Attiva la lettura');
    expect(nfc.activeScans()).toBe(1);
    expect(within(panel()).getByText(HOME_TEXT)).toBeInTheDocument();
    expect(within(panel()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('NotReadableError: "Lettura card spenta", back to active on return with granted (criterion 3)', async () => {
    const { nfc, reader } = setup({ permission: 'granted', scanOutcomes: ['NotReadableError'] });
    renderPanel(reader);
    await activate(reader);
    expect(within(panel()).getByText('Lettura card spenta')).toBeInTheDocument();
    expect(within(panel()).getByText(OFF_TEXT)).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Riprova la lettura' })).toBeInTheDocument();

    await act(async () => {
      nfc.returnToPage();
      await settle();
    });
    expect(within(panel()).getByText(HOME_TEXT)).toBeInTheDocument();
    expect(nfc.activeScans()).toBe(1);
  });

  it('off: "Riprova la lettura" calls start() again (NFC turned on from the shade)', async () => {
    const { nfc, reader } = setup({ permission: 'granted', scanOutcomes: ['NotReadableError'] });
    renderPanel(reader);
    await activate(reader);
    await tap('Riprova la lettura');
    expect(nfc.scanCount()).toBe(2);
    expect(within(panel()).getByText(HOME_TEXT)).toBeInTheDocument();
  });

  it('denied: the Chrome site-settings text and "Riprova la lettura"', async () => {
    const { nfc, reader } = setup({ permission: 'denied' });
    renderPanel(reader);
    await activate(reader);
    expect(within(panel()).getByText('Lettura card spenta')).toBeInTheDocument();
    expect(within(panel()).getByText(DENIED_TEXT)).toBeInTheDocument();
    await tap('Riprova la lettura');
    expect(nfc.scanCount()).toBe(1);
  });

  it('unsupported (iPhone): the off text and no button (criterion 4)', async () => {
    const { reader } = setup({ supported: false });
    renderPanel(reader);
    await activate(reader);
    expect(within(panel()).getByText('Lettura card spenta')).toBeInTheDocument();
    expect(within(panel()).getByText(OFF_TEXT)).toBeInTheDocument();
    expect(within(panel()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('announces a change of state in a polite live region', async () => {
    const { reader } = setup({ permission: 'prompt' });
    const { container } = renderPanel(reader);
    await activate(reader);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live).toHaveTextContent('Lettura delle card');

    await tap('Attiva la lettura');
    // The same region, now with the new state: screen readers read the change.
    expect(container.querySelector('[aria-live="polite"]')).toBe(live);
    expect(live).toHaveTextContent(HOME_TITLE);
    expect(live).not.toHaveTextContent('Lettura delle card');
  });

  it('"Attiva la lettura": once the button is gone, focus stays in the panel, on the new state', async () => {
    const { reader } = setup({ permission: 'prompt' });
    const { container } = renderPanel(reader);
    await activate(reader);

    await focusAndTap('Attiva la lettura');

    expect(within(panel()).queryByRole('button')).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(container.querySelector('[aria-live="polite"]'));
    expect(document.activeElement).toHaveTextContent(HOME_TEXT);
  });

  it('"Riprova la lettura" with NFC still off: focus goes back to the button', async () => {
    const { reader } = setup({
      permission: 'granted',
      scanOutcomes: ['NotReadableError', 'NotReadableError'],
    });
    renderPanel(reader);
    await activate(reader);

    await focusAndTap('Riprova la lettura');

    expect(within(panel()).getByText(OFF_TEXT)).toBeInTheDocument();
    expect(document.activeElement).toBe(
      within(panel()).getByRole('button', { name: 'Riprova la lettura' }),
    );
  });

  it('"Riprova la lettura": off → starting → off keeps the focus in the panel, then on the button', () => {
    const { container, rerender } = render(view('off'));
    act(() => {
      screen.getByRole('button', { name: 'Riprova la lettura' }).focus();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Riprova la lettura' }));

    rerender(view('starting'));
    expect(within(panel()).queryByRole('button')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(container.querySelector('[aria-live="polite"]'));

    rerender(view('off'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Riprova la lettura' }));
  });

  it('a state change without a tap does not move the focus', async () => {
    const { nfc, reader } = setup({ permission: 'granted', scanOutcomes: ['NotReadableError'] });
    renderPanel(reader);
    await activate(reader);
    await act(async () => {
      nfc.returnToPage();
      await settle();
    });
    expect(within(panel()).getByText(HOME_TEXT)).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  type Options = Parameters<typeof setup>[0];
  const notActive: [string, Options][] = [
    ['needs-permission', { permission: 'prompt' }],
    ['denied', { permission: 'denied' }],
    ['unsupported', { supported: false }],
    ['off', { permission: 'granted', scanOutcomes: ['NotReadableError'] }],
  ];

  it.each(notActive)(
    'usb mode: the consumer text with Web NFC %s, no permission states',
    async (_status, options) => {
      const { reader } = setup(options);
      renderPanel(reader, { mode: 'usb' });
      await activate(reader);
      expect(within(panel()).getByText(HOME_TITLE)).toBeInTheDocument();
      expect(within(panel()).getByText(HOME_TEXT)).toBeInTheDocument();
      expect(within(panel()).queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText('Lettura card spenta')).not.toBeInTheDocument();
    },
  );

  it('compact: one line while active', async () => {
    const { reader } = setup({ permission: 'granted' });
    renderPanel(reader, { variant: 'compact' });
    await activate(reader);
    expect(
      within(panel()).getByText('Lettura attiva: puoi anche avvicinare la card'),
    ).toBeVisible();
    expect(screen.queryByText(HOME_TITLE)).not.toBeInTheDocument();
  });

  it.each(notActive)('compact: nothing with Web NFC %s', async (_status, options) => {
    const { reader } = setup(options);
    renderPanel(reader, { variant: 'compact' });
    await activate(reader);
    expect(screen.queryByRole('region', { name: 'Lettura card' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
