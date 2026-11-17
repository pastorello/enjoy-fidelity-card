import { useCurrentOperator } from '../features/identity/AuthProvider';
import { StatusView } from '../shared/ui/StatusView';
import { AppShell } from './AppShell';

/** Placeholder until the customers module provides the real home ("Cerca cliente"). */
export function HomePage() {
  const operator = useCurrentOperator();
  return (
    <AppShell account={{ name: operator.name, to: '/impostazioni' }}>
      <StatusView
        kind="empty"
        icon="nfc"
        title="Enjoy Card è quasi pronta"
        description="Ricerca dei clienti, spese e premi arrivano con i prossimi aggiornamenti."
      />
    </AppShell>
  );
}
