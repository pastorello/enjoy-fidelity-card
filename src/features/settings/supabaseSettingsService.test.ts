import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseSettingsService } from './supabaseSettingsService';
import { SettingsLoadError } from './types';

type Answer = { data: unknown; error: unknown; status: number };

const db = vi.hoisted(() => ({
  schema: vi.fn<(name: string) => unknown>(),
  from: vi.fn<(table: string) => unknown>(),
  select: vi.fn<(columns: string) => unknown>(),
  maybeSingle: vi.fn<() => Promise<unknown>>(),
  rpc: vi.fn<(fn: string, args: unknown) => Promise<unknown>>(),
}));
vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({ schema: db.schema }),
}));

const row = {
  cents_per_point: 200,
  confirm_threshold_cents: 20000,
  usb_uid_format: 'dec-reversed',
  updated_at: '2026-11-17T10:00:00+00:00',
};
const settings = {
  centsPerPoint: 200,
  confirmThresholdCents: 20000,
  usbUidFormat: 'dec-reversed',
  updatedAt: '2026-11-17T10:00:00+00:00',
};

/** A Postgres error as PostgREST returns it. */
const pgError = (code: string, status: number): Answer => ({
  data: null,
  error: { code, message: 'error', details: null, hint: null },
  status,
});

/** What supabase-js returns when the request never got an answer (failed fetch). */
const noResponse: Answer = {
  data: null,
  error: { code: '', message: 'TypeError: Failed to fetch', details: '', hint: '' },
  status: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  db.schema.mockReturnValue({ from: db.from, rpc: db.rpc });
  db.from.mockReturnValue({ select: db.select });
  db.select.mockReturnValue({ maybeSingle: db.maybeSingle });
});

async function loadError(): Promise<SettingsLoadError> {
  const error: unknown = await supabaseSettingsService.load().then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof SettingsLoadError)) throw new Error('expected a SettingsLoadError');
  return error;
}

describe('load', () => {
  it('reads the single row of app.settings and maps it to Settings', async () => {
    db.maybeSingle.mockResolvedValue({ data: row, error: null, status: 200 });
    await expect(supabaseSettingsService.load()).resolves.toEqual(settings);
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.from).toHaveBeenCalledWith('settings');
    expect(db.select).toHaveBeenCalledWith(
      'cents_per_point, confirm_threshold_cents, usb_uid_format, updated_at',
    );
  });

  it('no visible row (no active profile) is not-found, not a network error', async () => {
    db.maybeSingle.mockResolvedValue({ data: null, error: null, status: 200 });
    expect((await loadError()).kind).toBe('not-found');
  });

  it('failed fetch is network', async () => {
    db.maybeSingle.mockResolvedValue(noResponse);
    expect((await loadError()).kind).toBe('network');
  });

  it('a throwing call is network', async () => {
    db.maybeSingle.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await loadError()).kind).toBe('network');
  });

  it.each([
    ['42501', 403],
    ['PGRST301', 401],
    ['PGRST116', 406],
    ['XX000', 500],
  ])('any other error (%s, HTTP %i) is unknown', async (code, status) => {
    db.maybeSingle.mockResolvedValue(pgError(code, status));
    expect((await loadError()).kind).toBe('unknown');
  });

  it.each([
    { ...row, cents_per_point: '200' },
    { ...row, confirm_threshold_cents: null },
    { ...row, usb_uid_format: 'binary' },
    { ...row, updated_at: 5 },
  ])('a row of unexpected shape is unknown (%o)', async (bad) => {
    db.maybeSingle.mockResolvedValue({ data: bad, error: null, status: 200 });
    expect((await loadError()).kind).toBe('unknown');
  });
});

describe('update', () => {
  const input = { centsPerPoint: 200, confirmThresholdCents: 20000 };

  it('calls app.update_settings with both values and no USB format, and maps the row', async () => {
    db.rpc.mockResolvedValue({ data: row, error: null, status: 200 });
    await expect(supabaseSettingsService.update(input)).resolves.toEqual({
      status: 'ok',
      settings,
    });
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.rpc).toHaveBeenCalledWith('update_settings', {
      p_cents_per_point: 200,
      p_confirm_threshold_cents: 20000,
    });
  });

  it('sends the USB reader format only when it is given (tablet-kiosk, LETTORE CARD)', async () => {
    db.rpc.mockResolvedValue({ data: row, error: null, status: 200 });
    await expect(
      supabaseSettingsService.update({ ...input, usbUidFormat: 'dec-reversed' }),
    ).resolves.toEqual({ status: 'ok', settings });
    expect(db.rpc).toHaveBeenCalledWith('update_settings', {
      p_cents_per_point: 200,
      p_confirm_threshold_cents: 20000,
      p_usb_uid_format: 'dec-reversed',
    });
  });

  it('42501 (not an admin) is forbidden', async () => {
    db.rpc.mockResolvedValue(pgError('42501', 403));
    await expect(supabaseSettingsService.update(input)).resolves.toEqual({ status: 'forbidden' });
  });

  it.each(['permission denied for schema app', 'permission denied for function update_settings'])(
    '42501 from a missing grant (%s) is unknown, not forbidden',
    async (message) => {
      db.rpc.mockResolvedValue({
        data: null,
        error: { code: '42501', message, details: null, hint: null },
        status: 403,
      });
      await expect(supabaseSettingsService.update(input)).resolves.toEqual({ status: 'unknown' });
    },
  );

  it('22023 (out of range) is invalid', async () => {
    db.rpc.mockResolvedValue(pgError('22023', 400));
    await expect(supabaseSettingsService.update(input)).resolves.toEqual({ status: 'invalid' });
  });

  it('failed fetch is network', async () => {
    db.rpc.mockResolvedValue(noResponse);
    await expect(supabaseSettingsService.update(input)).resolves.toEqual({ status: 'network' });
  });

  it('a throwing call is network', async () => {
    db.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(supabaseSettingsService.update(input)).resolves.toEqual({ status: 'network' });
  });

  it.each([
    ['PGRST301', 401],
    ['23514', 400],
    ['XX000', 500],
    ['', 503],
  ])('any other error (%s, HTTP %i) is unknown', async (code, status) => {
    db.rpc.mockResolvedValue(pgError(code, status));
    await expect(supabaseSettingsService.update(input)).resolves.toEqual({ status: 'unknown' });
  });

  it('a saved row of unexpected shape is unknown', async () => {
    db.rpc.mockResolvedValue({
      data: { ...row, cents_per_point: null },
      error: null,
      status: 200,
    });
    await expect(supabaseSettingsService.update(input)).resolves.toEqual({ status: 'unknown' });
  });
});
