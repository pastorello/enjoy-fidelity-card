# Todo: cards

Fonte: [plan.md](plan.md) · Spec: [SPEC-cards.md](../../docs/specs/SPEC-cards.md). Ogni task chiude con
`npm run typecheck && npm run lint && npm run format:check && npm test && npm run db:test &&
npm run test:integration && npm run e2e` verdi e un commit Conventional Commits sul branch `feat/cards`.
Test prima del codice (`test-driven-development`). Solo lo stack Supabase locale (`npm run db:start`, poi
`scripts/reload-auth-templates.sh`); mai i progetti remoti, mai `--linked`/`--remote`. Solo dati inventati
(`@example.com`, uid come `04AABBCCDDEE01`, nessun token nel seed). Detector Impeccable pulito dopo ogni
modifica di UI; target touch ≥ 48 px.

## Task 1: Tabella delle card e associazione nel database
**Descrizione:** `npx supabase migration new cards`: `app.cards` come in "Modello dati" (uid con la CHECK
di `normalizeUid`, `customer_id`, `active`, `associated_at/by`, `deactivated_at`, `link_written_at/by`,
`link_pending_at` e i loro vincoli), indice unico parziale `cards_one_active_per_customer`; policy
`select` per operatori attivi, `revoke insert, update, delete, truncate` ad `authenticated`; trigger
`before update` (uid e cliente immutabili, `associated_*` solo nella riattivazione) e `before delete`
rifiutato; RPC `app.lookup_card`, `app.associate_card` (blocca il cliente `for update`, sostituzione,
riattivazione, idempotenza, `unique_violation` → `card_taken`), `app.deactivate_card`. Seed: una card finta
su un cliente del seed, link non scritto.
**Accettazione:**
- [x] pgTAP: `anon` e utente senza profilo non leggono `cards` e ricevono `not_operator`/permesso negato
      dalle tre RPC; `authenticated` non scrive direttamente; vincolo uid (minuscolo, separatori, dispari,
      7 e 11 byte); trigger su uid, cliente, `associated_by` fuori dalla riattivazione e delete (criterio 8)
- [x] pgTAP: `associate_card` per operatore e admin con `associated_by` = chiamante; sostituzione (vecchia
      `active=false`, `deactivated_at`, `replaced_card_id`) senza modificare righe fuori da `app.cards`;
      `card_taken` (attiva, disattivata, anonimizzata → `owner_name` null); ripetizione idempotente;
      riattivazione; `customer_not_found`, `customer_anonymized`, `invalid_uid`; due attive impossibili
      (criteri 3, 4, 5, 7)
- [x] pgTAP: `lookup_card` sconosciuta/attiva/disattivata/anonimizzata (nome null), `invalid_uid`;
      `deactivate_card` idempotente e `card_not_found`; `function_privileges.test.sql` verde
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** nessuna · **File:** supabase/migrations/*_cards.sql, supabase/tests/cards.test.sql,
supabase/seed.sql · **Dimensione:** M

## Task 2: Nuovo cliente con card in una sola operazione; anonimizzazione
**Descrizione:** nella stessa migrazione: `app.create_customer_with_card(p_operation_id, p_name, p_phone,
p_privacy_consent, p_notes, p_uid)` (stessa firma di `app.create_customer` più `p_uid`; `operation_id` già
usato → restituisce quel cliente senza toccare le card; altrimenti `create_customer` + logica di
`associate_card` nella stessa transazione); trigger `after update of anonymized_at on app.customers` che
disattiva la card attiva.
**Accettazione:**
- [x] pgTAP: crea cliente e card attiva; stesso `operation_id` due volte → un cliente e una card (criterio 7)
- [x] pgTAP: `card_taken`, `invalid_uid` e `customer_name_taken` non lasciano né cliente né card (criterio 2)
- [x] pgTAP: l'anonimizzazione disattiva la card; l'uid resta legato a quel cliente e `associate_card` su
      un altro cliente dà `card_taken` con `owner_name` null
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 1 · **File:** supabase/migrations/*_cards.sql, supabase/tests/cards.test.sql · **Dimensione:** S

## Task 3: Link ai punti nel database
**Descrizione:** `private.card_links` (solo `token_hash` e `pending_hash` sha256, `pending_issued_at/by`;
RLS senza policy, `revoke all` a `public`, `anon`, `authenticated`); `private.card_token_hash(text)`;
`app.issue_card_link(card_id)` (token di 16 byte da `extensions.gen_random_bytes` in base64url di 22
caratteri, solo impronta in attesa, `link_pending_at` = `pending_issued_at`); `app.confirm_card_link(card_id,
token)` (idempotente sul token valido, promuove quello in attesa, `link_token_mismatch` altrimenti);
trigger: ogni passaggio `active` true → false azzera lo stato del link e cancella la riga di `card_links`.
**Accettazione:**
- [x] pgTAP: token di 22 caratteri `[A-Za-z0-9_-]`, due emissioni diverse; nessuna colonna di
      `card_links` contiene il token in chiaro; `card_not_found`, `card_inactive`, `not_operator` per `anon`
      e utente senza profilo; nessun messaggio d'errore contiene il token (criteri 8, 12)
- [x] pgTAP: conferma → `link_written_at/by` valorizzati e `link_pending_at` null; stesso token due volte
      idempotente; token più vecchio dopo una nuova emissione → `link_token_mismatch`; `link_pending_at`
      uguale a `pending_issued_at` dopo l'emissione (criterio 15)
- [x] pgTAP: sostituzione, `deactivate_card` e anonimizzazione → stato del link azzerato e riga cancellata;
      riattivazione → link non scritto (criterio 11)
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 1, 2 · **File:** supabase/migrations/*_cards.sql, supabase/tests/cards.test.sql
· **Dimensione:** M

## Task 4: Funzione pubblica del saldo
**Descrizione:** `public.card_points(p_token text) returns integer`, `stable security definer`,
`search_path = ''`, `revoke execute … from public`, `grant execute … to anon, authenticated`: imposta
`Cache-Control: no-store` in `response.headers`; token null o non `^[A-Za-z0-9_-]{22}$` → `null`; cerca
`token_hash` con card attiva e cliente non anonimizzato; saldo da `private.customer_balance` se esiste
(`to_regprocedure`), altrimenti `0`. Mai errori, mai altri campi.
**Accettazione:**
- [x] pgTAP come `anon`: token confermato → `0` senza movimenti; sconosciuto, malformato (21/23 caratteri,
      `+`, `/`, null), solo in attesa, di card disattivata, di cliente anonimizzato, vecchio dopo la
      rotazione → `null` senza errore (criteri 11, 12)
- [x] pgTAP: `anon` non legge `private.card_links` né `app.cards` e non esegue `issue_card_link` /
      `confirm_card_link`; `prosecdef` vero e `search_path` vuoto (criterio 8)
- [x] pgTAP allowlist: in `public` l'insieme delle funzioni eseguibili da `anon` è esattamente
      `{card_points(text)}`; `function_privileges.test.sql` verde per `app` e `private` (criterio 12)
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 3 · **File:** supabase/migrations/*_cards.sql, supabase/tests/cards.test.sql
· **Dimensione:** S

## Checkpoint A
- [ ] `db:test` verde, test esistenti invariati
- [ ] Revisione `security-and-hardening`: RLS, privilegi, `search_path`, token solo come impronta, nessun
      dato oltre al numero dalla funzione pubblica; problemi risolti con test

## Task 5: Servizio delle card
**Descrizione:** `src/features/cards/types.ts` (`CardsService`, `CardLookup`, `CardSummary` con
`LinkState` calcolato da `link_written_at`/`link_pending_at`, errori tipizzati `CardTakenError` con
proprietario, `CustomerUnavailableError`, `CardInactiveError`, `LinkTokenMismatchError`, `NetworkError`);
`supabaseCardsService.ts`: `lookup`, `getActiveCard(customerId)`, `associate`, `deactivate`,
`createCustomerWithCard`, `issueLink`, `confirmLink`; codici `P0001` tradotti, guasti tramite
`serverFaultFor`; `not_operator` come errore riconoscibile. Guardia: ogni codice sollevato dalla migrazione
ha una traduzione.
**Accettazione:**
- [x] Unità con client finto: ogni codice d'errore → errore tipizzato; errore di rete → `NetworkError`;
      `LinkState` `not-written` / `unverified` / `written` dai due istanti
- [x] Il token non compare in nessun messaggio d'errore prodotto dal servizio
- [x] `scripts/cardErrorCodes.test.ts` fallisce se la migrazione solleva un codice senza traduzione
**Verifica:** `npm test -- cards cardErrorCodes`
**Dipendenze:** 4 · **File:** src/features/cards/types.ts, src/features/cards/supabaseCardsService.ts
(+ .test.ts), scripts/cardErrorCodes.test.ts · **Dimensione:** M

## Task 6: Finto, provider e collegamento all'app
**Descrizione:** `src/test/fakeCardsService.ts` con le regole del server (un uid un cliente, una card
attiva, sostituzione, riattivazione, anonimizzati, token in attesa/confermato, idempotenza
sull'`operation_id`), registro delle chiamate, rete giù e "arrivato ma risposta persa";
`CardsServiceProvider` / `useCardsService()`; `main.tsx` con `supabaseCardsService`; `renderApp` con un
parametro facoltativo in coda.
**Accettazione:**
- [x] Unità del finto: stessi esiti di pgTAP per i casi principali (taken, idempotenza, sostituzione)
- [x] `useCardsService()` fuori dal provider lancia un errore chiaro
- [x] Tutti i test esistenti passano senza modifiche
**Verifica:** `npm test`
**Dipendenze:** 5 · **File:** src/test/fakeCardsService.ts (+ .test.ts),
src/features/cards/CardsServiceProvider.tsx, src/main.tsx, src/test/renderApp.tsx · **Dimensione:** M

## Task 7: Integrazione contro lo stack locale
**Descrizione:** `tests/integration/cards.test.ts` con gli utenti del seed e la chiave anon locale.
**Accettazione:**
- [x] Due `associate` concorrenti dello stesso uid a clienti diversi: una riesce, l'altra `card_taken`;
      due uid diversi allo stesso cliente in concorrenza: una sola card attiva alla fine (criterio 4)
- [x] `supabaseCardsService` traduce i codici reali (anche `card_inactive`, `link_token_mismatch`)
- [x] `card_points` via HTTP con la chiave anon: `Cache-Control: no-store`, corpo solo numero o `null`,
      stessa forma per token mai esistito e di card disattivata (criterio 12)
**Verifica:** `npm run test:integration`
**Dipendenze:** 6 · **File:** tests/integration/cards.test.ts · **Dimensione:** S

## Task 8: Etichetta della card e indirizzo del link
**Descrizione:** `formatCard.ts`: `formatCardLabel(uid)` («…» + ultime 4), nome breve (prima parola),
data «dal 3 nov» in `Europe/Rome` con anno se diverso; `cardLinkUrl.ts`: `cardLinkUrl(token)` con
`VITE_CARD_LINK_ORIGIN` (solo `https://`, senza percorso né `/` finale) o `location.origin`;
`vite.config.ts` fa fallire la build con `VERCEL_ENV=production` se la variabile manca o non è `https:`
(`.env.example` nel task 23).
**Accettazione:**
- [x] Unità: `04A1B2C3D4E5F6` → «…E5F6»; nome breve; data con e senza anno
- [x] Unità: origine da variabile o `location.origin`; origine con percorso, con `/` finale o `http:`
      rifiutata; l'URL non contiene mai l'uid
- [x] Unità del controllo di build (funzione esportata da un modulo usato da `vite.config.ts`): fallisce
      in produzione senza variabile o con `http:`, passa nelle anteprime e in locale
**Verifica:** `npm test -- formatCard cardLinkUrl && npm run build`
**Dipendenze:** nessuna · **File:** src/features/cards/formatCard.ts (+ .test.ts),
src/features/cards/cardLinkUrl.ts (+ .test.ts), vite.config.ts · **Dimensione:** M

## Checkpoint B
- [ ] Quality bar completa verde; test di `customers`, `rewards`, `card-input` invariati
- [ ] Revisione con l'utente prima della UI

## Task 9: Lettura dalla home
**Descrizione:** `useHomeCardRead` sostituisce `ignoreCardRead` in `HomePage` (consumatore attivo):
`lookup` → attiva `navigate('/clienti/:id/spesa')`, sconosciuta `navigate('/clienti/nuovo?card=UID')`,
disattivata avviso «Card disattivata» con «Apri la scheda di Maria», anonimizzata «Card non più valida»
senza nome; «Lettura della card…» con letture ignorate; rete «Card non letta: controlla la connessione.» con
«Riprova»; `not_operator` → `reportNotEnabled()`. `PurchasePlaceholderPage` su `/clienti/:id/spesa`
(«Registra spesa», «Indietro», riga cliente con nome e saldo).
**Accettazione:**
- [x] Componente: i quattro esiti, letture ignorate durante la ricerca, «Riprova» ripete la stessa ricerca,
      una nuova card sostituisce l'avviso (criterio 6)
- [x] Componente: il percorso card attiva → spesa non chiama `issueLink` né `writeUrl` (criterio 14)
- [x] `HomePage.test.tsx` di `customers` verde; segnaposto con nome e saldo (l'E2E del criterio 1 è nel task 10)
**Verifica:** `npm test -- HomePage useHomeCardRead`
**Dipendenze:** 6, 8 · **File:** src/features/cards/useHomeCardRead.ts (+ .test.tsx),
src/features/cards/PurchasePlaceholderPage.tsx, src/features/customers/HomePage.tsx, src/app/routes.tsx
· **Dimensione:** M

## Task 10: Nuovo cliente da card nuova
**Descrizione:** `/clienti/nuovo?card=UID` (wireframe "Card sconosciuta: nuovo cliente"):
`NewCustomerCardPanel` (`aria-label="Card letta"`, «Card nuova letta», codice completo, link «È la nuova
card di un cliente già registrato?…» → `/`); `NewCustomerPage` usa `createCustomerWithCard` con lo stesso
`operation_id` del form e poi `navigate('/clienti/:id/spesa', { replace: true })`; `?card` non valido
ignorato; `card_taken` → cliente non creato, avviso del punto 4 e «Continua senza card» (toglie `?card`, poi
`create` con lo stesso `operation_id`). Scrittura del link: task 18.
**Accettazione:**
- [x] Componente: riquadro con uid completo; `?card` non valido → form senza card; reinvio dopo rete con lo
      **stesso** `operation_id` (criterio 7)
- [x] Componente: `card_taken` → avviso, dati del form intatti, «Continua senza card»; errori del form di
      `customers` invariati
- [x] E2E (nasce `e2e/cards.spec.ts`): card sconosciuta in home → `/clienti/nuovo?card=` con il codice →
      Salva → `/clienti/:id/spesa` col nome; Indietro non torna al form; la stessa card riletta in home →
      spesa del nuovo cliente entro 2 s, senza tocchi, nessuna voce in `__enjoyFakeCardWrites` (criteri 1, 2, 14)
**Verifica:** `npm test -- NewCustomer && npm run e2e -- cards`
**Dipendenze:** 9 · **File:** src/features/cards/NewCustomerCardPanel.tsx (+ .module.css, .test.tsx),
src/features/customers/NewCustomerPage.tsx, e2e/cards.spec.ts · **Dimensione:** M

## Task 11: Card facoltativa in Nuovo cliente senza card
**Descrizione:** sezione `aria-label="Card"` «Card (facoltativa)» con `CardReadPanel` e consumatore attivo
su `/clienti/nuovo`: card sconosciuta → riquadro «Card letta» (vale l'ultima) e salvataggio con
`createCustomerWithCard`, destinazione quella di `customers`; card nota (attiva, disattivata, anonimizzata)
→ avviso «Card già associata» con i testi del caso, dati intatti; lettura non disponibile → stati di
`CardReadPanel`, il cliente si salva senza card.
**Accettazione:**
- [ ] Componente: sconosciuta → riquadro e salvataggio con card; seconda card sostituisce la prima
- [ ] Componente: nota → avviso senza perdere i dati; anonimizzata senza nome (criterio 5)
- [ ] Componente: NFC spento / iPhone → salvataggio senza card
**Verifica:** `npm test -- NewCustomer`
**Dipendenze:** 10 · **File:** src/features/cards/NewCustomerCardSection.tsx (+ .test.tsx),
src/features/cards/CardTakenNotice.tsx, src/features/customers/NewCustomerPage.tsx · **Dimensione:** M

## Task 12: Associa o sostituisci card
**Descrizione:** `AssociateCardPage` su `/clienti/:id/card` (wireframe "Associa o sostituisci card" e
"Card già di un altro cliente"): intestazione «Associa card», riga cliente con `PointsBadge`,
`CardReadPanel` «Avvicina la card nuova», nota sulla card attuale solo se c'è, footer «Annulla». Esiti di
`associate`: riuscita → `/clienti/:id` (`replace`) con «Card …A1B2 associata. Link non scritto.» (la
scrittura arriva nel task 17); `card_taken` (`CardTakenNotice` con «Riprova con un'altra card» e «Apri la
scheda di Antonio», letture ignorate); già attiva di questo cliente; riattivazione; «Associazione in corso…»;
rete con «Riprova» sullo stesso uid; anonimizzato → `StatusView`; inesistente → pagina non trovata.
**Accettazione:**
- [ ] Componente: ogni esito del punto 4 con i testi del wireframe; nota solo con card attiva (criterio 5)
- [ ] Componente: «Riprova» rimanda lo stesso uid; `not_operator` → `reportNotEnabled()` (criterio 7)
- [ ] E2E: card di un altro cliente → «Card già associata» → «Apri la scheda di …»; Sostituisci card → la
      vecchia letta in home mostra «Card disattivata» (criteri 3, 5, 6)
**Verifica:** `npm test -- AssociateCardPage && npm run e2e -- cards`
**Dipendenze:** 11 · **File:** src/features/cards/AssociateCardPage.tsx (+ .module.css, .test.tsx),
src/app/routes.tsx, e2e/cards.spec.ts · **Dimensione:** M

## Task 13: Sezione CARD di Modifica cliente
**Descrizione:** `CustomerCardSection` prima di DATI DEL CLIENTE in `EditCustomerPage`: «Card attiva …E5F6 ·
dal 3 nov» con «Sostituisci card» → `/clienti/:id/card` e «Disattiva card» (`ConfirmDialog` con i testi del
punto 5, «Disattiva card» danger / «Lascia com'è»); «Nessuna card attiva» con «Associa card»; rete con
«Riprova» idempotente; caricamento fallito «Card non caricata» con «Riprova», resto del form usabile; la
sezione si aggiorna senza salvare il form. Lo stato del link arriva nel task 19.
**Accettazione:**
- [ ] Componente: con e senza card; dialogo di disattivazione e sezione aggiornata; errore di caricamento
- [ ] Componente: «Disattiva card» ripetuto dopo un errore di rete non dà errore (criterio 7)
- [ ] E2E: Disattiva card → «Nessuna card attiva»; pulsanti ≥ 48 px
**Verifica:** `npm test -- CustomerCardSection EditCustomerPage && npm run e2e -- cards`
**Dipendenze:** 12 · **File:** src/features/cards/CustomerCardSection.tsx (+ .module.css, .test.tsx),
src/features/customers/EditCustomerPage.tsx, e2e/cards.spec.ts · **Dimensione:** M

## Task 14: Riga card della Scheda cliente
**Descrizione:** `CardSummary` nella riga sotto il nome di `CustomerPage`: «Card attiva …E5F6» o «Senza
card», poi « · » e la parte telefono di `customers`; cliente anonimizzato: riga di `customers` senza parte
card; messaggio `role="status"` arrivato dalla navigazione di Associa card.
**Accettazione:**
- [ ] Componente: card attiva, senza card, anonimizzato; stile come «Senza telefono»
- [ ] Componente: il messaggio «Card …A1B2 associata» compare e non resta dopo un nuovo ingresso
**Verifica:** `npm test -- CardSummary CustomerPage`
**Dipendenze:** 12 · **File:** src/features/cards/CardSummary.tsx (+ .test.tsx),
src/features/customers/CustomerPage.tsx · **Dimensione:** S

## Checkpoint C
- [ ] Quality bar completa verde
- [ ] Detector Impeccable pulito; screenshot 390×844 confrontati con Main, Nuovo-cliente-card,
      Nuovo-cliente, Associa-card, Card-gia-associata, Modifica-cliente, Cliente

## Task 15: Scrittura del link, percorso principale
**Descrizione:** `CardLinkWriter` (`aria-live="polite"`): `issueLink` → `writeUrl(cardLinkUrl(token), {
expectedUid, signal })` → `confirmLink`; passi `waiting-card` «Avvicina la card», `writing` «Tieni la card
appoggiata» · «Scrivo il link per vedere i punti…», `verifying`; «Salta, lo scrivo più tardi» interrompe con
il `signal`; esito riuscito; esiti `timeout`/`io` (tavola Associa-link-errore), `verify-failed`,
`not-allowed`, `cannot-write`, rete su `issue` con «Scrivi di nuovo il link» (token nuovo) e «Più tardi»;
`canWrite` falso → niente pulsante e testo del dispositivo. Il token solo in una variabile del componente.
**Accettazione:**
- [ ] Componente con scrittore finto: passi e testi; riuscita → `confirmLink` una volta con lo stesso token
- [ ] Componente: ogni esito non riuscito con i suoi testi; «Scrivi di nuovo il link» → nuova `issueLink`;
      «Salta» interrompe la scrittura
- [ ] Componente: il token non compare nel DOM in nessun passo (criterio 10)
**Verifica:** `npm test -- CardLinkWriter`
**Dipendenze:** 8, 6 · **File:** src/features/cards/CardLinkWriter.tsx (+ .module.css, .test.tsx),
src/features/cards/useCardLinkWriter.ts · **Dimensione:** M

## Task 16: Scrittura del link, casi difficili
**Descrizione:** in `CardLinkWriter`: rete su `confirm` → «Link scritto ma non registrato…» con «Riprova» che
rimanda `confirmLink` con lo **stesso** token, senza nuova emissione né scrittura; «Più tardi» lascia la card
`unverified`; `wrong-card` con `otherUid` → testo con le due card; `unreadable` → «Scrivi comunque» con
`allowUnreadable: true`; `card_inactive` → «Questa card non è più attiva.» senza «Scrivi di nuovo il link».
**Accettazione:**
- [ ] Componente: «Riprova» dopo rete su `confirm` non chiama `issueLink` né `writeUrl` (criterio 15)
- [ ] Componente: `wrong-card` con e senza `otherUid`; `unreadable` → `writeUrl` con `allowUnreadable`
- [ ] Componente: `card_inactive` senza pulsante di riscrittura; nessun log del token
**Verifica:** `npm test -- CardLinkWriter`
**Dipendenze:** 15 · **File:** src/features/cards/CardLinkWriter.tsx (+ .test.tsx),
src/features/cards/useCardLinkWriter.ts · **Dimensione:** S

## Task 17: Scrittura in Associa card
**Descrizione:** dopo un'associazione riuscita (o riattivazione) `AssociateCardPage` mostra «Card associata a
Maria» (`role="status"`), il riquadro di scrittura (`aria-label="Scrittura del link"`) e la nota con icona
link come nella tavola Associa-link; link scritto → `/clienti/:id` con «Card …A1B2 associata»; «Salta…» /
«Più tardi» / dispositivo che non scrive → `/clienti/:id` con «… Link non scritto.»; già attiva con link non
scritto → scrittura subito, con link scritto → «Scrivi di nuovo il link».
**Accettazione:**
- [ ] Componente: testi delle tavole Associa-link e Associa-link-errore; ogni uscita va su `/clienti/:id`
- [ ] E2E: Sostituisci card → scrittura finta → `__enjoyFakeCardWrites` ha l'URL `…/s/[A-Za-z0-9_-]{22}`
      senza l'uid (criterio 10)
- [ ] E2E: `setCanWrite(false)` → associazione salvata, «Link non scritto», nessuna voce nel registro
      (criterio 13)
**Verifica:** `npm test -- AssociateCardPage && npm run e2e -- cards`
**Dipendenze:** 12, 16 · **File:** src/features/cards/AssociateCardPage.tsx (+ .test.tsx),
e2e/cards.spec.ts · **Dimensione:** M

## Task 18: Scrittura dopo il salvataggio in Nuovo cliente
**Descrizione:** in Nuovo cliente con `?card` e con la card letta nel form, dopo il salvataggio parte
`CardLinkWriter` sulla card appena associata; poi `navigate` alla destinazione (spesa con `?card`, quella di
`customers` senza) sia a link scritto sia con «Più tardi» o scrittura non riuscita.
**Accettazione:**
- [ ] Componente: salvataggio → scrittura → navigazione; con «Più tardi» e con esito `io` il cliente resta
      salvato e la navigazione avviene
- [ ] E2E: card sconosciuta → Salva → «Avvicina la card …» → `__enjoyFakeCard(uid)` → scrittura finta →
      `/clienti/:id/spesa`; voce nel registro per quell'uid (criterio 10)
**Verifica:** `npm test -- NewCustomer && npm run e2e -- cards`
**Dipendenze:** 11, 16 · **File:** src/features/customers/NewCustomerPage.tsx,
src/features/cards/NewCustomerCardSection.tsx (+ .test.tsx), e2e/cards.spec.ts · **Dimensione:** M

## Task 19: Stato del link in Modifica cliente
**Descrizione:** sotto la riga della card in `CustomerCardSection`: `written` «Link ai punti scritto» +
«Scrivi di nuovo il link»; `not-written` avviso e «Scrivi il link»; `unverified` avviso «Link da
controllare…» e «Scrivi di nuovo il link»; i pulsanti aprono `CardLinkWriter` nella sezione con il passo
«Avvicina la card …E5F6»; `canWrite` falso → «Per scrivere il link serve un telefono Android con l'NFC
attivo.» al posto del pulsante; a scrittura finita la sezione si ricarica.
**Accettazione:**
- [ ] Componente: i tre `LinkState` con testi e pulsanti; dispositivo che non scrive (criteri 13, 15)
- [ ] E2E: `failNextWrite('io')` → «Link non scritto…» → «Più tardi» → Modifica cliente «Link non scritto»
      → «Scrivi il link» + `__enjoyFakeCard(uid)` → «Link ai punti scritto» (criterio 13)
**Verifica:** `npm test -- CustomerCardSection && npm run e2e -- cards`
**Dipendenze:** 13, 16 · **File:** src/features/cards/CustomerCardSection.tsx (+ .test.tsx),
e2e/cards.spec.ts · **Dimensione:** M

## Checkpoint D
- [ ] Quality bar completa verde; tutti gli esiti del punto 8 coperti da test di componente
- [ ] Detector Impeccable pulito; screenshot confrontati con Associa-link e Associa-link-errore
- [ ] Il token non compare nel DOM né nei log in nessun test

## Task 20: Pagina pubblica dei punti
**Descrizione:** `src/features/cards/public/`: `cardPointsService.ts` (solo
`getSupabase().schema('public').rpc('card_points', …)` in `POST`, timeout 8 s); `CardPointsPage` (tavole
Saldo-punti e Saldo-card-non-attiva): token controllato nel client (malformato → messaggio neutro senza
chiamata), «Carico i tuoi punti…», logo con `alt` «Bar Enjoy Gaeta», «ENJOY YOUR POINTS» (`lang="en"`), saldo
`Intl.NumberFormat('it-IT')` in stile `figure`, «punto»/«punti», testi sotto il riquadro, piè di pagina;
`null` → «Card non attiva»; rete → «Riprova»; `meta robots` noindex. Rotta `/s/:token` con `lazy` fuori da
`RequireAuth` e `AppShell`.
**Accettazione:**
- [ ] Componente: numero formattato, «punto» con 1, `null` neutro, malformato senza chiamata, timeout 8 s →
      «Riprova», nessun nome (criterio 10)
- [ ] Componente: `meta robots` presente; nessuna scrittura in `localStorage`; nessuna attesa di
      `AuthProvider`; il titolo della pagina non contiene il token
- [ ] Contrasto AA e leggibile a 320 px; detector Impeccable pulito
**Verifica:** `npm test -- CardPointsPage cardPointsService`
**Dipendenze:** 4, 6 · **File:** src/features/cards/public/cardPointsService.ts,
src/features/cards/public/CardPointsPage.tsx (+ .module.css, .test.tsx), src/app/routes.tsx
· **Dimensione:** M

## Task 21: Niente PWA sulla pagina pubblica; intestazioni
**Descrizione:** `vite.config.ts` con `injectRegister: false`; `main.tsx` registra il service worker tranne
sui percorsi `/s/` e su `/s/` annulla `beforeinstallprompt` (le intestazioni di `vercel.json`: task 22).
**Accettazione:**
- [ ] Unità: la funzione di registrazione salta `/s/…` e registra altrove; `beforeinstallprompt` annullato
      su `/s/`
- [ ] E2E di `pwa.spec.ts` ancora verde (il service worker si registra sulle pagine degli operatori)
**Verifica:** `npm test && npm run build && npm run check:bundle && npm run e2e -- pwa`
**Dipendenze:** 20 · **File:** src/main.tsx, src/app/registerServiceWorker.ts (+ .test.ts),
vite.config.ts · **Dimensione:** M

## Task 22: E2E della pagina pubblica e intestazioni
**Descrizione:** `e2e/card-points.spec.ts`: link scritto da un flusso di associazione e aperto in un
contesto del browser **senza accesso**. `vercel.json` aggiunge per `/s/(.*)` `Cache-Control: no-store` e
`X-Robots-Tag: noindex, nofollow` (in locale non valgono: le prova `scripts/vercelHeaders.test.ts`).
**Accettazione:**
- [ ] Link nuovo → «ENJOY YOUR POINTS» e `0`, nessun nome; Sostituisci card → link della vecchia «Card non
      attiva», della nuova il saldo; token inventato → messaggio neutro (criteri 10, 11)
- [ ] Le sole richieste a Supabase sono `rpc/card_points` in `POST` e nessuna URL contiene il token;
      nessuna registrazione di service worker su `/s/…`
- [ ] Card nota → Registra spesa non produce voci in `__enjoyFakeCardWrites` né chiamate a
      `issue_card_link` (criteri 1, 14)
- [ ] `vercelHeaders.test.ts` trova le due intestazioni per `/s/(.*)`; CSP e intestazioni esistenti invariate
**Verifica:** `npm test -- vercelHeaders && npm run e2e -- card-points cards`
**Dipendenze:** 17, 21 · **File:** e2e/card-points.spec.ts, e2e/nfc.ts, vercel.json,
scripts/vercelHeaders.test.ts · **Dimensione:** M

## Checkpoint E
- [ ] Quality bar completa verde
- [ ] Revisione `security-and-hardening` della pagina pubblica (nessun dato oltre al saldo, token mai in
      URL di richiesta, log, cache o `localStorage`; nessun SW né installazione)
- [ ] Screenshot 390×844 e 320 px confrontati con Saldo-punti e Saldo-card-non-attiva

## Task 23: Guardie, procedura manuale, memoria di progetto
**Descrizione:** `scripts/cardsBoundary.test.ts`: solo `supabaseCardsService.ts` e
`public/cardPointsService.ts` usano `getSupabase()`; nessun `console.*`, `localStorage` o `location.href`
nel modulo; nessun `makeReadOnly`; `card_points` mai con `{ get: true }`. `scripts/displayGlyphs.test.ts`
include i componenti nuovi con testo in Enjoy Display. RUNBOOK: scrittura e lettura su Android con un
NTAG215 di prova, iPhone XS (criterio 10), card con link letta in primo piano → spesa e fuori lettura →
pagina dei punti (criterio 14, OQ 21), `curl -I` di `/s/…` sull'anteprima, card dei clienti scritte solo
dall'app di produzione, `VITE_CARD_LINK_ORIGIN` su Vercel Production. `VITE_CARD_LINK_ORIGIN=` (vuota) in
`.env.example`. `brain/STATUS.md` aggiornato; proposta all'utente per `brain/DECISIONS.md`.
**Accettazione:**
- [ ] La guardia fallisce se un componente chiama Supabase o registra uid/URL
- [ ] RUNBOOK con le verifiche manuali dei criteri 10 e 14
- [ ] Nessun segreto né dato reale nei documenti
**Verifica:** `npm test -- cardsBoundary displayGlyphs`
**Dipendenze:** 22 · **File:** scripts/cardsBoundary.test.ts, scripts/displayGlyphs.test.ts,
brain/topics/operations/RUNBOOK.md, brain/STATUS.md, .env.example · **Dimensione:** M

## Task 24: Verifica dei criteri di successo e PR
**Descrizione:** sezione «Verifica dei criteri di successo» in `plan.md` con, per ogni criterio, i test che
lo provano (`file › titolo`); `scripts/cardsCriteria.test.ts` come `rewardsCriteria.test.ts` (15 criteri,
ogni prova esiste). `brain/MAP.md` registra il modulo come fatto. PR da `feat/cards` su `main`, da unire
dopo #18 e #19.
**Accettazione:**
- [ ] Ogni criterio 1–15 ha almeno una prova esistente; le parti manuali (10, 14) rimandano al RUNBOOK
- [ ] Quality bar completa verde; `npm run build && npm run check:bundle` verde
- [ ] PR aperta con base `main`
**Verifica:** `npm test -- cardsCriteria`; quality bar completa
**Dipendenze:** 23 · **File:** tasks/cards/plan.md, tasks/cards/todo.md, scripts/cardsCriteria.test.ts,
brain/MAP.md · **Dimensione:** S

## Checkpoint F
- [ ] I 15 criteri verificati (parte manuale su Android e iPhone con l'utente sull'anteprima HTTPS)
- [ ] Quality bar completa verde in CI
- [ ] PR pronta per `code-review-and-quality`
