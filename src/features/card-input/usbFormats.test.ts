import { describe, expect, it } from 'vitest';
import { USB_UID_FORMATS } from './normalizeUid';
import sql from '../../../supabase/migrations/20261117230100_settings.sql?raw';
import { USB_UID_FORMATS as SETTINGS_USB_UID_FORMATS } from '../settings/types';

// SPEC-card-input, "Testing": the values allowed by app.settings.usb_uid_format are exactly
// USB_UID_FORMATS. A format added on one side only breaks this test.

const MIGRATION = 'supabase/migrations/20261117230100_settings.sql';

function quotedList(list: string): string[] {
  return [...list.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
}

describe('USB uid formats', () => {
  it('match the CHECK on app.settings.usb_uid_format', () => {
    const check = /check\s*\(\s*usb_uid_format\s+in\s*\(([^)]*)\)\s*\)/i.exec(sql);
    expect(check, `CHECK on usb_uid_format not found in ${MIGRATION}`).not.toBeNull();
    expect(quotedList(check?.[1] ?? '')).toEqual([...USB_UID_FORMATS]);
  });

  it('match the values app.update_settings accepts', () => {
    const guard = /p_usb_uid_format\s+not\s+in\s*\(([^)]*)\)/i.exec(sql);
    expect(guard, `update_settings guard not found in ${MIGRATION}`).not.toBeNull();
    expect(quotedList(guard?.[1] ?? '')).toEqual([...USB_UID_FORMATS]);
  });

  it('are the same list that settings re-exports', () => {
    expect(SETTINGS_USB_UID_FORMATS).toBe(USB_UID_FORMATS);
  });
});
