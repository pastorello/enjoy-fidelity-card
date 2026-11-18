# Todo: export

Fonte: [plan.md](plan.md) · Spec: [SPEC-export.md](../../docs/specs/SPEC-export.md). Ogni task chiude con
`npm run typecheck && npm run lint && npm run format:check && npm test && npm run db:test &&
npm run test:integration && npm run e2e` verdi e un commit Conventional Commits sul branch `feat/export`.
Test prima del codice (`test-driven-development`). Solo lo stack Supabase locale (`npm run db:start`, poi
`scripts/reload-auth-templates.sh`); mai i progetti remoti. Solo dati finti (`@example`).

## Task 1: Esportazione dei clienti nel database
**Descrizione:** `npx supabase migration new export`: `app.export_customers(p_after_id uuid default null,
p_limit int default 1000)` con le colonne della spec ("Modello dati"). `security definer`, `stable`,
`set search_path = ''`; prima riga `if not private.is_admin() then raise exception … using errcode =
'42501'`; poi `p_limit` null o fuori 1–1000 → `22023`. Righe con `id > p_after_id` (o dall'inizio) in
ordine di `id`, `limit p_limit`; `balance_points` = `private.customer_balance(c.id)`; `active_card_uid`
dalla card con `active` del cliente; `created_by_name` dal nome dell'operatore; per gli anonimizzati `name`,
`phone`, `notes`, `active_card_uid` restituiti `null`. `revoke execute … from public, anon`;
`grant execute … to authenticated`.
**Accettazione:**
- [x] pgTAP: l'admin riceve le colonne attese; operatore, utente senza profilo e operatore scollegato →
      `42501`; `anon` e `public` senza `execute` (`has_function_privilege`); `provolatile = 's'`
- [x] pgTAP: anonimizzato (creato e anonimizzato nel test) con `name`, `phone`, `notes`, `active_card_uid`
      `null`, saldo presente; `balance_points` = somma con le correzioni, `0` senza movimenti
- [x] pgTAP: due pagine con `p_limit = 2` coprono tutte le righe senza duplicati; `p_limit` 0, 1001 e
      null → `22023`; `function_privileges.test.sql` verde
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** nessuna · **File:** supabase/migrations/*_export.sql, supabase/tests/export.test.sql ·
**Dimensione:** M

## Task 2: Esportazione dei movimenti nel database
**Descrizione:** nella stessa migrazione `app.export_movements(p_after_created_at timestamptz default null,
p_after_id uuid default null, p_limit int default 1000)`: stessi attributi e stesso primo controllo; un solo
campo del cursore null → `22023`; righe con `(created_at, id) > (p_after_created_at, p_after_id)` in
ordine `(created_at, id)`. `customer_name` = nome attuale del cliente (`null` se anonimizzato);
`description` = `movements.description`, altrimenti nome del premio; `operator_name`;
`corrected_by_movement_id` dalla correzione che punta al movimento. Nessun indice nuovo
(`movements_created_idx` di `ledger`).
**Accettazione:**
- [x] pgTAP: admin legge; operatore, utente senza profilo e `anon` → `42501` / permesso negato;
      `provolatile = 's'`; nessun privilegio a `anon`/`public`
- [x] pgTAP: spesa con `amount_cents`, `points`, `cents_per_point`; riscatto con la descrizione o il nome
      del premio; `corrected_by_movement_id` coerente con `corrects_movement_id`; movimenti di un
      anonimizzato presenti con `customer_name` `null`; nome attuale dopo una rinomina del cliente
- [x] pgTAP: due pagine con `p_limit = 2` (anche con `created_at` uguali) coprono tutto senza duplicati;
      `p_limit` 0, 1001, null e cursore con un solo campo → `22023`
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 1 · **File:** supabase/migrations/*_export.sql, supabase/tests/export.test.sql ·
**Dimensione:** M

## Checkpoint A
- [x] `db:test` verde (anche `function_privileges.test.sql` e `rls_default.test.sql`)
- [x] Revisione `security-and-hardening`: ruolo prima di tutto, `search_path` vuoto, privilegi, anonimizzati
      azzerati in SQL, nessuna scrittura possibile
- [ ] Revisione con l'utente prima del client

## Task 3: Testo CSV e difesa dalle formule
**Descrizione:** `src/features/export/csv.ts`: `BOM` (`﻿`), `escapeField` (virgolette solo con `;`, `"`,
CR o LF, virgolette interne raddoppiate), `guardFormula` (apostrofo iniziale su `=`, `+`, `-`, `@`, TAB, CR),
`excelText` (`="…"` solo se il valore rispetta `^\+?[0-9A-F]{1,20}$`, altrimenti testo libero protetto),
`toCsv(header, rows)` con `;` e CRLF. Il test contiene un parser RFC 4180 a `;` per rileggere le righe.
**Accettazione:**
- [x] Unità: `;`, `"` e a capo tra virgolette; nome con `;` e `"` riletto identico dal parser (criterio 6)
- [x] Unità: `=SOMMA(A1)` → `'=SOMMA(A1)`; lo stesso per `+`, `-`, `@`, TAB, CR; `-12,50` e `-12` come
      numeri restano intatti
- [x] Unità: `excelText('+393331234567')` → `="+393331234567"` (con le virgolette raddoppiate dentro il
      campo); valore con `"` o lettere non esadecimali → testo protetto; BOM in testa e CRLF in coda a ogni riga
**Verifica:** `npm test -- export/csv`
**Dipendenze:** nessuna · **File:** src/features/export/csv.ts (+ .test.ts) · **Dimensione:** S

## Task 4: Euro, date e nomi dei file
**Descrizione:** `src/features/export/formatExport.ts`: `centsToEuroCell` (`1250` → `12,50`, `-1250` →
`-12,50`, niente `€` né migliaia; non intero → `RangeError`), `romeDateTime(iso)` (`gg/mm/aaaa hh:mm:ss`,
`Europe/Rome`, `hourCycle: 'h23'`, `formatToParts`; assente → vuoto), `romeDateStamp(date)` (`AAAA-MM-GG`
di Roma), `exportFileName(kind, now)`, `kindLabel` (`Spesa` | `Riscatto` | `Correzione`).
**Accettazione:**
- [x] Unità: `centsToEuroCell` con 0, 5, 1250, -1250, 123456; `1.5` → `RangeError`
- [x] Unità (criterio 4): `2026-07-01T10:05:00Z` → `01/07/2026 12:05:00`; `2026-01-15T10:05:00Z` →
      `15/01/2026 11:05:00`; mezzanotte → `00:…`, mai `24:…`; con un fuso del processo diverso da Roma
- [x] Unità (criterio 8): alle 23:30 UTC del 17 novembre → `enjoy-movimenti-2026-11-18.csv`
**Verifica:** `npm test -- formatExport`
**Dipendenze:** nessuna · **File:** src/features/export/formatExport.ts (+ .test.ts) · **Dimensione:** S

## Task 5: Righe e file Clienti e Movimenti
**Descrizione:** `types.ts` (`CustomerExportRow`, `MovementExportRow` in centesimi interi e date ISO come
stringhe, `ExportKind`, `ExportResult`, `ExportService` come nella spec, "Code Style");
`buildCustomersCsv.ts` e `buildMovementsCsv.ts`: intestazioni italiane nell'ordine della spec (punto 5),
testo libero con `guardFormula`, telefono e uid con `excelText`, importi e rapporto solo per le spese, codici
di correzione solo dove servono. Clienti ordinati per nome con `Intl.Collator('it-IT', { sensitivity:
'base' })`, anonimizzati in fondo per data di creazione; movimenti nell'ordine del server. Campi personali di
un anonimizzato vuoti anche se la riga li contiene.
**Accettazione:**
- [x] Unità (criterio 3): intestazione Movimenti esatta della spec; spesa 1250 con rapporto 100 → `12,50`,
      `12`, `1,00`; riscatto senza importo né rapporto; correzione con "Annulla il movimento"
- [x] Unità (criterio 5): anonimizzato con `Nome`, `Telefono`, `Note`, `Card attiva` vuoti e saldo; i suoi
      movimenti con `Cliente` vuoto
- [x] Unità (criterio 6): nome `=1+1` nei due file → `'=1+1`; ordinamento con accenti ("Èlia" fra "Elia" e
      "Fabio") e anonimizzati in fondo; nessuna riga → solo intestazione
**Verifica:** `npm test -- export/build`
**Dipendenze:** 3, 4 · **File:** src/features/export/types.ts, buildCustomersCsv.ts (+ .test.ts),
buildMovementsCsv.ts (+ .test.ts) · **Dimensione:** M

## Task 6: Paginazione a chiave
**Descrizione:** `src/features/export/fetchAllPages.ts`: `fetchAllPages(fetchPage, cursorOf, limit =
1000)` chiede pagine finché ne riceve una più corta di `limit`; il cursore è preso dall'ultima riga così
come arriva (stringa di `created_at` con i microsecondi, mai passata per `Date`); un errore a qualunque
pagina rifiuta senza righe.
**Accettazione:**
- [x] Unità: 0, 1000 (due chiamate, la seconda vuota) e 1001 righe (criterio 7); cursori passati alla
      seconda pagina esattamente come ricevuti
- [x] Unità: errore alla seconda pagina → la promessa rifiuta con quell'errore, nessun risultato parziale
**Verifica:** `npm test -- fetchAllPages`
**Dipendenze:** 5 · **File:** src/features/export/fetchAllPages.ts (+ .test.ts) · **Dimensione:** S

## Checkpoint B
- [x] Unità del modulo verdi; test esistenti invariati
- [x] Revisione delle funzioni pure contro la spec (punto 4 e 5)

## Task 7: Servizio Supabase e guardia del confine
**Descrizione:** `supabaseExportService.ts`: `fetchCustomers()` e `fetchMovements()` con `fetchAllPages` e
le RPC `export_customers` / `export_movements` (schema `app`), mappa le colonne snake_case nei tipi.
Traduzione degli errori: `serverFaultFor` → `ServerFaultError`; `42501` dell'app → errore `forbidden`;
`TypeError` di fetch → `network`; altro → `unknown`. `scripts/exportBoundary.test.ts`: solo il servizio
usa `getSupabase()` e nomina le due RPC; solo `main.tsx` lo importa; solo `downloadFile.ts` usa `document`
o `URL.createObjectURL`; nessun `console.*`, `localStorage`, `sessionStorage` nel modulo; ogni `errcode`
sollevato da `*_export.sql` ha una traduzione.
**Accettazione:**
- [x] Unità con client finto: parametri e cursori delle RPC; `42501` → forbidden; `42501` "permission
      denied for function" → guasto del server; fetch fallita → network; altro → unknown
- [x] La guardia fallisce se un componente chiama Supabase, se un file diverso da `downloadFile.ts` crea il
      download, o se il modulo logga
**Verifica:** `npm test -- supabaseExportService exportBoundary`
**Dipendenze:** 6 · **File:** src/features/export/supabaseExportService.ts (+ .test.ts),
scripts/exportBoundary.test.ts · **Dimensione:** M

## Task 8: Integrazione contro lo stack locale
**Descrizione:** `tests/integration/export.test.ts` con le credenziali del seed: l'operatore riceve `42501`
da entrambe le RPC; l'admin le legge (anche a pagine con `p_limit` piccolo); un cliente finto creato e
anonimizzato nel test con le RPC di `customers` (`create_customer`, `anonymize_customer`): il suo nome
originale non compare nel corpo della risposta HTTP di nessuna delle due.
**Accettazione:**
- [ ] Operatore rifiutato da entrambe (criterio 2)
- [ ] Nome originale dell'anonimizzato assente dal corpo HTTP (criterio 5); saldo presente
- [ ] Il test non lascia dati che rompano gli altri (nome univoco per esecuzione)
**Verifica:** `npm run db:start && npm run test:integration -- export`
**Dipendenze:** 2, 7 · **File:** tests/integration/export.test.ts · **Dimensione:** S

## Task 9: Servizio finto e provider
**Descrizione:** `src/test/fakeExportService.ts` (righe in memoria con dati `@example`, ruolo come il server,
rete giù alla prima o alla seconda pagina, registro delle chiamate); `ExportServiceProvider.tsx` con
`useExportService()` e la funzione di download (default `downloadFile`); `main.tsx` monta il servizio vero;
`renderApp` riceve il finto come nuovo parametro facoltativo in coda.
**Accettazione:**
- [ ] Unità del finto: operatore → forbidden; rete giù su una pagina → rifiuta; registro delle chiamate
- [ ] Senza provider `useExportService()` lancia un errore chiaro; test esistenti di `renderApp` invariati
**Verifica:** `npm test`
**Dipendenze:** 7 · **File:** src/test/fakeExportService.ts (+ .test.ts),
src/features/export/ExportServiceProvider.tsx, src/main.tsx, src/test/renderApp.tsx · **Dimensione:** M

## Task 10: Percorso completo dell'esportazione
**Descrizione:** `downloadFile.ts` (`Blob` `text/csv;charset=utf-8`, `URL.createObjectURL`, `<a download>`,
`revokeObjectURL` in `setTimeout`); `useExport(kind)`: legge le pagine dal servizio, costruisce il CSV,
chiama il download con `exportFileName(kind, now)` e restituisce `{ status: 'ok', count }` oppure
`forbidden` / `network` / `unknown`; `busy`; `run()` ignorato mentre è in corso.
**Accettazione:**
- [ ] Hook: due `run()` di fila → una sola chiamata al servizio; `busy` vero durante e falso dopo
- [ ] Hook (criterio 7): errore di rete alla seconda pagina → `network`, download mai chiamato; nuovo
      `run()` riuscito
- [ ] Hook (criterio 8): nome del file con la data di Roma; `downloadFile` con jsdom: tipo del `Blob`,
      attributo `download`, revoca dopo il clic, non prima
**Verifica:** `npm test -- useExport downloadFile`
**Dipendenze:** 9 · **File:** src/features/export/downloadFile.ts (+ .test.ts), useExport.ts
(+ .test.tsx) · **Dimensione:** M

## Checkpoint C
- [ ] Quality bar completa verde
- [ ] Revisione con l'utente prima della UI

## Task 11: Sezione ESPORTA DATI nelle Impostazioni
**Descrizione:** icona Lucide `download` in `Icon.tsx` (i tre tracciati del wireframe); `ExportSection.tsx`
(+ `.module.css`, solo token): titolo di sezione come le altre ("ESPORTA DATI"), griglia a due colonne,
pulsanti `secondary` alti 48 px con icona, "Clienti CSV" a sinistra e "Movimenti CSV" a destra, regione
`aria-live="polite"` sotto. `SettingsPage` la rende dopo `RewardsSettingsSection` e prima di
`OperatorFinalNote`, solo se `operator.role === 'admin'`.
**Accettazione:**
- [ ] Componente (criterio 1): l'admin vede titolo e due pulsanti nell'ordine; l'operatore non vede la
      sezione (e vede ancora la nota finale di `settings`)
- [ ] Componente (criterio 9): la sezione è l'ultima della pagina dell'admin; target ≥ 48 px
- [ ] Detector Impeccable pulito; `displayGlyphs.test.ts` verde
**Verifica:** `npm test -- ExportSection SettingsPage displayGlyphs`
**Dipendenze:** 10 · **File:** src/shared/ui/Icon.tsx, src/features/export/ExportSection.tsx
(+ .module.css, .test.tsx), src/features/identity/SettingsPage.tsx · **Dimensione:** M

## Task 12: Stati della sezione
**Descrizione:** `ExportSection` collega i due pulsanti a `useExport`: il pulsante toccato è `busy`,
l'altro resta usabile; la regione dice "Preparazione del file…", poi "Clienti esportati: 312." /
"Movimenti esportati: 4.518." (`formatInteger`), "Nessun cliente da esportare: il file contiene solo le
intestazioni." (idem movimenti), "Esportazione non riuscita: controlla la connessione e riprova.", "Solo un
amministratore può esportare i dati." con `reportNotEnabled()`, "Esportazione non riuscita. Riprova; se
succede ancora, avvisa chi gestisce l'app." (anche per un guasto del server).
**Accettazione:**
- [ ] Componente: due clic rapidi → una sola chiamata; messaggi di in corso, successo con conteggio
      raggruppato, nessun dato (file comunque scaricato)
- [ ] Componente (criterio 7): rete giù → messaggio, download non chiamato, pulsante di nuovo attivo, nuovo
      tocco riuscito; imprevisto → messaggio
- [ ] Componente: `forbidden` → messaggio e `reportNotEnabled()` chiamato (la sezione sparisce quando il
      ruolo diventa operatore)
**Verifica:** `npm test -- ExportSection`
**Dipendenze:** 11 · **File:** src/features/export/ExportSection.tsx (+ .test.tsx),
src/features/export/exportMessages.ts · **Dimensione:** M

## Checkpoint D
- [ ] Quality bar completa verde; detector Impeccable pulito
- [ ] Screenshot 390×844 confrontato con il wireframe Impostazioni (sezione ultima, pulsanti affiancati)
- [ ] Revisione `security-and-hardening` del client: difesa dalle formule, nessun contenuto nei log o negli
      storage, ruolo deciso dal server

## Task 13: E2E dell'esportazione
**Descrizione:** `e2e/export.spec.ts` nel progetto `phone` (390×844, build di produzione, Supabase
locale): l'admin crea un cliente con nome univoco e una spesa di 12,50 € con la UI; tocca "Clienti CSV" e
"Movimenti CSV" con `page.waitForEvent('download')`; legge i file da `download.path()`. RPC interrotta con
`page.route(...).abort()` → nessun download, messaggio di rete, nuovo tocco riuscito. L'operatore non vede
la sezione.
**Accettazione:**
- [ ] Nomi `enjoy-clienti-<oggi a Roma>.csv` e `enjoy-movimenti-<oggi a Roma>.csv` (criterio 8); BOM,
      intestazioni italiane, `;`; il cliente del test con il saldo e la spesa con `12,50` (criterio 3)
- [ ] Rete interrotta e nuovo tocco (criterio 7); operatore senza sezione (criterio 1)
- [ ] Sezione ultima con i pulsanti affiancati, "Clienti CSV" a sinistra, ≥ 48 px con icona (criterio 9);
      nessun errore in console; nessuna richiesta a Supabase ospitato
**Verifica:** `npm run e2e -- export`
**Dipendenze:** 12, 8 · **File:** e2e/export.spec.ts · **Dimensione:** S

## Task 14: Glifi, procedura manuale e memoria di progetto
**Descrizione:** `scripts/displayGlyphs.test.ts` copre i testi di `ExportSection` (se non già coperti dai
`Button`). RUNBOOK: sezione «Prova manuale dell'esportazione» (criterio 10: PWA installata su Android,
anteprima HTTPS con lo staging, i due file scaricati e aperti in Excel o Fogli Google, colonne e accenti,
esito da annotare). `brain/STATUS.md` aggiornato; `CAPABILITY-MAP.md` se cambia qualcosa.
**Accettazione:**
- [ ] La procedura indica i passi, cosa controllare nei due file e dove annotare l'esito
- [ ] Nessun segreto né dato reale nei documenti
**Verifica:** `npm test -- displayGlyphs`; rilettura
**Dipendenze:** 13 · **File:** scripts/displayGlyphs.test.ts, brain/topics/operations/RUNBOOK.md,
brain/STATUS.md · **Dimensione:** S

## Task 15: Verifica dei criteri di successo e PR
**Descrizione:** sezione «Verifica dei criteri di successo» in `plan.md` con, per ogni criterio, i test che
lo provano (`file › titolo`); `scripts/exportCriteria.test.ts` come `ledgerCriteria.test.ts` (10 criteri,
ogni prova esiste, il criterio 10 rimanda al RUNBOOK). `brain/MAP.md` registra il modulo. PR da
`feat/export` su `main`, da unire dopo #21.
**Accettazione:**
- [ ] Ogni criterio 1–9 ha almeno una prova esistente; il 10 rimanda alla procedura del RUNBOOK
- [ ] Quality bar completa verde; `npm run build && npm run check:bundle` verde
- [ ] PR aperta con base `main`, con la nota "unire dopo #21"
**Verifica:** `npm test -- exportCriteria`; quality bar completa
**Dipendenze:** 14 · **File:** tasks/export/plan.md, tasks/export/todo.md, scripts/exportCriteria.test.ts,
brain/MAP.md · **Dimensione:** S

## Checkpoint E
- [ ] I criteri 1–9 verificati; criterio 10 sul telefono con l'utente dopo la pubblicazione su staging
      (esito nel RUNBOOK)
- [ ] Quality bar completa verde in CI
- [ ] PR pronta per `code-review-and-quality`
