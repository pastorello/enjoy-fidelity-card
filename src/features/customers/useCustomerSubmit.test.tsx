import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHookThenFire } from '../../test/fireAfterCommit';
import { fakeCustomer } from '../../test/fakeCustomerService';
import { signedInFake } from '../../test/renderApp';
import { AuthProvider } from '../identity/AuthProvider';
import type { CustomerFormValues } from './CustomerForm';
import { CustomerError, type CustomerSummary } from './types';
import { useCustomerSubmit } from './useCustomerSubmit';

const VALUES: CustomerFormValues = {
  name: 'Giulia Bianchi',
  email: '',
  notes: '',
  privacyConsent: true,
};

function Auth({ children }: { children: ReactNode }) {
  return <AuthProvider service={signedInFake().service}>{children}</AuthProvider>;
}

describe('useCustomerSubmit', () => {
  it('a save right after a render sends with the options of that render (the card just read)', async () => {
    const customer = fakeCustomer({ name: 'Giulia Bianchi' });
    const withoutCard = vi.fn<(values: CustomerFormValues) => Promise<CustomerSummary>>(() =>
      Promise.resolve(customer),
    );
    const withCard = vi.fn<(values: CustomerFormValues) => Promise<CustomerSummary>>(() =>
      Promise.resolve(customer),
    );
    const hosted = renderHookThenFire(
      ({ request }: { request: typeof withoutCard }) =>
        useCustomerSubmit({ request, onSaved: () => {}, networkText: 'Cliente non salvato.' }),
      { request: withoutCard },
      { wrapper: Auth },
    );

    // The screen now shows "Card letta"; "Salva cliente" is tapped before `useEffect` has run.
    hosted.rerenderAndFire({ request: withCard }, (submit) => submit.save(VALUES));
    await act(async () => {});

    expect(withoutCard).not.toHaveBeenCalled();
    expect(withCard).toHaveBeenCalledWith(VALUES);
  });

  it.each([
    ['customer_name_taken', 'name'],
    ['customer_email_taken', 'email'],
  ] as const)(
    '%s: the refusal points at the %s and at the customer that has it',
    async (code, field) => {
      const other = '00000000-0000-4000-8000-000000000042';
      const request = vi.fn<(values: CustomerFormValues) => Promise<CustomerSummary>>(() =>
        Promise.reject(new CustomerError(code, other)),
      );
      const { result } = renderHook(
        () => useCustomerSubmit({ request, onSaved: () => {}, networkText: 'Non salvato.' }),
        { wrapper: Auth },
      );
      await act(async () => result.current.save(VALUES));
      expect(result.current.refusal).toEqual({ kind: 'taken', field, existingCustomerId: other });
      expect(result.current.failure).toBeNull();
      expect(result.current.busy).toBe(false);
    },
  );

  it('email_invalid from the server: a refusal under the email', async () => {
    const request = vi.fn<(values: CustomerFormValues) => Promise<CustomerSummary>>(() =>
      Promise.reject(new CustomerError('email_invalid')),
    );
    const { result } = renderHook(
      () => useCustomerSubmit({ request, onSaved: () => {}, networkText: 'Non salvato.' }),
      { wrapper: Auth },
    );
    await act(async () => result.current.save(VALUES));
    expect(result.current.refusal).toEqual({
      kind: 'field',
      field: 'email',
      text: 'Email non valida: controlla come è scritta.',
    });
  });
});
