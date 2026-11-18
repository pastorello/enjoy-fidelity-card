import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_ERROR_CODES,
  customerErrorField,
  customerErrorText,
  isCustomerErrorCode,
} from './errorCodes';

describe('customer error codes', () => {
  it.each([
    ['name_required', 'Scrivi nome e cognome.'],
    ['name_too_long', 'Al massimo 80 caratteri.'],
    ['phone_invalid', 'Numero non valido: scrivi solo le cifre, con o senza prefisso.'],
    ['consent_required', 'Serve il consenso privacy per registrare il cliente.'],
    ['notes_too_long', 'Al massimo 500 caratteri.'],
    ['customer_name_taken', 'Esiste già un cliente con questo nome.'],
    ['customer_not_found', 'Cliente non trovato'],
    ['forbidden', 'Solo un amministratore può cancellare i dati di un cliente.'],
    ['not_operator', 'Account non abilitato: chiedi a un amministratore.'],
  ] as const)('%s reads "%s" (SPEC-customers)', (code, text) => {
    expect(customerErrorText(code)).toBe(text);
  });

  it('gives every code an Italian text', () => {
    for (const code of CUSTOMER_ERROR_CODES) expect(customerErrorText(code)).not.toBe('');
  });

  it.each([
    ['name_required', 'name'],
    ['name_too_long', 'name'],
    ['customer_name_taken', 'name'],
    ['phone_invalid', 'phone'],
    ['consent_required', 'consent'],
    ['notes_too_long', 'notes'],
    ['forbidden', null],
    ['not_operator', null],
    ['customer_not_found', null],
    ['customer_anonymized', null],
  ] as const)('%s belongs to field %s', (code, field) => {
    expect(customerErrorField(code)).toBe(field);
  });

  it('recognises only the listed codes', () => {
    expect(isCustomerErrorCode('customer_name_taken')).toBe(true);
    expect(isCustomerErrorCode('operation_id is required')).toBe(false);
    expect(isCustomerErrorCode('toString')).toBe(false);
  });
});
