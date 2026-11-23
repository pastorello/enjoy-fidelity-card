import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import {
  CardActiveError,
  CardForbiddenError,
  CardNotFoundError,
  CardsError,
  NetworkError,
  NotOperatorError,
} from './types';
import { isReleaseRetryable, reformattedNotice } from './useReformatCard';

// SPEC-customers-v2, point 4, «Riformatta» 4, 6 and 7. The flow itself is tested on the page
// (InactiveCardPage.test.tsx), with the fake writer and service.

describe('reformattedNotice', () => {
  it('names the card by its last four characters, never by its whole uid', () => {
    expect(reformattedNotice('04A1B2C3D4E5F6')).toBe('Card …E5F6 riformattata: ora è libera.');
  });
});

describe('isReleaseRetryable', () => {
  it.each([
    ['no answer', new NetworkError()],
    ['a server fault', new ServerFaultError('unavailable')],
    ['an unexpected code', new CardsError('unknown')],
    ['anything else', new Error('boom')],
  ])('%s: the same operation_id is sent again', (_label, error) => {
    expect(isReleaseRetryable(error)).toBe(true);
  });

  it.each([
    ['card_active', new CardActiveError()],
    ['forbidden', new CardForbiddenError()],
    ['card_not_found', new CardNotFoundError()],
    ['not_operator', new NotOperatorError()],
  ])('%s: a refusal that sending again would not change', (_label, error) => {
    expect(isReleaseRetryable(error)).toBe(false);
  });
});
