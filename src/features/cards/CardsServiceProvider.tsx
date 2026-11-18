import { createContext, use } from 'react';
import type { ReactNode } from 'react';
import type { CardsService } from './types';

const CardsServiceContext = createContext<CardsService | null>(null);

/**
 * Supplies the CardsService, like CustomerServiceProvider: `main.tsx` passes the Supabase
 * implementation, `renderApp` the fake.
 */
export function CardsServiceProvider({
  service,
  children,
}: {
  service: CardsService;
  children: ReactNode;
}) {
  return <CardsServiceContext value={service}>{children}</CardsServiceContext>;
}

export function useCardsService(): CardsService {
  const service = use(CardsServiceContext);
  if (!service) throw new Error('useCardsService must be used inside <CardsServiceProvider>');
  return service;
}
