import { act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHookThenFire } from '../../test/fireAfterCommit';
import { fakeCustomer } from '../../test/fakeCustomerService';
import { signedInFake } from '../../test/renderApp';
import { AuthProvider } from '../identity/AuthProvider';
import type { CustomerFormValues } from './CustomerForm';
import type { CustomerSummary } from './types';
import { useCustomerSubmit } from './useCustomerSubmit';

const VALUES: CustomerFormValues = {
  name: 'Giulia Bianchi',
  phone: '',
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
});
