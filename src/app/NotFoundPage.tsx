import { ButtonLink } from '../shared/ui/Button';
import { StatusView } from '../shared/ui/StatusView';
import { AppShell } from './AppShell';

export function NotFoundPage() {
  return (
    <AppShell
      title="Pagina non trovata"
      backTo="/"
      actions={
        <ButtonLink to="/" block>
          Torna all’inizio
        </ButtonLink>
      }
    >
      <StatusView
        kind="empty"
        icon="search"
        title="Questa pagina non esiste"
        description="Il collegamento potrebbe essere vecchio o scritto male."
      />
    </AppShell>
  );
}
