# Todo: customers

Fonte: [plan.md](plan.md) · Spec: [SPEC-customers.md](../../SPEC-customers.md). Ogni task chiude con
`npm run typecheck && npm run lint && npm run format:check && npm test && npm run db:test &&
npm run test:integration && npm run e2e` verdi e un commit Conventional Commits sul branch
`feat/customers`. Test prima del codice (`test-driven-development`). Solo lo stack Supabase locale
(`npm run db:start`, poi `scripts/reload-auth-templates.sh`); mai i progetti remoti. Solo dati finti
(`@example.com`, telefoni `+39333000…`).

## Task 1: Tabella clienti, chiave del nome e creazione idempotente
**Descrizione:** `npx supabase migration new customers`: estensione `unaccent` in `extensions`;
`private.clean_name(text)` (btrim, spazi interni ridotti) e `private.customer_name_key(text)` `immutable`
(`lower(unaccent(...))`, `’` → `'`), mai concesse ad `authenticated`; `create or replace` di
`private.acting_operator_id()` con il corpo comune parola per parola; tabella `app.customers` (spec,
"Modello dati": `name_key` generata, indice unico, `phone` E.164, `notes` ≤ 500, `create_operation_id`
unique, `anonymized_at`); RLS `select` per `private.is_active_operator()`, `insert/update/delete/truncate`
revocati; tipo `app.customer_summary`; normalizzazione SQL del telefono; `app.create_customer(...)`
`security definer`, `set search_path = ''`: `not_operator`, `name_required`, `name_too_long`,
`phone_invalid`, `consent_required`, `notes_too_long`, `customer_name_taken` (con `detail` = id esistente),
idempotente su `create_operation_id`, `unique_violation` intercettati per vincolo; `balance` 0.
**Accettazione:**
- [ ] pgTAP: `anon` e utente senza profilo non leggono la tabella; `authenticated` non scrive direttamente;
      utente senza profilo riceve `not_operator` da `create_customer`; `clean_name`/`customer_name_key` e
      `acting_operator_id` senza `execute` per `authenticated` e `anon`
- [ ] pgTAP: solo nome + consenso crea il cliente con `created_by` = operatore chiamante e
      `privacy_consent_at` = ora del server; consenso falso, nome vuoto o di 81 caratteri, telefono non valido,
      note di 501 caratteri → codice giusto; telefono e note di soli spazi → null
- [ ] pgTAP: "Nicolò Rossi" poi "nicolo  rossi" → `customer_name_taken` con `detail` = id; "D'Angelo" =
      "D’Angelo"; stesso `operation_id` due volte → una riga, stesso id; normalizzazione `333 123 4521` →
      `+393331234521`, `0039…`, `+44…`, `0771 123456` → `+390771123456`
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** nessuna · **File:** supabase/migrations/*_customers.sql, supabase/tests/customers.test.sql ·
**Dimensione:** M

## Task 2: Modifica e anonimizzazione nel database
**Descrizione:** `app.update_customer(p_customer_id, p_name, p_phone, p_notes)` per tutti gli operatori
(stessi errori di validazione, `customer_not_found`, `customer_anonymized` con riga `for update`,
`unique_violation` → `customer_name_taken`); `app.anonymize_customer(p_customer_id)` solo per
`private.is_admin()` (`forbidden` altrimenti, `customer_not_found`): nome `'Cliente cancellato ' || <8
caratteri dell'id>`, `phone`/`notes` null, `anonymized_at = now()`, idempotente.
**Accettazione:**
- [ ] pgTAP: rinomina su un nome equivalente già usato rifiutata con `detail`; telefono svuotato → null;
      id inesistente → `customer_not_found`; modifica di un anonimizzato → `customer_anonymized`;
      utente senza profilo → `not_operator`
- [ ] pgTAP: operatore → `forbidden` e riga invariata; admin → nome tecnico, phone e notes null,
      `anonymized_at` valorizzato, `privacy_consent_at` e riga presenti; seconda chiamata non cambia nulla
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 1 · **File:** supabase/migrations/*_customers.sql, supabase/tests/customers.test.sql ·
**Dimensione:** S

## Task 3: Letture, prestazioni e seed
**Descrizione:** `app.search_customers(p_query)` `stable` (testo tagliato a 80; sole cifre ≥ 3 → telefono
contenente quelle cifre, `00` = `+`; altrimenti ≥ 2 caratteri → ogni parola, passata per
`customer_name_key`, contenuta in `name_key`; `%`/`_`/`\` alla lettera; ordine `name_key`, `id`; massimo 21
righe; mai anonimizzati); `app.get_customer(p_customer_id)` (anche anonimizzati, nessuna riga se assente);
`app.customers_served_today()` vuota con la firma definitiva. Tutte con `not_operator`. Seed con 5 clienti
finti (telefoni `+39333000000x`).
**Accettazione:**
- [ ] pgTAP: "rossi mari" trova "Maria Rossi"; "nicolo" trova "Nicolò"; "4521" e "333 123" trovano il
      telefono; "50%" e "a_b" cercati alla lettera; ordine alfabetico; 25 clienti → 21 righe; anonimizzati
      esclusi; testo corto → nessuna riga
- [ ] pgTAP: `get_customer` restituisce anche un anonimizzato; `customers_served_today()` vuota; utente
      senza profilo → `not_operator` da tutte e tre; `performs_within` media < 50 ms su 10 esecuzioni con
      1 000 clienti generati nel test
- [ ] `npm run db:reset` carica il seed senza errori; nessun dato reale
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 2 · **File:** supabase/migrations/*_customers.sql, supabase/tests/customers.test.sql,
supabase/seed.sql · **Dimensione:** M

## Checkpoint A
- [ ] `db:test` verde (anche `function_privileges.test.sql` e `rls_default.test.sql`)
- [ ] Revisione `security-and-hardening`: RLS, privilegi, `search_path`, `not_operator` nelle letture,
      `forbidden` sull'anonimizzazione, nessun 23505 grezzo
- [ ] Revisione con l'utente prima della UI

## Task 4: Telefono e classificazione della ricerca
**Descrizione:** `src/features/customers/phone.ts`: `normalizePhone`, `maskPhone` ("••• 4521"),
`formatPhoneForCard` ("333 ••• 4521" per `+39`, "+44 ••• 4521" per gli altri), `formatPhoneForEdit`
("333 123 4521" per `+39`, E.164 per gli altri); `classifyQuery(text)` → `phone` / `name` / `none` con le
soglie della spec.
**Accettazione:**
- [x] Unità con gli stessi vettori del pgTAP (task 1 e 3), compresi `0771 123456` e numeri non validi
- [x] Classificazione: "4521", "+39 333 1", "333-123" → telefono; "45" → nessuna; "ro" → nome; "r" → nessuna
**Verifica:** `npm test -- customers`
**Dipendenze:** nessuna · **File:** src/features/customers/phone.ts, phone.test.ts · **Dimensione:** S

## Task 5: Servizio Supabase dei clienti e integrazione
**Descrizione:** `types.ts` (`CustomerSummary`, `CustomerService`: search, servedToday, get, create,
update, anonymize; errori tipizzati); `errorCodes.ts` (elenco unico codici → testi italiani della spec);
`supabaseCustomerService.ts`: snake_case → camelCase, `P0001` + messaggio-codice → errore tipizzato,
`customer_name_taken` con id dal `detail`, fetch fallita → `network`, `serverFaultFor` →
`ServerFaultError`; guardia `scripts/customersBoundary.test.ts`; integrazione con le credenziali del seed.
**Accettazione:**
- [ ] Unità con `getSupabase` finto: ogni codice di `errorCodes.ts` → errore tipizzato; rete → `network`;
      PGRST202 → `misconfigured`
- [ ] Integrazione: l'operatore crea, ritrova con la ricerca, riceve `forbidden` dall'anonimizzazione; il
      reinvio con lo stesso `operation_id` restituisce lo stesso id; l'admin anonimizza (nomi con suffisso unico)
- [ ] Solo `supabaseCustomerService.ts` chiama le RPC dei clienti (guardia verde)
**Verifica:** `npm test -- customers && npm run test:integration`
**Dipendenze:** 3 · **File:** src/features/customers/types.ts, errorCodes.ts, supabaseCustomerService.ts
(+ .test.ts), tests/integration/customers.test.ts, scripts/customersBoundary.test.ts · **Dimensione:** M

## Task 6: Servizio finto e iniezione
**Descrizione:** `src/test/fakeCustomerService.ts` in memoria (nome unico con la stessa chiave, idempotenza
per `operation_id`, registro delle chiamate, risposte programmabili e ritardate, rete giù, "arrivato ma
risposta persa"); `CustomerServiceProvider` / `useCustomerService()`; iniezione in `main.tsx` e `renderApp`.
**Accettazione:**
- [ ] Test del finto: nome equivalente rifiutato, stesso `operation_id` → stesso cliente, rete simulata
- [ ] I test esistenti di `renderApp` passano senza modifiche alle chiamate (terzo parametro facoltativo)
**Verifica:** `npm test`
**Dipendenze:** 5 · **File:** src/test/fakeCustomerService.ts (+ .test.ts),
src/features/customers/CustomerServiceProvider.tsx, src/main.tsx, src/test/renderApp.tsx · **Dimensione:** M

## Checkpoint B
- [ ] `test`, `test:integration`, `db:test` verdi; test esistenti di identity e settings invariati

## Task 7: Ricerca dalla home
**Descrizione:** `src/features/customers/HomePage.tsx` sostituisce `src/app/HomePage.tsx` (eliminato; rotta
indice aggiornata): `AppShell` con logo e account, posto in cima per il `CardReadPanel` (vuoto qui),
`SearchField` "Cerca per nome o telefono" / "Es. Rossi o 4521", "Nuovo cliente" nell'area azioni.
`useCustomerSearch`: attesa 250 ms, `?q=` con `replace`, scarto delle risposte superate; righe `ListRow` con
nome, "••• 4521" o "Senza telefono", `PointsBadge`; massimo 20 + riga "Mostro i primi 20: scrivi qualcosa
in più"; tocco → scheda; caricamento `StatusView` "Ricerca…"; "Cancella la ricerca" torna a SERVITI OGGI.
**Accettazione:**
- [ ] Componenti (timer finti): una sola chiamata dopo 250 ms; risposta vecchia arrivata dopo la nuova
      ignorata; 21 risultati → 20 righe + riga finale; testo corto → nessuna chiamata
- [ ] `/?q=rossi` apre con la ricerca; Indietro dalla scheda la ritrova
- [ ] Test esistenti di rotte e identity aggiornati al nuovo contenuto della home, nessuno tolto
**Verifica:** `npm test` (suite completa nel commit)
**Dipendenze:** 4, 6 · **File:** src/features/customers/HomePage.tsx (+ .module.css, .test.tsx),
useCustomerSearch.ts, src/app/routes.tsx, src/app/HomePage.tsx · **Dimensione:** M

## Task 8: Nessun risultato, errore e account tolto
**Descrizione:** "Nessun cliente trovato" con "Controlla come è scritto, o cerca con le ultime 4 cifre del
telefono."; pulsante "Nuovo cliente «<testo>»" che apre `/clienti/nuovo?nome=` (forma del pulsante secondo
Open Question 1 di plan.md); per una ricerca per telefono resta "Nuovo cliente". Errore "Ricerca non
riuscita" + "Controlla la connessione e riprova." con "Riprova". `not_operator` da qualunque chiamata del
modulo → `useAuth().reportNotEnabled()`.
**Accettazione:**
- [ ] Componenti: nessun risultato per nome → pulsante con il testo e link precompilato; per telefono →
      "Nuovo cliente" senza `?nome=`; errore → Riprova rifà la ricerca
- [ ] `not_operator` → `/accedi` con "Account non abilitato: chiedi a un amministratore."
- [ ] `displayGlyphs.test.ts` verde
**Verifica:** `npm test`
**Dipendenze:** 7 · **File:** src/features/customers/HomePage.tsx (+ .test.tsx), useCustomerSearch.ts,
src/features/customers/useNotOperator.ts · **Dimensione:** S

## Task 9: SERVITI OGGI e messaggio della home
**Descrizione:** `useServedToday` su `servedToday()`: righe "••• 0388 · 10:15" o "Senza telefono · 09:58"
(ora `Europe/Rome`) e saldo; sezione nascosta se vuota o con una ricerca mostrata; errore "Non riesco a
caricare i clienti di oggi" con "Riprova"; ricarica all'apertura e su `visibilitychange`. Riga
`role="status"` in cima con il messaggio passato nello stato della navigazione ("Dati del cliente cancellati.").
**Accettazione:**
- [ ] Componenti: lista piena con orari formattati; vuota → sezione assente; errore → riga compatta e
      Riprova; ritorno visibile → nuova chiamata
- [ ] Messaggio di navigazione mostrato una volta in `role="status"`
**Verifica:** `npm test`
**Dipendenze:** 7 · **File:** src/features/customers/HomePage.tsx (+ .module.css, .test.tsx),
useServedToday.ts, src/shared/format.ts · **Dimensione:** M

## Checkpoint C
- [ ] Suite unità/componenti verde
- [ ] Detector Impeccable pulito; screenshot 390×844 confrontati con Cerca cliente e Ricerca senza risultati
- [ ] Revisione con l'utente (Open Question 1 decisa)

## Task 10: Modulo Nuovo cliente
**Descrizione:** `/clienti/nuovo`: `CustomerForm` (nome "Es. Maria Rossi", telefono `type="tel"`
"Numero di cellulare", testo d'aiuto, note `maxLength` 500 in fondo) e sezione PRIVACY (casella "Ha letto
l’informativa privacy (obbligatorio)" ≥ 48 px, "Mostra l’informativa" → `PrivacyNoticeDialog` con il
segnaposto di `privacyNotice.ts`, `PRIVACY_NOTICE_STATUS = 'draft'`). Validazione nel client con i testi
della spec, errore sotto il campo in `danger-text`, fuoco sul primo campo errato, nessuna chiamata.
**Accettazione:**
- [ ] Componenti: nome vuoto, oltre 80, telefono non valido, consenso mancante → testo giusto e fuoco
- [ ] Dialogo dell'informativa apribile e chiudibile da tastiera; nessun testo legale inventato
- [ ] Etichette accessibili; target ≥ 48 px
**Verifica:** `npm test`
**Dipendenze:** 6 · **File:** src/features/customers/CustomerForm.tsx (+ .module.css, .test.tsx),
NewCustomerPage.tsx, PrivacyNoticeDialog.tsx, privacyNotice.ts, src/app/routes.tsx · **Dimensione:** M

## Task 11: Salvataggio del nuovo cliente
**Descrizione:** "Salva cliente" `busy`; `operation_id` al primo invio, tenuto dopo errore di rete,
rigenerato dopo un rifiuto; successo → scheda con `replace`; `customer_name_taken` → "Esiste già un cliente
con questo nome." + "Apri la scheda" + suggerimento «Maria Rossi Serapo» al posto del testo d'aiuto; rete →
"Cliente non salvato: controlla la connessione e riprova." con "Riprova"; errori del server mostrati sul
campo; `?nome=` ripulito e tagliato a 80.
**Accettazione:**
- [ ] Componenti: doppio tocco = una chiamata; Riprova dopo rete usa lo **stesso** `operation_id`; risposta
      persa e Riprova → scheda del cliente salvato davvero; dopo un rifiuto nuovo `operation_id`
- [ ] Nome già usato → link alla scheda esistente; `?nome=` precompila
**Verifica:** `npm test`
**Dipendenze:** 10 · **File:** src/features/customers/NewCustomerPage.tsx (+ .test.tsx), CustomerForm.tsx,
useSaveCustomer.ts · **Dimensione:** M

## Task 12: Scheda cliente
**Descrizione:** `AppShell` con `headerAction` facoltativa (test). `/clienti/:id`: Indietro (con `?q=` se
c'era), nome come titolo, pulsante icona "Modifica cliente"; "Tel. 333 ••• 4521" o "Senza telefono"; note in
testo secondario; riquadro SALDO con numero e "punti"; posto per `CustomerLedgerSection` di `ledger`.
`useCustomer`. Stati: caricamento; "Cliente non trovato" (anche id non uuid, senza chiamare il servizio) con
link alla home; errore con Riprova; cliente cancellato: titolo "Cliente cancellato", "Dati cancellati il
17 nov 2026", saldo, nessuna modifica.
**Accettazione:**
- [ ] Componenti: ogni stato; id non uuid → nessuna chiamata; cliente cancellato senza "Modifica cliente"
- [ ] `AppShell`: test esistenti verdi, nuova azione accessibile con target ≥ 48 px
**Verifica:** `npm test`
**Dipendenze:** 6 · **File:** src/app/AppShell.tsx (+ .test.tsx), src/features/customers/CustomerPage.tsx
(+ .module.css, .test.tsx), useCustomer.ts, src/app/routes.tsx · **Dimensione:** M

## Task 13: Modifica cliente
**Descrizione:** `/clienti/:id/modifica`: `CustomerForm` senza privacy, precompilato (telefono con
`formatPhoneForEdit`), telefono svuotabile; "Salva modifiche" `busy` → scheda; stessi errori (nome già
usato → "Apri la scheda" dell'altro; rete → "Modifiche non salvate: controlla la connessione e riprova." con
"Riprova"); stati come la scheda; cliente cancellato → scheda con `replace`.
**Accettazione:**
- [ ] Componenti: precompilazione, errori, rete + Riprova, telefono svuotato inviato come vuoto, cliente
      cancellato → redirect
- [ ] Nessuna sezione privacy
**Verifica:** `npm test`
**Dipendenze:** 11, 12 · **File:** src/features/customers/EditCustomerPage.tsx (+ .module.css, .test.tsx),
CustomerForm.tsx, src/app/routes.tsx · **Dimensione:** M

## Task 14: Cancellazione dei dati del cliente
**Descrizione:** `AnonymizeSection` in Modifica solo per gli admin (DATI DEL CLIENTE, pulsante pericoloso
"Cancella i dati del cliente" e testo della spec); `ConfirmDialog` `tone="danger"` "Cancellare i dati di
<nome>?", conferma "Cancella i dati" `busy`; dopo → home `replace` con "Dati del cliente cancellati.";
rete → dialogo aperto con "Dati non cancellati: controlla la connessione e riprova."; `forbidden` → "Solo un
amministratore può cancellare i dati di un cliente."
**Accettazione:**
- [ ] Componenti: operatore non vede la sezione; admin conferma → home con messaggio; rete → dialogo
      aperto e nuovo tentativo; `forbidden` → messaggio
- [ ] Nessuna cancellazione senza `ConfirmDialog`
**Verifica:** `npm test`
**Dipendenze:** 9, 13 · **File:** src/features/customers/AnonymizeSection.tsx (+ .module.css, .test.tsx),
EditCustomerPage.tsx · **Dimensione:** M

## Checkpoint D
- [ ] Ogni stato della spec ha un test di componente (criterio 8)
- [ ] Detector Impeccable pulito; screenshot 390×844 confrontati con Nuovo cliente senza card, Nome già
      usato, Scheda cliente, Modifica cliente
- [ ] Revisione con l'utente

## Task 15: E2E dei clienti
**Descrizione:** `e2e/customers.spec.ts` nel progetto `phone`, nomi con suffisso unico per esecuzione:
admin crea "Nicolò Prova E2E <suffisso>" con "333 123 4521" → lo trova con "nicolo" e con le ultime 4
cifre → scheda ("333 ••• 4521") → modifica telefono → rinomina su un nome già usato rifiutata → cancella i
dati → non si trova più; operatore crea un cliente con solo nome e consenso e non vede "Dati del cliente".
**Accettazione:**
- [ ] E2E verde a 390×844 contro Supabase locale, anche ripetuto senza `db:reset`
- [ ] Nessuna chiamata a `*.supabase.co` (fixture `onlyLocalSupabase`)
**Verifica:** `npm run db:start && scripts/reload-auth-templates.sh && npm run e2e`
**Dipendenze:** 14 · **File:** e2e/customers.spec.ts, e2e/fixtures.ts · **Dimensione:** S

## Task 16: Documentazione e chiusura
**Descrizione:** `brain/MAP.md` (file del modulo), `brain/STATUS.md`, RUNBOOK (trappole trovate),
`CLAUDE.md` se cambiano comandi; nota in `SPEC-customers.md` che `test:integration` ora esiste; verifica
puntuale degli 8 criteri di successo; i task segnati in questo file.
**Accettazione:**
- [ ] Ogni criterio di successo con il test che lo prova
- [ ] Nessun segreto né dato reale nei documenti
**Verifica:** quality bar completa verde; rilettura
**Dipendenze:** 15 · **File:** brain/MAP.md, brain/STATUS.md, brain/topics/operations/RUNBOOK.md,
SPEC-customers.md, tasks/customers/todo.md · **Dimensione:** S

## Checkpoint E
- [ ] Gli 8 criteri di successo di SPEC-customers verificati
- [ ] Quality bar completa verde in locale e in CI
- [ ] PR pronta per `code-review-and-quality`
