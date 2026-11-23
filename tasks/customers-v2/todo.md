# Todo: customers-v2

Fonte: [plan.md](plan.md) · Spec: [SPEC-customers-v2.md](../../docs/specs/SPEC-customers-v2.md). Ogni task
parte da un test che fallisce (`test-driven-development`) e chiude con la quality bar completa verde
(`npm run typecheck && npm run lint && npm run format:check && npm test && npm run db:test && npm run
test:integration && npm run e2e`) e un commit Conventional Commits sul ramo `feat/customers-v2`, con solo i
propri file e la riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Solo lo stack Supabase locale
(`npx supabase status`; dopo un `start`, `scripts/reload-auth-templates.sh`). Nessun dato reale (`@example.com`,
nessun telefono), nessun segreto. Dopo ogni modifica UI il detector Impeccable deve essere pulito.
Convenzione dei file: un sorgente "(+test)" o "(+css, +test)" conta come una voce.

## Fase 1 — Database, solo aggiunte

## Task 1: Ultima attività del cliente
**Descrizione:** `npx supabase migration new customers_v2_activity`: `app.customers.last_activity_at
timestamptz null`; colonne generate `has_activity` e `sort_at`; riempimento dal `max(created_at)` di spese e
riscatti (anche annullati; correzioni escluse); trigger `after insert on app.movements … when (new.kind in
('purchase','redemption'))` con `greatest(coalesce(last_activity_at,'-infinity'), new.created_at)`; indice
`customers_home_order_idx (has_activity desc, sort_at desc, id desc) where anonymized_at is null`; nessun grant
di scrittura.
**Accettazione:**
- [x] pgTAP: spesa e riscatto aggiornano `last_activity_at`, la correzione no, un movimento più vecchio non la
      fa tornare indietro; spesa annullata conta (Open Question 1)
- [x] pgTAP: il riempimento valorizza i clienti del seed con movimenti e lascia `null` gli altri; colonne
      generate coerenti; `authenticated` non scrive `last_activity_at`
- [x] pgTAP esistenti (ledger compreso) invariati
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** nessuna · **File:** supabase/migrations/*_customers_v2_activity.sql,
supabase/tests/customers_v2.test.sql · **Dimensione:** S

## Task 2: Colonna email e `app.list_customers`
**Descrizione:** `npx supabase migration new customers_v2_email` (prima forma, solo aggiunte): colonna
`email` con `customers_email_check` e `customers_email_key` unico; `app.list_customers(p_query,
p_after_activity_at, p_after_created_at, p_after_id, p_limit)` → `(id, name, balance, last_activity_at,
created_at)` (senza `email`: plan.md), `stable security definer`, `not_operator` per primo, `invalid_limit`
(1–50), `invalid_cursor`, testo tagliato a 80 e ripulito con `clean_name`, filtro "ogni parola nella chiave del
nome **oppure** testo intero nell'email" con `%`/`_`/`\` alla lettera, condizione di riga e `order by` della
spec, saldo solo per le righe restituite. Classificata come lettura in `tablet_kiosk_access.test.sql`.
**Accettazione:**
- [x] pgTAP: ordine (attività più recente, poi senza movimenti per creazione, poi `id`), anonimizzati mai
      presenti, filtro per parole del nome e per parte dell'email, caratteri speciali alla lettera, meno di 2
      caratteri = elenco completo
- [x] pgTAP: 3 pagine senza doppioni né buchi su dati fermi anche con `created_at` uguali al microsecondo;
      `invalid_cursor` (`p_after_id` null con un timestamp; `p_after_id` senza `p_after_created_at`),
      `invalid_limit`, `not_operator`; dispositivo senza cassiere rifiutato
- [x] pgTAP: vincolo email (minuscolo, senza spazi ai bordi, 6–254, formato) e unicità; più `null` ammessi
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 1 · **File:** supabase/migrations/*_customers_v2_email.sql, supabase/tests/customers_v2.test.sql,
supabase/tests/tablet_kiosk_access.test.sql · **Dimensione:** M

## Task 3: Piano dell'elenco con molti dati
**Descrizione:** file pgTAP che dentro una transazione annullata crea 1 000 clienti finti e 20 000 movimenti,
`analyze`, poi `explain (format json)` di prima pagina, pagina centrale e ricerca di `list_customers` (la query
del corpo) e verifica `Index Only Scan` o `Index Scan` su `customers_home_order_idx`. Nessuna asserzione di
tempo (criterio 6: il tempo si misura a mano, task 36).
**Accettazione:**
- [x] pgTAP: i tre piani usano `customers_home_order_idx`
- [x] Nessun dato lasciato nel database dopo il test; durata del file accettabile in CI
**Verifica:** `npm run db:test`
**Dipendenze:** 2 · **File:** supabase/tests/customers_v2_plan.test.sql · **Dimensione:** S

## Task 4: Card riformattate e `release_card`
**Descrizione:** `npx supabase migration new cards_v2_release`: colonne `released_at`, `released_by`,
`release_operation_id` (unico) e i due `check`; `cards_uid_key` sostituito dall'indice unico parziale con lo
stesso nome (`where released_at is null`); indice `cards_released_by_idx`; `private.cards_before_update` esteso
(scritte una volta, solo su card non attiva, mai di nuovo `null`, card rilasciata mai attiva);
`released_at is null` in `app.lookup_card`, `private.associate_card_to`, `private.raise_card_taken`;
`app.release_card(p_operation_id, p_card_id)` (admin, blocchi cliente → card, idempotente, `card_active`,
`card_not_found`, 22023, `delete from private.card_links`). Classificata in `tablet_kiosk_access.test.sql`.
**Accettazione:**
- [x] pgTAP: operatore e cassiere operatore → `forbidden`; card attiva → `card_active`; stesso
      `operation_id` → nessun cambiamento; `operation_id` riusato su un'altra card → 22023; riga conservata con
      uid e cliente, saldo e movimenti invariati, `private.card_links` vuota
- [x] pgTAP: uid rilasciato → `lookup_card` vuota → `associate_card` e `create_customer_with_card` lo
      associano a un altro cliente; `raise_card_taken` con due righe dello stesso uid; `unique_violation` →
      ancora `card_taken`
- [x] pgTAP: il trigger vieta di togliere `released_at` e di riattivare una card rilasciata; vale anche per
      la card di un cliente anonimizzato (criterio 10)
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 1 · **File:** supabase/migrations/*_cards_v2_release.sql, supabase/tests/cards_v2.test.sql,
supabase/tests/tablet_kiosk_access.test.sql · **Dimensione:** M

## Task 5: `get_card`, `reactivate_card` e riattivazione riservata agli amministratori
**Descrizione:** nella migrazione `cards_v2_release`: `app.get_card(p_card_id)` (qualunque operatore attivo;
`customer_name` null se anonimizzato; nessuna riga se non esiste) e `app.reactivate_card(p_card_id,
p_expected_active_card_id)` (`forbidden`, `card_not_found`, `card_released`, `customer_anonymized`,
`active_card_changed`, già attiva → riga invariata; altrimenti la sequenza di `associate_card_to`).
`private.associate_card_to`: nel ramo "card disattivata dello stesso cliente" `forbidden` se non admin. I pgTAP
esistenti che riattivano da Associa card usano l'admin.
**Accettazione:**
- [x] pgTAP: matrice operatore / admin / cassiere admin / cassiere operatore per `reactivate_card` e per la
      riattivazione da `associate_card` (criterio 11)
- [x] pgTAP: scambio con `p_expected_active_card_id` giusto (l'altra si disattiva, una sola attiva, punti
      invariati); sbagliato o `null` contro una card attiva → `active_card_changed`; riattivata senza link
- [x] pgTAP: `get_card` restituisce l'altra card attiva e il saldo; nessun messaggio o `detail` contiene uid
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 4 · **File:** supabase/migrations/*_cards_v2_release.sql, supabase/tests/cards_v2.test.sql,
supabase/tests/cards.test.sql, supabase/tests/tablet_kiosk_access.test.sql · **Dimensione:** M

## Task 6: Premi attivi per la pagina pubblica (database)
**Descrizione:** `npx supabase migration new card_rewards_public`: `private.card_customer_for_token(text)`
estratta da `card_points` senza cambiarne il comportamento; `public.card_points` riscritta per usarla (stessa
firma); `public.card_rewards(p_token)` (`stable security definer`, `no-store`, formato del token, zero righe
per ogni caso non valido, `order by r.points, lower(r.name), r.id limit 100`), `revoke … from public`,
`grant … to anon, authenticated`.
**Accettazione:**
- [x] pgTAP: token valido → solo premi attivi in ordine; token `null`, malformato, in attesa, card disattivata,
      rilasciata, cliente anonimizzato → zero righe; intestazione `no-store`
- [x] pgTAP: `card_points.test.sql` invariato nelle attese; allowlist di `anon` = `card_points`,
      `card_rewards` in `function_privileges.test.sql`
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 4 · **File:** supabase/migrations/*_card_rewards_public.sql, supabase/tests/card_points.test.sql,
supabase/tests/function_privileges.test.sql · **Dimensione:** S

## Task 7: Integrazione su HTTP e concorrenza
**Descrizione:** test Vitest contro lo stack locale (chiave locale solo nei test): `list_customers` con 3
pagine tramite PostgREST (cursore come stringhe ricevute); due `reactivate_card` contemporanee su due card
dello stesso cliente → una sola attiva; `release_card` contro `reactivate_card` sulla stessa card → una sola
vince; `card_rewards` chiamata da `anon` con token valido e non valido; operatore → `forbidden` su HTTP.
**Accettazione:**
- [x] Concorrenza provata in parallelo, senza stalli (criterio 8)
- [x] `anon` legge i premi solo con un token valido; nessuna risposta contiene uid o token (criterio 7)
- [x] Il cursore restituito da PostgREST, rimandato com'è, non perde né ripete righe (criterio 5)
**Verifica:** `npm run test:integration`
**Dipendenze:** 2, 5, 6 · **File:** tests/integration/customers-v2.test.ts, tests/integration/cards.test.ts,
tests/integration/localSupabase.ts (solo se serve un helper) · **Dimensione:** M

## Checkpoint A
- [ ] `db:test` e `test:integration` verdi; pgTAP degli altri moduli invariati nelle attese (salvo la
      riattivazione da Associa card, ora dell'admin)
- [ ] Revisione `security-and-hardening` del database: `anon`, ruoli, `search_path`, ordine dei blocchi, uid
      riusabile, nessun uid/token/email in errori o `detail`; problemi risolti con test

## Fase 2 — Scrittura della card vuota

## Task 8: Motore di scrittura della card vuota
**Descrizione:** `webNfcWriter.ts`: `eraseCard` sullo stesso motore di `writeUrl` (messaggio `{ records: [{
recordType: 'empty' }] }`, `overwrite: true`, `signal`), verifica "vuota" stretta, `allowUnreadable`;
`mayHaveWritten` sull'esito `wrong-card` (anche per `writeUrl`); `webNfcAdapter.ts` inoltra allo scrittore
`blank` (nessun record o soli `empty`), mai ai consumatori di `useCardRead`; tipi in `web-nfc.d.ts`;
`fakeWebNfc` capace di card vuote.
**Accettazione:**
- [ ] Unit: un solo record `empty` con `overwrite: true`; `verify-failed` se resta un URL, un `text` o un
      `mime`; `wrong-card` con `mayHaveWritten: false` nel passo `waiting-card` e `true` durante `write()`; un
      altro uid letto **vuoto** durante la verifica → `wrong-card` con `mayHaveWritten: true`; uno non vuoto
      ignorato; `unreadable`/`allowUnreadable`; tempi; `makeReadOnly` mai chiamato
- [ ] Unit: `blank` vero per nessun record e per soli `empty`, falso con `text`, `mime`, `url`; mai a
      `useCardRead`; `writeUrl` esistente invariato salvo `mayHaveWritten`
**Verifica:** `npm test -- card-input`
**Dipendenze:** nessuna · **File:** src/features/card-input/webNfcWriter.ts (+test),
src/features/card-input/webNfcAdapter.ts (+test), src/features/card-input/web-nfc.d.ts, src/test/fakeWebNfc.ts
· **Dimensione:** M

## Task 9: `useCardWriter().eraseCard` e adattatore finto degli E2E
**Descrizione:** `useCardWriter()` espone `eraseCard` (stesse precondizioni e sessione esclusiva di
`writeUrl`); `fakeCardAdapter.ts`: memoria `uid → url | null`, `__enjoyFakeCardWrites` con `url: null` per
una card svuotata, `failNextWrite(...)` anche per `eraseCard`; helper in `e2e/nfc.ts` per leggere il registro
delle scritture vuote. Controllo del bundle invariato.
**Accettazione:**
- [ ] Test del hook: `eraseCard` con `canWrite` falso → `cannot-write`; sessione esclusiva con la lettura
- [ ] Test dell'adattatore finto: card svuotata riletta come vuota; registro con `url: null`;
      `failNextWrite` vale per la cancellazione
- [ ] `npm run build && npm run check:bundle` verde (nessun `__enjoyFakeCard` in `dist/`)
**Verifica:** `npm test -- card-input && npm run build && npm run check:bundle`
**Dipendenze:** 8 · **File:** src/features/card-input/useCardWriter.ts (+test),
src/features/card-input/fakeCardAdapter.ts (+test), e2e/nfc.ts, scripts/cardInputBoundary.test.ts
· **Dimensione:** M

## Checkpoint B
- [ ] Quality bar completa verde; bundle senza la card finta
- [ ] Nessun consumatore di `useCardRead` riceve URL o `blank`

## Fase 3 — Home con l'elenco CLIENTI

## Task 10: Contratto `list` del servizio clienti
**Descrizione:** in `types.ts` `CustomerListRow`, `CustomerListCursor` e `CustomerService.list({ query, after
})` → `{ customers, hasMore }` (accanto a `search`/`servedToday`, che spariscono nel task 13); parser
`customerListRow.ts` (timestamp stringhe, niente `notes`); `supabaseCustomerService.list` (cursore rimandato
com'è, `serverFaultFor` per primo, codici `invalid_cursor`/`invalid_limit` come guasto); `fakeCustomerService.list`
con lo stesso ordine, filtro e cursore del server; `fakeLedgerService.applyMovement` aggiorna
`lastActivityAt`.
**Accettazione:**
- [ ] Unit: parser (stringhe ISO con microsecondi intatte, righe senza `notes`, forma sbagliata → errore)
- [ ] Unit: il servizio Supabase manda i parametri della spec e restituisce `hasMore` = 20 righe; il finto
      rispetta ordine, filtro (nome a parole, parte dell'email) e cursore; una spesa nel ledger finto porta il
      cliente in cima
**Verifica:** `npm test -- customers`
**Dipendenze:** 2 · **File:** src/features/customers/types.ts, src/features/customers/customerListRow.ts (+test),
src/features/customers/supabaseCustomerService.ts (+test), src/test/fakeCustomerService.ts (+test),
src/test/fakeLedgerService.ts · **Dimensione:** M

## Task 11: `activityLabel` e `useCustomerList`
**Descrizione:** `activityLabel.ts` in fuso `Europe/Rome` («Oggi, 10:15», «Ieri, 18:40», «12 nov», «12 nov 2025»,
«Nessun movimento»); `useCustomerList(text)`: prima pagina all'apertura, pagine successive una per volta,
deduplica per `id`, fine elenco con meno di 20 righe, attesa di 250 ms e risposte superate scartate, sotto i 2
caratteri l'elenco completo, ricarica della prima pagina a `visibilitychange` solo se è caricata solo lei,
`not_operator` → `reportNotEnabled()`, callback con `useLatest`.
**Accettazione:**
- [ ] Unit: `activityLabel` per oggi, ieri, quest'anno, altri anni, nessun movimento, cambio dell'ora legale
- [ ] Test del hook: cursore = valori **stringa** dell'ultima riga; una sola richiesta per volta; errore della
      prima pagina e di una successiva (le righe restano); risposta superata ignorata; refresh solo con la sola
      prima pagina
**Verifica:** `npm test -- customers`
**Dipendenze:** 10 · **File:** src/features/customers/activityLabel.ts (+test),
src/features/customers/useCustomerList.ts (+test) · **Dimensione:** M

## Task 12: Campo di ricerca della home negli E2E tramite un helper
**Descrizione:** refactor senza cambi di comportamento: un helper in `e2e/fixtures.ts` (`homeSearch(page)`)
trova il campo di ricerca della home; gli E2E che oggi cercano «Cerca per nome o telefono» / «Oppure cerca per
nome o telefono» lo usano, così il cambio d'etichetta del task 13 tocca un punto solo.
**Accettazione:**
- [ ] Nessuna spec E2E nomina più l'etichetta del campo fuori dall'helper
- [ ] E2E verdi senza altre modifiche
**Verifica:** `npm run e2e`
**Dipendenze:** nessuna · **File:** e2e/fixtures.ts, e2e/card-input.spec.ts, e2e/identity.spec.ts,
e2e/password.spec.ts, e2e/customers.spec.ts · **Dimensione:** M

## Task 13: Home con la sezione CLIENTI
**Descrizione:** `HomePage`: sezione `h2` «CLIENTI» sempre presente al posto dei risultati e di SERVITI OGGI
(`ListRow` con nome, `activityLabel`, `PointsBadge`; nessuna email); sentinella `IntersectionObserver` con
`root: null`, `rootMargin: '400px'` e «Mostra altri clienti»; stati della spec (caricamento, errore della
prima pagina con «Riprova», «Carico altri clienti…», «Non riesco a caricare altri clienti.», archivio vuoto,
nessun risultato con «Nuovo cliente «<testo>»» solo senza `@`, regione live); testo nello stato della
cronologia (niente più `setSearchParams` né `?q=`); riquadro della card compatto da 2 caratteri; etichette «Cerca per
nome o email» / «Oppure cerca per nome o email», placeholder «Es. Rossi o rossi@»; tablet: CLIENTI in due
colonne. Via `useCustomerSearch.ts`, `useServedToday.ts`, `search`/`servedToday` dal contratto e dai finti.
**Accettazione:**
- [ ] Componenti: ogni stato del criterio 5; pagina 2 da sentinella e da pulsante con il cursore ricevuto;
      `location.search` mai con `@`; testo ripristinato dopo «Indietro»; riquadro compatto solo da 2 caratteri
- [ ] Tablet (`HomePage.tablet.test.tsx`): due colonne, lettore USB invariato; E2E esistenti verdi
- [ ] Impeccable pulito; confronto con Main, Ricerca vuota, Tablet-Cerca; target ≥ 48 px
**Verifica:** `npm test -- HomePage && npm run e2e`
**Dipendenze:** 11, 12 · **File:** src/features/customers/HomePage.tsx (+css, +test),
src/features/customers/HomePage.tablet.test.tsx, src/features/customers/useCustomerSearch.ts e
useServedToday.ts (eliminati), e2e/fixtures.ts · **Dimensione:** M

## Task 14: Card sconosciuta a Nuovo cliente tramite lo stato della cronologia
**Descrizione:** `useNewCustomerCard` legge l'uid da `useLocation().state.card` e non più da `?card=`; la
home (`useHomeCardRead`) naviga con `state: { card: uid }`; il testo della card in `CardReadPanel` stato `off`
diventa «… cerca il cliente per nome o email.».
**Accettazione:**
- [ ] Componenti: dopo la lettura di una card sconosciuta `location.search` non contiene l'uid; Nuovo cliente
      ha la card associata come oggi (anche dopo un ricaricamento)
- [ ] `CardReadPanel` con il testo nuovo; E2E `cards` e `card-input` verdi
**Verifica:** `npm test -- cards card-input && npm run e2e`
**Dipendenze:** 13 · **File:** src/features/cards/useNewCustomerCard.ts, src/features/cards/useHomeCardRead.ts
(+test), src/features/cards/NewCustomerCardSection.test.tsx, src/features/card-input/CardReadPanel.tsx (+test),
e2e/card-input.spec.ts · **Dimensione:** M

## Task 15: E2E dell'elenco CLIENTI
**Descrizione:** E2E (progetto `phone`): 45 clienti creati con un prefisso unico della corsa, scritto nel campo
→ 20 righe, poi le altre scorrendo, nessun doppione, fine al 45°; il cliente appena servito sale in cima.
`ledger.spec.ts`, criterio 3: dopo la spesa il cliente è in cima a CLIENTI con «Oggi, HH:MM».
**Accettazione:**
- [ ] E2E: scorrimento, fine elenco, nessun doppione, servito in cima (criterio 5)
- [ ] E2E `ledger` aggiornato e verde; tempo card → conferma invariato (< 10 s)
**Verifica:** `npm run e2e`
**Dipendenze:** 13 · **File:** e2e/customers-list.spec.ts, e2e/ledger.spec.ts, e2e/db.ts (solo se serve creare
i clienti in blocco) · **Dimensione:** S

## Checkpoint C
- [ ] Home verde in componenti ed E2E, telefono e tablet; Impeccable pulito
- [ ] Confronto a 390×844 e 1280×800 con Main, Ricerca vuota, Tablet-Cerca

## Fase 4 — Email al posto del telefono

## Task 16: Email nelle RPC dei clienti (forma transitoria)
**Descrizione:** nella migrazione `customers_v2_email`: `create_customer`, `update_customer`,
`create_customer_with_card` ricreate con `p_email` e `p_phone default null` (plan.md); normalizzazione
(`btrim` anche Unicode, `lower`, vuota → `null`), `email_invalid`, `customer_email_taken` con `detail` = id
dell'altro (anche da `unique_violation` su `customers_email_key`), controllo dopo il nome; email vuota in
`update_customer` = tolta, la propria non è conflitto; `anonymize_customer` azzera l'email; attributo `email`
in coda ad `app.customer_summary` con le funzioni che lo costruiscono; `export_customers` con `email`. I pgTAP
esistenti passano `null` come telefono.
**Accettazione:**
- [ ] pgTAP (criterio 2): `'  Rossi@Example.COM '` → `rossi@example.com`; `ROSSI@example.com` →
      `customer_email_taken` con `detail`; `rossi@` → `email_invalid`; nome ed email già usati → solo
      `customer_name_taken`; due clienti senza email
- [ ] pgTAP (criterio 3): l'anonimizzazione azzera nome, email, note e un altro cliente riusa l'email
- [ ] App ed E2E esistenti verdi senza modifiche (il frontend manda ancora `p_phone`)
**Verifica:** `npm run db:reset && npm run db:test && npm run e2e`
**Dipendenze:** 2 · **File:** supabase/migrations/*_customers_v2_email.sql, supabase/tests/customers_v2.test.sql,
supabase/tests/customers.test.sql, supabase/tests/export.test.sql, supabase/tests/cards.test.sql
· **Dimensione:** M

## Task 17: `normalizeEmail` e codici d'errore dell'email
**Descrizione:** `src/features/customers/email.ts` come nel Code Style della spec, con gli stessi vettori di
pgTAP; `email_invalid` e `customer_email_taken` in `errorCodes.ts` e nella traduzione di
`supabaseCustomerService` (errori tipizzati, `detail` → id dell'altro cliente).
**Accettazione:**
- [ ] Unit: stessi vettori di pgTAP (spazi Unicode, maiuscole, vuota → `null`, limiti 6/254, formato)
- [ ] Unit: ogni codice nuovo → errore tipizzato; nessuna email nei messaggi d'errore
**Verifica:** `npm test -- customers`
**Dipendenze:** 16 · **File:** src/features/customers/email.ts (+test), src/features/customers/errorCodes.ts
(+test), src/features/customers/supabaseCustomerService.ts (+test) · **Dimensione:** S

## Task 18: Dominio e servizi con l'email
**Descrizione:** `Customer` e gli input di creazione e modifica guadagnano `email` (il telefono resta
facoltativo fino al task 22); `customerRow.ts` legge `email`; `supabaseCustomerService` e
`supabaseCardsService.createCustomerWithCard` mandano `p_email`; i finti la salvano normalizzata e rifiutano i
doppioni come il server.
**Accettazione:**
- [ ] Unit: create/update/createCustomerWithCard mandano `p_email`; la riga letta porta `email`
- [ ] Finti: `customer_email_taken` con l'id dell'altro, `email_invalid`, email liberata dall'anonimizzazione
**Verifica:** `npm test && npm run test:integration`
**Dipendenze:** 17 · **File:** src/features/customers/types.ts, src/features/customers/customerRow.ts,
src/features/cards/supabaseCardsService.ts (+test), src/test/fakeCustomerService.ts (+test),
src/test/fakeCardsService.ts (+test) · **Dimensione:** M

## Task 19: Nuovo e Modifica cliente con l'email
**Descrizione:** `CustomerForm`: campo «Email (facoltativa)» (`type="email"`, `inputMode="email"`,
`autoComplete="off"`, `autoCapitalize="none"`, `spellCheck={false}`, `maxLength={254}`, placeholder
«nome@esempio.it»), testo d'aiuto nuovo; errori «Email non valida: controlla come è scritta.» e «Esiste già
un cliente con questa email.» + «Apri la scheda», fuoco sul primo campo errato; via il campo telefono e il suo
testo. Modifica cliente mostra l'email salvata e la si può svuotare. Vale anche per Nuovo cliente da card.
**Accettazione:**
- [ ] Componenti: attributi del campo, i due errori, «Apri la scheda» porta alla scheda dell'altro, email
      svuotata in Modifica
- [ ] Impeccable pulito; confronto con Nuovo cliente, Nome già usato, Modifica cliente, Tablet-Nuovo-cliente
- [ ] E2E esistenti verdi (quelli che scrivevano un telefono non lo scrivono più)
**Verifica:** `npm test -- customers && npm run e2e`
**Dipendenze:** 18 · **File:** src/features/customers/CustomerForm.tsx (+css, +test),
src/features/customers/useCustomerSubmit.ts (+test), src/features/customers/useSaveCustomer.ts,
src/features/customers/useUpdateCustomer.ts, src/features/customers/EditCustomerPage.tsx (+test)
· **Dimensione:** M

## Task 20: Scheda con l'email
**Descrizione:** `CardSummary`: «Card attiva …E5F6 · rossi@example.com» o «… · Senza email», email intera
selezionabile, `overflow-wrap: anywhere`, nessun `mailto:`; `CustomerPage` senza «Tel. …»/«Senza telefono»;
`AnonymizeSection`: «Nome, email e note si cancellano per sempre…» e testo della sezione DATI DEL CLIENTE.
**Accettazione:**
- [ ] Componenti: email o «Senza email»; nel DOM della scheda nessun link `mailto:` (criterio 4); anonimizzato
      invariato
- [ ] Tablet (`CustomerPage.tablet.test.tsx`) verde; Impeccable pulito; confronto con Scheda cliente
**Verifica:** `npm test -- customers cards`
**Dipendenze:** 18 · **File:** src/features/cards/CardSummary.tsx (+css, +test),
src/features/customers/CustomerPage.tsx (+css, +test), src/features/customers/CustomerPage.tablet.test.tsx,
src/features/customers/AnonymizeSection.tsx (+test) · **Dimensione:** M

## Task 21: Export CSV clienti con l'email
**Descrizione:** colonna «Email» al posto di «Telefono» (stessa posizione), valore da `guardFormula`, vuota
per gli anonimizzati; `supabaseExportService` legge `email`; tipi e finto aggiornati; E2E con la nuova
intestazione.
**Accettazione:**
- [ ] Unit: `=cmd@example.com` protetta da `guardFormula`; anonimizzato vuoto; intestazione nuova
- [ ] E2E `export` verde (criterio 4)
**Verifica:** `npm test -- export && npm run e2e`
**Dipendenze:** 16 · **File:** src/features/export/buildCustomersCsv.ts (+test), src/features/export/types.ts,
src/features/export/supabaseExportService.ts (+test), src/test/fakeExportService.ts, e2e/export.spec.ts
· **Dimensione:** M

## Task 22: Servizi e dominio senza telefono
**Descrizione:** via `phone` da `Customer`, dagli input e da `customerRow.ts`; i servizi non mandano più
`p_phone` (le firme transitorie lo hanno con `default`); finti senza telefono.
**Accettazione:**
- [ ] Unit: nessuna chiamata RPC contiene `p_phone`; nessuna riga parsata ha `phone`
- [ ] `npm run typecheck` verde senza il campo
**Verifica:** `npm run typecheck && npm test`
**Dipendenze:** 19, 20, 21 · **File:** src/features/customers/types.ts, src/features/customers/customerRow.ts,
src/features/customers/supabaseCustomerService.ts (+test), src/features/cards/supabaseCardsService.ts (+test),
src/test/fakeCustomerService.ts e fakeCardsService.ts · **Dimensione:** M

## Task 23: Test di integrazione senza telefono
**Descrizione:** i test di integrazione che creavano o cercavano clienti per telefono passano all'email
(creazione con email normalizzata, doppione, `email_invalid`, ricerca per parte dell'email tramite `list`,
due `create_customer` contemporanee con la stessa email → uno solo, l'altro `customer_email_taken`).
**Accettazione:**
- [ ] Integrazione verde; nessun `+39…` né «telefono» del cliente nei file
- [ ] Concorrenza sull'email provata (spec, Testing Strategy)
**Verifica:** `npm run test:integration`
**Dipendenze:** 22 · **File:** tests/integration/customers.test.ts, tests/integration/cards.test.ts,
tests/integration/export.test.ts, tests/integration/tablet-kiosk.test.ts, tests/integration/ledger*.test.ts
· **Dimensione:** M

## Task 24: Telefono fuori da galleria, codici ed E2E; percorso dell'email
**Descrizione:** eliminati `phone.ts` (+test) e `phone_invalid`; `UiGallery` con il campo email e «Cerca per
nome o email»; `e2e/tablet-pin.spec.ts` rinomina il parametro in `operatorPhone`; `e2e/customers.spec.ts`:
percorso admin con email (crea con `'  Rossi@Example.COM '`, trova scrivendo «rossi@exa» e «maria rossi»,
doppione rifiutato con «Apri la scheda», `rossi@` rifiutato, cancella i dati, l'email si riusa).
**Accettazione:**
- [ ] E2E (criteri 2, 3, 4) verde a 390×844
- [ ] `grep` di `phone`/`telefono` in `src/`, `e2e/`: solo il senso di dispositivo
**Verifica:** `npm test && npm run e2e`
**Dipendenze:** 22 · **File:** src/features/customers/phone.ts (+test, eliminati),
src/features/customers/errorCodes.ts (+test), src/app/dev/UiGallery.tsx, e2e/tablet-pin.spec.ts,
e2e/customers.spec.ts · **Dimensione:** M

## Task 25: Migrazione 2 nella forma finale; seed con email
**Descrizione:** il file `*_customers_v2_email.sql` riscritto con la forma esatta della spec: `rename
attribute phone to email` nella stessa posizione (via l'attributo transitorio), firme finali `(…, p_email, …)`
senza `p_phone`, `drop`/`create` di `export_customers` senza `phone`, `update … set phone = null` poi `drop
column phone`, `drop function private.normalize_phone`, `app.search_customers`,
`app.customers_served_today`; `seed.sql` con email `@example.com` (alcuni clienti senza) e nessun telefono;
pgTAP sul telefono sostituiti.
**Accettazione:**
- [ ] pgTAP (criterio 1): colonna `phone` assente, le tre funzioni assenti; firme finali; tutti i pgTAP verdi
- [ ] App, integrazione ed E2E verdi **senza** modifiche al frontend
- [ ] Nessun `+39…` nel seed
**Verifica:** `npm run db:reset && npm run db:test && npm run test:integration && npm run e2e`
**Dipendenze:** 23, 24 · **File:** supabase/migrations/*_customers_v2_email.sql, supabase/seed.sql,
supabase/tests/customers.test.sql, supabase/tests/customers_v2.test.sql, supabase/tests/ledger_reads.test.sql
· **Dimensione:** M

## Task 26: Controlli di confine e dei codici d'errore
**Descrizione:** `scripts/customersBoundary.test.ts` con la regola della spec (in `src/`, `e2e/`, `tests/`,
`scripts/`, `supabase/seed.sql`, escluso sé stesso: `phone:`, `.phone`, `p_phone`, `'phone'`,
`normalize_phone`, `maskPhone`, `phone_invalid`, «Telefono», «Senza telefono», «Tel.», `\+39\d{6,}`; niente
`mailto:`); `customerErrorCodes.test.ts` e `cardErrorCodes.test.ts` leggono `_customers*.sql`/`_cards*.sql` e
usano la definizione più recente di ogni funzione ancora presente; `ledgerErrorCodes.test.ts` aggiornato.
**Accettazione:**
- [ ] Test di confine verde (criterio 1) e rosso se si reintroduce uno dei modelli (provato in TDD)
- [ ] `email_invalid` e `customer_email_taken` obbligatori, `phone_invalid` assente
**Verifica:** `npm test -- scripts`
**Dipendenze:** 25 · **File:** scripts/customersBoundary.test.ts, scripts/customerErrorCodes.test.ts,
scripts/cardErrorCodes.test.ts, scripts/ledgerErrorCodes.test.ts · **Dimensione:** M

## Checkpoint D
- [ ] Criteri 1–4 provati (pgTAP, componenti, integrazione, E2E)
- [ ] `grep -rniE "phone|telefono"` in `src supabase e2e tests scripts`: solo il senso di dispositivo
- [ ] Impeccable pulito; confronto con Nuovo cliente, Nome già usato, Modifica cliente, Scheda cliente

## Fase 5 — Premi nella pagina pubblica

## Task 27: Sezione PREMI di `/s/:token`
**Descrizione:** `cardPointsService.fetchCardRewards` (token non valido senza chiamata, stesso timeout di 8 s,
`Promise.all` con `card_points`, un solo stato d'errore con «Riprova»); `CardPointsPage`: `<section
aria-labelledby="rewards-title">` con `h2` «PREMI», `<ul>` di righe ≥ 56 px con nome e `PointsBadge` «150
punti» / «1 punto», cifre `it-IT`; frase nuova «Questa pagina mostra i punti della card e i premi del bar,
senza dati personali.»; senza premi nessuna sezione; «Card non attiva» invariata.
**Accettazione:**
- [ ] Componenti: testo intero della pagina («nothing else») con PREMI; singolare; catalogo vuoto; «Card non
      attiva» senza premi; errore di una delle due chiamate → «Riprova»
- [ ] E2E `card-points`: premi attivi del seed in ordine, nessuna richiesta oltre alle due RPC; leggibile a
      320 px; Impeccable pulito (criterio 7)
**Verifica:** `npm test -- public && npm run e2e`
**Dipendenze:** 6 · **File:** src/features/cards/public/cardPointsService.ts (+test),
src/features/cards/public/CardPointsPage.tsx (+css, +test), e2e/card-points.spec.ts · **Dimensione:** M

## Fase 6 — Card non attiva: Riattiva e Riformatta

## Task 28: Servizio delle card per la schermata nuova
**Descrizione:** `types.ts` e `supabaseCardsService`: `getCard`, `reactivateCard(cardId, expectedActiveCardId)`,
`releaseCard(operationId, cardId)`; codici `card_released`, `card_active`, `active_card_changed` e `forbidden`
in `CARD_ERROR_CODES` con traduzione propria («Card non attiva: chiedi a un amministratore.»);
`fakeCardsService` con le stesse regole (ruolo, scambio, idempotenza, rilascio che libera l'uid).
**Accettazione:**
- [ ] Unit: forme e parametri delle tre RPC; ogni codice nuovo → errore tipizzato; `forbidden` non è più il
      `CustomerError` della cancellazione dati
- [ ] Finto: `release` con lo stesso `operation_id` non cambia nulla; uid rilasciato sconosciuto a `lookup`
**Verifica:** `npm test -- cards`
**Dipendenze:** 5 · **File:** src/features/cards/types.ts, src/features/cards/supabaseCardsService.ts (+test),
src/test/fakeCardsService.ts (+test) · **Dimensione:** M

## Task 29: Card disattivata letta in home e rotta `/card/:cardId`
**Descrizione:** `useHomeCardRead`: card non attiva + admin → `navigate('/card/<card_id>')` senza altre RPC;
operatore → avviso `role="alert"` «Card non attiva: chiedi a un amministratore» con i due testi della spec
(cliente / dati cancellati); card attiva invariata. Rotta sotto `RequireCashier` (pagina segnaposto fino al
task 30) in `routes.tsx`, `routes.test.tsx`, `docs/specs/contract.md`.
**Accettazione:**
- [ ] Componenti: admin → `/card/:id`, operatore → avviso con e senza cliente; card attiva → Registra spesa
      con le stesse chiamate di prima (criterio 13)
- [ ] Rotta presente nel contratto e nel test delle rotte; dispositivo senza cassiere → `/cassa`
**Verifica:** `npm test -- cards routes`
**Dipendenze:** 28 · **File:** src/features/cards/useHomeCardRead.ts (+test), src/features/cards/homeCardNotice.tsx,
src/app/routes.tsx, src/app/routes.test.tsx, docs/specs/contract.md · **Dimensione:** M

## Task 30: Schermata «Card non attiva»: dati e stati
**Descrizione:** `useInactiveCard` (su `getCard`, `useLatest`) e `InactiveCardPage`: intestazione con
«Indietro», riga card «Card …E5F6» / «Disattivata il 12 nov» (`Europe/Rome`), riga cliente «Era di Maria
Rossi» con `PointsBadge` o testo per il cliente anonimizzato; testi di Riattiva/Riformatta (senza azioni);
stati: caricamento, «Card non trovata» (anche id non uuid, senza chiamata), errore con «Riprova», già attiva
con «Apri la scheda di Maria», già riformattata, operatore → errore «Solo un amministratore può riattivare o
riformattare una card.»
**Accettazione:**
- [ ] Componenti: ogni stato; anonimizzato senza Riattiva e senza riga cliente (criterio 10); nessun uid
      nell'URL
- [ ] Impeccable pulito; target ≥ 48 px; titoli in Enjoy Display senza glifi mancanti
**Verifica:** `npm test -- cards`
**Dipendenze:** 29 · **File:** src/features/cards/useInactiveCard.ts, src/features/cards/InactiveCardPage.tsx
(+css, +test), src/app/routes.tsx, scripts/displayGlyphs.test.ts (solo se servono stringhe nuove)
· **Dimensione:** M

## Task 31: Riattiva
**Descrizione:** conferma sempre: senza altra card «Riattivare la card …E5F6?» / «Riattiva» / «Lascia com'è»;
con un'altra card «Scambiare le card di Maria?» / «Scambia le card»; `active_card_changed` → ricarica e nuova
conferma; riuscita → `role="status"` e `CardLinkWriter` (esiti e «Salta, lo scrivo più tardi» come Associa
card) → scheda con «Card …E5F6 riattivata» (o «… Link non scritto.»); `canWrite` falso → subito la scheda;
errori della spec con «Riprova» sicuro.
**Accettazione:**
- [ ] Componenti: nessuna chiamata a `reactivate_card` prima del tocco su «Riattiva»; scambio con l'id della
      card attiva; `active_card_changed`; `forbidden`; scrittura del link (criterio 8)
- [ ] Impeccable pulito
**Verifica:** `npm test -- cards`
**Dipendenze:** 30 · **File:** src/features/cards/InactiveCardPage.tsx (+test),
src/features/cards/useInactiveCard.ts, src/features/customers/homeNotice.ts (messaggio della scheda) · **Dimensione:** M

## Task 32: Riformatta
**Descrizione:** conferma `tone="danger"` con i testi della spec (cliente / anonimizzato); passi
`waiting-card` / `writing` / `verifying` in `aria-live="polite"` con «Annulla»; `eraseCard` → verifica →
`releaseCard` con un `operation_id` generato al tocco e tenuto finché l'esito è incerto; riuscita →
`navigate('/', { replace: true })` con «Card …E5F6 riformattata: ora è libera.»; ogni esito non riuscito della
spec (i due testi di `wrong-card` secondo `mayHaveWritten`, «Riformatta comunque»), rete dopo la scrittura →
«Card svuotata ma non liberata…» con «Riprova» senza riavvicinare la card; `card_active`; `canWrite` falso →
nota del telefono Android al posto del pulsante.
**Accettazione:**
- [ ] Componenti: ogni esito; reinvio con lo stesso `operation_id`; nessuna `release_card` prima della
      verifica (criteri 9, 10)
- [ ] Impeccable pulito
**Verifica:** `npm test -- cards`
**Dipendenze:** 9, 31 · **File:** src/features/cards/InactiveCardPage.tsx (+test),
src/features/cards/useReformatCard.ts (+test), src/features/customers/homeNotice.ts · **Dimensione:** M

## Task 33: Associa card con la riattivazione riservata
**Descrizione:** in Associa card un operatore che avvicina la propria card disattivata riceve `forbidden` e
vede «Card non attiva: chiedi a un amministratore.»; l'admin la riattiva come oggi; una card riformattata vi
appare come sconosciuta.
**Accettazione:**
- [ ] Componenti: operatore → testo nuovo; admin → riattivata (criterio 11)
- [ ] E2E `cards` verdi
**Verifica:** `npm test -- AssociateCardPage && npm run e2e`
**Dipendenze:** 28 · **File:** src/features/cards/AssociateCardPage.tsx (+test), src/features/cards/useAssociateCard.ts
· **Dimensione:** S

## Task 34: «Card non attiva» sul tablet
**Descrizione:** layout 1280×800 a una colonna larga come Associa card, azioni ≥ 70 px dal bordo inferiore;
nessun «Riformatta» (nota del telefono Android); `e2e/tablet-layout.spec.ts` misura la rotta; E2E tablet:
card disattivata dal lettore USB (`page.keyboard`) con un cassiere admin di un dispositivo del seed riservato →
Riattiva → scheda con «Link non scritto».
**Accettazione:**
- [ ] Test tablet del componente e E2E (criterio 12); nessuno scorrimento orizzontale; target ≥ 48 px
- [ ] Impeccable pulito
**Verifica:** `npm test && npm run e2e`
**Dipendenze:** 31, 32 · **File:** src/features/cards/InactiveCardPage.module.css,
src/features/cards/cardsPages.tablet.test.tsx, e2e/tablet-layout.spec.ts, e2e/tablet.spec.ts, supabase/seed.sql
(solo se serve un dispositivo riservato) · **Dimensione:** M

## Task 35: E2E sul telefono di Riattiva e Riformatta
**Descrizione:** con `__enjoyFakeCard`: card disattivata riletta da admin → «Card non attiva» → Riattiva con
scambio → link scritto (`__enjoyFakeCardWrites`) → spesa (< 10 s dalla card); disattiva → Riformatta → registro
con `url: null` → riletta → Nuovo cliente con la card; card di un cliente cancellato → solo Riformatta;
operatore → avviso.
**Accettazione:**
- [ ] E2E dei criteri 8, 9, 10, 11 e 13 verdi a 390×844
- [ ] Nessuna chiamata in più nel percorso card attiva → Registra spesa
**Verifica:** `npm run e2e`
**Dipendenze:** 32, 33 · **File:** e2e/cards-v2.spec.ts, e2e/nfc.ts · **Dimensione:** M

## Checkpoint E
- [ ] Criteri 7–13 provati; E2E telefono e tablet verdi
- [ ] Revisione `security-and-hardening` del client: niente `mailto:`, niente email/uid in URL o console,
      ruolo controllato anche sul server, riformattazione solo dopo la card riconosciuta; problemi risolti con test
- [ ] Impeccable pulito su ogni schermata nuova

## Fase 7 — Chiusura

## Task 36: Documentazione
**Descrizione:** RUNBOOK: note di rilascio della spec (produzione a bar chiuso, query delle note, `vacuum full
app.customers`, Open Question 17 prima del merge), prove a mano (Riformatta su Android e NTAG215, card vuota
fuori dall'app, tempo di `list_customers` < 500 ms con 1 000/20 000, pagina dei punti a 320 px), trappole
trovate; CLAUDE.md (telefono → email, rotta `/card/:cardId`); `docs/setup-*.md` e spec originali senza il
telefono del cliente (rimando a SPEC-customers-v2, plan.md Open Questions); `brain/MAP.md`.
**Accettazione:**
- [ ] `grep -rniE "phone|telefono" docs`: solo il senso di dispositivo o la storia citata da SPEC-customers-v2
- [ ] Nessun segreto né dato reale
**Verifica:** rilettura; `npm run format:check`
**Dipendenze:** 35 · **File:** brain/topics/operations/RUNBOOK.md, CLAUDE.md, docs/setup-accounts.md,
docs/specs/ (passi sul telefono), brain/MAP.md · **Dimensione:** M

## Task 37: Verifica dei criteri di successo e PR
**Descrizione:** tabella "Verifica dei criteri di successo" in `plan.md` (criterio → `file › titolo del
test`) e `scripts/customersV2Criteria.test.ts` (criteri 1–13, documenti senza segreti né contatti reali).
Quality bar completa più `npm run build && npm run check:bundle`. PR da `feat/customers-v2` su base `main`:
nel corpo, niente riga "rami in catena"; si dice che è **indipendente dalla PR #24** (`operators`) e si
elencano i file toccati da entrambe, se ce ne sono; in apertura l'Open Question 17 da chiudere prima del merge.
`brain/STATUS.md` e `brain/HANDOFF.md` aggiornati.
**Accettazione:**
- [ ] Ogni criterio ha almeno una prova verificata dallo script
- [ ] CI verde sulla PR (pgTAP, unit, componenti, integrazione, E2E telefono e tablet, bundle)
- [ ] Nessuna pubblicazione su progetti remoti (la fa l'orchestratore)
**Verifica:** `npm test -- customersV2Criteria`; CI su GitHub
**Dipendenze:** 36 · **File:** tasks/customers-v2/plan.md, tasks/customers-v2/todo.md,
scripts/customersV2Criteria.test.ts, brain/STATUS.md, brain/HANDOFF.md · **Dimensione:** M

## Checkpoint F
- [ ] I 13 criteri di successo di SPEC-customers-v2 verificati
- [ ] PR su `main`, indipendente da #24, pronta per `code-review-and-quality`
- [ ] Open Question 17 chiusa con il titolare prima del merge
