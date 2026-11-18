import { describe, expect, it } from 'vitest';
import { serverFaultFor, ServerFaultError } from './serverFault';

const error = (code: string, message = 'error') => ({ code, message });

describe('serverFaultFor', () => {
  it('schema app not exposed in the Data API is misconfigured', () => {
    expect(serverFaultFor(error('PGRST106', 'Invalid schema: app'), 406)).toBe('misconfigured');
  });

  it.each([
    'permission denied for schema app',
    'permission denied for table operators',
    'permission denied for function update_settings',
  ])('a missing grant is misconfigured (%s)', (message) => {
    expect(serverFaultFor(error('42501', message), 403)).toBe('misconfigured');
  });

  it.each(['PGRST205', 'PGRST202'])(
    'a table or function missing from the schema cache is misconfigured (%s)',
    (code) => {
      expect(serverFaultFor(error(code), 404)).toBe('misconfigured');
    },
  );

  it('a refusal raised by the app (42501 without schema) is not a server fault', () => {
    expect(serverFaultFor(error('42501', 'Only an admin can change the settings'), 403)).toBeNull();
  });

  it('the Data API reloading its schema cache is unavailable', () => {
    expect(serverFaultFor(error('PGRST002'), 503)).toBe('unavailable');
  });

  it('any 503 is unavailable', () => {
    expect(serverFaultFor(error(''), 503)).toBe('unavailable');
  });

  it.each([
    [null, 200],
    [error('', 'TypeError: Failed to fetch'), 0],
    [error('PGRST116'), 406],
    [error('XX000'), 500],
  ])('anything else is not a server fault (%o, HTTP %i)', (answerError, status) => {
    expect(serverFaultFor(answerError, status)).toBeNull();
  });
});

describe('ServerFaultError', () => {
  it('carries its kind', () => {
    const fault = new ServerFaultError('misconfigured');
    expect(fault).toBeInstanceOf(Error);
    expect(fault.kind).toBe('misconfigured');
  });
});
