import { useCallback, useEffect, useRef, useState } from 'react';
import { useCustomerService } from './CustomerServiceProvider';
import type { CustomerSummary } from './types';
import { useNotOperator } from './useNotOperator';

/** The customer ids are UUIDs: anything else is not looked up (SPEC-customers point 6). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCustomerId(id: string): boolean {
  return UUID.test(id);
}

export type CustomerState =
  | { status: 'loading' }
  | { status: 'done'; customer: CustomerSummary }
  /** No customer with that id, or an id that is not a UUID (then the service is not called). */
  | { status: 'not-found' }
  | { status: 'error'; error: unknown };

/** The state, and `retry` to load again at once (after an error). */
export type CustomerLoad = CustomerState & { retry: () => void };

/**
 * Loads one customer, anonymized ones included. An answer for an id the page has since left is
 * dropped. A `not_operator` refusal is also reported to `AuthProvider` (back to /accedi).
 */
export function useCustomer(id: string): CustomerLoad {
  const service = useCustomerService();
  // In a ref: a new identity of the reporter must not load again.
  const notOperator = useNotOperator();
  const reportNotOperator = useRef(notOperator);
  useEffect(() => {
    reportNotOperator.current = notOperator;
  }, [notOperator]);
  const valid = isCustomerId(id);
  // Keyed by id and attempt, so a new id or "Riprova" shows the loading state at once.
  const [loaded, setLoaded] = useState<{ key: string; state: CustomerState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${id}#${attempt}`;

  useEffect(() => {
    if (!valid) return undefined;
    let current = true;
    service.get(id).then(
      (customer) => {
        if (!current) return;
        setLoaded({
          key,
          state: customer === null ? { status: 'not-found' } : { status: 'done', customer },
        });
      },
      (error: unknown) => {
        if (!current) return;
        reportNotOperator.current(error);
        setLoaded({ key, state: { status: 'error', error } });
      },
    );
    return () => {
      current = false;
    };
  }, [service, id, valid, key]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  let state: CustomerState;
  if (!valid) state = { status: 'not-found' };
  else if (loaded?.key === key) state = loaded.state;
  else state = { status: 'loading' };
  return { ...state, retry };
}
