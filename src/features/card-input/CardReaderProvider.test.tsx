import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeWebNfc, type FakeScanOutcome } from '../../test/fakeWebNfc';
import { renderHookThenFire } from '../../test/fireAfterCommit';
import { createCardReader, type CardRead, type CardReader } from './cardReader';
import { CardReaderProvider, useCardReader } from './CardReaderProvider';
import { useCardRead, useCardReaderState } from './useCardRead';
import { createWebNfcAdapter, type NfcPermission } from './webNfcAdapter';

// SPEC-card-input, points 2 and 5; success criterion 5. Invented uids only.

const UID = '04A1B2C3D4E5F6';
const OTHER_UID = '04B1C2D3E4F5A6';

/** Lets the pending promises (permission query, scan) settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(
  options: { permission?: NfcPermission | null; scanOutcomes?: FakeScanOutcome[] } = {},
) {
  const nfc = createFakeWebNfc(options);
  let clock = 1_000_000;
  const reader = createCardReader({
    // Each read comes 5 s after the previous one: past the repeat window.
    now: () => (clock += 5000),
    adapters: [],
    nfc: createWebNfcAdapter(nfc.api),
  });
  return { nfc, reader };
}

function withProvider(reader: CardReader, children: ReactNode, strict = false) {
  const tree = <CardReaderProvider reader={reader}>{children}</CardReaderProvider>;
  return strict ? <StrictMode>{tree}</StrictMode> : tree;
}

function Consumer({
  name,
  onRead,
  enabled,
  children,
}: {
  name: string;
  onRead: (name: string, read: CardRead) => void;
  enabled?: boolean;
  children?: ReactNode;
}) {
  useCardRead((read) => onRead(name, read), enabled === undefined ? undefined : { enabled });
  return <div data-testid={name}>{children}</div>;
}

/** A screen that reads cards, with a panel that reads too and opens above it on a tap. */
function Screen({
  onRead,
  strictPanel,
}: {
  onRead: (n: string, r: CardRead) => void;
  strictPanel?: boolean;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(true);
  return (
    <Consumer name="screen" onRead={onRead} enabled={screenEnabled}>
      <button type="button" onClick={() => setPanelOpen((open) => !open)}>
        pannello
      </button>
      <button type="button" onClick={() => setScreenEnabled((enabled) => !enabled)}>
        schermata
      </button>
      {panelOpen &&
        (strictPanel ? (
          <StrictMode>
            <Consumer name="panel" onRead={onRead} />
          </StrictMode>
        ) : (
          <Consumer name="panel" onRead={onRead} />
        ))}
    </Consumer>
  );
}

function Reading({ onRead }: { onRead: (read: CardRead) => void }) {
  useCardRead(onRead);
  return null;
}

/** Uses the hook without any provider around it. */
function Bare() {
  useCardRead(() => undefined);
  return null;
}

function Status() {
  const state = useCardReaderState();
  return (
    <>
      <p data-testid="nfc">{state.nfc}</p>
      <button type="button" onClick={() => void state.start()}>
        Attiva la lettura
      </button>
    </>
  );
}

async function activate(reader: CardReader) {
  await act(async () => {
    reader.activate({ usbFormat: null });
    await settle();
  });
}

function hold(nfc: ReturnType<typeof createFakeWebNfc>, uid: string) {
  act(() => {
    nfc.read(uid);
  });
}

describe('useCardRead: the stack of consumers (criterion 5)', () => {
  for (const strict of [false, true]) {
    const mode = strict ? 'in StrictMode' : 'without StrictMode';

    it(`gives reads only to the consumer on top, then back to the other one (${mode})`, async () => {
      const { nfc, reader } = setup();
      const onRead = vi.fn<(name: string, read: CardRead) => void>();
      render(withProvider(reader, <Screen onRead={onRead} />, strict));
      await activate(reader);

      hold(nfc, UID);
      expect(onRead.mock.calls.map(([name]) => name)).toEqual(['screen']);

      fireEvent.click(screen.getByRole('button', { name: 'pannello' }));
      hold(nfc, OTHER_UID);
      expect(onRead.mock.calls.map(([name]) => name)).toEqual(['screen', 'panel']);
      expect(onRead.mock.calls[1]?.[1]).toMatchObject({ uid: OTHER_UID, source: 'web-nfc' });

      // Closing the panel (unmounting the top one) gives the reads back to the screen.
      fireEvent.click(screen.getByRole('button', { name: 'pannello' }));
      hold(nfc, UID);
      expect(onRead.mock.calls.map(([name]) => name)).toEqual(['screen', 'panel', 'screen']);
    });

    it(`enabled false then true puts the consumer back on top (${mode})`, async () => {
      const { nfc, reader } = setup();
      const onRead = vi.fn<(name: string, read: CardRead) => void>();
      render(withProvider(reader, <Screen onRead={onRead} />, strict));
      await activate(reader);
      fireEvent.click(screen.getByRole('button', { name: 'pannello' }));

      // The screen leaves the stack: the panel, still on top, keeps receiving.
      fireEvent.click(screen.getByRole('button', { name: 'schermata' }));
      hold(nfc, UID);
      // Enabled again, the screen is now the last one activated: it goes above the panel.
      fireEvent.click(screen.getByRole('button', { name: 'schermata' }));
      hold(nfc, OTHER_UID);

      expect(onRead.mock.calls.map(([name]) => name)).toEqual(['panel', 'screen']);
    });
  }

  it('a panel mounted in StrictMode (double effects) still ends up on top, once', async () => {
    const { nfc, reader } = setup();
    const onRead = vi.fn<(name: string, read: CardRead) => void>();
    render(withProvider(reader, <Screen onRead={onRead} strictPanel />));
    await activate(reader);
    fireEvent.click(screen.getByRole('button', { name: 'pannello' }));

    hold(nfc, UID);

    expect(onRead.mock.calls.map(([name]) => name)).toEqual(['panel']);
  });

  it('a disabled consumer receives nothing', async () => {
    const { nfc, reader } = setup();
    const onRead = vi.fn<(name: string, read: CardRead) => void>();
    render(withProvider(reader, <Consumer name="home" onRead={onRead} enabled={false} />));
    await activate(reader);

    hold(nfc, UID);

    expect(onRead).not.toHaveBeenCalled();
  });

  it('uses the latest callback without subscribing again', async () => {
    const { nfc, reader } = setup();
    const push = vi.spyOn(reader, 'pushConsumer');
    const first = vi.fn<(read: CardRead) => void>();
    const second = vi.fn<(read: CardRead) => void>();
    const { rerender } = render(withProvider(reader, <Reading onRead={first} />));
    await activate(reader);

    rerender(withProvider(reader, <Reading onRead={second} />));
    hold(nfc, UID);

    expect(push).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ uid: UID }));
  });
});

describe('CardReaderProvider', () => {
  it('does not start anything by itself: no activate(), no scan()', async () => {
    const { nfc, reader } = setup();
    const activateSpy = vi.spyOn(reader, 'activate');
    render(withProvider(reader, <Consumer name="screen" onRead={() => undefined} />, true));
    await act(settle);

    expect(activateSpy).not.toHaveBeenCalled();
    expect(nfc.scanCount()).toBe(0);
    expect(nfc.permissionQueries()).toBe(0);
  });

  it('gives its service to useCardReader', () => {
    const { reader } = setup();
    function Probe() {
      return <p>{useCardReader() === reader ? 'same' : 'other'}</p>;
    }
    render(withProvider(reader, <Probe />));

    expect(screen.getByText('same')).toBeInTheDocument();
  });

  it('the hooks outside the provider throw', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Bare />)).toThrow(/CardReaderProvider/);
    vi.restoreAllMocks();
  });
});

describe('useCardReaderState', () => {
  it('follows the nfc status of the service', async () => {
    const { reader } = setup({ permission: 'granted' });
    render(withProvider(reader, <Status />));
    expect(screen.getByTestId('nfc')).toHaveTextContent('checking');

    await activate(reader);
    expect(screen.getByTestId('nfc')).toHaveTextContent('active');

    act(() => {
      reader.deactivate();
    });
    expect(screen.getByTestId('nfc')).toHaveTextContent('checking');
  });

  it('start() from a tap starts the scan', async () => {
    const { nfc, reader } = setup({ permission: 'prompt' });
    render(withProvider(reader, <Status />));
    await activate(reader);
    expect(screen.getByTestId('nfc')).toHaveTextContent('needs-permission');
    expect(nfc.scanCount()).toBe(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Attiva la lettura' }));
      await settle();
    });

    expect(nfc.scanCount()).toBe(1);
    expect(screen.getByTestId('nfc')).toHaveTextContent('active');
  });
});

describe('useCardRead: the onRead of the screen on show', () => {
  it('a read right after a render goes to the onRead of that render', async () => {
    const { nfc, reader } = setup();
    const before = vi.fn<(read: CardRead) => void>();
    const after = vi.fn<(read: CardRead) => void>();
    const hosted = renderHookThenFire(
      ({ onRead }) => useCardRead(onRead),
      { onRead: before },
      {
        wrapper: ({ children }) => withProvider(reader, children),
      },
    );
    await activate(reader);

    // The screen changed (e.g. a card was just looked up); a card arrives before `useEffect` runs.
    hosted.rerenderAndFire({ onRead: after }, () => nfc.read(UID));

    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ uid: UID }));
  });
});
