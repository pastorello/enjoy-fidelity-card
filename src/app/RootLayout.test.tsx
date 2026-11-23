import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, signedInFake } from '../test/renderApp';

const INVITE_SEARCH = '?token_hash=abc&type=invite';
const INVITE_HASH = '#nome=Marco&da=Andrea&ruolo=operatore';

describe('RootLayout: fallback invite link on site_url', () => {
  it('forwards /?token_hash=…&type=invite to /imposta-password keeping query and fragment', async () => {
    const { router } = renderApp(`/${INVITE_SEARCH}${INVITE_HASH}`);
    await waitFor(() => expect(router.state.location.pathname).toBe('/imposta-password'));
    expect(router.state.location.search).toBe(INVITE_SEARCH);
    expect(router.state.location.hash).toBe(INVITE_HASH);
    expect(router.state.historyAction).toBe('REPLACE');
    // The texts of the fragment reach the invite page.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ciao, Marco' }),
    ).toBeInTheDocument();
  });

  it('forwards an invite without a fragment to the generic invite page', async () => {
    const { router } = renderApp(`/${INVITE_SEARCH}`);
    await waitFor(() => expect(router.state.location.pathname).toBe('/imposta-password'));
    expect(router.state.location.hash).toBe('');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Scegli la password' }),
    ).toBeInTheDocument();
  });

  it('forwards also when signed in, without consuming the token', async () => {
    const fake = signedInFake();
    const { router } = renderApp(`/${INVITE_SEARCH}${INVITE_HASH}`, fake);
    await waitFor(() => expect(router.state.location.pathname).toBe('/imposta-password'));
    expect(router.state.location.hash).toBe(INVITE_HASH);
    expect(fake.service.verifyInvite).not.toHaveBeenCalled();
  });

  it.each([
    ['no token_hash', '/?type=invite#nome=Marco'],
    ['another type', '/?token_hash=abc&type=magiclink#nome=Marco'],
  ])('does not forward with %s', async (_label, path) => {
    const { router } = renderApp(path);
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });

  it('does not forward an invite from other paths', async () => {
    const { router } = renderApp(`/impostazioni${INVITE_SEARCH}${INVITE_HASH}`);
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
  });
});
