import { describe, expect, it } from 'vitest';
import { INVITE_EMAIL_MAX, INVITE_NAME_MAX, validateInvite } from './validateInvite';

// SPEC-operators point 3: the checks `app.operator_invite_begin` makes too, done in the app first.

const VALID = { name: 'Marco Prova', email: 'marco@esempio.it', role: 'operator' } as const;

describe('validateInvite', () => {
  it('accepts a name, an email and a role, cleaning the name like private.clean_name', () => {
    expect(
      validateInvite({
        ...VALID,
        name: '\u00a0 Marco \u202f\t Prova  ',
        email: ' marco@esempio.it ',
      }),
    ).toEqual({
      ok: true,
      invite: { name: 'Marco Prova', email: 'marco@esempio.it', role: 'operator' },
    });
    expect(validateInvite({ ...VALID, role: 'admin' })).toEqual({
      ok: true,
      invite: { ...VALID, role: 'admin' },
    });
  });

  it('asks for the name when it is empty or only spaces', () => {
    expect(validateInvite({ ...VALID, name: '' })).toEqual({
      ok: false,
      errors: { name: 'Inserisci il nome' },
    });
    expect(validateInvite({ ...VALID, name: ' \u00a0 ' })).toEqual({
      ok: false,
      errors: { name: 'Inserisci il nome' },
    });
  });

  it('refuses a name over 60 characters, counted as Postgres does', () => {
    expect(INVITE_NAME_MAX).toBe(60);
    expect(validateInvite({ ...VALID, name: 'a'.repeat(60) }).ok).toBe(true);
    // 60 characters of two UTF-16 units each are still 60 characters.
    expect(validateInvite({ ...VALID, name: '😀'.repeat(60) }).ok).toBe(true);
    expect(validateInvite({ ...VALID, name: 'a'.repeat(61) })).toEqual({
      ok: false,
      errors: { name: 'Al massimo 60 caratteri' },
    });
    // Spaces collapsed first: 60 characters once cleaned.
    expect(
      validateInvite({ ...VALID, name: `  ${'a'.repeat(30)}    ${'b'.repeat(29)}  ` }).ok,
    ).toBe(true);
  });

  it('asks for the email when it is empty or only spaces', () => {
    expect(validateInvite({ ...VALID, email: '  ' })).toEqual({
      ok: false,
      errors: { email: 'Inserisci l’email' },
    });
  });

  it('refuses an email without the shape x@y.z', () => {
    for (const email of [
      'marco',
      'marco@esempio',
      '@esempio.it',
      'marco@.it',
      'ma rco@esempio.it',
      'marco@@esempio.it',
      'marco@esempio.',
    ]) {
      expect({ email, result: validateInvite({ ...VALID, email }) }).toEqual({
        email,
        result: { ok: false, errors: { email: 'Email non valida' } },
      });
    }
  });

  it('refuses an email over 254 characters', () => {
    expect(INVITE_EMAIL_MAX).toBe(254);
    const local = 'a'.repeat(254 - '@esempio.it'.length);
    expect(validateInvite({ ...VALID, email: `${local}@esempio.it` }).ok).toBe(true);
    expect(validateInvite({ ...VALID, email: `a${local}@esempio.it` })).toEqual({
      ok: false,
      errors: { email: 'Email non valida' },
    });
  });

  it('reports both fields at once', () => {
    expect(validateInvite({ name: '', email: '', role: 'operator' })).toEqual({
      ok: false,
      errors: { name: 'Inserisci il nome', email: 'Inserisci l’email' },
    });
  });
});
