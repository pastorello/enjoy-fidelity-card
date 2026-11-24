# Implementation Plan: ledger

Source spec: [SPEC-ledger.md](../../docs/specs/SPEC-ledger.md) (approvata il 2026-11-17; le Open Questions usano i
default adottati, da rivedere con il titolare: `docs/specs/cross-review.md` §3)

## Overview

Alla cassa l'operatore registra una spesa e riscatta premi in meno di 10 secondi dalla card alla conferma,
senza mai sbagliare un saldo. Nasce `app.movements`, lo storico intoccabile: ogni spesa salva importo in
centesimi, punti per difetto e rapporto in vigore; il saldo è la somma di tutti i movimenti, non scende mai
sotto zero (controllo sul server, sotto lock, nella stessa transazione); i movimenti non si modificano né si
cancellano, si annullano con una correzione di segno opposto; ogni scrittura porta un `operation_id`
generato dall'app e un reinvio restituisce il primo risultato. `ledger` sostituisce il segnaposto di
`/clienti/:id/spesa` creato da `cards`, aggiunge Riscatta premio (catalogo e premio libero) e Movimenti,
monta `CustomerLedgerSection` nella Scheda cliente e rende reali `customer_summary.balance` e
`customers_served_today`.

## Architecture Decisions

- **Prima il database, poi il servizio, poi la UI** (rischio più alto in testa). I rischi gravi sono tutti
  sul server: due riscatti concorrenti che spendono gli stessi punti, un reinvio che registra due volte, un
  movimento modificato o cancellato, un operatore che annulla un movimento altrui o fuori tempo, una spesa
  annullata dopo che i suoi punti sono stati spesi, punti calcolati col rapporto sbagliato. Si fissa tutto
  con pgTAP nei task 1–5 e con il test di concorrenza reale nel task 10, prima di ogni riga di UI, e con la
  revisione `security-and-hardening` al Checkpoint A.
- **Una sola migrazione `*_ledger.sql`**, creata con `npx supabase migration new ledger` (dopo quelle di
  `cards`) e completata nei task 1–5 (non pubblicata: si modifica in place e si applica con
  `npm run db:reset`). Tutte le RPC di scrittura seguono lo stesso schema fissato dalla spec: (1)
  `private.acting_operator_id()` → null `42501`; (2) `select … for update` sulla riga del cliente
  (assente o anonimizzato → `EC006`, eccetto `cancel_movement`); (3) **dopo il lock** ricerca
  dell'`operation_id` (stessi parametri → replay con il saldo attuale; diversi → `EC007`); (4) validazione,
  calcolo, `private.customer_balance` e insert; `unique_violation` su `operation_id` → `EC007`. Il lock sul
  cliente serializza spese, riscatti e annulli dello stesso cliente: è ciò che rende impossibile spendere due
  volte gli stessi punti. `security definer`, `search_path = ''`, `execute` revocato a `public`/`anon` e
  concesso ad `authenticated` (resta verde `function_privileges.test.sql`).
- **Un solo calcolo del saldo**: `private.customer_balance(uuid) returns int` =
  `coalesce(sum(points), 0)` su `app.movements`. Lo usano le RPC, i corpi riscritti (`create or replace`,
  stesse firme) di `search_customers`, `get_customer`, `customers_served_today` e, già oggi via
  `to_regprocedure`, `public.card_points` di `cards` (il pgTAP di `ledger` prova che la pagina pubblica mostra
  il saldo reale).
- **Storico intoccabile anche per errore**: `revoke insert, update, delete, truncate` ad `authenticated` e
  `anon`; trigger `before update or delete` per riga e `before truncate` che alzano sempre un errore, anche
  per `postgres`. Lettura per gli operatori attivi tramite policy `select` e la vista
  `app.movement_history` (`security_invoker = true`).
- **Errori come fissati dalla spec**: SQLSTATE personalizzati `EC001`…`EC007`, più `42501` e `22023`
  (Open Question 15). Il servizio li traduce in `LedgerError` (`insufficient-balance`, `already-cancelled`,
  `cancel-window-expired`, `not-cancellable`, `reward-unavailable`, `customer-unavailable`, `conflict`,
  `forbidden`, `invalid`, `network`, `unknown`); i guasti del server passano da `serverFaultFor` di
  `src/lib/serverFault.ts`; una risposta oltre 8 s vale `network`. Guardia
  `scripts/ledgerErrorCodes.test.ts`: ogni `errcode` sollevato dalla migrazione ha una traduzione.
- **Un solo punto di accesso a Supabase.** Solo `supabaseLedgerService.ts` legge `app.movement_history` e
  chiama le RPC (guardia `scripts/ledgerBoundary.test.ts`, come `cardsBoundary.test.ts`). Servizio iniettato
  come gli altri moduli: `LedgerServiceProvider` / `useLedgerService()` in `main.tsx` e in `renderApp`
  (nuovo parametro facoltativo in coda: i test esistenti restano invariati). `src/test/fakeLedgerService.ts`
  replica le regole del server (per difetto, saldo ≥ 0, idempotenza, finestra di 10 s, punti già spesi),
  aggiorna il saldo del finto di `customers` e simula rete giù, timeout e "arrivato ma risposta persa".
- **`operation_id` solo in memoria** (Open Question 8): `useOperation` lo crea al primo tocco con
  `crypto.randomUUID()`, lo riusa in "Riprova", lo consuma a esito definitivo; doppio tocco = una chiamata.
  Nessun reinvio automatico.
- **Logica pura fuori dai componenti**: `points.ts` (`pointsFor`, riduttori del tastierino a centesimi e dei
  punti del premio libero, soglia strettamente sopra, importo del pulsante) e `formatMovement.ts` (etichette,
  date relative, gruppi per giorno, testo della correzione) sempre con `timeZone: 'Europe/Rome'` esplicito.
- **Le schermate degli altri moduli si estendono, non si copiano.** Riga cliente con `CustomerRowLink` di
  `cards`; riquadro SALDO, home e "Serviti oggi" restano di `customers` (`ledger` dà i dati); `ledger` monta
  `CustomerLedgerSection` in `CustomerPage` (cross-review §2). `PurchasePlaceholderPage` si elimina quando
  `PurchasePage` prende la rotta; i test di `cards` che arrivano su Registra spesa restano verdi.
- **Enjoy Display**: titoli e pulsanti senza `… « » @ # * × →` (`scripts/displayGlyphs.test.ts` esteso ai
  componenti di `ledger`). Il segno meno dei punti è `−` (U+2212): da verificare nel test dei glifi e nel
  browser (vedi Risks).
- **E2E nel progetto `phone`** (parallelo): clienti e uid creati dal test con nome unico per esecuzione
  (`customerWithCard`, `uniqueName`, `freshUid` di `e2e/nfc.ts`); premi del seed di `rewards` mai modificati
  (il premio inattivo del seed basta per "premio disattivato assente"); nessun E2E cambia `app.settings`:
  il caso "rapporto 250" è provato da pgTAP e dai test di componente (se servisse un E2E, va nel progetto
  `phone-settings` e ripristina i valori).
- **Revisione di sicurezza obbligatoria** (`security-and-hardening`) ai Checkpoint A (RLS, privilegi,
  trigger, lock, idempotenza, ruoli nell'annullo) ed E (dati dei clienti nella UI e nei log).
- **Pubblicazione esclusa da questo piano**: migrazioni remote, anteprima e produzione le gestisce
  l'orchestratore; le verifiche manuali sul telefono (vibrazione, tempo reale alla cassa) si fanno con
  l'utente sull'anteprima HTTPS. La PR va su `main` e si unisce dopo #18 (`feat/rewards`), #19
  (`feat/card-input`) e #20 (`feat/cards`).

## Dependency Graph

```
migrazione ledger (task 1-5: movements, trigger, vista, saldo, RPC, letture di customers)
    │
    ├── logica pura (task 6-7: punti, tastierino, soglia, date e testi dei movimenti)
    │
    ├── servizio + traduzione errori (task 8) ── finto + provider (task 9) ── concorrenza reale (task 10)
    │       │
    │       ├── useOperation (task 11) + AmountKeypad (task 12)
    │       │       └── Registra spesa (task 13-17) ── E2E spesa (task 18)
    │       │               └── LedgerDoneView riusata da Premio riscattato
    │       ├── Riscatta premio, premio libero, Premio riscattato (task 19-21) ── E2E (task 22)
    │       └── CustomerLedgerSection, Movimenti, annullo admin (task 23-25) ── E2E (task 26)
    │
    └── guardie, RUNBOOK, criteri, PR (task 27-28)
```

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Database (rischio più alto)
- [x] Task 1: `app.movements`, vincoli per tipo, indici, RLS, trigger che bloccano update/delete/truncate, `customer_balance`, vista `movement_history`, `ledger_result`
- [x] Task 2: `record_purchase`: lock, idempotenza, punti per difetto col rapporto in vigore salvato
- [x] Task 3: `redeem_reward` e `redeem_free_reward`: premio sul server, saldo mai sotto zero
- [x] Task 4: `cancel_movement`: correzione di segno opposto, finestra di 10 s dell'operatore, punti già spesi
- [x] Task 5: Saldo reale in `search_customers`, `get_customer`, `customers_served_today` e nella pagina pubblica

### Checkpoint A: `db:test` verde; revisione `security-and-hardening` su RLS, privilegi, trigger, lock, idempotenza e ruoli

### Fase 2: Logica e servizio
- [x] Task 6: Tipi, `pointsFor`, riduttori dei tastierini, soglia strettamente sopra, importo del pulsante
- [x] Task 7: `formatMovement`: etichette, date relative, gruppi per giorno, testo della correzione in `Europe/Rome`
- [x] Task 8: `supabaseLedgerService`: RPC, vista, traduzione errori, timeout 8 s, guardia dei codici
- [x] Task 9: `fakeLedgerService`, `LedgerServiceProvider`, `main.tsx` e `renderApp`
- [x] Task 10: Integrazione contro lo stack locale: concorrenza reale, idempotenza parallela, codici reali

### Checkpoint B: quality bar completa verde; test esistenti invariati; revisione con l'utente prima della UI

### Fase 3: Registra spesa
- [x] Task 11: `useOperation`: `operation_id` stabile, Riprova con lo stesso id, doppio tocco
- [x] Task 12: `AmountKeypad`: tastierino POS a centesimi
- [x] Task 13: `PurchasePage` sulla rotta del segnaposto: riga cliente, IMPORTO, anteprima, Conferma, stati comuni
- [x] Task 14: Importo insolito (strettamente sopra la soglia): avviso, Correggi, Conferma con l'importo
- [x] Task 15: `LedgerDoneView` per Spesa registrata: nuovo saldo, vibrazione, conto alla rovescia, ritorno a `/`
- [x] Task 16: Annulla la spesa entro 10 s dalla conferma
- [x] Task 17: Spesa non salvata: rete, timeout, errori del server, Riprova con lo stesso id, rifiuti definitivi

### Checkpoint C: Impeccable pulito; confronto a 390×844 con Importo, Importo-alto, Spesa-ok, Errore-rete

- [x] Task 18: E2E della spesa: card → Spesa registrata in meno di 10 s, ritorno a `/` e Serviti oggi, rete giù → Riprova → un solo movimento

### Fase 4: Riscatti
- [x] Task 19: Riscatta premio dal catalogo: premi raggiungibili e non, saldo dopo, rifiuti che ricaricano
- [x] Task 20: Premio libero (`?libero`): descrizione, PUNTI DA SCALARE, saldo insufficiente
- [x] Task 21: Premio riscattato, Annulla il riscatto, Riscatto non salvato
- [x] Task 22: E2E dei riscatti: catalogo, premio libero insufficiente, premio inattivo assente

### Checkpoint D: Impeccable pulito; confronto a 390×844 con Premi, Premio-libero, Premio-ok

### Fase 5: Scheda e storico
- [x] Task 23: `CustomerLedgerSection` nella Scheda cliente: pulsanti e ULTIMI MOVIMENTI
- [x] Task 24: Movimenti (`/clienti/:id/movimenti`): gruppi per giorno, 50 per volta, correzioni e annullati
- [x] Task 25: Annullo dell'amministratore dallo storico: «Punti già spesi», dialogo di conferma, rifiuti
- [x] Task 26: E2E dello storico: admin annulla una spesa e vede la correzione; operatore senza Annulla

### Checkpoint E: Impeccable pulito; confronto con Cliente e Movimenti; revisione `security-and-hardening` della UI

### Fase 6: Chiusura
- [x] Task 27: Guardia del confine, glifi di Enjoy Display, RUNBOOK, memoria di progetto
- [x] Task 28: Verifica dei criteri di successo e PR

### Checkpoint F: i 10 criteri verificati; quality bar completa verde; PR su `main` pronta per `code-review-and-quality`, da unire dopo #18, #19 e #20

## Copertura dei criteri di successo

| Criterio (docs/specs/SPEC-ledger.md) | Task |
|---|---|
| 1. 1-2-5-0 mostra "12,50 €" e "+12"; con rapporto 250 la stessa spesa vale 5 punti e il movimento salva 250 | 2, 6, 12, 13 |
| 2. Soglia 150,00 €: 150,01 € mostra "Importo insolito" e "Conferma 150,01 €"; 150,00 € no | 6, 14 |
| 3. E2E: dalla card finta a "Spesa registrata" in meno di 10 s; dopo 10 s si torna a `/` | 15, 18 |
| 4. Reinvio dopo errore di rete o doppio tocco: un solo movimento (pgTAP, componenti, E2E) | 2, 3, 4, 9, 11, 17, 18, 21 |
| 5. Il test di concorrenza non registra mai un saldo negativo né due riscatti oltre il saldo | 3, 4, 10 |
| 6. Nessun ruolo scrive direttamente un movimento; update/delete falliscono anche come `postgres`; l'annullo crea una correzione visibile e il saldo resta la somma di tutti i movimenti | 1, 4, 24, 26 |
| 7. Spesa con punti già spesi: "Punti già spesi" al posto di Annulla, `EC001` dal server | 4, 25 |
| 8. Operatore: annulla solo il proprio movimento entro 10 s; nessun Annulla nello storico; `EC003` oltre | 4, 16, 25, 26 |
| 9. Ogni testo, stato e pulsante dei wireframe ha un test di componente; E2E a 390×844; Impeccable pulito; target ≥ 48 px | 12–17, 19–21, 23–25, 18, 22, 26, 27 |
| 10. typecheck, lint, test, `db:test`, `test:integration`, `e2e` verdi | ogni task; 28 |

## Verifica dei criteri di successo

Verifica finale del task 28 (2026-11-18), con la quality bar completa verde in locale. Ogni prova è scritta
come `file › titolo del test` (per pgTAP la descrizione dell'asserzione, per i titoli con `${ROUNDS}` o
`it.each` il titolo come è scritto nel file); `scripts/ledgerCriteria.test.ts` controlla che ogni criterio ne
abbia almeno una, che ognuna esista davvero nel file indicato e che le parti manuali rimandino al RUNBOOK.

| Criterio (docs/specs/SPEC-ledger.md) | Test che lo prova |
|---|---|
| 1. 1-2-5-0 mostra "12,50 €" e "+12"; con rapporto 250 la stessa spesa vale 5 punti e il movimento salva 250 | `src/features/ledger/points.test.ts › enters cents from the right as on a POS: 1-2-5-0 = 12,50 €`, `src/features/ledger/points.test.ts › rounds down with the ratio in force`, `src/features/ledger/AmountKeypad.test.tsx › enters cents as on a POS: 1-2-5-0 gives 1250 (criterion 1)`, `src/features/ledger/PurchasePage.test.tsx › 1-2-5-0 shows "12,50 €", "+12" and the new balance (criterion 1)`, `src/features/ledger/PurchasePage.test.tsx › with a ratio of 250 the same purchase is worth 5 points (criterion 1)`, `supabase/tests/ledger.test.sql › 12,50 € at 100 cents per point is a purchase of 12 points by the acting operator, balance 12`, `supabase/tests/ledger.test.sql › with 250 cents per point 12,50 € is 5 points and the movement saves 250 (criterion 1)`, `supabase/tests/ledger.test.sql › changing the settings later does not alter the history`, `tests/integration/ledger.test.ts › a purchase rounds down and saves the ratio in force; the balance is the sum` |
| 2. Soglia 150,00 €: 150,01 € mostra "Importo insolito" e "Conferma 150,01 €"; 150,00 € no | `src/features/ledger/points.test.ts › is strictly above the threshold`, `src/features/ledger/PurchasePage.test.tsx › threshold 150,00 €: 150,01 € shows the warning and "Conferma 150,01 €"; 150,00 € does not (criterion 2)`, `src/features/ledger/PurchasePage.test.tsx › the threshold in force, and points grouped: 1.250 € → "+1.250 punti", "Conferma 1.250 €"` |
| 3. E2E: dalla card finta a "Spesa registrata" in meno di 10 s; dopo 10 s si torna a `/` (parte manuale: RUNBOOK, «Prova manuale alla cassa») | `e2e/ledger.spec.ts › from the card to «Spesa registrata» in less than 10 s; after 10 s back to the home, with the customer on top of CLIENTI (criterion 3)`, `src/features/ledger/LedgerDoneView.test.tsx › counts down every second and goes back to / after 10 s, replacing the entry (criterion 3)`, `src/features/ledger/PurchasePage.test.tsx › the texts of the wireframe with the server’s points and balance, the vibration, back to / after 10 s (criterion 3)`, `supabase/tests/ledger_reads.test.sql › get_customer: a cancelled purchase is served today at the purchase, not at the correction` |
| 4. Reinvio dopo errore di rete o doppio tocco: un solo movimento (pgTAP, componenti, E2E) | `supabase/tests/ledger.test.sql › a resent purchase returns the movement of the first one`, `supabase/tests/ledger.test.sql › resending records nothing new`, `supabase/tests/ledger.test.sql › a resent redemption returns the first movement, not the reward as it is now`, `supabase/tests/ledger.test.sql › a resent cancellation returns the first correction`, `supabase/tests/ledger.test.sql › the same operation_id with another amount is a conflict`, `tests/integration/ledger-concurrency.test.ts › both queued behind the customer lock: the second is a replay of the first`, `tests/integration/ledger-concurrency.test.ts › ${ROUNDS} rounds: one movement, both answers carry it`, `src/features/ledger/useOperation.test.tsx › a double submit in the same tick makes one call, busy until the answer`, `src/features/ledger/useOperation.test.tsx › retry after a network error sends the same operation id, once`, `src/features/ledger/PurchasePage.test.tsx › "Conferma" records the purchase once, even on a double tap`, `src/features/ledger/PurchasePage.test.tsx › answer lost after the write: "Riprova" resends the same id, a single movement (criterion 4)`, `src/features/ledger/RedeemPage.test.tsx › answer lost after the write: "Riprova" gives the first result, a single redemption (criterion 4)`, `src/features/ledger/FreeRewardForm.test.tsx › answer lost after the write: "Riprova" gives the first result, a single redemption (criterion 4)`, `e2e/ledger.spec.ts › offline: «Spesa non salvata»; back online, Riprova registers one movement (criterion 4)`, `e2e/ledger.spec.ts › the answer is lost after the server registered the purchase: Riprova returns it, one movement (criterion 4)` |
| 5. Il test di concorrenza non registra mai un saldo negativo né due riscatti oltre il saldo | `tests/integration/ledger-concurrency.test.ts › ${ROUNDS} rounds: always one wins, the balance stays >= 0`, `tests/integration/ledger-concurrency.test.ts › both queued behind the customer lock: exactly one goes through`, `tests/integration/ledger-concurrency.test.ts › admin and operator at once, ${ROUNDS} rounds: always one wins, the balance stays >= 0`, `tests/integration/ledger-concurrency.test.ts › both queued behind the customer lock: the second sees the first and is refused`, `supabase/tests/ledger.test.sql › a redemption beyond the balance is rejected, with the current points of the reward`, `supabase/tests/ledger.test.sql › a free redemption equal to the balance is accepted and leaves 0, its description trimmed`, `tests/integration/ledger.test.ts › EC001 insufficient-balance: a redemption above the balance`, `e2e/ledger.spec.ts › Premio libero above the balance: «Saldo insufficiente» and Riscatta disabled (criterion 5)` |
| 6. Nessun ruolo scrive direttamente un movimento; update/delete falliscono anche come `postgres`; l'annullo crea una correzione visibile e il saldo resta la somma di tutti i movimenti | `supabase/tests/ledger.test.sql › authenticated has no insert, update, delete or truncate on app.movements`, `supabase/tests/ledger.test.sql › anon has no privilege on app.movements`, `supabase/tests/ledger.test.sql › an operator cannot insert a movement directly`, `supabase/tests/ledger.test.sql › an operator cannot update movements directly`, `supabase/tests/ledger.test.sql › an operator cannot delete movements directly`, `supabase/tests/ledger.test.sql › postgres cannot update a movement`, `supabase/tests/ledger.test.sql › postgres cannot delete a movement`, `supabase/tests/ledger.test.sql › postgres cannot truncate app.movements`, `supabase/tests/ledger.test.sql › a cancellation leaves the cancelled movement as it was`, `supabase/tests/ledger.test.sql › the history shows who cancelled the purchase and when (criterion 6)`, `supabase/tests/ledger.test.sql › the balance is the sum of every movement, cancelled ones and corrections included (criterion 6)`, `tests/integration/ledger.test.ts › a cancel inserts a correction and the history shows who cancelled the movement`, `src/features/ledger/MovementsPage.test.tsx › a purchase confirmed: the correction shows in the list and the balance is updated (criterion 6)`, `e2e/ledger.spec.ts › an administrator cancels a purchase from the history: the correction and the balance (criterion 6)` |
| 7. Spesa con punti già spesi: "Punti già spesi" al posto di Annulla, `EC001` dal server | `supabase/tests/ledger.test.sql › a purchase whose points are already spent cannot be cancelled`, `tests/integration/ledger.test.ts › EC001 insufficient-balance: cancelling a purchase whose points are spent`, `src/features/ledger/MovementsPage.test.tsx › admin: "Annulla" on purchases and redemptions not cancelled, "Punti già spesi" when spent (criterion 7)`, `src/features/ledger/MovementsPage.test.tsx › insufficient-balance: "Punti già spesi" and the list reloads`, `src/features/ledger/LedgerDoneView.test.tsx › points already spent: its own text and back to / after 3 s` |
| 8. Operatore: annulla solo il proprio movimento entro 10 s; nessun Annulla nello storico; `EC003` oltre (parte manuale: RUNBOOK, «Prova manuale alla cassa») | `supabase/tests/ledger.test.sql › the operator cancels their own purchase of 5 s ago: a correction of -5 points, balance 13`, `supabase/tests/ledger.test.sql › the operator cannot cancel their own purchase of 11 s ago`, `supabase/tests/ledger.test.sql › the operator cannot cancel a movement of another operator, even a recent one`, `tests/integration/ledger.test.ts › the operator cancels their own movement just registered`, `tests/integration/ledger.test.ts › EC003 cancel-window-expired: the operator cancelling someone else's movement`, `src/features/ledger/LedgerDoneView.test.tsx › done: "Spesa annullata" focused, the server’s balance, no return (criterion 8)`, `src/features/ledger/LedgerDoneView.test.tsx › time out (cancel-window-expired): the text, no button, back to / after 3 s`, `src/features/ledger/LedgerDoneView.test.tsx › the button is gone after 10 s`, `src/features/ledger/MovementsPage.test.tsx › operator: no "Annulla" and no "Punti già spesi" in the history (criterion 8)`, `e2e/ledger.spec.ts › an operator cancels their own purchase from «Spesa registrata» within 10 s, and has no Annulla in the history (criterion 8)`, `e2e/ledger.spec.ts › an operator sees no Annulla on a purchase still standing in the history (criterion 8)` |
| 9. Ogni testo, stato e pulsante dei wireframe ha un test di componente; E2E a 390×844; Impeccable pulito; target ≥ 48 px | `src/features/ledger/PurchasePage.test.tsx › header "Registra spesa", the customer row to the page, IMPORTO at 0,00 € and the keypad`, `src/features/ledger/PurchasePage.test.tsx › network down: the alert of the wireframe instead of the keypad, amount and preview still there (criterion 4)`, `src/features/ledger/LedgerDoneView.test.tsx › the texts of the wireframe, with no header, and the focus on the title`, `src/features/ledger/RedeemPage.test.tsx › header, the customer row, CATALOGO with the active rewards in order and "Premio libero"`, `src/features/ledger/RedeemPage.test.tsx › the texts of the wireframe Premio-ok, the vibration, back to / after 10 s`, `src/features/ledger/FreeRewardForm.test.tsx › header, customer row, description, PUNTI DA SCALARE and a keypad without "00"`, `src/features/ledger/CustomerLedgerSection.test.tsx › lists the 4 newest movements, newest first, with relative date, operator, signed points`, `src/features/ledger/MovementsPage.test.tsx › groups by day (OGGI, IERI, 8 NOVEMBRE), newest first, rows with the time only (criterion 6)`, `src/features/ledger/AmountKeypad.test.tsx › lays out 1-9, "00", 0 and backspace in the wireframe order, with accessible names`, `scripts/amountKeypadCss.test.ts › never lets a key get narrower than the touch target`, `scripts/displayGlyphs.test.ts › catches a missing glyph in the ledger screens`, `e2e/ledger.spec.ts › Caffè from the catalog: «Premio riscattato» and the balance down by 50; the inactive reward of the seed is not there (criterion 5)` |
| 10. typecheck, lint, test, `db:test`, `test:integration`, `e2e` verdi | `scripts/ledgerBoundary.test.ts › lets only supabaseLedgerService.ts read the movements or call the ledger RPCs`, `scripts/ledgerBoundary.test.ts › fails when the operation_id is written to a storage or logged`, `scripts/ledgerErrorCodes.test.ts › translates exactly the SQLSTATEs the ledger migration raises`, `supabase/tests/function_privileges.test.sql › anon cannot execute any function in app or private`, `tests/integration/ledger.test.ts › a missing grant (anon has no execute) is a server fault, not a refusal`, `e2e/ledger.spec.ts › from the card to «Spesa registrata» in less than 10 s; after 10 s back to the home, with the customer on top of CLIENTI (criterion 3)` |

Note sul criterio 3: l'E2E misura il tempo reale con la card finta (`window.__enjoyFakeCard`) a 390×844; la
lettura con il telefono vero, la vibrazione e il tempo peggiore su Android sono nella sezione «Prova manuale
alla cassa» del RUNBOOK (`brain/topics/operations/RUNBOOK.md`), da fare con l'utente sull'anteprima HTTPS
della PR (Checkpoint F). Note sul criterio 8: con una rete lenta l'ultimo secondo del conto alla rovescia può
già essere fuori tempo per il server (Open Question 1 della spec, default adottato): risponde `EC003` e l'app
lo spiega; la prova sul telefono è nella stessa sezione del RUNBOOK. Note sul criterio 9: il detector
Impeccable non è un test; `npx impeccable detect src/features/ledger src/shared/ui src/app` (scansione dei sorgenti) non segnala nulla;
il confronto con i wireframe a 390×844 è stato fatto ai Checkpoint C, D ed E. Note sul criterio 10: i comandi
sono stati eseguiti tutti, compresi `npm run format:check`, `npm run build` e `npm run check:bundle`.

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Due riscatti (o riscatto e annullo di una spesa) concorrenti spendono gli stessi punti | Alto | `select … for update` sul cliente prima di leggere il saldo in ogni RPC; test di integrazione con chiamate davvero parallele da due account, 20 ripetizioni |
| Reinvio con lo stesso `operation_id` che registra due volte o risponde errore | Alto | Ricerca dell'id **dopo** il lock; `unique` su `operation_id`; test di due chiamate parallele con lo stesso id; `useOperation` riusa l'id in Riprova |
| Movimento modificato o cancellato (API, SQL Editor) | Alto | `revoke` e trigger per riga e per `truncate`; pgTAP anche come `postgres` |
| Operatore che annulla movimenti altrui o fuori tempo chiamando l'API | Alto | Controllo sul server con `clock_timestamp()` e `operator_id = acting_operator_id()`; pgTAP con `created_at` di 5 e 11 s fa |
| Spesa annullata dopo che i punti sono stati spesi (saldo negativo) | Alto | `EC001` in `cancel_movement` sotto lock; "Punti già spesi" nello storico calcolato dal saldo attuale |
| Rapporto cambiato tra anteprima e conferma | Medio | Il server legge `cents_per_point` nella stessa transazione e lo salva; la conferma mostra i punti restituiti dal server |
| Date e "Serviti oggi" sbagliati a mezzanotte o al cambio d'ora | Medio | `Europe/Rome` esplicito nel client e nel server; pgTAP alle 23:59/00:01 di Roma; unit test sul cambio d'ora |
| Test di integrazione influenzati dal rapporto cambiato da `settings.test.ts` | Medio | Il test legge il rapporto in vigore e calcola l'importo; `fileParallelism: false` già attivo |
| Timer finti e `role="timer"` che rendono instabili i test di componente | Medio | Timer finti di Vitest; un solo `setInterval` nella vista, fermato dall'annullo; E2E misura il tempo reale |
| Corpi di `search_customers`/`get_customer` riscritti che cambiano altro comportamento | Medio | `create or replace` con le stesse firme e lo stesso controllo `not_operator`; `customers.test.sql` e test di integrazione di `customers` invariati e verdi |
| Glifi mancanti in Enjoy Display (segno meno `−`, "Conferma 1.250 €") | Basso | `displayGlyphs.test.ts`; verifica nel browser del `−`; se manca, numeri con il segno fuori dal testo in Enjoy Display (da chiedere se cambia un testo della spec) |
| Template email dopo `supabase start` | Basso | `scripts/reload-auth-templates.sh` dopo l'avvio dello stack (RUNBOOK) |

## Open Questions

Nessuna bloccante: le Open Questions 1–15 della spec usano i default adottati, da rivedere con il titolare
(`docs/specs/cross-review.md` §3). Da segnalare all'utente durante l'implementazione, senza fermare il lavoro:

- se il segno meno tipografico `−` non è disegnato da Enjoy Display (Risks);
- l'ultimo secondo della finestra di 10 s con una rete lenta può già essere fuori tempo (Open Question 1):
  il server risponde `EC003` e l'app lo spiega.
