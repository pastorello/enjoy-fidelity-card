import { cardLinkUrl, resolveCardLinkOrigin } from './cardLinkUrl';
import { checkCardLinkOriginForBuild, parseCardLinkOrigin } from './cardLinkOrigin';

const TOKEN = 'AbCdEfGhIjKlMnOpQr_-12'; // 22 base64url characters
const UID = '04A1B2C3D4E5F6';

describe('parseCardLinkOrigin', () => {
  it('accepts an https origin without path', () => {
    expect(parseCardLinkOrigin('https://enjoy-card.vercel.app')).toBe(
      'https://enjoy-card.vercel.app',
    );
  });

  it.each([
    ['a trailing slash', 'https://enjoy-card.vercel.app/'],
    ['a path', 'https://enjoy-card.vercel.app/app'],
    ['http', 'http://enjoy-card.vercel.app'],
    ['a query', 'https://enjoy-card.vercel.app?x=1'],
    ['a fragment', 'https://enjoy-card.vercel.app#x'],
    ['credentials', 'https://user:pw@enjoy-card.vercel.app'],
    ['not a URL', 'enjoy-card.vercel.app'],
    ['upper case or spaces', ' https://Enjoy-Card.vercel.app'],
  ])('rejects an origin with %s', (_case, value) => {
    expect(() => parseCardLinkOrigin(value)).toThrow(/VITE_CARD_LINK_ORIGIN/);
  });
});

describe('resolveCardLinkOrigin', () => {
  it('uses the configured origin when present', () => {
    expect(resolveCardLinkOrigin('https://enjoy-card.vercel.app', 'http://localhost:5173')).toBe(
      'https://enjoy-card.vercel.app',
    );
  });

  it('falls back to the page origin when the variable is empty or missing', () => {
    expect(resolveCardLinkOrigin(undefined, 'http://localhost:5173')).toBe('http://localhost:5173');
    expect(resolveCardLinkOrigin('', 'https://preview.vercel.app')).toBe(
      'https://preview.vercel.app',
    );
  });

  it('rejects an invalid configured origin instead of falling back', () => {
    expect(() => resolveCardLinkOrigin('http://enjoy-card.vercel.app', 'https://x.app')).toThrow(
      /VITE_CARD_LINK_ORIGIN/,
    );
    expect(() => resolveCardLinkOrigin('https://enjoy-card.vercel.app/', 'https://x.app')).toThrow(
      /VITE_CARD_LINK_ORIGIN/,
    );
  });
});

describe('cardLinkUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the link from VITE_CARD_LINK_ORIGIN', () => {
    vi.stubEnv('VITE_CARD_LINK_ORIGIN', 'https://enjoy-card.vercel.app');
    expect(cardLinkUrl(TOKEN)).toBe(`https://enjoy-card.vercel.app/s/${TOKEN}`);
  });

  it('builds the link from location.origin when the variable is missing', () => {
    vi.stubEnv('VITE_CARD_LINK_ORIGIN', '');
    expect(cardLinkUrl(TOKEN)).toBe(`${window.location.origin}/s/${TOKEN}`);
  });

  it('refuses a configured origin with a path, a trailing slash or http', () => {
    for (const origin of [
      'https://enjoy-card.vercel.app/app',
      'https://enjoy-card.vercel.app/',
      'http://enjoy-card.vercel.app',
    ]) {
      vi.stubEnv('VITE_CARD_LINK_ORIGIN', origin);
      expect(() => cardLinkUrl(TOKEN)).toThrow(/VITE_CARD_LINK_ORIGIN/);
    }
  });

  it('accepts only a 22-character base64url token, so the uid never ends up in the URL', () => {
    vi.stubEnv('VITE_CARD_LINK_ORIGIN', 'https://enjoy-card.vercel.app');
    expect(() => cardLinkUrl(UID)).toThrow(RangeError);
    expect(() => cardLinkUrl(`${TOKEN}=`)).toThrow(RangeError);
    expect(() => cardLinkUrl('AbCdEfGhIjKlMnOpQr/+12')).toThrow(RangeError);
    const url = cardLinkUrl(TOKEN);
    expect(url).not.toContain(UID);
    expect(new URL(url).pathname).toBe(`/s/${TOKEN}`);
  });
});

describe('checkCardLinkOriginForBuild', () => {
  it('fails in production without the variable', () => {
    expect(() => checkCardLinkOriginForBuild({ VERCEL_ENV: 'production' })).toThrow(
      /VITE_CARD_LINK_ORIGIN/,
    );
    expect(() =>
      checkCardLinkOriginForBuild({ VERCEL_ENV: 'production', VITE_CARD_LINK_ORIGIN: '  ' }),
    ).toThrow(/VITE_CARD_LINK_ORIGIN/);
  });

  it('fails in production with an http or malformed origin', () => {
    expect(() =>
      checkCardLinkOriginForBuild({
        VERCEL_ENV: 'production',
        VITE_CARD_LINK_ORIGIN: 'http://enjoy-card.vercel.app',
      }),
    ).toThrow(/VITE_CARD_LINK_ORIGIN/);
    expect(() =>
      checkCardLinkOriginForBuild({
        VERCEL_ENV: 'production',
        VITE_CARD_LINK_ORIGIN: 'https://enjoy-card.vercel.app/',
      }),
    ).toThrow(/VITE_CARD_LINK_ORIGIN/);
  });

  it('passes in production with an https origin', () => {
    expect(() =>
      checkCardLinkOriginForBuild({
        VERCEL_ENV: 'production',
        VITE_CARD_LINK_ORIGIN: 'https://enjoy-card.vercel.app',
      }),
    ).not.toThrow();
  });

  it('passes in previews and locally without the variable', () => {
    expect(() => checkCardLinkOriginForBuild({ VERCEL_ENV: 'preview' })).not.toThrow();
    expect(() => checkCardLinkOriginForBuild({ VERCEL_ENV: 'development' })).not.toThrow();
    expect(() => checkCardLinkOriginForBuild({})).not.toThrow();
  });

  it('still rejects a malformed origin set outside production', () => {
    expect(() =>
      checkCardLinkOriginForBuild({ VITE_CARD_LINK_ORIGIN: 'http://enjoy-card.vercel.app' }),
    ).toThrow(/VITE_CARD_LINK_ORIGIN/);
  });
});
