import { StatusView } from '../shared/ui/StatusView';
import { AppShell } from './AppShell';

/** Placeholder until the customers module provides the real home ("Cerca cliente"). */
export function HomePage() {
  return (
    <AppShell>
      <StatusView
        kind="empty"
        icon="nfc"
        title="Enjoy Card è quasi pronta"
        description="Ricerca dei clienti, spese e premi arrivano con i prossimi aggiornamenti."
      />
    </AppShell>
  );
}
