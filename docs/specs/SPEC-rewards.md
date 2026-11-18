# Spec: rewards — V1

Status: approvata (2026-11-17) su delega dell'utente — le Open Questions adottano i default proposti, da rivedere con il titolare (`docs/specs/cross-review.md` §3)
Modulo: `rewards` ([CAPABILITY-MAP.md](../../CAPABILITY-MAP.md)) · Dipende da: `identity` · Usato da: `ledger` ·
Fonti: specifiche (sezioni "Premi", "Modello dati", "Ruoli e account"), wireframe "Catalogo premi",
"Impostazioni (amministratore)", "Impostazioni (operatore)", "Riscatta premio" (solo come consumatore) e
nota "Amministrazione" del canvas · Decisioni: `brain/DECISIONS.md`.

## Objective

Gli amministratori tengono il **catalogo dei premi fissi** (nome, punti richiesti, attivo sì/no) da
`/impostazioni/premi`. Alla cassa (`ledger`, schermata "Riscatta premio") compaiono solo i premi attivi.
Il premio libero non fa parte del catalogo: è un movimento di `ledger`.

**Utenti**:
- **Amministratore**: vede tutto il catalogo, aggiunge premi, li attiva e disattiva, ne corregge nome e punti.
- **Operatore**: non gestisce il catalogo (nota "Amministrazione": "Solo amministratori: … catalogo
  premi"); legge i premi attivi solo attraverso la schermata di riscatto di `ledger`.

**Successo**: un amministratore aggiunge "Spremuta, 80 punti", la disattiva e la riattiva dal telefono; la
modifica di nome o punti non cambia nessun movimento già registrato; un operatore non riesce a scrivere nel
catalogo nemmeno chiamando l'API a mano.

## Cosa include

1. **Voce nelle Impostazioni** (wireframe "Impostazioni (amministratore)"): sezione **GESTIONE** con la riga
   "Catalogo premi" / "Premi fissi e punti richiesti" (`ListRow` con `to="/impostazioni/premi"`). Visibile
   solo agli amministratori; il wireframe operatore non la mostra. La riga "Operatori" della stessa sezione
   resta rinviata (vedi `SPEC-identity.md`): la sezione nasce con la sola riga del catalogo.
   Posizione come nel wireframe, secondo l'ordine unico delle sezioni di `/impostazioni` (fissato in `CROSS-REVIEW.md`): riquadro account (`identity`) · PUNTI E CONTROLLI / PUNTI (`settings`) · ACCOUNT (`identity-password`, più "PIN della cassa" di `tablet-kiosk`) · GESTIONE (`rewards`, solo admin) · LETTORE CARD (`tablet-kiosk`, solo tablet con cassiere admin) · ESPORTA DATI (`export`, solo admin) · nota finale (`settings`, solo operatore). `SettingsPage` (di `identity`) monta le sezioni dei moduli in
   quest'ordine fisso; se `settings` non è ancora unito, GESTIONE segue subito il riquadro account. La nota
   finale del wireframe operatore ("Operatori, premi, esportazioni e annullamenti… li gestiscono gli
   amministratori.") non la aggiunge questo modulo (vedi Out of Scope).
2. **Catalogo premi** (`/impostazioni/premi`, wireframe "Catalogo premi"): `AppShell` con titolo "Catalogo
   premi" e Indietro verso `/impostazioni`.
   - **Elenco**: per ogni premio nome (18 px), sotto "N punti" e a destra la casella **Attivo**. Ordine:
     prima gli attivi per punti crescenti, poi gli inattivi, anch'essi per punti crescenti (come nel
     wireframe: "Dolce del giorno" in fondo); a parità di punti, per nome (`localeCompare` `it`). L'ordine lo
     calcola sempre l'app con un'unica funzione `sortRewards()` (usata anche da `listActive()`), così non
     dipende dalla collation del database. L'elenco scorre dentro `main`; il riquadro Nuovo premio resta
     fisso in basso. Righe con `key` = id: dopo un cambio di stato la riga si sposta al suo posto e il
     focus resta sulla sua casella.
   - **Casella Attivo della riga**: area di tocco ≥ 48 px in altezza (il wireframe disegna 44 px: vale la
     regola dei 48 px di `CLAUDE.md`); nome accessibile che include il premio (es. `aria-label` "Caffè
     attivo"), perché cinque caselle chiamate solo "Attivo" non si distinguono con un lettore di schermo.
     La riga non usa `ListRow` (che renderebbe link o pulsante l'intera riga, con la casella annidata
     dentro): è una riga propria con gli stessi token.
   - **Premio inattivo**: riga in grigio (`ink-muted`), sottotitolo "120 punti · non visibile alla cassa né
     al cliente" (testo del wireframe).
   - **Attiva/disattiva**: toccare la casella salva subito (nessun pulsante Salva nel wireframe). Durante il
     salvataggio la casella è disabilitata; se fallisce torna allo stato precedente e sotto la riga compare
     l'errore.
   - **Nuovo premio** (riquadro fisso in basso, sfondo `surface-alt`): "Nome del premio" (placeholder
     "Es. Spremuta"), "Punti richiesti" (placeholder "Es. 80", `inputMode="numeric"`), casella "Attivo"
     (spuntata di default), pulsante primario "Aggiungi premio". Dopo il salvataggio il premio compare in
     elenco, i campi si svuotano e un messaggio `aria-live` dice "Premio aggiunto".
   - **Modifica** (non nel wireframe, vedi Open Questions): toccando nome e punti di una riga (pulsante su
     tutta l'area di testo, ≥ 48 px) il riquadro in basso diventa "Modifica premio" con i campi compilati,
     senza la casella Attivo (quella resta nella riga), con "Salva modifiche" (primario) e "Annulla"
     (secondario). Nota fissa sotto i campi: "Nome e punti valgono per i riscatti da ora in poi: i riscatti
     già registrati non cambiano." (stesso schema della nota sul rapporto nelle Impostazioni). Dopo
     "Salva modifiche" riuscito o "Annulla" il riquadro torna a "Nuovo premio" con i campi e
     l'identificativo che aveva prima (una bozza non salvata non si perde). Durante la modifica la riga
     modificata è evidenziata e le altre righe non aprono una seconda modifica finché non si salva o annulla.
   - **Nessuna cancellazione**: un premio non si cancella mai, si disattiva. Nessun pulsante Elimina.
3. **Validazione** (in app, ripetuta sul server):
   - nome: spazi iniziali e finali tolti, 1–60 caratteri, unico senza distinzione tra maiuscole e minuscole;
   - punti: intero da 1 a 99 999, solo cifre (niente decimali, segni o spazi interni).
   - Messaggi sotto il campo (`TextField` con errore): "Scrivi il nome del premio"; "Il nome è troppo lungo
     (massimo 60 caratteri)"; "Esiste già un premio con questo nome"; "Scrivi i punti: un numero intero
     maggiore di zero"; "Al massimo 99.999 punti". Il focus va al primo campo con errore.
4. **Stati della schermata**:
   - **caricamento**: `StatusView kind="loading"` al posto dell'elenco; riquadro Nuovo premio disabilitato;
   - **vuoto**: `StatusView kind="empty"` "Nessun premio nel catalogo" / "Aggiungi il primo premio qui
     sotto." con il riquadro Nuovo premio attivo;
   - **errore di caricamento**: `StatusView kind="error"` "Catalogo non caricato" / "Controlla la
     connessione e riprova." con "Riprova";
   - **errore di rete in scrittura**: "Premio non salvato: controlla la connessione e riprova." I campi
     restano compilati; "Riprova" (o un nuovo tocco su "Aggiungi premio") reinvia **con lo stesso
     identificativo**, così non si creano due premi. Se il server risponde con un premio già esistente con
     quell'id (la prima richiesta era arrivata), l'app mostra la riga restituita dal server, non i valori del
     modulo. Per attiva/disattiva e modifica il reinvio è sicuro di per sé (impostano valori, non sommano);
   - **altri errori in scrittura**: `not-found` o `unknown` → "Premio non salvato: riprova." e l'elenco si
     ricarica; `invalid` → stessi messaggi della validazione;
   - **doppio tocco**: il pulsante è `busy` e disabilitato finché la richiesta non risponde;
   - **permesso**: un operatore che apre l'URL a mano vede `StatusView kind="empty"` con icona lucchetto,
     "Solo per gli amministratori" / "Il catalogo premi lo gestiscono gli amministratori." e sotto un
     `ButtonLink` secondario "Torna alle impostazioni" (`StatusView` non ha azioni nello stato vuoto;
     l'icona `lock` va aggiunta a `Icon`, che oggi non ce l'ha); nessuna chiamata parte, né di lettura né di
     scrittura, e il riquadro Nuovo premio non compare. Se il server rifiuta una scrittura
     perché l'utente non è più amministratore, compare lo stesso messaggio e si chiama `reportNotEnabled()`
     (`SPEC-customers.md`), che ricarica il profilo o torna su `/accedi` se l'account è stato tolto;
   - **sessione scaduta / account tolto**: gestiti da `identity` (ritorno a `/accedi`).
   - Dopo ogni scrittura riuscita e al ritorno sulla schermata l'elenco si ricarica dal server (più
     amministratori possono lavorare insieme; vince l'ultima scrittura).
5. **Interfaccia verso `ledger`**: `RewardsService.listActive()` restituisce i premi attivi ordinati con
   `sortRewards()`; la schermata "Riscatta premio" li mostra tutti, con quelli non raggiungibili visibili ma non
   selezionabili (nota "Riscattare un premio": logica di `ledger`). Regole che `app.redeem_reward` (di
   `ledger`) deve rispettare e che questa spec fissa: legge il premio sul server, **rifiuta un premio
   inattivo o inesistente**, usa i punti **attuali** del premio e ne salva nome (`description`) e punti
   nel movimento. `app.movements.reward_id` referenzia `app.rewards(id)` senza `on delete cascade` (le
   righe dei premi non si cancellano comunque).

### Modello dati e regole di accesso

```sql
-- app.rewards: catalogo dei premi fissi
id          uuid primary key            -- generato dall'app alla creazione (idempotenza)
name        text not null check (name = btrim(name) and length(name) between 1 and 60)
points      int  not null check (points between 1 and 99999)
active      boolean not null default true
created_at  timestamptz not null default now()
-- Colonne in più rispetto a specifiche e contratto (proposta, Open Question 8):
created_by  uuid not null references app.operators(id)
updated_at  timestamptz not null default now()   -- impostata a now() dalle RPC a ogni modifica
updated_by  uuid not null references app.operators(id)
-- unique index rewards_name_key on app.rewards (lower(name))
```

- **Lettura**: policy `select` per `private.is_active_operator()` (gli operatori servono a `ledger`).
- **Scrittura solo da RPC**: `revoke insert, update, delete, truncate on app.rewards from authenticated`.
  Nessuna policy di scrittura; nessuna funzione di cancellazione, per nessun ruolo.
- RPC (`security definer`, `set search_path = ''`, `private.is_admin()` controllato dentro; altrimenti
  errore `42501`; l'autore è `private.acting_operator_id()`), tutte restituiscono la riga aggiornata:
  - ordine dei controlli in ogni RPC: prima il ruolo (anche un reinvio da chi non è più amministratore
    riceve `42501`), poi l'idempotenza, poi la validazione; il nome si salva con `btrim`;
  - `app.create_reward(p_id uuid, p_name text, p_points int, p_active boolean)`: **idempotente su
    `p_id`**: se il premio con quell'id esiste già, restituisce la riga esistente senza modificarla e senza
    controllare il nome (altrimenti il reinvio darebbe "nome già usato"). Due chiamate concorrenti con lo
    stesso id producono una sola riga (`insert … on conflict (id) do nothing`, poi `select`);
  - `app.update_reward(p_id uuid, p_name text, p_points int)`;
  - `app.set_reward_active(p_id uuid, p_active boolean)`.
  - Nome già usato → errore `23505` con vincolo `rewards_name_key`; valori fuori limite → `23514`;
    id inesistente in update/toggle → `P0002`. Il servizio li traduce in `'name-taken' | 'invalid' |
    'not-found' | 'forbidden' | 'network' | 'unknown'`.
- `execute` delle RPC solo ad `authenticated` (concesso in modo esplicito), mai a `public` e `anon`: il
  test esistente `supabase/tests/function_privileges.test.sql` deve restare verde.
- `private.acting_operator_id()` è nel contratto ma non esiste ancora nel codice. La crea la prima
  migrazione che la usa (`settings`, `customers` e `rewards` possono arrivare in parallelo), con
  `create or replace function` e lo stesso corpo identico in ogni modulo (definizione in `SPEC-settings.md`): `select
  private.current_operator_id()`, `stable`, `security definer`, `set search_path = ''`, `execute` revocato a
  `public`/`anon` e **non** concesso ad `authenticated` (la chiamano solo funzioni `security definer`).
  `tablet-kiosk` la ridefinirà. Se restituisce `null` la RPC fallisce (`42501`), mai un premio senza autore.
- **Storico**: modificare nome o punti o disattivare non tocca `app.movements`, che salva `description` e
  `points` al momento del riscatto; `reward_id` resta come riferimento. Proprio per questo il premio non si
  cancella mai.
- **Seed locale** (`supabase/seed.sql`, solo sviluppo ed E2E): i premi finti del wireframe (Caffè 50,
  Cornetto e cappuccino 100, Colazione per due 180, Aperitivo 200 attivi; Dolce del giorno 120 inattivo),
  con `created_by`/`updated_by` = l'operatore "Admin Prova" del seed. In produzione il catalogo parte vuoto
  e lo compila il titolare (decisione del 2026-11-16: "catalogo premi … si impostano dall'app"); nessuna
  migrazione inserisce premi.

## Commands

Nessun comando nuovo. Si usano `npm run db:reset` (migrazione + seed), `npm run db:test`, `npm test`,
`npm run e2e`.

## Project Structure

```
src/features/rewards/
  types.ts                     → Reward, RewardWriteError, RewardWriteResult, RewardsService
  sortRewards.ts / validateReward.ts → ordinamento e validazione (logica pura, test di unità)
  supabaseRewardsService.ts    → implementazione con getSupabase() (RPC + select)
  RewardsServiceProvider.tsx   → contesto + useRewardsService(); useRewards() (stato load/errore/ricarica)
  RewardsCatalogPage.tsx       → /impostazioni/premi (+ .module.css)
  RewardForm.tsx               → riquadro Nuovo/Modifica premio (+ .module.css)
  RewardsSettingsSection.tsx   → sezione GESTIONE nelle Impostazioni (solo admin)
  *.test.tsx / *.test.ts       → accanto al codice
src/test/fakeRewardsService.ts → fake in memoria (stessi errori del server, ritardi e guasti pilotabili)
src/test/renderApp.tsx         → accetta anche il fake dei premi
src/app/routes.tsx             → rotta impostazioni/premi dentro RequireAuth
src/features/identity/SettingsPage.tsx → monta RewardsSettingsSection al suo posto
src/shared/ui/Icon.tsx         → icona `lock` (nuova)
supabase/migrations/*_rewards.sql
supabase/tests/rewards.test.sql
e2e/rewards.spec.ts
```

## Code Style

Come `platform` e `identity`. I componenti non chiamano mai `getSupabase()`: usano `useRewardsService()`.

```ts
export type Reward = { id: string; name: string; points: number; active: boolean };

export type RewardWriteError = 'name-taken' | 'invalid' | 'not-found' | 'forbidden' | 'network' | 'unknown';
export type RewardWriteResult = { ok: true; reward: Reward } | { ok: false; error: RewardWriteError };

/** Active first, then inactive; each by points, then name (localeCompare 'it'). */
export function sortRewards(rewards: Reward[]): Reward[];

export type RewardsService = {
  listAll(): Promise<Reward[]>;          // catalogo per gli amministratori
  listActive(): Promise<Reward[]>;       // per ledger, ordinati per punti e nome
  create(input: { id: string; name: string; points: number; active: boolean }): Promise<RewardWriteResult>;
  update(id: string, input: { name: string; points: number }): Promise<RewardWriteResult>;
  setActive(id: string, active: boolean): Promise<RewardWriteResult>;
};
```

L'id del nuovo premio nasce con `crypto.randomUUID()` quando si apre il modulo e cambia solo dopo un
salvataggio riuscito. Il ruolo per mostrare o nascondere sezioni viene da `useCurrentOperator()`.

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP (`supabase/tests/rewards.test.sql`, ruoli simulati con `set local role authenticated` e `request.jwt.claims` degli utenti del seed) | RLS attiva; operatore e admin leggono, utente senza profilo non legge nulla, `anon` non legge; `insert`/`update`/`delete`/`truncate` diretti negati ad `authenticated` (anche admin); le tre RPC rifiutate a un operatore e a un utente senza profilo (`42501`), anche come reinvio di un id esistente; `create_reward` ripetuta con lo stesso id (anche con nome diverso) → una sola riga, restituita invariata; nome duplicato con maiuscole diverse o spazi iniziali/finali → `23505`; punti 0, negativi, > 99 999 e nome vuoto, di soli spazi o > 60 → `23514`; nome con spazi salvato senza spazi; `update_reward`/`set_reward_active` su id inesistente → `P0002`; `update_reward` non cambia `active`; `created_by`/`updated_by` = operatore che agisce, `updated_at` aggiornato; nessuna funzione in `app` o `private` che cancelli da `app.rewards` (nessuna funzione di cancellazione esiste); `execute` delle RPC non concesso ad `anon`/`public` |
| Unità (Vitest) | `validateReward` (limiti 0/1/99 999/100 000, decimali, segni, spazi interni nei punti, nome vuoto/61 caratteri); `sortRewards` (attivi per punti, poi inattivi per punti, parità per nome); `supabaseRewardsService` con client finto: ogni codice (`42501`, `23505` con `rewards_name_key`, `23514`, `P0002`, errore di rete, altro) → l'errore giusto, e `listActive()` chiede solo `active = true` |
| Componenti (Vitest + Testing Library, `fakeRewardsService`) | caricamento, vuoto, errore con Riprova; aggiunta con campi svuotati e annuncio; errori di validazione e focus; nome già usato; errore di rete e reinvio con lo **stesso id** (il fake registra gli id ricevuti: due chiamate, stesso id, una sola riga); nuovo id dopo un salvataggio riuscito; doppio tocco = una sola chiamata; casella Attivo disabilitata durante il salvataggio e ripristinata in caso di errore; nomi accessibili delle caselle distinti; modifica, Annulla e ritorno alla bozza Nuovo premio; `forbidden` in scrittura → messaggio di permesso; operatore → messaggio di permesso e **nessuna** chiamata al fake; sezione GESTIONE visibile solo all'admin e nell'ordine giusto |
| E2E (Playwright, 390×844, stack Supabase locale, account del seed) | admin: Impostazioni → Catalogo premi → elenco del seed nell'ordine del wireframe → aggiunge un premio con nome unico per esecuzione → lo vede in elenco → riprova lo stesso nome in maiuscolo e vede "Esiste già un premio con questo nome" (traduzione dell'errore reale) → lo disattiva (sottotitolo "non visibile alla cassa") → ricarica la pagina e lo stato resta → lo rinomina; operatore: nessuna riga "Catalogo premi" e l'URL diretto mostra "Solo per gli amministratori"; target di tocco ≥ 48 px (caselle comprese). I premi del seed non si modificano (servono all'E2E di `ledger`). Nessun adattatore card necessario |

Quando `ledger` esiste, il suo pgTAP verifica che rinominare o cambiare i punti di un premio lasci invariati
`description` e `points` dei riscatti già registrati, e che `redeem_reward` rifiuti un premio inattivo; il
suo E2E verifica che un premio disattivato non compaia in "Riscatta premio". In questo modulo `app.movements`
non esiste ancora: qui si verifica solo che le RPC dei premi scrivano esclusivamente su `app.rewards`
(nessun trigger su `app.rewards`).

## Boundaries

- **Always**: ogni controllo di ruolo e ogni validazione anche sul server; scritture solo via RPC;
  identificativo generato dall'app per la creazione; dati finti nel seed; testi in italiano, codice in
  inglese; solo token nei CSS.
- **Ask first**: aggiungere la cancellazione dei premi; nuovi campi del premio (immagine, descrizione,
  categoria, scadenza); far gestire il catalogo agli operatori; cambiare i limiti di nome e punti.
- **Never**: cancellare righe di `app.rewards`; aggiornare `app.movements` quando cambia un premio; usare
  la chiave service role nell'app; mostrare il catalogo al cliente.

## Success Criteria

1. Un amministratore aggiunge "Spremuta, 80 punti, attivo" e la riga compare in elenco al posto giusto
   nell'ordine; dopo un ricaricamento della pagina il dato è ancora lì.
2. Disattivato, il premio resta nel catalogo in grigio con "non visibile alla cassa né al cliente" e non
   compare in `listActive()`; riattivato, ricompare.
3. Rinominare un premio, cambiarne i punti o disattivarlo modifica solo la sua riga in `app.rewards`
   (pgTAP: le RPC non toccano altre tabelle, nessun trigger); la conservazione di nome e punti nei riscatti
   già registrati la verifica il pgTAP di `ledger`, appena `app.movements` esiste.
4. Due tocchi rapidi o un reinvio con lo stesso id dopo un errore di rete creano **un solo** premio (test
   di componente e pgTAP).
5. Un secondo premio con lo stesso nome (anche con maiuscole diverse o spazi all'inizio o alla fine) è
   rifiutato con "Esiste già un premio con questo nome" (pgTAP ed E2E).
6. Un operatore autenticato riceve `42501` da ogni RPC di scrittura e un rifiuto da `insert`/`update`/
   `delete` diretti (pgTAP con il ruolo `authenticated`); nessun ruolo ha una funzione o un permesso per
   cancellare un premio.
7. Caricamento, catalogo vuoto, errore con Riprova e messaggio di permesso sono visibili e coperti da test
   di componente.
8. A 390×844 la schermata mostra gli elementi del wireframe "Catalogo premi" (intestazione con Indietro,
   righe con nome, punti e casella Attivo, riga inattiva in grigio con il suo sottotitolo, riquadro Nuovo
   premio con i due campi, la casella e il pulsante); detector Impeccable pulito; target ≥ 48 px (E2E).
9. `npm run typecheck && npm run lint && npm test`, `npm run db:test` (compreso
   `function_privileges.test.sql`) ed `npm run e2e` verdi.

## Out of Scope

- Schermata "Riscatta premio", premio libero, saldo dopo il riscatto, controllo del saldo: modulo `ledger`.
- Schermate tablet ("Tablet: catalogo premi"): modulo `tablet-kiosk`.
- Riga "Operatori" nelle Impostazioni: rinviata con la gestione operatori (decisioni del 2026-11-17).
- Altre parti dei wireframe Impostazioni: "PUNTI E CONTROLLI" e "PUNTI" (modulo `settings`), "ESPORTA
  DATI" (`export`), "Cambia password" (aggiunta di `identity` dopo la V1), nota finale del wireframe
  operatore sulle funzioni riservate agli amministratori (la aggiunge `settings`, che compone la versione
  operatore).
- Elenco e "Mancano N punti" della schermata "Riscatta premio": `ledger` (questo modulo dà solo i dati).
- Cancellazione, immagini, categorie, premi a tempo, ordinamento manuale: non richiesti.

## Open Questions

1. **Cancellazione dei premi.** Proposta: mai cancellare, solo disattivare, anche per i premi mai usati
   (default adottato). Le specifiche prevedono solo "attivo sì/no" e lo storico è intoccabile.
2. **Modifica di nome e punti.** Il wireframe non mostra come si modifica un premio. Proposta: si
   modificano toccando la riga, nel riquadro in basso che diventa "Modifica premio"; lo storico non cambia
   perché il movimento salva nome e punti (default adottato). Alternativa: niente modifica, si disattiva e se
   ne crea uno nuovo.
3. **Limiti dei campi.** Proposta: nome 1–60 caratteri, punti interi 1–99 999 (default adottato).
4. **Nomi con accenti.** Proposta: unicità senza distinzione di maiuscole, ma "Caffe" e "Caffè" restano
   diversi (default adottato, come da contratto `name unique ci`).
5. **Punti cambiati mentre un operatore è sulla schermata di riscatto.** Proposta: il server usa i punti
   attuali del premio e rifiuta un premio nel frattempo disattivato; `ledger` mostra l'errore e ricarica
   l'elenco (default adottato, da riprendere nella spec di `ledger`).
6. **Testo "né al cliente"** del sottotitolo di un premio inattivo: il cliente non vede mai l'app.
   Proposta: lasciare il testo del wireframe (default adottato).
7. **Operatore che apre l'URL del catalogo.** Proposta: messaggio "Solo per gli amministratori" invece
   di un catalogo in sola lettura (default adottato). Testi del messaggio, degli errori di validazione e
   di rete sono proposte di questa spec, non vengono dai wireframe.
8. **Colonne di controllo nel premio** (`created_by`, `updated_at`, `updated_by`). Né le specifiche
   ("premi: id, nome, punti, attivo") né il contratto le prevedono. Proposta: aggiungerle, per sapere chi
   ha creato o cambiato un premio; non si mostrano nell'app (default adottato). Alternativa: solo le
   colonne del contratto.
9. **Ordine dei controlli sull'idempotenza.** Un reinvio di `create_reward` con lo stesso id ma valori
   diversi restituisce il premio già salvato senza errore, e l'app mostra quello (default adottato).
   Alternativa: errore se i valori differiscono; più rigido ma inutile, perché l'unicità del nome impedisce
   già i doppioni.
