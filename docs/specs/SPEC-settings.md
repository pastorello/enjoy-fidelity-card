# Spec: settings — V1

Status: approvata (2026-11-17) su delega dell'utente — le Open Questions adottano i default proposti, da rivedere con il titolare (`docs/specs/cross-review.md` §3)
Modulo: `settings` ([CAPABILITY-MAP.md](../../CAPABILITY-MAP.md)) · Dipende da: `identity` ·
Usato da: `ledger` (rapporto e soglia), `card-input` e `tablet-kiosk` (formato del lettore USB) ·
Fonti: specifiche ("Calcolo dei punti", "Modello dati": configurazione, "Ruoli e account"), wireframe
Impostazioni, Impostazioni operatore, Importo insolito, Tablet: impostazioni e relative note ·
Decisioni: `brain/DECISIONS.md` (2026-11-16: "Aggiunte al modello dati", "Configurazione iniziale",
"Lettore NFC USB generico con formato configurabile", "Importi in centesimi interi ovunque").

## Objective

Il titolare decide **quanti euro valgono un punto** e **sopra quale importo** l'app chiede di confermare una
spesa (per evitare errori di battitura come 1250 al posto di 12,50). I camerieri vedono il rapporto in vigore
ma non lo cambiano. Cambiare il rapporto non tocca lo storico: ogni spesa ha già salvato il suo.

**Utenti**:
- **Amministratore**: legge e modifica rapporto e soglia nella sezione "PUNTI E CONTROLLI" di `/impostazioni`.
- **Operatore**: vede la sezione "PUNTI" in sola lettura ("1 punto ogni 1,00 € di spesa").
- **Altri moduli**: leggono la configurazione con un solo hook, `useSettings()`.

**Successo**: un amministratore porta il rapporto a 2,00 € e salva; da quel momento la spesa successiva
registra i punti con 200 centesimi per punto, mentre le spese precedenti mostrano ancora i punti e il
rapporto di allora.

## Cosa include

1. **Tabella `app.settings`** (una sola riga), creata e popolata dalla migrazione con i valori iniziali:
   1 punto ogni 1,00 € (`cents_per_point = 100`, DECISIONS 2026-11-16), conferma sopra 150,00 €
   (`confirm_threshold_cents = 15000`, wireframe Impostazioni e Importo insolito), lettore `'hex'`.
2. **Funzione `app.update_settings`**: unica via di scrittura, solo amministratori, controlli sul server.
3. **Sezione amministratore "PUNTI E CONTROLLI"** in `/impostazioni`, sotto il riquadro account (wireframe
   Impostazioni), con:
   - riga "1 punto ogni [ 1,00 ] €" e riga "Chiedi conferma sopra [ 150,00 ] €": campi di testo con
     `inputmode="decimal"`, allineati a destra, alti 48 px, label a sinistra e "€" a destra;
   - testo d'aiuto: "Il rapporto vale per le spese registrate da ora in poi. La conferma evita errori di
     battitura, come 1250 al posto di 12,50.";
   - pulsante primario **Salva** (≥ 48 px) che invia entrambi i valori insieme.
4. **Sezione operatore "PUNTI"** (wireframe Impostazioni operatore): "1 punto ogni 1,00 € di spesa" (importo
   con `formatCents`) e "Il rapporto lo decide un amministratore.", più la nota in fondo alla pagina
   "Operatori, premi, esportazioni e annullamenti dei movimenti li gestiscono gli amministratori." La soglia
   non si mostra all'operatore (il wireframe non la riporta). Posizione: ordine unico delle sezioni di `/impostazioni` (fissato in `CROSS-REVIEW.md`): riquadro account (`identity`) · PUNTI E CONTROLLI / PUNTI (`settings`) · ACCOUNT (`identity-password`, più "PIN della cassa" di `tablet-kiosk`) · GESTIONE (`rewards`, solo admin) · LETTORE CARD (`tablet-kiosk`, solo tablet con cassiere admin) · ESPORTA DATI (`export`, solo admin) · nota finale (`settings`, solo operatore); la nota resta
   l'ultimo elemento della pagina anche quando `identity` aggiunge la sezione ACCOUNT. `formatCents` usa uno
   spazio indivisibile prima di "€": i test cercano il testo normalizzando gli spazi.
5. **Stati della sezione** (nota dei wireframe "Altri stati da gestire", design system «Stati,
   errori e conferme»):
   - *caricamento*: `StatusView kind="loading"` dentro la sezione, il resto della pagina resta usabile;
   - *errore di caricamento*: `StatusView kind="error"` "Impostazioni non caricate" con **Riprova**;
   - *salvataggio in corso*: Salva in stato `busy`, campi in sola lettura, niente doppio invio;
   - *salvato*: messaggio in una regione `aria-live="polite"`: "Impostazioni salvate."; i campi mostrano i
     valori restituiti dal server, riformattati (es. "2" → "2,00");
   - *errore di rete al salvataggio*: messaggio "Impostazioni non salvate: controlla la connessione e
     riprova." con i valori digitati conservati; ripetere Salva è sicuro (scrittura idempotente: stessi
     valori, stesso risultato);
   - *permesso negato* (ruolo cambiato mentre la pagina era aperta): "Solo un amministratore può cambiare
     queste impostazioni." e Salva resta disattivato; la sezione chiama `reportNotEnabled()` di `AuthProvider`
     (definito in `SPEC-customers.md`): se il profilo non c'è più si torna su `/accedi`, altrimenti il profilo
     si ricarica e la sezione passa alla vista operatore;
   - *valori rifiutati dal server* (`invalid`, client e server non allineati) o *errore imprevisto*
     (`unknown`): "Impostazioni non salvate. Ricarica la pagina e riprova." con i valori digitati conservati
     (testo proposto, vedi Open Questions);
   - *salvataggio di un altro amministratore mentre si modifica*: la ricarica su `visibilitychange` aggiorna
     `useSettings()` ma **non sovrascrive i campi già modificati** e non salvati; i campi non toccati
     mostrano i nuovi valori;
   - *sessione scaduta* e *operatore disattivato mentre è collegato* (nota del wireframe: "torna all'accesso
     con un messaggio"): li gestisce `identity` (ritorno su `/accedi`). Se `load()` non trova la riga (RLS:
     utente senza profilo), il servizio rifiuta con un errore distinto da quello di rete e la sezione mostra
     solo lo stato di errore, senza dati.
6. **Validazione degli importi** (client, ripetuta sul server), funzione pura `parseEuroInput`:
   - accetta cifre con al massimo un separatore decimale, virgola o punto, e al massimo due decimali;
     spazi iniziali e finali ignorati; nessun separatore delle migliaia;
   - "1" → 100, "1,5" → 150, "1,50" → 150, "1.50" → 150; "1.250" → errore (tre decimali: protegge
     dall'ambiguità con il punto delle migliaia italiano);
   - messaggi (sotto il campo, colore `danger-text`, `aria-invalid`, `aria-describedby`):
     - vuoto: "Inserisci un importo, per esempio 1,00."
     - caratteri non validi: "Scrivi solo cifre e la virgola, per esempio 1,50."
     - più di due decimali: "Usa al massimo due decimali, per esempio 1,50."
     - zero: "Deve essere maggiore di 0,00 €."
     - rapporto oltre il massimo: "Al massimo 100,00 € per punto."
     - soglia oltre il massimo: "Al massimo 10.000,00 €."
   - con un errore Salva non invia nulla e il focus va al primo campo errato.
7. **Hook condiviso `useSettings()`** e servizio `SettingsService` (implementazione Supabase + finto per i
   test), descritti in "Code Style". Il rapporto letto dal client serve solo all'anteprima dei punti: i punti
   della spesa li calcola `app.record_purchase` sul server leggendo `app.settings` nella stessa transazione.
8. **Formato del lettore USB** (`usb_uid_format`): colonna e parametro della funzione esistono da subito
   (`card-input` dipende da `settings`, DECISIONS 2026-11-16), ma **nessun campo nell'interfaccia** in questo
   modulo. Il campo "Formato del lettore USB" lo aggiunge `tablet-kiosk`. Perché: il telefono non ha lettore
   USB; il lettore non è ancora comprato e il suo formato "va verificato prima dell'acquisto" (specifiche);
   il wireframe Tablet: impostazioni non mostra il campo; un'impostazione visibile ma senza effetto può
   essere cambiata per errore e rompere la lettura il giorno in cui arriva il lettore.

### Modello dati e regole di accesso

```sql
-- app.settings: configurazione unica del bar (una sola riga)
id                       boolean primary key default true check (id)
cents_per_point          int  not null default 100   check (cents_per_point between 1 and 10000)
confirm_threshold_cents  int  not null default 15000 check (confirm_threshold_cents between 1 and 1000000)
usb_uid_format           text not null default 'hex'
                         check (usb_uid_format in ('hex', 'hex-reversed', 'dec', 'dec-reversed'))
updated_at               timestamptz not null default now()
updated_by               uuid null references app.operators(id)   -- null solo per la riga iniziale
-- La migrazione esegue: insert into app.settings default values;
```

- I valori ammessi di `usb_uid_format`: il contratto dice che li definisce `card-input`, ma `card-input`
  dipende da `settings` e la colonna nasce qui. Si fissano qui i quattro valori sotto (DECISIONS 2026-11-16:
  "decimale/esadecimale, ordine dei byte"); se `card-input` ne serve un altro, lo aggiunge con una propria
  migrazione che cambia il `check` (vedi Open Questions).
- Significato dei formati USB (la conversione la implementa `card-input` in `normalizeUid()`): `hex` uid in
  esadecimale nell'ordine dei byte del tag; `hex-reversed` esadecimale con byte invertiti; `dec` intero
  decimale dei byte nell'ordine del tag; `dec-reversed` intero decimale con byte invertiti.
- **Lettura**: policy `select` per `private.is_active_operator()`. Utenti senza profilo e `anon`: nulla.
- **Scrittura**: `revoke insert, update, delete, truncate on app.settings from authenticated, anon`; la riga
  non si crea né si cancella dall'API, cambia solo con la funzione.
- `app.update_settings(p_cents_per_point int, p_confirm_threshold_cents int, p_usb_uid_format text default
  null) returns app.settings` — `security definer`, `set search_path = ''`; la migrazione esegue in modo
  esplicito `revoke execute ... from public, anon` e `grant execute ... to authenticated` (non ci si affida ai
  privilegi predefiniti: vedi `20261117230000_function_privileges.sql`, Postgres concede `execute` a
  `public` su ogni nuova funzione):
  - se `not private.is_admin()`: `raise exception using errcode = '42501'` (permesso negato);
  - valori fuori dai limiti: `errcode = '22023'` (parametro non valido), messaggio in inglese per i log;
  - `p_usb_uid_format` null = invariato (il telefono non lo invia mai);
  - aggiorna la riga con `updated_at = now()`, `updated_by = private.acting_operator_id()` e la restituisce.
    `private.acting_operator_id()` oggi **non esiste** (verificato nelle migrazioni di `identity`): la
    migrazione di `settings` la crea con `create or replace function private.acting_operator_id()` con il corpo comune a `settings`, `customers` e `rewards` (identico parola per parola): `select private.current_operator_id()`, `stable`, `security definer`, `set search_path = ''`, `revoke execute ... from public, anon, authenticated` (la chiamano solo funzioni `security definer`). `customers` e `rewards`, costruiti in parallelo,
    usano la stessa definizione identica (chi arriva dopo la ridefinisce uguale); `tablet-kiosk` la estende.
  - Idempotente per natura (imposta valori assoluti): non serve `operation_id`. Due amministratori che
    salvano insieme: vale l'ultimo salvataggio (vedi Open Questions).
- Lo storico non dipende da questa tabella: ogni movimento salva il proprio `cents_per_point` (`ledger`).

## Commands

Nessun comando nuovo. Si usano `npm test`, `npm run db:test`, `npm run test:integration`, `npm run e2e`.
`test:integration` è previsto da `SPEC-identity.md` ma non è ancora in `package.json` (task aperto in
`tasks/identity/todo.md`): se manca quando si implementa `settings`, lo si aggiunge prima, come da quel task.

## Project Structure

```
supabase/migrations/<timestamp>_settings.sql   → tabella, riga iniziale, policy, update_settings
supabase/tests/settings.test.sql               → pgTAP
src/features/settings/
  types.ts                 → Settings, UsbUidFormat, SettingsService, UpdateSettingsResult
  supabaseSettingsService.ts (+ .test.ts)      → mappa righe ed errori Postgres
  SettingsProvider.tsx (+ .test.tsx)           → contesto + useSettings()
  parseEuroInput.ts (+ .test.ts)               → validazione pura, messaggi italiani
  PointsSettingsSection.tsx (+ .module.css, .test.tsx) → sezione admin / operatore
src/test/fakeSettingsService.ts                → servizio finto in memoria
src/test/renderApp.tsx                         → monta anche SettingsProvider con il finto
src/features/identity/SettingsPage.tsx         → rende <PointsSettingsSection/> sotto l'account
tests/integration/settings.test.ts             → Vitest contro lo stack locale
e2e/settings.spec.ts                           → in un progetto Playwright a parte, eseguito dopo gli altri
```

`SettingsProvider` sta dentro `RequireAuth` (serve un operatore collegato) e carica la riga una volta per
sessione; ricarica dopo un salvataggio e quando la pagina torna visibile (`visibilitychange`), così un
telefono rimasto aperto vede il rapporto cambiato da un altro amministratore. Niente Realtime.

## Code Style

Come `platform` e `identity`: i componenti non chiamano mai `getSupabase()`; importi sempre in centesimi
interi nei tipi; testo UI in italiano nei componenti; solo token CSS.

```ts
export type UsbUidFormat = 'hex' | 'hex-reversed' | 'dec' | 'dec-reversed';
export type Settings = {
  centsPerPoint: number;          // 100 = 1 punto ogni 1,00 €
  confirmThresholdCents: number;  // conferma se amount_cents > soglia
  usbUidFormat: UsbUidFormat;
  updatedAt: string;
};
export type UpdateSettingsResult =
  | { status: 'ok'; settings: Settings }
  | { status: 'forbidden' | 'invalid' | 'network' | 'unknown' };
export type SettingsService = {
  // rifiuta con SettingsLoadError { kind: 'network' | 'not-found' | 'unknown' }
  // ('not-found' = nessuna riga visibile: RLS, utente senza profilo)
  load(): Promise<Settings>;
  update(input: { centsPerPoint: number; confirmThresholdCents: number }): Promise<UpdateSettingsResult>;
};
export type SettingsState =
  | { status: 'loading' } | { status: 'error'; retry: () => void }
  | { status: 'ready'; settings: Settings };
export function useSettings(): SettingsState & { save: SettingsService['update'] };
```

- `ledger` usa `confirmThresholdCents` così: chiede conferma quando l'importo è **strettamente sopra** la
  soglia ("Sopra 150,00 € l'app chiede conferma", wireframe Importo insolito); 150,00 € esatti non la chiedono.
  Il testo "Sopra 150,00 €" di quella schermata mostra la soglia in vigore (`formatCents(confirmThresholdCents)`),
  non un valore scritto nel codice. La soglia è solo un controllo dell'interfaccia: il server non rifiuta
  importi sopra soglia.
- Il campo con label a sinistra e "€" a destra si ottiene estendendo `TextField` con le prop facoltative
  `layout="inline"` e `suffix`, senza cambiare il comportamento attuale (test esistenti verdi).
- Il valore iniziale dei campi si ottiene da centesimi con una funzione pura `centsToEuroInput(150) → "1,50"`.

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP (`settings.test.sql`) | esiste esattamente una riga con 100 / 15000 / 'hex' e `updated_by` null; non si può inserire una seconda riga né cancellarla; operatore attivo legge, utente senza profilo e `anon` non leggono; `update`/`insert`/`delete` diretti negati ad `authenticated`; `anon` non ha `execute` su `update_settings` (`function_privs_are` o `has_function_privilege`); `update_settings` da operatore e da utente senza profilo → 42501, riga invariata; da admin aggiorna valori, `updated_at`, `updated_by` = id del profilo admin; valori 0, negativi, appena oltre i limiti (10001, 1000001) e formato USB sconosciuto → 22023, mentre i limiti esatti (1, 10000, 1000000) sono accettati; `p_usb_uid_format` null lascia il formato invariato, `'dec'` lo cambia; chiamata ripetuta con gli stessi valori dà gli stessi valori (cambia solo `updated_at`); `private.acting_operator_id()` verificata attraverso `updated_by` (= id del profilo chiamante) e senza `execute` per `authenticated`/`anon` |
| Unità (Vitest) | `parseEuroInput` (tutti i casi del punto 6, compresi "1.250", " 2 ", "0,00", "abc", "-1", "1,555", "100,00" e "100,01" per il rapporto, "10000,00" e "10000,01" per la soglia); `centsToEuroInput` (100 → "1,00", 15000 → "150,00", 5 → "0,05"); mappatura del servizio Supabase (42501 → forbidden, 22023 → invalid, fetch fallita → network, nessuna riga → `not-found`, da riga snake_case a `Settings`) |
| Componenti (Vitest + Testing Library, `fakeSettingsService` e `fakeAuthService`) | admin: campi precompilati "1,00" e "150,00", salvataggio ok con messaggio e valori riformattati, errori di validazione con focus e nessuna chiamata a `update`, doppio tocco su Salva → una sola chiamata, errore di rete con valori conservati e nuovo Salva riuscito, forbidden, invalid/unknown; ricarica su `visibilitychange` che non sovrascrive un campo modificato; operatore: sezione "PUNTI" in sola lettura senza campi né Salva, nessuna soglia, nota finale presente; caricamento ed errore con Riprova (Riprova richiama `load`) |
| Integrazione (Vitest + stack locale) | con le credenziali del seed l'operatore legge `app.settings`, riceve 42501 da `update_settings` e un `update` diretto non cambia nulla; l'admin salva e rilegge, poi ripristina i valori iniziali |
| E2E (Playwright, 390×844, build di produzione, Supabase locale) | admin: cambia il rapporto a 2,00 € e la soglia a 200,00 €, salva, ricarica la pagina e ritrova i valori; errore "Usa al massimo due decimali" con "1,555"; operatore: vede "1 punto ogni 2,00 € di spesa" e nessun campo modificabile; target di tocco ≥ 48 px; nessun errore in console. Siccome la configurazione è unica e condivisa e `playwright.config.ts` usa `fullyParallel: true`, questi test cambiano lo stato globale: stanno in un progetto Playwright separato con `dependencies` sul progetto principale (girano dopo tutti gli altri), in modalità seriale, e ripristinano 100 / 15000 in `afterAll` tramite l'admin. Il test che una spesa usa il nuovo rapporto sta in `e2e/ledger.spec.ts` e usa l'adattatore card finto (`window.__enjoyFakeCard`); poiché cambia il rapporto, va nello stesso progetto separato |

## Boundaries

- **Always**: controllo del ruolo **sul server** (la UI nasconde solo i campi); importi in centesimi interi
  ovunque, conversione da/verso testo solo ai bordi; stessi limiti nel client e nei `check` del database;
  il calcolo dei punti avviene sul server con il rapporto letto nella transazione della spesa.
- **Ask first**: cambiare i valori iniziali o i limiti; mostrare la soglia agli operatori; aggiungere un
  registro delle modifiche alla configurazione; esporre il formato USB prima di `tablet-kiosk`.
- **Never**: ricalcolare o aggiornare movimenti passati quando cambia il rapporto; scritture dirette su
  `app.settings` dall'API; decimali in euro (`numeric`/float) nel database o nei tipi.

## Success Criteria

1. Dopo `npm run db:reset`, `app.settings` ha una riga con 100, 15000, `'hex'`; un secondo `insert` fallisce.
2. Un operatore vede "1 punto ogni 1,00 € di spesa" e "Il rapporto lo decide un amministratore.", senza
   campi né Salva; chiamando `app.update_settings` dall'API riceve un errore di permesso (pgTAP + integrazione).
3. Un amministratore imposta "2,00" e "200,00", salva, vede "Impostazioni salvate."; dopo il ricaricamento i
   campi mostrano "2,00" e "200,00" e `updated_by` è il suo profilo.
4. Input "0", "", "abc", "1,555", "1.250", "100,01" (rapporto), "10000,01" (soglia) mostrano il messaggio
   italiano previsto e non partono richieste; "1.50" e "1,5" sono accettati come 150 centesimi.
5. Con la rete interrotta Salva mostra l'errore di rete, i valori digitati restano, e al ritorno della rete
   un nuovo Salva riesce (test di componente con il servizio finto).
6. `anon` e utenti senza profilo non leggono `app.settings` né eseguono `app.update_settings`; nessuna
   scrittura diretta sulla tabella riesce da `authenticated` (pgTAP).
7. Nel codice, solo `src/features/settings/supabaseSettingsService.ts` interroga la tabella `settings` o
   chiama `update_settings` (verifica in review: `grep -rn "settings'" src` non trova altri accessi a
   Supabase); i componenti leggono la configurazione solo con `useSettings()`.
8. Schermate a 390×844: testi, ordine delle sezioni e valori iniziali come nei wireframe Impostazioni e
   Impostazioni operatore (asserzioni E2E sui testi e sull'ordine); detector Impeccable pulito; CI verde
   (typecheck, lint, test, pgTAP, integrazione, E2E).

Verificato in `ledger`, non qui (dipende da quel modulo): i movimenti registrati prima di un cambio di
rapporto conservano `cents_per_point` e punti originali, e la spesa successiva usa il nuovo rapporto.

## Out of Scope (Deferred)

- Campo "Formato del lettore USB" nell'interfaccia: `tablet-kiosk` (la colonna esiste già).
- Wireframe "Tablet: impostazioni": impaginazione a 1280×800, intestazione "Alla cassa: Giulia · Cambia" e
  voce "Account, ruoli, inviti e PIN": `tablet-kiosk` (la sezione PUNTI E CONTROLLI è la stessa del telefono).
- Wireframe "Importo insolito" (importo, "Importo insolito: +1250 punti", tastierino, Correggi,
  "Conferma 1.250 €"): `ledger`. Qui si fissa solo il significato della soglia (vedi Code Style).
- Riquadro account (iniziale, nome, ruolo, Esci): già in `identity`.
- Sezioni GESTIONE (Operatori, Catalogo premi) ed ESPORTA DATI di `/impostazioni`: moduli `identity`
  (dopo la V1), `rewards`, `export`.
- "Cambia password" nella sezione ACCOUNT dell'operatore: aggiunta di `identity` dopo la V1.
- Registro storico dei cambi di configurazione (resta solo `updated_at`/`updated_by`).
- Avviso del server quando una spesa usa un rapporto diverso dall'anteprima: lo gestisce `ledger` mostrando
  i punti restituiti dal server.

## Open Questions

1. **Formato USB nascosto fino al tablet.** Proposta: colonna e parametro ora, campo nell'interfaccia solo
   con `tablet-kiosk`, dopo aver verificato il formato del lettore comprato (default adottato).
2. **Limiti dei valori.** Le fonti dicono solo "maggiore di zero". Proposta: rapporto da 0,01 € a 100,00 € per
   punto; soglia da 0,01 € a 10.000,00 € (default adottato).
3. **Separatore decimale.** Proposta: virgola o punto, al massimo due decimali, niente separatore delle
   migliaia; "1.250" rifiutato (default adottato).
4. **Soglia "sopra".** Proposta: conferma solo se l'importo è strettamente maggiore della soglia (default
   adottato, dal testo "Sopra 150,00 €").
5. **Soglia visibile all'operatore.** Il wireframe operatore mostra solo il rapporto. Proposta: soglia non
   mostrata (default adottato).
6. **Salvataggi contemporanei di due amministratori.** Proposta: vale l'ultimo, senza avviso di conflitto;
   i pochi titolari rendono il caso raro (default adottato).
7. **Conferma del salvataggio.** I wireframe non mostrano cosa succede dopo Salva. Proposta: messaggio
   "Impostazioni salvate." in una regione `aria-live`, nessuna finestra di conferma (default adottato).
8. **Valori ammessi del formato USB.** Il contratto li affida a `card-input`, ma la colonna nasce qui.
   Proposta: `hex`, `hex-reversed`, `dec`, `dec-reversed` (da DECISIONS 2026-11-16); `card-input` può
   aggiungerne con una propria migrazione (default adottato).
9. **Testi dei messaggi.** Le fonti non danno i testi di validazione e di errore della sezione (punti 5 e 6).
   Proposta: i testi scritti in questa spec, da rivedere con il titolare insieme agli altri testi dell'app
   (default adottato).
