# Spec: ledger — V1

Status: approvata (2026-11-17) su delega dell'utente — le Open Questions adottano i default proposti, da rivedere con il titolare (`docs/specs/cross-review.md` §3)
Modulo: `ledger` ([CAPABILITY-MAP.md](../../CAPABILITY-MAP.md)) · Dipende da: `customers`, `settings`, `rewards`
(e `cards`/`card-input` per l'arrivo dalla card: `ledger` sostituisce il segnaposto di `/clienti/:id/spesa`
creato da `cards`) · Usato da: `export`, `tablet-kiosk` ·
Fonti: specifiche ("Ruoli e account", "Flussi alla cassa", "Calcolo dei punti", "Premi", "Modello dati",
"Sicurezza e privacy"), wireframe "Registra spesa", "Importo insolito", "Spesa registrata", "Spesa non
salvata", "Scheda cliente", "Riscatta premio", "Premio libero: saldo insufficiente", "Premio riscattato",
"Movimenti: conferma di annullamento", "Cerca cliente" (Serviti oggi), note n1, n2, n3, n6 del canvas ·
Decisioni: `brain/DECISIONS.md` (centesimi ovunque, idempotenza, niente offline) · Interfacce fissate da
altre spec: `SPEC-customers.md` (`customer_summary`, `customers_served_today`, `reportNotEnabled()`),
`SPEC-settings.md` (`useSettings()`, soglia strettamente sopra), `SPEC-rewards.md` (`listActive()`,
regole di `redeem_reward`), `SPEC-tablet-kiosk.md` (estende `acting_operator_id()` e `is_admin()`).

## Objective

Alla cassa l'operatore registra una spesa in punti e riscatta premi **in meno di 10 secondi dalla card alla
conferma**, senza mai sbagliare un saldo: punti per difetto col rapporto in vigore, saldo mai sotto zero
(controllo sul server, nella stessa transazione), nessuna doppia registrazione, storico intoccabile.

**Utenti**:
- **Operatore**: registra spese, riscatta premi (catalogo o libero), annulla entro 10 s la propria spesa o il
  proprio riscatto appena registrati, consulta saldo e movimenti.
- **Amministratore**: tutto ciò che fa l'operatore, più l'annullamento di qualsiasi spesa o riscatto dallo
  storico, con conferma (correzione di segno opposto). Le specifiche dicono "correzione e annullamento
  movimenti": in questa V1 la sola correzione è quella che annulla un movimento (Open Question 12).

**Successo**: card letta → 4 tocchi sul tastierino → Conferma → "Spesa registrata" con il nuovo saldo; dopo
un errore di rete "Riprova" registra la spesa **una sola volta**; due operatori che riscattano insieme
non spendono due volte gli stessi punti.

## Cosa include

Ogni schermata del modulo legge nome e saldo del cliente con `CustomerService.get()` di `customers`
(`customer_summary.balance`, che `ledger` rende reale) e mostra in alto la **riga cliente** del wireframe:
nome, `PointsBadge` del saldo e freccia, tutta la riga è un link alla scheda `/clienti/:id`.

1. **Registra spesa** (`/clienti/:id/spesa`, wireframe "Registra spesa"; sostituisce il segnaposto di
   `cards` sulla stessa rotta): `AppShell` con Indietro (`navigate(-1)`, alla home se non c'è cronologia) e
   titolo "Registra spesa"; riga cliente; display **IMPORTO** (`<output>` dentro una sezione
   `aria-label="Importo"`, `aria-live="polite"`); riquadro "Punti da aggiungere **+12**" e riga "1 punto
   ogni 1,00 €, per difetto · nuovo saldo 132 punti" (rapporto in vigore formattato con `formatCents`);
   tastierino interno (`role="group"`, `aria-label="Tastierino numerico"`): 1–9, "00"
   (`aria-label="Doppio zero"`), 0, cancella (`aria-label="Cancella ultima cifra"`), tasti alti 64 px come
   nel wireframe, nessuna tastiera di sistema. Pulsanti in basso: "Riscatta premio" (secondario →
   `/clienti/:id/premi`) e "Conferma +N" (primario).
   - Inserimento a centesimi come sui POS: ogni cifra entra a destra (1-2-5-0 = 12,50 €); "00" aggiunge due
     zeri; cancella toglie l'ultima cifra; zeri iniziali ignorati (0 poi 5 = 0,05 €). Massimo 9.999.999
     centesimi (99.999,99 €, Open Question 5): le cifre oltre vengono ignorate. Con importo 0 "Conferma" è
     disabilitato.
   - Anteprima: `points = Math.floor(amountCents / centsPerPoint)` da `useSettings()`; il valore registrato
     è quello calcolato dal server (vince se il rapporto è cambiato nel frattempo, e la schermata di
     conferma mostra i punti restituiti dal server).
   - `useSettings()` in caricamento o in errore: tastierino visibile, anteprima e "Conferma" sostituiti da
     `StatusView` (errore con "Riprova"); non si conferma senza rapporto e soglia.
2. **Importo insolito** (wireframe "Importo insolito"): appena l'importo è **strettamente sopra**
   `confirmThresholdCents` (regola fissata in `SPEC-settings.md`), il riquadro punti diventa un avviso
   (`role="alert"` come nel wireframe, toni di warning del design system): "Importo insolito: +1.250 punti"
   (punti raggruppati come in `formatPoints`; il wireframe scrive "1250") / "Sopra 150,00 € l'app chiede
   conferma. Controlla di non aver digitato una cifra in più." (la soglia in vigore,
   `formatCents(confirmThresholdCents)`); i pulsanti diventano "Correggi" (secondario: azzera l'importo,
   Open Question 3) e "Conferma 1.250 €" (primario, con l'importo in euro; ",00" omesso quando i centesimi
   sono zero, come nel wireframe: "Conferma 150,01 €" altrimenti). "Riscatta premio" in questo stato non
   c'è (wireframe). Il tastierino resta. Un tocco su "Conferma 1.250 €" registra subito: nessun secondo
   dialogo.
3. **Spesa registrata** (wireframe "Spesa registrata", stessa rotta, stato `done`; nessuna intestazione,
   come nel wireframe): icona di spunta, titolo "Spesa registrata", "+12 punti a Maria Rossi", riquadro
   **NUOVO SALDO** (`aria-label="Nuovo saldo"`) con il numero e "punti", "12,50 € · oggi 10:42 · Giulia"
   (dati del movimento restituito dal server). Il fuoco va sul titolo. Vibrazione
   `navigator.vibrate?.(200)` se disponibile (nota n1). Pulsante "Annulla la spesa · N s" (secondario, con
   icona) per 10 s; in basso barra di avanzamento (decorativa, `aria-hidden`) e testo "Torno alla lettura
   delle card tra N secondi" (`role="timer"`, che non viene letto a ogni secondo); allo scadere
   `navigate('/', { replace: true })`. Pulsanti "Leggi un'altra card" (primario → `/` subito, `replace`) e
   link "Apri la scheda di <nome proprio>" (→ `/clienti/:id`; nome proprio = prima parola del nome). Il
   tasto Indietro di Android dalla conferma non torna al tastierino (lo stato `done` sostituisce la voce
   nella cronologia).
   - **Annulla** (un tocco, senza dialogo: movimento proprio e appena fatto; Open Question 2) chiama
     `cancel_movement` con un nuovo `operation_id`; durante l'invio il pulsante è `busy` e il conto alla
     rovescia si ferma; esito: titolo "Spesa annullata", saldo ripristinato (dal server), restano i due
     pulsanti, nessun ritorno automatico. Rifiuto `cancel-window-expired`: "Tempo scaduto: per annullare
     ora serve un amministratore." e il ritorno automatico riparte da 3 s. Errore di rete durante
     l'annullo: "Annullamento non riuscito: controlla la connessione e riprova." con "Riprova" (stesso
     `operation_id`); il conto alla rovescia resta fermo.
4. **Spesa non salvata** (wireframe "Spesa non salvata"): errore di rete o risposta che non arriva entro
   8 s (Open Question 13) → il tastierino lascia posto a un avviso `role="alert"` con titolo "Spesa non
   salvata" / "Il telefono non è connesso a internet. L'importo resta qui: riprova appena torna la rete. La
   spesa non verrà registrata due volte."; importo e anteprima restano visibili; pulsanti "Annulla" (torna
   alla home `/` come nel wireframe, Open Question 4) e "Riprova +12", che reinvia **lo stesso
   `operation_id`** (nessun reinvio automatico). Errore del server non di rete (5xx, `unknown`): stesso
   avviso con il testo proposto "Il server non ha risposto correttamente. Riprova: la spesa non verrà
   registrata due volte." (Open Question 13).
   - Altri rifiuti del server (definitivi: l'`operation_id` si scarta): `customer-unavailable` → "Cliente
     non trovato" (punto 11); `invalid` o `conflict` → "Spesa non registrata: dati non validi. Ricomincia."
     con importo azzerato; `forbidden` → punto 11.
5. **Riscatta premio** (`/clienti/:id/premi`, wireframe "Riscatta premio"): Indietro (`navigate(-1)`) e
   titolo "Riscatta premio"; riga cliente; gruppo **CATALOGO** (`fieldset`/`legend`) con i premi attivi
   (`RewardsService.listActive()`, ordine di `sortRewards()`), ognuno un radio con nome e `PointsBadge`;
   quelli con punti > saldo restano visibili ma disabilitati (stile tratteggiato del wireframe) con
   "Mancano N punti" (N = punti − saldo); riga-link "Premio libero" / "Descrizione e punti decisi al
   momento" → `/clienti/:id/premi?libero` (Open Question 10). Righe ≥ 64 px. In basso "Saldo dopo il
   riscatto N punti" (solo con un premio scelto) e "Riscatta N punti" (primario, disabilitato finché non si
   sceglie). Catalogo vuoto: "Nessun premio nel catalogo" e resta il premio libero. Errore di caricamento
   del catalogo: `StatusView` con "Riprova", il premio libero resta disponibile.
   - Rifiuti: `reward-unavailable` → "Premio non più disponibile" e l'elenco si ricarica;
     `insufficient-balance` (saldo cambiato nel frattempo da un altro operatore) → "Saldo insufficiente:
     il saldo è cambiato, controlla e riprova." e saldo ricaricato. Entrambi scartano l'`operation_id`.
6. **Premio libero** (`/clienti/:id/premi?libero`, wireframe "Premio libero"): Indietro (→ catalogo),
   titolo "Premio libero", riga cliente; `TextField` "Descrizione del premio" (placeholder "Es. dolce del
   giorno"; obbligatoria, 1–80 caratteri dopo aver tolto gli spazi esterni); **PUNTI DA SCALARE**
   (`<output>` in una sezione `aria-label="Punti da scalare"`) con tastierino 1–9, cella vuota al posto di
   "00", 0 e cancella (tasti 56 px), 1–99.999 (cifre oltre ignorate); se i punti superano il saldo:
   "Saldo insufficiente: Maria ha 120 punti e il saldo non può scendere sotto zero." (`role="alert"`,
   collegato all'output con `aria-describedby`; nome proprio del cliente) e "Riscatta N punti" disabilitato.
   "Riscatta N punti" è disabilitato anche con descrizione vuota o punti 0 ("Riscatta" senza numero). Il
   server ricontrolla comunque.
7. **Premio riscattato** (wireframe "Premio riscattato"): come Spesa registrata (spunta, NUOVO SALDO,
   vibrazione, `role="timer"`, barra, ritorno automatico, stessi due pulsanti): "<premio> per Maria Rossi ·
   −100 punti" (nome del premio o descrizione del premio libero, da `description`), "Oggi 10:45 · Giulia",
   "Annulla il riscatto · N s"; dopo l'annullo "Riscatto annullato". Errori di rete come al punto 4, con i
   testi adattati e proposti "Riscatto non salvato" / "Il telefono non è connesso a internet. Riprova appena
   torna la rete: il riscatto non verrà registrato due volte." e "Riprova" (stesso `operation_id`).
8. **Saldo e ultimi movimenti nella scheda** (wireframe "Scheda cliente"): `ledger` fornisce
   `CustomerLedgerSection` e la monta in `CustomerPage` di `customers` (`/clienti/:id`, modifica di quel
   file) **sotto** il riquadro SALDO (che resta
   di `customers` e legge `customer_summary.balance`): "Registra spesa" (primario) e "Riscatta premio"
   (secondario), sezione **ULTIMI MOVIMENTI** (titolo `h2`, 4 più recenti) con link "Vedi tutti" →
   `/clienti/:id/movimenti`. Righe (non interattive): "Spesa 15,00 €" / "Premio: Caffè" / "Correzione";
   sotto la data relativa "Ieri 19:10 · Giulia" (formato: "Oggi HH:MM", "Ieri HH:MM", "8 nov HH:MM",
   con l'anno solo se diverso dall'anno corrente: "8 nov 2025 HH:MM"; fuso `Europe/Rome`) + "· annullata"
   se annullato; a destra "+15" / "−50" (segno meno tipografico). Vuoto: "Ancora nessun movimento" (nota
   n6). Errore: riga compatta "Non riesco a caricare i movimenti" con "Riprova". Cliente anonimizzato:
   nessun pulsante "Registra spesa"/"Riscatta premio", gli ultimi movimenti restano (Open Question 14).
9. **Movimenti** (`/clienti/:id/movimenti`, wireframe "Movimenti"): Indietro (→ scheda), titolo
   "Movimenti", riga cliente; gruppi per giorno con titolo `h2` (OGGI, IERI, "8 NOVEMBRE", con l'anno se
   diverso dal corrente; fuso `Europe/Rome`), più recenti in alto, 50 per volta con "Mostra altri" (Open
   Question 9). Righe come al punto 8 ma con la sola ora ("10:42 · Giulia"). Correzione: "Correzione ·
   18:12 · Andrea · annulla la spesa delle 18:05" (per un riscatto "annulla il riscatto delle HH:MM"; se
   il movimento annullato è di un altro giorno "… del 7 nov alle 18:05"). Movimento annullato: testo e
   punti barrati, colore secondario, "· annullata", senza pulsante. Vuoto: "Ancora nessun movimento".
   - **Solo amministratore**: pulsante "Annulla" (`danger-secondary`, altezza ≥ 48 px: il wireframe ne
     disegna 44, prevale la regola dei 48 px) su ogni spesa o riscatto non annullato. Una spesa con
     saldo attuale − punti < 0 mostra al posto del pulsante il testo "Punti già spesi" (non un pulsante
     disabilitato, come nel wireframe); le correzioni non hanno mai "Annulla". Al tocco la riga si
     evidenzia e si apre `ConfirmDialog` (`tone="danger"`, `busy` durante l'invio): "Annullare la spesa di
     12,50 €?" / "Oggi alle 10:42, +12 punti. Si registra una correzione di −12 punti e il saldo passa da 20
     a 8. Il movimento resta nello storico." / "Annulla la spesa" · "Lascia com'è". Per un riscatto
     (testi adattati, proposti): "Annullare il riscatto di <premio>?" / "Oggi alle 10:45, −100 punti. Si
     registra una correzione di +100 punti e il saldo passa da 20 a 120. Il movimento resta nello
     storico." / "Annulla il riscatto". Dopo la conferma l'elenco e il saldo si ricaricano. Rifiuti:
     `already-cancelled` (un altro admin l'ha appena annullato) → elenco ricaricato senza errore;
     `insufficient-balance` → "Punti già spesi: questa spesa non si può più annullare." ed elenco
     ricaricato; rete → il dialogo resta aperto con "Annullamento non riuscito: controlla la connessione e
     riprova." (stesso `operation_id`). L'operatore non vede pulsanti Annulla nello storico (Open
     Question 7).
10. **Serviti oggi** (wireframe "Cerca cliente"): la sezione la disegna `customers` (`HomePage`, regole e
    stati in `SPEC-customers.md` punto 3); `ledger` fornisce solo i dati, sostituendo con `create or
    replace` (stessa firma) il corpo di `app.customers_served_today()`: clienti non anonimizzati con almeno
    una spesa o un riscatto registrati oggi (`Europe/Rome`), anche se poi annullati, correzioni escluse;
    `last_served_at` = ora dell'ultimo; ordine `last_served_at desc`, massimo 50; `balance` reale. La home
    li ricarica all'apertura e su `visibilitychange`.
11. **Stati comuni** a tutte le schermate: caricamento (`StatusView kind="loading"`); errore di
    caricamento con "Riprova"; `:id` non uuid o cliente inesistente → "Cliente non trovato" con link alla
    home; cliente anonimizzato su Registra spesa o Riscatta premio → "Cliente cancellato: non si registrano
    spese né premi." con link alla scheda (testo proposto); `forbidden` da un RPC (nessun profilo
    operatore: account tolto durante l'uso, nota n6) → `reportNotEnabled()` di `AuthProvider` (aggiunto
    da `customers`), ritorno a `/accedi` con il messaggio di `identity`; sessione scaduta → `identity`;
    doppio tocco: pulsante `busy`, una sola chiamata.

### Modello dati e regole di accesso

```sql
-- app.movements: storico intoccabile (mai update né delete)
id                    uuid primary key default gen_random_uuid()
operation_id          uuid not null unique                -- generato dall'app
customer_id           uuid not null references app.customers(id) on delete restrict
kind                  text not null check (kind in ('purchase','redemption','correction'))
amount_cents          int  null    -- purchase: 1..9999999; altrimenti null
points                int  not null  -- purchase >= 0; redemption -99999..-1; correction = -points corretti
cents_per_point       int  null    -- purchase: rapporto in vigore (> 0); altrimenti null
reward_id             uuid null references app.rewards(id)  -- redemption da catalogo (no cascade)
description           text null    -- redemption: nome del premio o descrizione del premio libero (1..80)
operator_id           uuid not null references app.operators(id)
created_at            timestamptz not null default now()
corrects_movement_id  uuid null unique references app.movements(id)  -- solo correction (not null)
-- check per kind sulle colonne sopra; index (customer_id, created_at desc), index (created_at, id)
```

- Nessun dato personale del cliente (nome, telefono) si copia nei movimenti (`SPEC-customers.md`):
  l'anonimizzazione non li raggiungerebbe.
- **Accesso**: RLS attiva (event trigger di `platform`); policy `select` per
  `(select private.is_active_operator())`; `revoke insert, update, delete, truncate` da `authenticated` e
  `anon`; trigger `before update or delete` (per riga) e `before truncate` che alzano sempre un errore: i
  movimenti non si toccano, nemmeno per sbaglio da `postgres` nel SQL Editor (un superutente può comunque
  togliere il trigger: è una protezione contro gli errori, non contro il proprietario del database).
- **Vista** `app.movement_history` (`security_invoker = true`, quindi con la RLS di chi legge; `grant
  select` solo ad `authenticated`): movimenti + `operator_name`, `cancelled_by_id`/`cancelled_at` (dalla
  correzione che li punta) e `corrected_kind`/`corrected_created_at` (del movimento annullato, per il
  testo della correzione). Il saldo di un cliente si calcola solo come `coalesce(sum(points), 0)` su
  `app.movements`, in un'unica funzione `private.customer_balance(p_customer_id) returns int` usata dalle
  RPC.
- **Saldo nelle letture di `customers`**: `ledger` sostituisce (`create or replace`, stesse firme, stesso
  controllo `not_operator` iniziale) i corpi di `app.search_customers`, `app.get_customer` e
  `app.customers_served_today` perché `customer_summary.balance` sia la somma reale dei punti (convertita
  in `int`) e `last_served_at` l'ora dell'ultima spesa o riscatto di oggi (come previsto da
  `SPEC-customers.md`). Nessuna vista o funzione di saldo parallela.
- **RPC di scrittura** (`security definer`, `set search_path = ''`, `revoke execute … from public, anon`,
  `grant execute` solo ad `authenticated`). Ognuna: (1) `v_operator := private.acting_operator_id()`
  (creata con la stessa definizione da `settings`, `customers` e `rewards`, estesa da `tablet-kiosk`), null → `42501`; (2) blocca la
  riga del cliente `select … for update` (cliente assente o anonimizzato → `EC006`); (3) **dopo il lock**
  cerca `operation_id`: se esiste con gli stessi parametri restituisce quel movimento (replay, Open
  Question 6), se i parametri differiscono → `EC007`; (4) valida, calcola, controlla il saldo con
  `private.customer_balance` e inserisce; `unique_violation` su `operation_id` (possibile solo con clienti
  diversi) → `EC007`. Restituisce `app.ledger_result` = `(movement app.movement_history, balance int)`,
  con il saldo attuale.
  - `app.record_purchase(p_operation_id, p_customer_id, p_amount_cents)`: legge `cents_per_point` da
    `app.settings` nella stessa transazione e lo salva nel movimento; `points = p_amount_cents /
    cents_per_point` (divisione intera, per difetto); importo null o fuori 1..9999999 → `22023`.
  - `app.redeem_reward(p_operation_id, p_customer_id, p_reward_id)`: premio inesistente o inattivo →
    `EC005`; usa i punti **attuali** del premio e ne salva nome (`description`) e `reward_id`
    (`SPEC-rewards.md`); saldo − punti < 0 → `EC001`.
  - `app.redeem_free_reward(p_operation_id, p_customer_id, p_description, p_points)`: descrizione 1..80
    (trim), punti 1..99999, altrimenti `22023`; saldo insufficiente → `EC001`.
  - `app.cancel_movement(p_operation_id, p_movement_id)`: movimento inesistente → `EC006`; blocca il
    cliente del movimento, **anche se anonimizzato** (unica eccezione al passo 2, Open Question 14); correzione → `EC004`; già annullato → `EC002`; se non `private.is_admin()`
    (esteso da `tablet-kiosk` al cassiere): solo se `operator_id = v_operator` e `clock_timestamp() -
    created_at <= interval '10 seconds'`, altrimenti `EC003`; spesa con saldo − punti < 0 → `EC001`;
    inserisce `correction` con `points = -points` e `corrects_movement_id`. Il replay confronta
    `p_movement_id`.
- Errori → servizio: `EC001 insufficient-balance`, `EC002 already-cancelled`, `EC003 cancel-window-expired`,
  `EC004 not-cancellable`, `EC005 reward-unavailable`, `EC006 customer-unavailable`, `EC007 conflict`,
  `42501 forbidden`, `22023 invalid`, rete/timeout `network`, altro `unknown`. I codici `EC0xx` sono
  SQLSTATE personalizzati (`raise exception using errcode = 'EC001'`); `customers` usa invece `P0001` con
  messaggi-codice (Open Question 15).
- **Seed locale** (`supabase/seed.sql`, solo sviluppo ed E2E): nessun movimento nel seed; i test creano i
  propri movimenti sui clienti finti di `customers` e sui premi finti di `rewards`.

## Commands

Nessun comando nuovo per lo sviluppo. Se ancora assente, si aggiunge `npm run test:integration` (Vitest
contro lo stack locale, previsto da `SPEC-identity.md`) per il test di concorrenza.

## Project Structure

```
supabase/migrations/<ts>_ledger.sql            → movements, trigger, vista, customer_balance, RPC,
                                                 corpi reali di search/get/served_today di customers
supabase/tests/ledger.test.sql                 → pgTAP
src/features/ledger/
  types.ts, points.ts (+ .test.ts)             → Movement, LedgerService, LedgerError; pointsFor(), keypad reducer
  formatMovement.ts (+ .test.ts)               → etichette, date relative e gruppi per giorno in Europe/Rome
  supabaseLedgerService.ts (+ .test.ts)        → RPC, vista, traduzione errori, timeout 8 s
  LedgerServiceProvider.tsx                    → contesto + useLedgerService()
  AmountKeypad.tsx, PurchasePage.tsx, RedeemPage.tsx, FreeRewardForm.tsx, LedgerDoneView.tsx,
  MovementsPage.tsx, CustomerLedgerSection.tsx (+ .module.css, .test.tsx)
  useOperation.ts                              → operation_id stabile, stati idle/busy/done/error
src/test/fakeLedgerService.ts                  → fake in memoria con le stesse regole e guasti pilotabili
src/test/renderApp.tsx                         → accetta anche il fake del ledger
src/app/routes.tsx                             → spesa (al posto del segnaposto), premi, movimenti dentro RequireAuth
tests/integration/ledger-concurrency.test.ts
e2e/ledger.spec.ts
```

## Code Style

Come `platform` e `identity`: i componenti non chiamano `getSupabase()`, usano `useLedgerService()`.
Date e ore si formattano sempre con `timeZone: 'Europe/Rome'` esplicito (mai il fuso del dispositivo o
della CI).

```ts
export function pointsFor(amountCents: number, centsPerPoint: number): number {
  return Math.floor(amountCents / centsPerPoint); // per difetto; interi garantiti dal dominio
}
// L'operation_id nasce al primo tocco su Conferma e resta finché l'esito non è definitivo.
const op = useOperation(() => service.recordPurchase({ customerId, amountCents }));
// op.submit() → crypto.randomUUID() una volta; op.retry() riusa lo stesso id; ok/rifiuto → id consumato.
```

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP (`ledger.test.sql`, ruoli simulati con `set local role authenticated` e `request.jwt.claims` degli utenti del seed) | RLS: operatore legge, utente senza profilo e `anon` no; insert/update/delete/truncate diretti negati ad `authenticated`; trigger blocca update e delete anche a `postgres`; `anon`/`public` senza `execute` sulle RPC (`has_function_privilege`); utente senza profilo → `42501`; `record_purchase` 1250 c con 100 → 12 pt, 199 c → 1, 99 c → 0, con 250 → 5; importo 0, negativo, null e 10.000.000 → `22023`; rapporto salvato nel movimento e cambio di `settings` che non altera lo storico; replay con stesso `operation_id` → una riga e stesso movimento; stesso id con parametri diversi → `EC007`; riscatto oltre il saldo → `EC001`, esattamente uguale al saldo → ok (saldo 0); premio inattivo o inesistente → `EC005`; punti e nome del premio letti dal server; premio libero con descrizione vuota/81 caratteri o punti 0/100000 → `22023`; cliente anonimizzato → `EC006` su spesa e riscatti, mentre l'annullo dell'admin resta possibile; annullo: correzione −punti, saldo, doppio annullo `EC002`, correzione non annullabile `EC004`, spesa con punti spesi `EC001`, operatore su movimento altrui `EC003`, operatore su movimento proprio inserito dal test (come `postgres`, `insert` consentito) con `created_at` di 11 s fa → `EC003`, di 5 s fa → ok; admin su qualsiasi; `customer_balance` con correzioni e senza movimenti (0); `search_customers`/`get_customer` col saldo reale; `customers_served_today` (movimenti inseriti a 23:59 di ieri e 00:01 di oggi ora di Roma, annullati inclusi, correzioni escluse, anonimizzati esclusi, ordine, limite 50) |
| Integrazione (Vitest + stack locale) | concorrenza: saldo 100, admin e operatore del seed lanciano insieme due riscatti da 60 con id diversi, 20 ripetizioni → sempre uno solo riuscito (l'altro `insufficient-balance`), saldo finale mai < 0; stessa prova con un riscatto e l'annullo di una spesa; due chiamate parallele con lo **stesso** id → un solo movimento ed entrambe le risposte con lo stesso id; `supabaseLedgerService` traduce i codici reali del server |
| Unità (Vitest) | `pointsFor`; riduttore del tastierino (cifre, "00", cancella, limite 7 cifre, zero iniziale, cancella su 0); riduttore dei punti del premio libero (5 cifre, niente "00"); soglia strettamente sopra (15000 no, 15001 sì); importo del pulsante ("1.250 €", "150,01 €"); date relative e raggruppamento per giorno in `Europe/Rome` (anche a cavallo della mezzanotte e del cambio d'ora); testo della correzione (stesso giorno / altro giorno, spesa / riscatto); traduzione errori (ogni codice, rete, timeout 8 s) |
| Componenti (Vitest + Testing Library, fake di ledger, customers, settings, rewards, auth; timer finti) | anteprima punti e nuovo saldo; Conferma disabilitata a 0; settings in errore; Importo insolito con Correggi e Conferma; Spesa registrata con vibrazione (mock), `role="timer"`, conto alla rovescia, ritorno a `/` dopo 10 s, Annulla, annullo riuscito ("Spesa annullata", nessun ritorno) e tempo scaduto; errore di rete → Riprova con lo stesso id (il fake conta un solo movimento), "Annulla" → `/`, doppio tocco = una chiamata; nuovo id dopo un esito definitivo; premi non raggiungibili disabilitati con "Mancano N punti", catalogo vuoto, `reward-unavailable` e `insufficient-balance` che ricaricano; premio libero con saldo insufficiente, descrizione vuota; Movimenti: admin vede Annulla e "Punti già spesi", operatore no, dialogo e testi di spesa e riscatto, `already-cancelled`; `CustomerLedgerSection` con 4 righe, vuota, errore, cliente anonimizzato; stati caricamento, errore, cliente non trovato, `forbidden` → `reportNotEnabled()` |
| E2E (Playwright, 390×844, build con `VITE_E2E=1`, Supabase locale, account del seed) | operatore: crea nel test (RPC di `customers` e `cards`) un cliente finto con card finta e nome unico per esecuzione, `window.__enjoyFakeCard(uid)` → Registra spesa → 1-2-5-0 → Conferma → "Spesa registrata" +12 e saldo corretto, **in meno di 10 s** misurati dal test; ritorno automatico a `/` e cliente in "Serviti oggi"; rete interrotta (`context.setOffline`) → "Spesa non salvata" → rete ripristinata → Riprova → un solo movimento nello storico; riscatto da catalogo (premi del seed di `rewards`) e premio libero insufficiente; admin: annulla una spesa dallo storico con il dialogo e vede la correzione; premio disattivato assente in Riscatta premio; target ≥ 48 px; nessun errore in console |

## Boundaries

- **Always**: importi in centesimi interi; punti per difetto calcolati **sul server**; saldo controllato
  sotto lock nella stessa transazione; `operation_id` dall'app e riuso nel reinvio; operatore da
  `private.acting_operator_id()`; ruoli verificati sul server; solo dati finti nei test e nel seed
  (`@example.com`, nomi inventati, telefoni `+39333000…`, uid finti); nessun segreto nel repo.
- **Ask first**: coda offline o reinvio automatico in background; cambiare la finestra di 10 s; permettere
  l'annullo di una correzione; correzioni manuali di punti; mostrare al cliente altro oltre al saldo della pagina pubblica di `cards`
  (`/s/:token`); limiti diversi
  per importo o punti.
- **Never**: `update`/`delete` di `app.movements`; calcolare il saldo solo nel client per decidere; numeri
  decimali in euro; nuovo `operation_id` su un reinvio; dati personali del cliente nei movimenti; chiave
  service role nell'app.

## Success Criteria

1. 1-2-5-0 mostra "12,50 €" e "+12"; con rapporto 250 la stessa spesa vale 5 punti e il movimento salva 250.
2. Con soglia 150,00 €: importo 150,01 € mostra "Importo insolito" e "Conferma 150,01 €"; 150,00 € no.
3. E2E: dalla lettura card finta alla schermata "Spesa registrata" in meno di 10 s; dopo 10 s si torna a `/`.
4. Reinvio dopo errore di rete o doppio tocco: un solo movimento (pgTAP, componenti, E2E).
5. Il test di concorrenza non registra mai un saldo negativo né due riscatti oltre il saldo.
6. Dall'API nessun ruolo inserisce, modifica o cancella direttamente un movimento, e `update`/`delete` falliscono
   anche come `postgres`; l'annullo crea una correzione visibile nello storico e il saldo resta la somma di
   tutti i movimenti.
7. Spesa con punti già spesi: nello storico "Punti già spesi" al posto di Annulla, e `EC001` dal server.
8. Operatore: annulla solo il proprio movimento entro 10 s; nessun Annulla nello storico; `EC003` oltre.
9. Ogni testo, stato e pulsante dei wireframe elencati in Fonti ha un test di componente; E2E a 390×844;
   detector Impeccable pulito; target ≥ 48 px.
10. `npm run typecheck && npm run lint && npm test`, `npm run db:test`, `npm run test:integration` ed
    `npm run e2e` verdi.

## Out of Scope

- Lettura card, permesso NFC, card sconosciuta → `card-input`, `cards`; scheda (riquadro SALDO incluso),
  ricerca, home e disegno di "Serviti oggi" → `customers` (`ledger` fornisce la sezione della scheda e i
  dati); export CSV → `export`; schermate tablet e PIN → `tablet-kiosk`.
- Modifica di un movimento, correzioni manuali di punti, rimborsi parziali, scadenza dei punti, coda
  offline: non richiesti.

## Open Questions

1. **Finestra di 10 s e latenza.** Proposta: il server accetta l'annullo dell'operatore fino a 10 s da
   `created_at`, senza tolleranza; oltre risponde `EC003` e l'app lo spiega (default adottato). Con una
   rete lenta l'ultimo secondo del conto alla rovescia può già essere fuori tempo.
2. **Dopo "Annulla" su Spesa registrata.** Proposta: un tocco senza dialogo di conferma; titolo "Spesa
   annullata", saldo ripristinato, niente ritorno automatico, restano "Leggi un'altra card" e "Apri la
   scheda" (default adottato).
3. **"Correggi" in Importo insolito.** Proposta: azzera l'importo (default adottato).
4. **"Annulla" in Spesa non salvata.** Proposta: torna alla home come nel wireframe e scarta
   l'`operation_id`; se la prima richiesta era arrivata, la spesa compare nello storico (default adottato).
5. **Limiti.** Proposta: importo massimo 99.999,99 €; premio libero 1–99.999 punti (come i premi del
   catalogo), descrizione 1–80 caratteri; spesa che vale 0 punti (es. 0,50 €) registrata comunque
   (default adottato).
6. **Saldo nella risposta di un replay.** Proposta: si restituisce il movimento originale con il saldo
   **attuale** (default adottato; il contratto dice "il primo risultato").
7. **Annullo nello storico per l'operatore.** Proposta: nessun pulsante; annulla solo dalla conferma
   (default adottato).
8. **Ricarica della pagina durante un errore di rete.** Proposta: l'`operation_id` vive solo in memoria
   (default adottato); alternativa: salvarlo in `sessionStorage`.
9. **Storico a pagine.** Proposta: 50 movimenti per volta con "Mostra altri" (default adottato). "Serviti
   oggi" segue `SPEC-customers.md` (Open Question 3 di quella spec).
10. **Premio libero come URL.** Proposta: `/clienti/:id/premi?libero` perché il tasto Indietro di Android
    torni al catalogo (default adottato; il contratto elenca solo `/clienti/:id/premi`).
11. **Sezione della scheda montata da `customers`.** Proposta: `CustomerLedgerSection` (pulsanti e ultimi
    movimenti) la fornisce `ledger`; scheda, riquadro SALDO e home restano di `customers` (default
    adottato, coerente con `SPEC-customers.md`).
12. **"Correzione" per l'amministratore.** Le specifiche danno all'amministratore "correzione e
    annullamento movimenti". Proposta: in V1 la correzione è solo l'annullo di una spesa o di un riscatto;
    niente correzioni manuali di punti (default adottato). Serve una correzione libera (es. "+20 punti per
    errore")?
13. **Timeout e testi d'errore non nei wireframe.** Proposta: una richiesta senza risposta entro 8 s vale
    come errore di rete; per gli errori del server, per l'annullo e per il riscatto si usano i testi
    proposti in questa spec (default adottato). Il testo del wireframe ("Il telefono non è connesso a
    internet") resta anche per il timeout.
14. **Cliente con dati cancellati.** Proposta: niente spese né riscatti (il server rifiuta con `EC006`),
    storico consultabile, l'amministratore può ancora annullare dallo storico (default adottato).
15. **Codici d'errore diversi tra moduli.** `customers` usa `P0001` con messaggi-codice
    (`not_operator`…), `settings` e `rewards` gli SQLSTATE standard; `ledger` usa SQLSTATE personalizzati
    `EC0xx` e `42501`. Proposta: tenerli, ogni servizio traduce i propri (default adottato); da uniformare
    se si preferisce un solo schema.
