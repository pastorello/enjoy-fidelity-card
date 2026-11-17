import { Button } from '../shared/ui/Button';
import { Icon } from '../shared/ui/Icon';
import { ScreenTitle } from '../shared/ui/ScreenTitle';
import styles from './ErrorScreen.module.css';

type ErrorScreenProps = {
  onRetry: () => void;
};

/** Last-resort screen for unexpected errors. Works without the router. */
export function ErrorScreen({ onRetry }: ErrorScreenProps) {
  return (
    <main className={styles.screen}>
      <Icon name="circle-alert" size={48} className={styles.icon} />
      <ScreenTitle>Qualcosa è andato storto</ScreenTitle>
      <p className={styles.text}>
        L’operazione non è riuscita. Riprova; se il problema continua, chiudi e riapri l’app.
      </p>
      <Button block onClick={onRetry}>
        Riprova
      </Button>
    </main>
  );
}
