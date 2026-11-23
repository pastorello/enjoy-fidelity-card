import type { Role } from '../identity/types';

// Validation of the "Invita operatore" form, at the UI edge (SPEC-operators point 3). The limits
// and the email shape mirror the checks of the invite on the server, which repeats every one.

/** `length(name) between 1 and 60`, once cleaned. */
export const INVITE_NAME_MAX = 60;
/** `length(email) <= 254`, once trimmed. */
export const INVITE_EMAIL_MAX = 254;

/** The `x@y.z` shape of the server: `^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$`. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const MESSAGES = {
  nameRequired: 'Inserisci il nome',
  nameTooLong: 'Al massimo 60 caratteri',
  emailRequired: 'Inserisci l’email',
  emailInvalid: 'Email non valida',
} as const;

export type InviteFormValues = { name: string; email: string; role: Role };
export type InviteFormErrors = { name?: string; email?: string };
export type ValidateInviteResult =
  { ok: true; invite: InviteFormValues } | { ok: false; errors: InviteFormErrors };

/** `private.clean_name`: whitespace runs (Unicode spaces too) collapsed to one, then trimmed. */
export function cleanInviteName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Characters, as Postgres `length` counts them (not UTF-16 units). */
function characters(text: string): number {
  return Array.from(text).length;
}

/**
 * validateInvite({ name: ' Marco  B. ', email: ' marco@esempio.it ', role: 'operator' })
 * → { ok: true, invite: { name: 'Marco B.', email: 'marco@esempio.it', role: 'operator' } }.
 */
export function validateInvite(values: InviteFormValues): ValidateInviteResult {
  const errors: InviteFormErrors = {};
  const name = cleanInviteName(values.name);
  if (name === '') errors.name = MESSAGES.nameRequired;
  else if (characters(name) > INVITE_NAME_MAX) errors.name = MESSAGES.nameTooLong;

  const email = values.email.trim();
  if (email === '') errors.email = MESSAGES.emailRequired;
  else if (characters(email) > INVITE_EMAIL_MAX || !EMAIL.test(email)) {
    errors.email = MESSAGES.emailInvalid;
  }

  if (errors.name !== undefined || errors.email !== undefined) return { ok: false, errors };
  return { ok: true, invite: { name, email, role: values.role } };
}
