import { ListRow } from '../../shared/ui/ListRow';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';

/**
 * The "Operatori" row of GESTIONE in /impostazioni (SPEC-operators point 1), shown by
 * RewardsSettingsSection before "Catalogo premi". The tablet layout names the till PIN too.
 */
export function OperatorsSettingsRow() {
  const tablet = useTabletLayout();
  return (
    <ListRow
      to="/impostazioni/operatori"
      title="Operatori"
      subtitle={tablet ? 'Account, ruoli, inviti e PIN' : 'Account, ruoli e inviti'}
    />
  );
}
