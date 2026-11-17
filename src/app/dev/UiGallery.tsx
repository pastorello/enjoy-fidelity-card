// Development-only showcase of the shared components (route /dev/ui).
// Fake data only: this repository is public.
import { useState } from 'react';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { ListRow } from '../../shared/ui/ListRow';
import { PointsBadge } from '../../shared/ui/PointsBadge';
import { SearchField } from '../../shared/ui/SearchField';
import { StatusView } from '../../shared/ui/StatusView';
import { TextField } from '../../shared/ui/TextField';
import { AppShell } from '../AppShell';
import styles from './UiGallery.module.css';

export function UiGallery() {
  const [search, setSearch] = useState('Rossi');
  const [name, setName] = useState('Maria Rossi');
  const [phone, setPhone] = useState('');
  const [ratio, setRatio] = useState('1,00');
  const [threshold, setThreshold] = useState('15o');
  const [dialogOpen, setDialogOpen] = useState(false);

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
          label="Cerca per nome o telefono"
          value={search}
          onChange={setSearch}
          placeholder="Es. Rossi o 4521"
        />
        <TextField
          label="Nome e cognome"
          value={name}
          onChange={setName}
          error="Esiste già Maria Rossi · Apri la scheda"
        />
        <TextField
          label="Telefono"
          type="tel"
          value={phone}
          onChange={setPhone}
          hint="Facoltativo"
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
          SERVITI OGGI
        </h2>
        <ul className={styles.list}>
          <ListRow
            to="/dev/ui"
            title="Antonio Esposito"
            subtitle="••• 0388 · 10:15"
            trailing={<PointsBadge points={45} />}
          />
          <ListRow
            to="/dev/ui"
            title="Lucia De Meo"
            subtitle="Senza telefono · 09:58"
            trailing={<PointsBadge points={310} />}
          />
          <ListRow
            title="Spesa 12,50 €"
            subtitle="10:42 · Giulia"
            trailing={<strong>+12</strong>}
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
          Annulla la spesa…
        </Button>
        <Button busy block>
          Salvataggio
        </Button>
        <Button disabled block>
          Mancano 60 punti
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
          description="Controlla come è scritto, o cerca con le ultime 4 cifre del telefono."
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

      <ConfirmDialog
        open={dialogOpen}
        tone="danger"
        title="Annullare la spesa di 12,50 €?"
        description="Oggi alle 10:42, +12 punti. Si registra una correzione di −12 punti e il saldo passa da 20 a 8."
        confirmLabel="Annulla la spesa"
        onConfirm={() => setDialogOpen(false)}
        onCancel={() => setDialogOpen(false)}
      />
    </AppShell>
  );
}
