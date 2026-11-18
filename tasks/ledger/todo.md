# Todo: ledger

Fonte: [plan.md](plan.md) · Spec: [SPEC-ledger.md](../../docs/specs/SPEC-ledger.md). Ogni task chiude con
`npm run typecheck && npm run lint && npm run format:check && npm test && npm run db:test &&
npm run test:integration && npm run e2e` verdi e un commit Conventional Commits sul branch `feat/ledger`.
Test prima del codice (`test-driven-development`). Solo lo stack Supabase locale (`npm run db:start`, poi
`scripts/reload-auth-templates.sh`); mai i progetti remoti, mai `--linked`/`--remote`. Solo dati inventati
(`@example.com`, nomi inventati, telefoni `+39333000…`, uid finti); nessun movimento nel seed. Detector
Impeccable pulito dopo ogni modifica di UI; target touch ≥ 48 px; testi in italiano come nella spec.

## Task 1: Storico dei movimenti nel database
**Descrizione:** `npx supabase migration new ledger`: `app.movements` come in "Modello dati" (`operation_id`
unique, `kind`, `amount_cents`, `points`, `cents_per_point`, `reward_id` senza cascade, `description`,
`operator_id`, `created_at`, `corrects_movement_id` unique) con i `check` per tipo, indici
`(customer_id, created_at desc)` e `(created_at, id)`; policy `select` per
`(select private.is_active_operator())`; `revoke insert, update, delete, truncate` ad `authenticated` e
`anon`; trigger `before update or delete` (per riga) e `before truncate` che alzano sempre un errore;
`private.customer_balance(uuid) returns int`; vista `app.movement_history` (`security_invoker = true`,
`operator_name`, `cancelled_by_id`/`cancelled_at`, `corrected_kind`/`corrected_created_at`; `grant select`
solo ad `authenticated`); tipo `app.ledger_result`.
**Accettazione:**
- [x] pgTAP: operatore attivo legge movimenti e vista; utente senza profilo e `anon` no; insert, update,
      delete, truncate diretti negati ad `authenticated` (criterio 6)
- [x] pgTAP: update e delete falliscono anche come `postgres` (movimenti inseriti dal test come `postgres`);
      i `check` per tipo rifiutano righe incoerenti (criterio 6)
- [x] pgTAP: `customer_balance` 0 senza movimenti, somma con correzioni; la vista riporta chi e quando ha
      annullato
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** nessuna · **File:** supabase/migrations/*_ledger.sql, supabase/tests/ledger.test.sql
· **Dimensione:** M

## Task 2: Registrare una spesa sul server
**Descrizione:** nella stessa migrazione `app.record_purchase(p_operation_id, p_customer_id,
p_amount_cents)` con lo schema comune (operatore da `private.acting_operator_id()`, lock del cliente, replay
dopo il lock, validazione, insert): legge `cents_per_point` da `app.settings` nella stessa transazione,
`points = p_amount_cents / cents_per_point`, restituisce `app.ledger_result` col saldo attuale. `execute`
revocato a `public`/`anon`, concesso ad `authenticated`.
**Accettazione:**
- [x] pgTAP: 1250 c con 100 → 12 pt; 199 → 1; 99 → 0 (registrata); con 250 → 5 e il movimento salva 250;
      cambiare poi `settings` non altera lo storico (criterio 1)
- [x] pgTAP: importo 0, negativo, null, 10.000.000 → `22023`; cliente inesistente o anonimizzato → `EC006`;
      utente senza profilo → `42501`; `anon` senza `execute` (`has_function_privilege`)
- [x] pgTAP: stesso `operation_id` due volte → una riga e lo stesso movimento; stesso id con importo o
      cliente diverso → `EC007` (criterio 4)
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 1 · **File:** supabase/migrations/*_ledger.sql, supabase/tests/ledger.test.sql
· **Dimensione:** S

## Task 3: Riscattare un premio sul server
**Descrizione:** `app.redeem_reward(p_operation_id, p_customer_id, p_reward_id)` (premio inesistente o
inattivo → `EC005`; punti **attuali** e nome del premio letti sul server, salvati in `points` negativi,
`description` e `reward_id`) e `app.redeem_free_reward(p_operation_id, p_customer_id, p_description,
p_points)` (descrizione 1..80 dopo il trim, punti 1..99999, altrimenti `22023`); saldo − punti < 0 → `EC001`
controllato dopo il lock.
**Accettazione:**
- [x] pgTAP: riscatto oltre il saldo → `EC001`; esattamente uguale al saldo → ok e saldo 0 (criterio 5)
- [x] pgTAP: premio inattivo o inesistente → `EC005`; rinominare o cambiare i punti di un premio dopo il
      riscatto lascia invariati `description` e `points` del movimento (`SPEC-rewards.md`)
- [x] pgTAP: premio libero con descrizione vuota, di soli spazi o di 81 caratteri, punti 0 o 100000 →
      `22023`; cliente anonimizzato → `EC006`; replay e `EC007` come nel task 2 (criterio 4)
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 2 · **File:** supabase/migrations/*_ledger.sql, supabase/tests/ledger.test.sql
· **Dimensione:** M

## Task 4: Annullare un movimento sul server
**Descrizione:** `app.cancel_movement(p_operation_id, p_movement_id)`: movimento inesistente → `EC006`;
lock del cliente del movimento **anche se anonimizzato**; correzione → `EC004`; già annullato → `EC002`;
se non `private.is_admin()`: solo `operator_id = v_operator` e `clock_timestamp() - created_at <= 10 s`,
altrimenti `EC003`; spesa con saldo − punti < 0 → `EC001`; inserisce `correction` con `points = -points`
e `corrects_movement_id`; replay che confronta `p_movement_id`.
**Accettazione:**
- [x] pgTAP: correzione di segno opposto, saldo = somma di tutti i movimenti; doppio annullo `EC002`;
      correzione non annullabile `EC004`; spesa con punti già spesi `EC001` (criteri 6, 7)
- [x] pgTAP: operatore su movimento altrui → `EC003`; su movimento proprio con `created_at` di 11 s fa →
      `EC003`, di 5 s fa → ok; admin su qualsiasi movimento, anche di cliente anonimizzato (criterio 8)
- [x] pgTAP: annullo di un riscatto restituisce i punti; replay con lo stesso id → stessa correzione, con
      un altro `p_movement_id` → `EC007` (criterio 4)
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 3 · **File:** supabase/migrations/*_ledger.sql, supabase/tests/ledger.test.sql
· **Dimensione:** M

## Task 5: Saldo reale nelle letture dei clienti
**Descrizione:** nella stessa migrazione `create or replace` (stesse firme, stesso controllo `not_operator`
iniziale) di `app.search_customers`, `app.get_customer` e `app.customers_served_today`: `balance` da
`private.customer_balance`; "Serviti oggi" = clienti non anonimizzati con almeno una spesa o un riscatto di
oggi (`Europe/Rome`), annullati inclusi, correzioni escluse, `last_served_at` = ora dell'ultimo, ordine
`last_served_at desc`, massimo 50. `public.card_points` di `cards` usa ora il saldo reale.
**Accettazione:**
- [x] pgTAP: `search_customers` e `get_customer` col saldo reale (spesa, riscatto, correzione)
- [x] pgTAP: `customers_served_today` con movimenti alle 23:59 di ieri e 00:01 di oggi ora di Roma,
      annullati inclusi, correzioni escluse, anonimizzati esclusi, ordine, limite 50
- [x] pgTAP: `card_points` di un link confermato restituisce il saldo reale; `customers.test.sql`,
      `card_points.test.sql` e `function_privileges.test.sql` verdi senza modifiche ai casi esistenti
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 4 · **File:** supabase/migrations/*_ledger.sql, supabase/tests/ledger_reads.test.sql
· **Dimensione:** M

## Checkpoint A
- [ ] `db:test` verde, test esistenti invariati
- [ ] Revisione `security-and-hardening`: RLS, privilegi, `search_path`, trigger, lock prima del saldo e
      dell'idempotenza, ruoli nell'annullo, nessun dato personale nei movimenti; problemi risolti con test

## Task 6: Tipi e calcoli della cassa
**Descrizione:** `src/features/ledger/types.ts` (`Movement`, `LedgerResult`, `LedgerService`,
`LedgerError` con i codici della spec); `points.ts`: `pointsFor(amountCents, centsPerPoint)` per difetto,
riduttore del tastierino a centesimi (cifre a destra, "00", cancella, zeri iniziali ignorati, massimo
9.999.999), riduttore dei punti del premio libero (5 cifre, niente "00"), `isUnusualAmount` (strettamente
sopra la soglia), `formatConfirmAmount` ("1.250 €", "150,01 €").
**Accettazione:**
- [x] Unità: 1-2-5-0 = 1250 c e 12 punti con 100, 5 con 250; cancella su 0; cifre oltre il limite ignorate
      (criterio 1)
- [x] Unità: soglia 15000 → 15000 no, 15001 sì; "Conferma 1.250 €" e "Conferma 150,01 €" (criterio 2)
- [x] Unità: riduttore dei punti del premio libero (1..99999, niente "00")
**Verifica:** `npm test -- points`
**Dipendenze:** nessuna · **File:** src/features/ledger/types.ts, src/features/ledger/points.ts,
src/features/ledger/points.test.ts · **Dimensione:** S

## Task 7: Testi e date dei movimenti
**Descrizione:** `formatMovement.ts`: etichetta ("Spesa 15,00 €", "Premio: Caffè", "Correzione"), punti
con segno ("+15", "−50" con U+2212), data relativa ("Oggi HH:MM", "Ieri HH:MM", "8 nov HH:MM", "8 nov 2025
HH:MM"), gruppi per giorno (OGGI, IERI, "8 NOVEMBRE", con l'anno se diverso), testo della correzione
("annulla la spesa delle 18:05", "annulla il riscatto delle HH:MM", "… del 7 nov alle 18:05"); sempre
`timeZone: 'Europe/Rome'`.
**Accettazione:**
- [x] Unità: date relative e gruppi a cavallo della mezzanotte di Roma e del cambio d'ora, con un orologio
      fisso e la CI in UTC
- [x] Unità: testo della correzione stesso giorno / altro giorno, spesa / riscatto
**Verifica:** `npm test -- formatMovement`
**Dipendenze:** 6 · **File:** src/features/ledger/formatMovement.ts, src/features/ledger/formatMovement.test.ts
· **Dimensione:** S

## Task 8: Servizio del ledger
**Descrizione:** `supabaseLedgerService.ts`: `recordPurchase`, `redeemReward`, `redeemFreeReward`,
`cancelMovement` (RPC con `operation_id`), `listMovements(customerId, { before, limit })` sulla vista
(50 per pagina, 4 per la scheda); `EC001`…`EC007`, `42501`, `22023` → `LedgerError`; rete e risposta oltre
8 s → `network`; guasti da `serverFaultFor`. Guardia `scripts/ledgerErrorCodes.test.ts`.
**Accettazione:**
- [x] Unità con client finto: ogni codice → l'errore giusto; timeout 8 s → `network` (timer finti); 5xx →
      `unknown` o `ServerFaultError`
- [x] Unità: il risultato restituisce i punti e il saldo del server, non quelli calcolati nel client
- [x] `scripts/ledgerErrorCodes.test.ts` fallisce se la migrazione solleva un codice senza traduzione
**Verifica:** `npm test -- supabaseLedgerService ledgerErrorCodes`
**Dipendenze:** 5, 6 · **File:** src/features/ledger/supabaseLedgerService.ts (+ .test.ts),
scripts/ledgerErrorCodes.test.ts · **Dimensione:** M

## Task 9: Finto, provider e collegamento all'app
**Descrizione:** `src/test/fakeLedgerService.ts` con le regole del server (per difetto, saldo ≥ 0,
idempotenza sull'`operation_id`, finestra di 10 s con orologio pilotabile, punti già spesi, premi del finto
di `rewards`, saldo aggiornato nel finto di `customers`), registro delle chiamate, rete giù, timeout e
"arrivato ma risposta persa"; `LedgerServiceProvider` / `useLedgerService()`; `main.tsx` con
`supabaseLedgerService`; `renderApp` con un parametro facoltativo in coda.
**Accettazione:**
- [x] Unità del finto: stessi esiti di pgTAP per i casi principali (saldo insufficiente, replay, `EC003`,
      punti già spesi); "risposta persa" + reinvio = un movimento (criterio 4)
- [x] `useLedgerService()` fuori dal provider lancia un errore chiaro
- [x] Tutti i test esistenti passano senza modifiche
**Verifica:** `npm test`
**Dipendenze:** 8 · **File:** src/test/fakeLedgerService.ts (+ .test.ts),
src/features/ledger/LedgerServiceProvider.tsx, src/main.tsx, src/test/renderApp.tsx · **Dimensione:** M

## Task 10: Concorrenza reale contro lo stack locale
**Descrizione:** `tests/integration/ledger-concurrency.test.ts` con admin e operatore del seed (due client
autenticati), su clienti creati dal test; importi calcolati dal rapporto in vigore.
**Accettazione:**
- [x] Saldo 100, due riscatti liberi da 60 lanciati insieme con id diversi, 20 ripetizioni → sempre uno
      solo riuscito, l'altro `insufficient-balance`, saldo finale mai < 0; stessa prova con un riscatto e
      l'annullo (admin) di una spesa (criterio 5)
- [x] Due chiamate parallele con lo **stesso** id → un solo movimento ed entrambe le risposte con lo stesso
      movimento (criterio 4)
- [x] `supabaseLedgerService` traduce i codici reali (`EC001`…`EC007`, `22023`, `42501`)
**Verifica:** `npm run test:integration`
**Dipendenze:** 9 · **File:** tests/integration/ledger-concurrency.test.ts, tests/integration/ledger.test.ts
· **Dimensione:** M

## Checkpoint B
- [ ] Quality bar completa verde; test di `customers`, `rewards`, `card-input`, `cards` invariati
- [ ] Revisione con l'utente prima della UI

## Task 11: Operazione con identificativo stabile
**Descrizione:** `useOperation(run)`: `submit()` crea `crypto.randomUUID()` una volta; `retry()` riusa lo
stesso id; esito ok o rifiuto definitivo → id consumato; stati `idle`/`busy`/`done`/`error`; chiamate
ignorate mentre è `busy`; `reset()` per "Annulla"/"Correggi".
**Accettazione:**
- [x] Unità: doppio `submit` = una chiamata; `retry` dopo `network` con lo stesso id; nuovo id dopo un esito
      definitivo e dopo `reset` (criterio 4)
- [x] Unità: nessun reinvio automatico; nessun salvataggio in `localStorage`/`sessionStorage`
**Verifica:** `npm test -- useOperation`
**Dipendenze:** 6 · **File:** src/features/ledger/useOperation.ts, src/features/ledger/useOperation.test.tsx
· **Dimensione:** S

## Task 12: Tastierino a centesimi
**Descrizione:** `AmountKeypad` (`role="group"`, `aria-label="Tastierino numerico"`): 1–9, "00"
(`aria-label="Doppio zero"`) o cella vuota, 0, cancella (`aria-label="Cancella ultima cifra"`), tasti alti
64 px (56 px nel premio libero), nessuna tastiera di sistema; usa i riduttori del task 6. Solo token e
componenti del design system.
**Accettazione:**
- [x] Componente: 1-2-5-0 produce 1250; "00", cancella, limite; variante senza "00"
- [x] Componente: nomi accessibili; nessun `input` che apra la tastiera di sistema; tasti ≥ 48 px
- [x] Detector Impeccable pulito
**Verifica:** `npm test -- AmountKeypad`
**Dipendenze:** 6 · **File:** src/features/ledger/AmountKeypad.tsx (+ .module.css, .test.tsx)
· **Dimensione:** S

## Task 13: Registra spesa
**Descrizione:** `PurchasePage` prende `/clienti/:id/spesa` (via `PurchasePlaceholderPage`): `AppShell` con
Indietro (`navigate(-1)`, home senza cronologia) e titolo "Registra spesa"; `CustomerRowLink`; display
IMPORTO (`<output>` in sezione `aria-label="Importo"`, `aria-live="polite"`); "Punti da aggiungere +12" e
"1 punto ogni 1,00 €, per difetto · nuovo saldo 132 punti"; "Riscatta premio" (→ `/clienti/:id/premi`) e
"Conferma +N" (disabilitato a 0). `useSettings()` in caricamento o errore → `StatusView` con "Riprova".
Stati comuni: caricamento, errore, cliente non trovato o `:id` non uuid, cliente cancellato ("Cliente
cancellato: non si registrano spese né premi."), `forbidden` → `reportNotEnabled()`.
**Accettazione:**
- [x] Componente: 1-2-5-0 mostra "12,50 €", "+12" e il nuovo saldo; con rapporto 250 "+5" (criterio 1)
- [x] Componente: Conferma disabilitata a 0; settings in errore → niente Conferma; stati comuni con i testi
      della spec
- [x] Test di `cards` che arrivano su Registra spesa (home → card attiva) verdi; Impeccable pulito
**Verifica:** `npm test -- PurchasePage useHomeCardRead`
**Dipendenze:** 9, 11, 12 · **File:** src/features/ledger/PurchasePage.tsx (+ .module.css, .test.tsx),
src/app/routes.tsx, src/features/cards/PurchasePlaceholderPage.tsx (eliminato) · **Dimensione:** M

## Task 14: Importo insolito
**Descrizione:** importo **strettamente sopra** `confirmThresholdCents`: il riquadro punti diventa avviso
`role="alert"` (toni di warning) "Importo insolito: +1.250 punti" / "Sopra 150,00 € l'app chiede conferma.
Controlla di non aver digitato una cifra in più."; pulsanti "Correggi" (azzera) e "Conferma 1.250 €"
(registra subito, nessun secondo dialogo); "Riscatta premio" assente; il tastierino resta.
**Accettazione:**
- [x] Componente: soglia 150,00 €: 150,01 € → avviso e "Conferma 150,01 €"; 150,00 € → stato normale
      (criterio 2)
- [x] Componente: "Correggi" azzera; "Conferma 1.250 €" chiama una sola volta il servizio
- [x] Impeccable pulito; confronto con il wireframe "Importo insolito" (Importo-alto)
**Verifica:** `npm test -- PurchasePage`
**Dipendenze:** 13 · **File:** src/features/ledger/PurchasePage.tsx, src/features/ledger/PurchasePage.test.tsx,
src/features/ledger/PurchasePage.module.css · **Dimensione:** S

## Task 15: Spesa registrata
**Descrizione:** `LedgerDoneView` (riusata dal task 21), stato `done` sulla stessa rotta sostituendo la voce
di cronologia: spunta, titolo "Spesa registrata" con il fuoco, "+12 punti a Maria Rossi", NUOVO SALDO
(`aria-label="Nuovo saldo"`), "12,50 € · oggi 10:42 · Giulia" dal movimento del server;
`navigator.vibrate?.(200)`; "Annulla la spesa · N s" per 10 s; barra `aria-hidden`; "Torno alla lettura
delle card tra N secondi" (`role="timer"`); allo scadere `navigate('/', { replace: true })`; "Leggi
un'altra card" (→ `/` subito) e "Apri la scheda di <nome proprio>".
**Accettazione:**
- [x] Componente (timer finti): testi del wireframe Spesa-ok, punti e saldo restituiti dal server,
      vibrazione chiamata (mock), ritorno a `/` dopo 10 s (criterio 3)
- [x] Componente: Indietro dalla conferma non torna al tastierino; "Leggi un'altra card" e il link alla scheda
- [x] Impeccable pulito; confronto con Spesa-ok
**Verifica:** `npm test -- LedgerDoneView PurchasePage`
**Dipendenze:** 13 · **File:** src/features/ledger/LedgerDoneView.tsx (+ .module.css, .test.tsx),
src/features/ledger/PurchasePage.tsx · **Dimensione:** M

## Task 16: Annullare la spesa appena registrata
**Descrizione:** "Annulla la spesa · N s" chiama `cancelMovement` con un nuovo `operation_id` (un tocco,
senza dialogo); `busy` e conto alla rovescia fermo; esito "Spesa annullata", saldo dal server, nessun
ritorno automatico; `cancel-window-expired` → "Tempo scaduto: per annullare ora serve un amministratore." e
ritorno automatico da 3 s; rete → "Annullamento non riuscito: controlla la connessione e riprova." con
"Riprova" (stesso id), conto alla rovescia fermo.
**Accettazione:**
- [x] Componente: annullo riuscito → "Spesa annullata", saldo ripristinato, nessun ritorno (criterio 8)
- [x] Componente: tempo scaduto (`EC003` dal finto) → testo e ritorno dopo 3 s; rete → Riprova con lo
      stesso id e un solo annullo nel finto
- [x] Pulsante nascosto dopo 10 s
**Verifica:** `npm test -- LedgerDoneView PurchasePage`
**Dipendenze:** 15 · **File:** src/features/ledger/LedgerDoneView.tsx,
src/features/ledger/LedgerDoneView.test.tsx, src/features/ledger/PurchasePage.test.tsx · **Dimensione:** S

## Task 17: Spesa non salvata
**Descrizione:** errore di rete o risposta oltre 8 s → al posto del tastierino avviso `role="alert"` "Spesa
non salvata" / "Il telefono non è connesso a internet. L'importo resta qui: riprova appena torna la rete.
La spesa non verrà registrata due volte."; importo e anteprima visibili; "Annulla" (→ `/`, id scartato) e
"Riprova +12" (stesso id). 5xx/`unknown`: "Il server non ha risposto correttamente. Riprova: la spesa non
verrà registrata due volte.". Rifiuti definitivi: `customer-unavailable` → "Cliente non trovato";
`invalid`/`conflict` → "Spesa non registrata: dati non validi. Ricomincia." con importo azzerato;
`forbidden` → `reportNotEnabled()`.
**Accettazione:**
- [x] Componente: rete giù → avviso; Riprova con lo **stesso** id; "risposta persa" + Riprova = un solo
      movimento nel finto; doppio tocco = una chiamata (criterio 4)
- [x] Componente: timeout 8 s, errore del server, rifiuti definitivi (nuovo id dopo)
- [x] Impeccable pulito; confronto con Errore-rete
**Verifica:** `npm test -- PurchasePage`
**Dipendenze:** 13 · **File:** src/features/ledger/PurchasePage.tsx, src/features/ledger/PurchasePage.test.tsx,
src/features/ledger/LedgerFailure.tsx (+ .module.css) · **Dimensione:** M

## Checkpoint C
- [ ] Quality bar completa verde
- [ ] Screenshot 390×844 confrontati con Importo, Importo-alto, Spesa-ok, Errore-rete
- [ ] Detector Impeccable pulito su `src/features/ledger`

## Task 18: E2E della spesa
**Descrizione:** `e2e/ledger.spec.ts` (progetto `phone`): l'operatore crea nel test un cliente finto con
card finta e nome unico (`customerWithCard`), `window.__enjoyFakeCard(uid)` dalla home.
**Accettazione:**
- [x] Card → Registra spesa → 1-2-5-0 → Conferma → "Spesa registrata" +12 e saldo corretto **in meno di
      10 s** misurati dal test; dopo 10 s si torna a `/` e il cliente è in "Serviti oggi" (criterio 3)
- [x] `context.setOffline(true)` → "Spesa non salvata" → rete ripristinata → Riprova → un solo movimento
      nello storico (criterio 4)
- [x] Target ≥ 48 px; nessun errore in console; nessuna chiamata a `*.supabase.co`
**Verifica:** `npm run e2e -- ledger`
**Dipendenze:** 17 · **File:** e2e/ledger.spec.ts, e2e/nfc.ts · **Dimensione:** S

## Task 19: Riscatta premio dal catalogo
**Descrizione:** `RedeemPage` su `/clienti/:id/premi`: Indietro, titolo "Riscatta premio",
`CustomerRowLink`; CATALOGO (`fieldset`/`legend`) da `listActive()` in ordine `sortRewards()`, radio con
nome e `PointsBadge`; premi oltre il saldo visibili ma disabilitati (tratteggio) con "Mancano N punti"; riga
"Premio libero" → `?libero`; righe ≥ 64 px; "Saldo dopo il riscatto N punti" e "Riscatta N punti";
catalogo vuoto "Nessun premio nel catalogo"; errore con "Riprova" e premio libero disponibile; rifiuti
`reward-unavailable` → "Premio non più disponibile" + ricarica, `insufficient-balance` → "Saldo
insufficiente: il saldo è cambiato, controlla e riprova." + saldo ricaricato; stati comuni del task 13.
**Accettazione:**
- [x] Componente: premi raggiungibili e non, "Mancano N punti", saldo dopo, Riscatta disabilitato senza scelta
- [x] Componente: vuoto, errore, i due rifiuti che ricaricano e scartano l'id; cliente cancellato
- [x] Impeccable pulito; confronto con Premi
**Verifica:** `npm test -- RedeemPage`
**Dipendenze:** 11, 13 · **File:** src/features/ledger/RedeemPage.tsx (+ .module.css, .test.tsx),
src/app/routes.tsx · **Dimensione:** M

## Task 20: Premio libero
**Descrizione:** `FreeRewardForm` su `/clienti/:id/premi?libero`: Indietro (→ catalogo), titolo "Premio
libero", riga cliente; `TextField` "Descrizione del premio" (placeholder "Es. dolce del giorno", 1–80
caratteri dopo il trim); PUNTI DA SCALARE (`<output>` in sezione `aria-label="Punti da scalare"`) con
`AmountKeypad` senza "00", tasti 56 px, 1–99.999; oltre il saldo "Saldo insufficiente: Maria ha 120 punti
e il saldo non può scendere sotto zero." (`role="alert"`, `aria-describedby`); "Riscatta N punti"
disabilitato con saldo insufficiente, descrizione vuota o punti 0 ("Riscatta").
**Accettazione:**
- [x] Componente: saldo insufficiente con il nome proprio; pulsante disabilitato nei tre casi
- [x] Componente: invio con descrizione ripulita e punti; Indietro torna al catalogo
- [x] Impeccable pulito; confronto con Premio-libero
**Verifica:** `npm test -- FreeRewardForm RedeemPage`
**Dipendenze:** 19 · **File:** src/features/ledger/FreeRewardForm.tsx (+ .module.css, .test.tsx),
src/features/ledger/RedeemPage.tsx · **Dimensione:** M

## Task 21: Premio riscattato
**Descrizione:** `LedgerDoneView` in variante riscatto: "<premio> per Maria Rossi · −100 punti" (da
`description`), "Oggi 10:45 · Giulia", "Annulla il riscatto · N s", dopo l'annullo "Riscatto annullato";
errori di rete come nel task 17 con "Riscatto non salvato" / "Il telefono non è connesso a internet.
Riprova appena torna la rete: il riscatto non verrà registrato due volte." e "Riprova" (stesso id).
**Accettazione:**
- [x] Componente: testi del wireframe Premio-ok per catalogo e premio libero; vibrazione; ritorno a `/`
- [x] Componente: annullo del riscatto; rete → Riprova con lo stesso id, un solo riscatto nel finto
      (criterio 4)
**Verifica:** `npm test -- RedeemPage FreeRewardForm LedgerDoneView`
**Dipendenze:** 16, 20 · **File:** src/features/ledger/LedgerDoneView.tsx,
src/features/ledger/RedeemPage.tsx, src/features/ledger/RedeemPage.test.tsx,
src/features/ledger/FreeRewardForm.test.tsx · **Dimensione:** M

## Task 22: E2E dei riscatti
**Descrizione:** in `e2e/ledger.spec.ts`: cliente creato dal test con una spesa che gli dà punti; premi del
seed di `rewards` (mai modificati).
**Accettazione:**
- [ ] Riscatto "Caffè" dal catalogo → "Premio riscattato" e saldo ridotto
- [ ] Premio libero oltre il saldo → avviso e pulsante disabilitato
- [ ] Il premio inattivo del seed ("Dolce del giorno") non compare in Riscatta premio; target ≥ 48 px
**Verifica:** `npm run e2e -- ledger`
**Dipendenze:** 21 · **File:** e2e/ledger.spec.ts · **Dimensione:** S

## Checkpoint D
- [ ] Quality bar completa verde
- [ ] Screenshot 390×844 confrontati con Premi, Premio-libero, Premio-ok

## Task 23: Movimenti nella Scheda cliente
**Descrizione:** `useMovements(customerId, limit)`; `CustomerLedgerSection` montata da `ledger` in
`CustomerPage` sotto il riquadro SALDO: "Registra spesa" (primario), "Riscatta premio" (secondario), ULTIMI
MOVIMENTI (`h2`, 4 più recenti, righe non interattive con data relativa, "· annullata", punti con segno),
"Vedi tutti" → `/clienti/:id/movimenti`; vuoto "Ancora nessun movimento"; errore "Non riesco a caricare i
movimenti" con "Riprova"; cliente cancellato: niente pulsanti, movimenti visibili.
**Accettazione:**
- [ ] Componente: 4 righe nell'ordine giusto, vuota, errore, cliente cancellato
- [ ] `CustomerPage.test.tsx` di `customers` verde; ordine delle sezioni di cross-review §2
- [ ] Impeccable pulito; confronto con Cliente
**Verifica:** `npm test -- CustomerLedgerSection CustomerPage`
**Dipendenze:** 7, 9 · **File:** src/features/ledger/useMovements.ts,
src/features/ledger/CustomerLedgerSection.tsx (+ .module.css, .test.tsx), src/features/customers/CustomerPage.tsx
· **Dimensione:** M

## Task 24: Storico dei movimenti
**Descrizione:** `MovementsPage` su `/clienti/:id/movimenti`: Indietro (→ scheda), titolo "Movimenti",
riga cliente; gruppi per giorno (`h2`), più recenti in alto, 50 per volta con "Mostra altri"; righe con la
sola ora; correzione "Correzione · 18:12 · Andrea · annulla la spesa delle 18:05"; annullati barrati in
colore secondario con "· annullata"; vuoto "Ancora nessun movimento"; stati comuni.
**Accettazione:**
- [ ] Componente: gruppi OGGI/IERI/data, testi di correzione e annullati (criterio 6)
- [ ] Componente: "Mostra altri" carica i 50 successivi; vuoto; errore con Riprova
- [ ] Impeccable pulito; confronto con Movimenti
**Verifica:** `npm test -- MovementsPage`
**Dipendenze:** 23 · **File:** src/features/ledger/MovementsPage.tsx (+ .module.css, .test.tsx),
src/app/routes.tsx · **Dimensione:** M

## Task 25: Annullo dell'amministratore dallo storico
**Descrizione:** solo admin: "Annulla" (`danger-secondary`, ≥ 48 px) su spese e riscatti non annullati;
spesa con saldo − punti < 0 → testo "Punti già spesi"; correzioni mai annullabili. Al tocco la riga si
evidenzia e si apre `ConfirmDialog` (`tone="danger"`, `busy`): "Annullare la spesa di 12,50 €?" / "Oggi alle
10:42, +12 punti. Si registra una correzione di −12 punti e il saldo passa da 20 a 8. Il movimento resta
nello storico." / "Annulla la spesa" · "Lascia com'è" (testi del riscatto adattati). Dopo la conferma elenco
e saldo si ricaricano; `already-cancelled` → ricarica senza errore; `insufficient-balance` → "Punti già
spesi: questa spesa non si può più annullare." e ricarica; rete → dialogo aperto con "Annullamento non
riuscito: controlla la connessione e riprova." (stesso id). L'operatore non vede pulsanti.
**Accettazione:**
- [ ] Componente: admin vede Annulla e "Punti già spesi"; operatore nessun Annulla (criteri 7, 8)
- [ ] Componente: dialogo e testi per spesa e riscatto; correzione nell'elenco e saldo aggiornato
- [ ] Componente: `already-cancelled`, `insufficient-balance`, rete con lo stesso id
**Verifica:** `npm test -- MovementsPage`
**Dipendenze:** 24 · **File:** src/features/ledger/MovementsPage.tsx, src/features/ledger/MovementsPage.test.tsx,
src/features/ledger/CancelMovementDialog.tsx · **Dimensione:** M

## Task 26: E2E dello storico
**Descrizione:** in `e2e/ledger.spec.ts` con gli account del seed e un cliente creato dal test.
**Accettazione:**
- [ ] Admin: annulla una spesa dallo storico con il dialogo, vede la correzione e il saldo aggiornato
      (criterio 6)
- [ ] Operatore: nessun Annulla nello storico; annulla la propria spesa dalla conferma entro 10 s (criterio 8)
- [ ] Target ≥ 48 px; nessun errore in console
**Verifica:** `npm run e2e -- ledger`
**Dipendenze:** 25 · **File:** e2e/ledger.spec.ts · **Dimensione:** S

## Checkpoint E
- [ ] Quality bar completa verde
- [ ] Screenshot 390×844 confrontati con Cliente e Movimenti
- [ ] Revisione `security-and-hardening` della UI: ruoli decisi dal server, nessun dato del cliente nei log,
      `operation_id` solo in memoria

## Task 27: Guardie, procedura manuale, memoria di progetto
**Descrizione:** `scripts/ledgerBoundary.test.ts`: solo `supabaseLedgerService.ts` usa `getSupabase()`,
legge `movement_history` o chiama le RPC del ledger; nessun `console.*`, `localStorage`, `sessionStorage`
nel modulo. `scripts/displayGlyphs.test.ts` include i componenti e i titoli di `ledger`. RUNBOOK: prova
manuale alla cassa sull'anteprima (card → conferma in meno di 10 s su Android, vibrazione). Aggiornati
`brain/STATUS.md` e `CAPABILITY-MAP.md` se cambia qualcosa.
**Accettazione:**
- [ ] La guardia fallisce se un componente chiama Supabase o scrive l'`operation_id` in uno storage
- [ ] `displayGlyphs.test.ts` verde con i testi di `ledger` (criterio 9)
- [ ] Nessun segreto né dato reale nei documenti
**Verifica:** `npm test -- ledgerBoundary displayGlyphs`
**Dipendenze:** 26 · **File:** scripts/ledgerBoundary.test.ts, scripts/displayGlyphs.test.ts,
brain/topics/operations/RUNBOOK.md, brain/STATUS.md · **Dimensione:** M

## Task 28: Verifica dei criteri di successo e PR
**Descrizione:** sezione «Verifica dei criteri di successo» in `plan.md` con, per ogni criterio, i test che
lo provano (`file › titolo`); `scripts/ledgerCriteria.test.ts` come `cardsCriteria.test.ts` (10 criteri,
ogni prova esiste). `brain/MAP.md` registra il modulo. PR da `feat/ledger` su `main`, da unire dopo #18,
#19 e #20.
**Accettazione:**
- [ ] Ogni criterio 1–10 ha almeno una prova esistente
- [ ] Quality bar completa verde; `npm run build && npm run check:bundle` verde
- [ ] PR aperta con base `main`
**Verifica:** `npm test -- ledgerCriteria`; quality bar completa
**Dipendenze:** 27 · **File:** tasks/ledger/plan.md, tasks/ledger/todo.md, scripts/ledgerCriteria.test.ts,
brain/MAP.md · **Dimensione:** S

## Checkpoint F
- [ ] I 10 criteri verificati (parte manuale sul telefono con l'utente sull'anteprima HTTPS)
- [ ] Quality bar completa verde in CI
- [ ] PR pronta per `code-review-and-quality`
