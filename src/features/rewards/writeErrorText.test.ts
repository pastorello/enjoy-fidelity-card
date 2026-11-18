import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { writeErrorText } from './writeErrorText';

describe('writeErrorText', () => {
  it.each([
    ['network', 'Premio non salvato: controlla la connessione e riprova.'],
    ['not-found', 'Premio non salvato: riprova.'],
    ['unknown', 'Premio non salvato: riprova.'],
    ['invalid', 'Premio non salvato: riprova.'],
    ['forbidden', 'Solo per gli amministratori'],
    ['name-taken', 'Esiste già un premio con questo nome'],
  ] as const)('%s → %s', (error, text) => {
    expect(writeErrorText(error)).toBe(text);
  });

  it.each([
    ['misconfigured', 'Servizio non configurato: chiedi a un amministratore.'],
    ['unavailable', 'Servizio momentaneamente non disponibile: riprova tra poco.'],
  ] as const)('a %s server fault keeps its own words', (kind, text) => {
    expect(writeErrorText(new ServerFaultError(kind))).toBe(text);
  });

  it('any other rejection is an unknown error', () => {
    expect(writeErrorText(new Error('boom'))).toBe('Premio non salvato: riprova.');
    expect(writeErrorText('toString')).toBe('Premio non salvato: riprova.');
  });
});
