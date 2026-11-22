import { AppShell } from '../../app/AppShell';
import { AdminsOnly } from '../../shared/ui/AdminsOnly';
import { useCurrentOperator } from '../identity/AuthProvider';

const TITLE = 'Operatori';

/**
 * /impostazioni/operatori (SPEC-operators point 2). An operator who opens it by hand gets the
 * "solo amministratori" view and nothing is asked of the server; the list comes with Task 16.
 */
export function OperatorsPage() {
  const operator = useCurrentOperator();
  if (operator.role !== 'admin') {
    return (
      <AdminsOnly title={TITLE} description="Gli operatori li gestiscono gli amministratori." />
    );
  }
  return (
    <AppShell title={TITLE} backTo="/impostazioni">
      {null}
    </AppShell>
  );
}
