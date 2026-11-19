import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeSettingsService, defaultSettings } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { createFakeAuthService } from '../../test/fakeAuthService';
import type { Settings, UpdateSettingsResult } from './types';
import { SettingsProvider, SettingsServiceProvider, useSettings } from './SettingsProvider';

type Fake = ReturnType<typeof createFakeSettingsService>;

function Probe() {
  const settings = useSettings();
  const text =
    settings.status === 'ready'
      ? `ready:${settings.settings.centsPerPoint}/${settings.settings.confirmThresholdCents}`
      : settings.status;
  return <p data-testid="settings">{text}</p>;
}

function renderWith(fake: Fake) {
  const captured: { value?: ReturnType<typeof useSettings> } = {};
  function Capture() {
    const value = useSettings();
    useEffect(() => {
      captured.value = value;
    });
    return null;
  }
  render(
    <SettingsServiceProvider service={fake.service}>
      <SettingsProvider>
        <Probe />
        <Capture />
      </SettingsProvider>
    </SettingsServiceProvider>,
  );
  return () => {
    if (!captured.value) throw new Error('useSettings not rendered');
    return captured.value;
  };
}

/** Uses the hook without any provider around it. */
function Bare() {
  useSettings();
  return null;
}

const shown = () => screen.getByTestId('settings');

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  setVisibility('visible');
});

describe('SettingsProvider', () => {
  it('starts loading, then ready with the stored values', async () => {
    const fake = createFakeSettingsService();
    renderWith(fake);

    expect(shown()).toHaveTextContent('loading');
    await waitFor(() => expect(shown()).toHaveTextContent('ready:100/15000'));
    expect(fake.service.load).toHaveBeenCalledOnce();
  });

  it('shows the error state when loading fails, and retry loads again', async () => {
    const fake = createFakeSettingsService({ loadResults: ['network', 'ok'] });
    const settings = renderWith(fake);

    await waitFor(() => expect(shown()).toHaveTextContent('error'));
    const current = settings();
    if (current.status !== 'error') throw new Error('expected the error state');

    act(() => current.retry());

    await waitFor(() => expect(shown()).toHaveTextContent('ready:100/15000'));
    expect(fake.service.load).toHaveBeenCalledTimes(2);
  });

  it('keeps the error state when no row is visible (not-found)', async () => {
    const fake = createFakeSettingsService({ loadResults: ['not-found'] });
    renderWith(fake);

    await waitFor(() => expect(shown()).toHaveTextContent('error'));
    expect(fake.service.load).toHaveBeenCalledOnce();
  });

  it('saves through the service, shows the saved values and reloads', async () => {
    const fake = createFakeSettingsService();
    const settings = renderWith(fake);
    await waitFor(() => expect(shown()).toHaveTextContent('ready:100/15000'));

    let result: UpdateSettingsResult | undefined;
    await act(async () => {
      result = await settings().save({ centsPerPoint: 200, confirmThresholdCents: 20000 });
    });

    expect(fake.service.update).toHaveBeenCalledExactlyOnceWith({
      centsPerPoint: 200,
      confirmThresholdCents: 20000,
    });
    expect(result?.status).toBe('ok');
    expect(shown()).toHaveTextContent('ready:200/20000');
    await waitFor(() => expect(fake.service.load).toHaveBeenCalledTimes(2));
    expect(shown()).toHaveTextContent('ready:200/20000');
  });

  it('returns a failed save as it is, without changing the values or reloading', async () => {
    const fake = createFakeSettingsService({ updateResults: ['network'] });
    const settings = renderWith(fake);
    await waitFor(() => expect(shown()).toHaveTextContent('ready:100/15000'));

    let result: UpdateSettingsResult | undefined;
    await act(async () => {
      result = await settings().save({ centsPerPoint: 200, confirmThresholdCents: 20000 });
    });

    expect(result).toEqual({ status: 'network' });
    expect(shown()).toHaveTextContent('ready:100/15000');
    expect(fake.service.load).toHaveBeenCalledOnce();
  });

  it('saveUsbFormat reads ratio and threshold again from the server and sends them with the format', async () => {
    const fake = createFakeSettingsService();
    const settings = renderWith(fake);
    await waitFor(() => expect(shown()).toHaveTextContent('ready:100/15000'));
    // Another administrator changed the ratio after this page loaded.
    fake.changeElsewhere({ centsPerPoint: 250 });

    let result: UpdateSettingsResult | undefined;
    await act(async () => {
      result = await settings().saveUsbFormat('dec');
    });

    expect(fake.service.update).toHaveBeenCalledExactlyOnceWith({
      centsPerPoint: 250,
      confirmThresholdCents: 15000,
      usbUidFormat: 'dec',
    });
    expect(result).toMatchObject({ status: 'ok', settings: { usbUidFormat: 'dec' } });
    expect(fake.current()).toMatchObject({ centsPerPoint: 250, usbUidFormat: 'dec' });
    expect(shown()).toHaveTextContent('ready:250/15000');
  });

  it.each([
    ['network', 'network'],
    ['unknown', 'unknown'],
    ['not-found', 'forbidden'],
  ] as const)(
    'saveUsbFormat sends nothing when the fresh read fails (%s → %s)',
    async (loadFailure, status) => {
      const fake = createFakeSettingsService({ loadResults: ['ok', loadFailure] });
      const settings = renderWith(fake);
      await waitFor(() => expect(shown()).toHaveTextContent('ready:100/15000'));

      let result: UpdateSettingsResult | undefined;
      await act(async () => {
        result = await settings().saveUsbFormat('dec');
      });

      expect(result).toEqual({ status });
      expect(fake.service.update).not.toHaveBeenCalled();
      expect(fake.current().usbUidFormat).toBe('hex');
    },
  );

  it('reloads when the page becomes visible again, not when it is hidden', async () => {
    const fake = createFakeSettingsService();
    renderWith(fake);
    await waitFor(() => expect(shown()).toHaveTextContent('ready:100/15000'));

    fake.changeElsewhere({ centsPerPoint: 250 });
    setVisibility('hidden');
    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(fake.service.load).toHaveBeenCalledOnce();

    setVisibility('visible');
    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });

    await waitFor(() => expect(shown()).toHaveTextContent('ready:250/15000'));
    expect(fake.service.load).toHaveBeenCalledTimes(2);
  });

  it('keeps the loaded values when a reload in the background fails', async () => {
    const fake = createFakeSettingsService({ loadResults: ['ok', 'network'] });
    renderWith(fake);
    await waitFor(() => expect(shown()).toHaveTextContent('ready:100/15000'));

    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });

    await waitFor(() => expect(fake.service.load).toHaveBeenCalledTimes(2));
    expect(shown()).toHaveTextContent('ready:100/15000');
  });

  it('ignores a reload that answers after a newer save', async () => {
    const fake = createFakeSettingsService();
    const settings = renderWith(fake);
    await waitFor(() => expect(shown()).toHaveTextContent('ready:100/15000'));

    const stale = deferred<Settings>();
    fake.service.load.mockReturnValueOnce(stale.promise);
    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });
    await act(async () => {
      await settings().save({ centsPerPoint: 200, confirmThresholdCents: 20000 });
    });
    await act(async () => {
      stale.resolve(defaultSettings);
      await stale.promise;
    });

    expect(shown()).toHaveTextContent('ready:200/20000');
  });

  it('throws when used outside the providers', () => {
    // React reports the error thrown while rendering; keep the test output clean.
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Bare />)).toThrow('useSettings must be used inside <SettingsProvider>');
    } finally {
      console.error = original;
    }
  });
});

describe('SettingsProvider inside RequireAuth', () => {
  it('does not load without a signed-in operator', async () => {
    const settings = createFakeSettingsService();
    const { router } = renderApp('/', createFakeAuthService(), settings);

    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(settings.service.load).not.toHaveBeenCalled();
  });

  it('loads once per session, not again on every page', async () => {
    const settings = createFakeSettingsService();
    const { router } = renderApp('/', signedInFake(), settings);
    await screen.findByRole('main');
    await waitFor(() => expect(settings.service.load).toHaveBeenCalledOnce());

    await act(async () => {
      await router.navigate('/impostazioni');
    });
    await act(async () => {
      await router.navigate('/');
    });

    expect(settings.service.load).toHaveBeenCalledOnce();
  });
});
