import { AppShell } from '../../app/AppShell';
import { ButtonLink } from './Button';
import { StatusView } from './StatusView';

const BACK_TO = '/impostazioni';

type AdminsOnlyProps = {
  /** The title of the screen the operator opened (e.g. "Catalogo premi"). */
  title: string;
  /** What only the administrators manage there. */
  description: string;
};

/**
 * The permission view for an operator who opens an administrators' settings screen by hand
 * (SPEC-rewards §4, SPEC-operators point 2): the screen's own title, a lock message and the way back
 * to /impostazioni. It sends nothing; the server refuses anyway.
 */
export function AdminsOnly({ title, description }: AdminsOnlyProps) {
  return (
    <AppShell
      title={title}
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
        description={description}
      />
    </AppShell>
  );
}
