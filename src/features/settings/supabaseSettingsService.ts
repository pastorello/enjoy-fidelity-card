import { serverFaultFor } from '../../lib/serverFault';
import { getSupabase } from '../../lib/supabase';
import { SettingsLoadError, USB_UID_FORMATS } from './types';
import type { Settings, SettingsService, UpdateSettingsResult, UsbUidFormat } from './types';

// The only module that reads app.settings or calls app.update_settings (SPEC-settings, criterion 7).

const COLUMNS = 'cents_per_point, confirm_threshold_cents, usb_uid_format, updated_at';

/** The parts of a supabase-js answer this module looks at. */
type Answer = { data: unknown; error: { code?: string } | null; status: number };

/** supabase-js answers a failed fetch with status 0 instead of throwing. */
function isNoResponse(answer: Answer): boolean {
  return answer.error !== null && answer.status === 0;
}

function isUsbUidFormat(value: unknown): value is UsbUidFormat {
  return USB_UID_FORMATS.some((format) => format === value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Maps an `app.settings` row (snake_case) to `Settings`, or null when its shape is unexpected. */
function toSettings(data: unknown): Settings | null {
  if (typeof data !== 'object' || data === null) return null;
  const row: Record<string, unknown> = { ...data };
  const {
    cents_per_point: centsPerPoint,
    confirm_threshold_cents: confirmThresholdCents,
    usb_uid_format: usbUidFormat,
    updated_at: updatedAt,
  } = row;
  if (
    !isCount(centsPerPoint) ||
    !isCount(confirmThresholdCents) ||
    !isUsbUidFormat(usbUidFormat) ||
    typeof updatedAt !== 'string'
  ) {
    return null;
  }
  return { centsPerPoint, confirmThresholdCents, usbUidFormat, updatedAt };
}

function updateResultFor(answer: Answer): UpdateSettingsResult {
  if (isNoResponse(answer)) return { status: 'network' };
  // A misconfigured or unavailable server is not the user's fault: never 'forbidden'.
  if (serverFaultFor(answer.error, answer.status)) return { status: 'unknown' };
  if (answer.error) {
    // 42501: not (or no longer) an admin. 22023: a value outside the limits.
    if (answer.error.code === '42501') return { status: 'forbidden' };
    if (answer.error.code === '22023') return { status: 'invalid' };
    return { status: 'unknown' };
  }
  const settings = toSettings(answer.data);
  return settings ? { status: 'ok', settings } : { status: 'unknown' };
}

export const supabaseSettingsService: SettingsService = {
  async load() {
    let answer: Answer;
    try {
      answer = await getSupabase().schema('app').from('settings').select(COLUMNS).maybeSingle();
    } catch {
      throw new SettingsLoadError('network');
    }
    if (isNoResponse(answer)) throw new SettingsLoadError('network');
    if (answer.error) throw new SettingsLoadError('unknown');
    // Row-level security hides the row from anyone without an active operator profile.
    if (answer.data === null) throw new SettingsLoadError('not-found');
    const settings = toSettings(answer.data);
    if (!settings) throw new SettingsLoadError('unknown', 'Unexpected settings row shape');
    return settings;
  },

  async update({ centsPerPoint, confirmThresholdCents }) {
    try {
      // No p_usb_uid_format: the server keeps the reader format unchanged.
      const answer: Answer = await getSupabase().schema('app').rpc('update_settings', {
        p_cents_per_point: centsPerPoint,
        p_confirm_threshold_cents: confirmThresholdCents,
      });
      return updateResultFor(answer);
    } catch {
      return { status: 'network' };
    }
  },
};
