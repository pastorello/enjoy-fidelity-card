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
- [ ] Task 4: `cancel_movement`: correzione di segno opposto, finestra di 10 s dell'operatore, punti già spesi
- [ ] Task 5: Saldo reale in `search_customers`, `get_customer`, `customers_served_today` e nella pagina pubblica

### Checkpoint A: `db:test` verde; revisione `security-and-hardening` su RLS, privilegi, trigger, lock, idempotenza e ruoli

### Fase 2: Logica e servizio
- [ ] Task 6: Tipi, `pointsFor`, riduttori dei tastierini, soglia strettamente sopra, importo del pulsante
- [ ] Task 7: `formatMovement`: etichette, date relative, gruppi per giorno, testo della correzione in `Europe/Rome`
- [ ] Task 8: `supabaseLedgerService`: RPC, vista, traduzione errori, timeout 8 s, guardia dei codici
- [ ] Task 9: `fakeLedgerService`, `LedgerServiceProvider`, `main.tsx` e `renderApp`
- [ ] Task 10: Integrazione contro lo stack locale: concorrenza reale, idempotenza parallela, codici reali

### Checkpoint B: quality bar completa verde; test esistenti invariati; revisione con l'utente prima della UI

### Fase 3: Registra spesa
- [ ] Task 11: `useOperation`: `operation_id` stabile, Riprova con lo stesso id, doppio tocco
- [ ] Task 12: `AmountKeypad`: tastierino POS a centesimi
- [ ] Task 13: `PurchasePage` sulla rotta del segnaposto: riga cliente, IMPORTO, anteprima, Conferma, stati comuni
- [ ] Task 14: Importo insolito (strettamente sopra la soglia): avviso, Correggi, Conferma con l'importo
- [ ] Task 15: `LedgerDoneView` per Spesa registrata: nuovo saldo, vibrazione, conto alla rovescia, ritorno a `/`
- [ ] Task 16: Annulla la spesa entro 10 s dalla conferma
- [ ] Task 17: Spesa non salvata: rete, timeout, errori del server, Riprova con lo stesso id, rifiuti definitivi

### Checkpoint C: Impeccable pulito; confronto a 390×844 con Importo, Importo-alto, Spesa-ok, Errore-rete

- [ ] Task 18: E2E della spesa: card → Spesa registrata in meno di 10 s, ritorno a `/` e Serviti oggi, rete giù → Riprova → un solo movimento

### Fase 4: Riscatti
- [ ] Task 19: Riscatta premio dal catalogo: premi raggiungibili e non, saldo dopo, rifiuti che ricaricano
- [ ] Task 20: Premio libero (`?libero`): descrizione, PUNTI DA SCALARE, saldo insufficiente
- [ ] Task 21: Premio riscattato, Annulla il riscatto, Riscatto non salvato
- [ ] Task 22: E2E dei riscatti: catalogo, premio libero insufficiente, premio inattivo assente

### Checkpoint D: Impeccable pulito; confronto a 390×844 con Premi, Premio-libero, Premio-ok

### Fase 5: Scheda e storico
- [ ] Task 23: `CustomerLedgerSection` nella Scheda cliente: pulsanti e ULTIMI MOVIMENTI
- [ ] Task 24: Movimenti (`/clienti/:id/movimenti`): gruppi per giorno, 50 per volta, correzioni e annullati
- [ ] Task 25: Annullo dell'amministratore dallo storico: «Punti già spesi», dialogo di conferma, rifiuti
- [ ] Task 26: E2E dello storico: admin annulla una spesa e vede la correzione; operatore senza Annulla

### Checkpoint E: Impeccable pulito; confronto con Cliente e Movimenti; revisione `security-and-hardening` della UI

### Fase 6: Chiusura
- [ ] Task 27: Guardia del confine, glifi di Enjoy Display, RUNBOOK, memoria di progetto
- [ ] Task 28: Verifica dei criteri di successo e PR

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
