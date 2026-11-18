import { ServerFaultError } from '../../lib/serverFault';

/** Why data could not be loaded: a server fault is not a connection problem (same words as sign-in). */
export function loadErrorText(error: unknown): string {
  if (error instanceof ServerFaultError) {
    return error.kind === 'misconfigured'
      ? 'Servizio non configurato: chiedi a un amministratore.'
      : 'Servizio momentaneamente non disponibile: riprova tra poco.';
  }
  return 'Controlla la connessione e riprova.';
}
