// Development-only showcase of the shared components (route /dev/ui).
// Fake data only: this repository is public.
import { useState } from 'react';
import { CardReadPanelView } from '../../features/card-input/CardReadPanel';
import type { NfcStatus } from '../../features/card-input/cardReader';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { Dialog } from '../../shared/ui/Dialog';
import { ListRow } from '../../shared/ui/ListRow';
import { PointsBadge } from '../../shared/ui/PointsBadge';
import { SearchField } from '../../shared/ui/SearchField';
import { StatusView } from '../../shared/ui/StatusView';
import { TextField } from '../../shared/ui/TextField';
import { AppShell } from '../AppShell';
import styles from './UiGallery.module.css';

const HOME_TITLE = 'Avvicina la card';
const HOME_TEXT =
  'Lettura attiva: appoggia la card sul retro del telefono. Una card nuova apre la registrazione del cliente.';
const NFC_STATES: NfcStatus[] = [
  'active',
  'starting',
  'needs-permission',
  'off',
  'denied',
  'unsupported',
];

export function UiGallery() {
  const [search, setSearch] = useState('Rossi');
  const [name, setName] = useState('Maria Rossi');
  const [email, setEmail] = useState('');
  const [ratio, setRatio] = useState('1,00');
  const [threshold, setThreshold] = useState('15o');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);

  return (
    <AppShell
      account={{ name: 'Giulia', to: '/dev/ui' }}
      actions={
        <ButtonLink to="/dev/ui" variant="secondary" icon="plus" block>
          Nuovo cliente
        </ButtonLink>
      }
    >
      <section className={styles.section} aria-labelledby="g-fields">
        <h2 id="g-fields" className={styles.group}>
          CAMPI
        </h2>
        <SearchField
          label="Cerca per nome o email"
          value={search}
          onChange={setSearch}
          placeholder="Es. Rossi o rossi@"
        />
        <TextField
          label="Nome e cognome"
          value={name}
          onChange={setName}
          error="Esiste già Maria Rossi · Apri la scheda"
        />
        <TextField
          label="Email (facoltativa)"
          type="email"
          placeholder="nome@esempio.it"
          value={email}
          onChange={setEmail}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="email"
        />
        <TextField
          label="1 punto ogni"
          layout="inline"
          suffix="€"
          inputMode="decimal"
          value={ratio}
          onChange={setRatio}
        />
        <TextField
          label="Chiedi conferma sopra"
          layout="inline"
          suffix="€"
          inputMode="decimal"
          value={threshold}
          onChange={setThreshold}
          error="Scrivi solo cifre e la virgola, per esempio 1,50."
        />
      </section>

      <section className={styles.section} aria-labelledby="g-list">
        <h2 id="g-list" className={styles.group}>
          CLIENTI
        </h2>
        <ul className={styles.list}>
          <ListRow
            to="/dev/ui"
            title="Antonio Esposito"
            subtitle="Oggi, 10:15"
            trailing={<PointsBadge points={45} />}
          />
          <ListRow
            to="/dev/ui"
            title="Lucia De Meo"
            subtitle="Ieri, 18:30"
            trailing={<PointsBadge points={310} />}
          />
          <ListRow
            title="Spesa 12,50 €"
            subtitle="10:42 · Giulia"
            trailing={<span className={styles.delta}>+12</span>}
          />
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="g-buttons">
        <h2 id="g-buttons" className={styles.group}>
          PULSANTI
        </h2>
        <Button block>Conferma +12 punti</Button>
        <Button variant="secondary" block>
          Annulla
        </Button>
        <Button variant="danger-secondary" block onClick={() => setDialogOpen(true)}>
          Annulla la spesa
        </Button>
        <Button busy block>
          Salvataggio
        </Button>
        <Button disabled block>
          Mancano 60 punti
        </Button>
        <Button variant="secondary" block onClick={() => setShellOpen(true)}>
          Apri il dialogo
        </Button>
      </section>

      <section className={styles.section} aria-labelledby="g-states">
        <h2 id="g-states" className={styles.group}>
          STATI
        </h2>
        <StatusView kind="loading" />
        <StatusView
          kind="empty"
          title="Nessun cliente trovato"
          description="Controlla come è scritto, o cerca con l’email."
        />
        <StatusView
          kind="error"
          icon="wifi-off"
          title="Spesa non salvata"
          description="Il telefono non è connesso a internet. L’importo resta qui: riprova appena torna la rete."
          onRetry={() => {}}
          retryLabel="Riprova +12"
        />
      </section>

      <section className={styles.section} aria-labelledby="g-card">
        <h2 id="g-card" className={styles.group}>
          LETTURA CARD
        </h2>
        {NFC_STATES.map((status) => (
          <CardReadPanelView
            key={status}
            title={HOME_TITLE}
            description={HOME_TEXT}
            status={status}
            onStart={() => {}}
          />
        ))}
        <CardReadPanelView
          variant="compact"
          title={HOME_TITLE}
          description={HOME_TEXT}
          status="active"
          onStart={() => {}}
        />
        <CardReadPanelView
          mode="usb"
          title="Passa la card sul lettore"
          description="L’app riceve il codice dal lettore da sola, senza bisogno di toccare un campo. Una card nuova apre la registrazione del cliente."
          status="unsupported"
          onStart={() => {}}
        />
      </section>

      <ConfirmDialog
        open={dialogOpen}
        tone="danger"
        title="Annullare la spesa di 12,50 €?"
        description="Oggi alle 10:42, +12 punti. Si registra una correzione di −12 punti e il saldo passa da 20 a 8."
        confirmLabel="Annulla la spesa"
        onConfirm={() => setDialogOpen(false)}
        onCancel={() => setDialogOpen(false)}
      />

      <Dialog open={shellOpen} title="Maria Rossi" onClose={() => setShellOpen(false)}>
        <p className={styles.dialogText}>maria.rossi@example.com · Attivo</p>
      </Dialog>
    </AppShell>
  );
}
