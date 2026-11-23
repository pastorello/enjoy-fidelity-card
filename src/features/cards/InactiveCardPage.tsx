import { AppShell } from '../../app/AppShell';
import { StatusView } from '../../shared/ui/StatusView';

/**
 * «Card non attiva» (`/card/:cardId`, SPEC-customers-v2 point 4): where an administrator lands
 * after reading a deactivated card on the home. The card row, Riattiva and Riformatta come next
 * (tasks 30-32); until then the page only names itself.
 */
export function InactiveCardPage() {
  return (
    <AppShell title="Card non attiva" backTo="/">
      <StatusView
        kind="empty"
        icon="credit-card"
        title="Questa card non è attiva"
        description="Per servire il cliente adesso, cercalo per nome o email."
      />
    </AppShell>
  );
}
