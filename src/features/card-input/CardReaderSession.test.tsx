import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { rootRoute } from '../../app/routes';
import { AuthProvider } from '../identity/AuthProvider';
import { RequireAuth } from '../identity/RequireAuth';
import { RequireCashier } from '../tablet-kiosk/RequireCashier';
import { SettingsServiceProvider } from '../settings/SettingsProvider';
import type { Settings } from '../settings/types';
import { createTestCardReader, type TestCardReader } from '../../test/fakeCardReader';
import { createFakeAuthService } from '../../test/fakeAuthService';
import { createFakeSettingsService, defaultSettings } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import type { CardRead } from './cardReader';
import { CardReaderProvider } from './CardReaderProvider';
import { useCardRead } from './useCardRead';

// SPEC-card-input, point 2; success criteria 5, 6 and 7. Invented uids only.

const UID = '04A1B2C3D4E5F6';
/** UID as a USB reader in `dec` format types it. */
const UID_DEC = '1303689068602870';

/** A USB reader: a fast burst of keys closed by Enter. Returns whether Enter was let through. */
function usbBurst(text: string): boolean {
  for (const key of text) fireEvent.keyDown(document.body, { key });
  return fireEvent.keyDown(document.body, { key: 'Enter' });
}

/** A screen that reads cards, with a sheet that reads too and opens above it on a tap. */
function FakePage({ onRead }: { onRead: (name: string, read: CardRead) => void }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  useCardRead((read) => onRead('page', read));
  return (
    <main>
      <button type="button" onClick={() => setSheetOpen(true)}>
        Apri
      </button>
      {sheetOpen && <Sheet onRead={onRead} />}
    </main>
  );
}

function Sheet({ onRead }: { onRead: (name: string, read: CardRead) => void }) {
  useCardRead((read) => onRead('sheet', read));
  return <p>Foglio aperto</p>;
}

/** The app's providers around RequireAuth and RequireCashier with one fake page behind them. */
function renderFakePage(
  page: ReactNode,
  {
    settings = createFakeSettingsService(),
    card = createTestCardReader(),
  }: { settings?: ReturnType<typeof createFakeSettingsService>; card?: TestCardReader } = {},
) {
  const auth = createFakeAuthService({ userId: 'user-1' });
  const router = createMemoryRouter(
    [
      {
        ...rootRoute,
        children: [
          {
            Component: RequireAuth,
            children: [{ Component: RequireCashier, children: [{ index: true, element: page }] }],
          },
        ],
      },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <AuthProvider service={auth.service}>
      <SettingsServiceProvider service={settings.service}>
        <CardReaderProvider reader={card.reader}>
          <RouterProvider router={router} />
        </CardReaderProvider>
      </SettingsServiceProvider>
    </AuthProvider>,
  );
  return { settings, card };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('CardReaderSession', () => {
  it('reads nothing on the sign-in page (criterion 7)', async () => {
    const card = createTestCardReader();
    const fake = createFakeAuthService();
    renderApp('/accedi', fake, undefined, undefined, undefined, card);
    await screen.findByRole('button', { name: 'Accedi' });

    expect(card.activate).not.toHaveBeenCalled();
    expect(card.nfc.scanCount()).toBe(0);
    expect(usbBurst(UID)).toBe(true);
  });

  it('stops reading after "Esci" (criterion 7)', async () => {
    const card = createTestCardReader();
    const { router } = renderApp(
      '/impostazioni',
      signedInFake(),
      undefined,
      undefined,
      undefined,
      card,
    );
    await waitFor(() => expect(card.nfc.activeScans()).toBe(1));
    await waitFor(() => expect(card.reader.getState().usb.enabled).toBe(true));

    await userEvent.click(await screen.findByRole('button', { name: 'Esci' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));

    expect(card.deactivate).toHaveBeenCalled();
    expect(card.nfc.abortedCount()).toBeGreaterThanOrEqual(1);
    expect(card.nfc.activeScans()).toBe(0);
    expect(card.reader.getState().usb.enabled).toBe(false);
    expect(usbBurst(UID)).toBe(true);
  });

  it('gives a USB read in the saved format only to the consumer on top (criteria 5 and 6)', async () => {
    const onRead = vi.fn<(name: string, read: CardRead) => void>();
    const settings = createFakeSettingsService({
      settings: { ...defaultSettings, usbUidFormat: 'dec' },
    });
    const { card } = renderFakePage(<FakePage onRead={onRead} />, { settings });
    await waitFor(() => expect(card.reader.getState().usb.format).toBe('dec'));

    await userEvent.click(screen.getByRole('button', { name: 'Apri' }));
    await screen.findByText('Foglio aperto');
    let enterLetThrough = true;
    act(() => {
      enterLetThrough = usbBurst(UID_DEC);
    });

    expect(enterLetThrough).toBe(false);
    expect(onRead).toHaveBeenCalledOnce();
    expect(onRead).toHaveBeenCalledWith(
      'sheet',
      expect.objectContaining({ uid: UID, source: 'usb' }),
    );
  });

  it('keeps the USB reader off while the settings load, and turns it on when they arrive', async () => {
    const settings = createFakeSettingsService();
    const pending = deferred<Settings>();
    settings.service.load.mockImplementationOnce(() => pending.promise);
    const onRead = vi.fn<(name: string, read: CardRead) => void>();
    const { card } = renderFakePage(<FakePage onRead={onRead} />, { settings });
    await waitFor(() => expect(card.activate).toHaveBeenCalled());

    expect(card.reader.getState().usb).toMatchObject({ enabled: false, format: null });
    act(() => {
      usbBurst(UID);
    });
    expect(onRead).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve(defaultSettings);
      await pending.promise;
    });
    await waitFor(() =>
      expect(card.reader.getState().usb).toMatchObject({ enabled: true, format: 'hex' }),
    );
    act(() => {
      usbBurst(UID);
    });
    expect(onRead).toHaveBeenCalledWith('page', expect.objectContaining({ uid: UID }));
  });

  it('keeps the USB reader off when the settings fail to load, and turns it on when they arrive', async () => {
    const settings = createFakeSettingsService({ loadResults: ['network', 'ok'] });
    const { card } = renderFakePage(
      <FakePage onRead={vi.fn<(name: string, read: CardRead) => void>()} />,
      { settings },
    );
    await waitFor(() => expect(settings.service.load).toHaveBeenCalledOnce());
    await waitFor(() => expect(card.activate).toHaveBeenCalled());
    // Let the failed load settle into the error state.
    await act(async () => {
      await Promise.resolve();
    });
    expect(card.reader.getState().usb.enabled).toBe(false);

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() =>
      expect(card.reader.getState().usb).toMatchObject({ enabled: true, format: 'hex' }),
    );
  });
});
