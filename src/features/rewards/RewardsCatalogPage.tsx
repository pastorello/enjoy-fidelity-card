import { AppShell } from '../../app/AppShell';
import { ButtonLink } from '../../shared/ui/Button';
import { StatusView } from '../../shared/ui/StatusView';
import { useCurrentOperator } from '../identity/AuthProvider';

const TITLE = 'Catalogo premi';
const BACK_TO = '/impostazioni';

/**
 * The permission message for an operator who opens the catalogue URL by hand
 * (docs/specs/SPEC-rewards.md §4): no read and no write is sent, and no "Nuovo premio" box.
 */
function AdminsOnly() {
  return (
    <AppShell
      title={TITLE}
      backTo={BACK_TO}
      actions={
        <ButtonLink to={BACK_TO} variant="secondary" block>
          Torna alle impostazioni
        </ButtonLink>
      }
    >
      <StatusView
        kind="empty"
        icon="lock"
        title="Solo per gli amministratori"
        description="Il catalogo premi lo gestiscono gli amministratori."
      />
    </AppShell>
  );
}

/**
 * Catalogo premi (`/impostazioni/premi`; wireframe "Catalogo premi"): administrators only,
 * reached from the GESTIONE section of the settings.
 */
export function RewardsCatalogPage() {
  const operator = useCurrentOperator();
  if (operator.role !== 'admin') return <AdminsOnly />;
  return (
    <AppShell title={TITLE} backTo={BACK_TO}>
      {/* The list and the "Nuovo premio" box come with the next tasks of the plan. */}
      {null}
    </AppShell>
  );
}
