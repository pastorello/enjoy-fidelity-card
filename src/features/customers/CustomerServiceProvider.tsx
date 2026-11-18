import { createContext, use } from 'react';
import type { ReactNode } from 'react';
import type { CustomerService } from './types';

const CustomerServiceContext = createContext<CustomerService | null>(null);

/**
 * Supplies the CustomerService, like SettingsServiceProvider: `main.tsx` passes the Supabase
 * implementation, `renderApp` the fake.
 */
export function CustomerServiceProvider({
  service,
  children,
}: {
  service: CustomerService;
  children: ReactNode;
}) {
  return <CustomerServiceContext value={service}>{children}</CustomerServiceContext>;
}

export function useCustomerService(): CustomerService {
  const service = use(CustomerServiceContext);
  if (!service) throw new Error('useCustomerService must be used inside <CustomerServiceProvider>');
  return service;
}
