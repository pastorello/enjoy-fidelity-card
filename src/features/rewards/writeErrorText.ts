import { loadErrorText } from '../customers/loadErrorText';
import { ServerFaultError } from '../../lib/serverFault';
import type { RewardWriteError } from './types';

const NETWORK = 'Premio non salvato: controlla la connessione e riprova.';
const RETRY = 'Premio non salvato: riprova.';

const TEXTS: Record<RewardWriteError, string> = {
  network: NETWORK,
  'not-found': RETRY,
  unknown: RETRY,
  // The app validates first: a refused value is unexpected here, so it is worded as unknown.
  invalid: RETRY,
  'name-taken': 'Esiste già un premio con questo nome',
  forbidden: 'Solo per gli amministratori',
};

/**
 * What a failed write of the catalogue says (docs/specs/SPEC-rewards.md §4): a refusal of the
 * server by its code, a server fault in its own words, any other rejection as unknown.
 */
export function writeErrorText(error: unknown): string {
  if (error instanceof ServerFaultError) return loadErrorText(error);
  if (isWriteError(error)) return TEXTS[error];
  return RETRY;
}

function isWriteError(error: unknown): error is RewardWriteError {
  return typeof error === 'string' && Object.hasOwn(TEXTS, error);
}
