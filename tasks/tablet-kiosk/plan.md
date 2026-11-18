# Implementation Plan: tablet-kiosk

Source spec: [SPEC-tablet-kiosk.md](../../docs/specs/SPEC-tablet-kiosk.md) (approvata il 2026-11-17; le Open
Questions usano i default adottati, da rivedere con il titolare: `docs/specs/cross-review.md` §3)

## Overview

Il tablet della cassa (BESTTAB A20, 1280×800 in orizzontale, senza NFC) accede una volta con l'account del
bar (**account di dispositivo**, creato a mano con `private.add_device`) e chi sta alla cassa si alterna con
il **PIN personale di 4 cifre**, verificato sul server, con blocco di 5 minuti dopo 5 errori consecutivi per
dispositivo. Il cassiere scelto vive sulla riga del dispositivo (`app.devices`) per al massimo 12 ore:
`private.acting_operator_id()`, `is_active_operator()` e `is_admin()` vengono estese così che ogni RPC già
esistente registri il cassiere come operatore e che, senza cassiere valido, il dispositivo non legga e non
scriva nulla. Lato client: lo stato "device" in `AuthProvider` (da `app.get_session_identity()`), la pagina
`/cassa` "Chi è alla cassa?", la guardia del cassiere, il chip "Alla cassa: <nome> · Cambia", il PIN dal
proprio telefono (`/impostazioni/pin`), la sezione "LETTORE CARD" per il formato del lettore USB e i layout
1280×800 delle stesse rotte del telefono. Il lettore USB è l'adattatore tastiera di `card-input`, che non si
modifica. Prima di tutto (task 1) si chiude il test instabile di `cards` che ha fatto fallire la CI.

## Architecture Decisions

- **Task 1 = il test instabile di `NewCustomerCardSection`** (richiesta dell'orchestratore). La CI (run
  44321492570) è fallita una volta su `waitFor` dentro `currentWrite` ("expected 0 to be greater than 0"),
  in locale passa. Prima si **riproduce** sotto carico (`npx vitest run <file> --repeat N`, con la CPU
  occupata da altri processi o con `--pool=threads` e tutta la suite in parallelo) e si annota il tasso di
  fallimento; poi si cerca la causa reale (quale passo asincrono separa il salvataggio dall'inizio della
  scrittura del link e quanto supera il timeout predefinito di `waitFor`: risposta del finto, navigazione,
  effetto che avvia `writeUrl`); la correzione attende un segnale deterministico o elimina l'attesa inutile
  nel codice, **mai** un timeout più lungo o un nuovo tentativo. Prova: la stessa ripetizione sotto carico
  che prima falliva passa N volte su N. Nota in RUNBOOK §4 se la causa è un'insidia riutilizzabile.
- **Database prima di tutto** (rischio più alto: chi tiene il tablet in mano non deve poter leggere,
  scrivere o indovinare PIN oltre il limite). Una sola migrazione `*_tablet_kiosk.sql` creata con
  `npx supabase migration new tablet_kiosk` (dopo `*_export.sql`), completata in place nei task 2–5 e
  applicata con `npm run db:reset` (non pubblicata). pgTAP in `supabase/tests/tablet_kiosk.test.sql` e,
  per la matrice "dispositivo senza cassiere", `supabase/tests/tablet_kiosk_access.test.sql`.
- **Le tre funzioni di accesso si estendono con `create or replace` e stessa firma**, l'ultima definizione
  vince su quelle di settings/customers/rewards/ledger. Turno valido = cassiere impostato,
  `cashier_since > now() - interval '12 hours'`, operatore ancora collegato (`user_id` non null) e con riga
  in `private.operator_pins`. Per gli account operatore il risultato non cambia: tutti i pgTAP esistenti
  restano verdi senza modifiche (è la prova di non regressione). Le RPC dei moduli non si toccano: si
  verifica con pgTAP che ognuna rifiuti il dispositivo senza cassiere con il codice che già usa (`42501`,
  `not_operator`, …: nessun codice nuovo).
- **PIN solo come hash bcrypt** in `private.operator_pins` (`extensions.crypt(pin, extensions.gen_salt('bf',
  8))`), confronto `crypt(p_pin, pin_hash) = pin_hash` solo dentro `unlock_cashier`. Nessun grant su
  `private` ad `authenticated`/`anon`; `app.devices` con RLS senza policy e `revoke all`.
- **Blocco senza corse**: `unlock_cashier` prende la riga del dispositivo con `select … for update` prima di
  leggere `locked_until` e il contatore, quindi tentativi concorrenti si serializzano e il 6° vede il blocco.
  La funzione **restituisce** l'esito (mai `raise` dopo l'incremento), così il contatore non torna indietro
  col rollback; solo l'input non valido (`22023`) e il chiamante sbagliato (`42501`) sollevano, prima di
  toccare il contatore. Durante il blocco il PIN non si verifica nemmeno (niente bcrypt: niente oracolo di
  temporizzazione). Prova del parallelo nel test di integrazione (10 chiamate concorrenti su HTTP → esattamente
  5 contate, poi `locked`).
- **Privilegi delle funzioni** come `20261117230000_function_privileges.sql`: `security definer`,
  `set search_path = ''`, `revoke execute from public, anon`, `grant execute to authenticated` sulle RPC
  `app.*`; `private.add_device` eseguibile solo da `postgres`; `function_privileges.test.sql` resta verde.
  `add_device` e `add_operator` si escludono (stesso utente Auth mai operatore e dispositivo).
- **Identità della sessione da una RPC**: `AuthService.loadOperator` diventa `loadIdentity` su
  `app.get_session_identity()` (`operator` | `device` | null). `AuthState` guadagna lo stato
  `{ status: 'device', device, cashier, turnExpiresAt, lockSecondsLeft }`; `useCurrentOperator()` restituisce
  il cassiere, così le schermate esistenti non cambiano. Per mostrare "Impostato / Da impostare" sul
  telefono, il ramo `operator` di `get_session_identity()` include `has_pin` (campo in più nella stessa RPC:
  nessuna RPC nuova; vedi Open Questions).
- **Guardia del cassiere** (`RequireCashier` dentro `RequireAuth`): dispositivo senza turno valido →
  `/cassa`; rilettura di `get_session_identity()` a ogni cambio di rotta, a `visibilitychange` e a ogni
  `reportNotEnabled()`; timer all'ora `turn_expires_at` del server → `/cassa` con "Turno scaduto: inserisci
  di nuovo il PIN". `SettingsProvider` e `CardReaderSession` si montano solo sotto la guardia, con `key` =
  cassiere: su `/cassa` nessuna lettura card. Operatore su `/cassa` → `/`.
- **Servizio iniettato come gli altri moduli**: `src/features/tablet-kiosk/types.ts` (`KioskService`,
  `UnlockResult` della spec), `supabaseKioskService.ts` (unico file che nomina `list_cashiers`,
  `unlock_cashier`, `end_cashier_turn`, `set_my_pin`; `serverFaultFor` di `src/lib/serverFault.ts` per primo),
  `KioskServiceProvider`/`useKioskService()` in `main.tsx` e `renderApp` (parametro facoltativo in coda),
  `src/test/fakeKioskService.ts` (PIN, contatore, blocco, scadenza, rete giù, registro delle chiamate). La
  guardia `scripts/kioskBoundary.test.ts` verifica anche che il modulo non usi `console.*`, `localStorage`,
  `sessionStorage` né metta il PIN in URL (Boundaries: il PIN non finisce mai in log, URL o storage).
- **`/cassa` accetta il PIN solo dal tocco**: listener `keydown` in fase di cattura su `window` con
  `preventDefault` + `stopPropagation` per tutta la vita della pagina (anche Invio con un pulsante a fuoco).
  Il conto alla rovescia parte dai secondi restanti dati dal server, mai dall'orologio del tablet.
- **Layout tablet = varianti CSS della stessa pagina**: `useTabletLayout()` (media query
  `(min-width: 1024px) and (min-height: 600px)`) e `@media` nei `.module.css` esistenti, con token del design
  system. Nessuna logica di dominio duplicata; i layout del telefono non cambiano (E2E del progetto `phone`
  invariati). Larghezze dei wireframe: Cerca 440, Scheda 560, tastierini 480, Riscatta 400, Nuovo cliente
  440, Catalogo 480.
- **Playwright**: progetto `tablet` (1280×800, `testMatch: /tablet.*\.spec\.ts$/`), il progetto `phone` lo
  ignora. La prova del formato del lettore cambia `app.settings`: sta in `tablet-settings.spec.ts`, in un
  progetto seriale `tablet-settings` dopo `phone-settings` (stessa regola di `SHARED_STATE_SPECS`), e rimette
  `hex`. Seed: `cassa@example.com` e `cassa-blocco@example.com` (dispositivi distinti, così il test del blocco
  non blocca gli altri), PIN finti per gli operatori del seed, e un operatore riservato all'E2E del PIN dal
  telefono (come `recupero@example.com`), così cambiare il suo PIN non disturba gli altri test.
- **Enjoy Display**: titoli e pulsanti nuovi ("Chi è alla cassa?", "PIN di <nome>", "LETTORE CARD",
  "Disconnetti il tablet", "Cambia"…) passano da `scripts/displayGlyphs.test.ts`; il separatore "·" del chip
  si verifica contro la regola dei glifi prima di usarlo in un elemento Display.
- **Revisione di sicurezza obbligatoria** (`security-and-hardening`) al Checkpoint A (forza bruta sul PIN,
  corsa sul blocco, privilegi dell'account di dispositivo, hash, `search_path`) e al Checkpoint D (PIN mai in
  log/URL/storage, keydown, guardia, "Disconnetti il tablet").
- **Pubblicazione esclusa da questo piano**: migrazioni remote, anteprima e produzione le gestisce
  l'orchestratore. La prova sul tablet vero (lettore, formato, densità) è nella procedura
  `docs/setup-tablet.md`, da fare con l'utente. La PR va su `main` e si unisce dopo #22 (`feat/export`).

## Dependency Graph

```
task 1 (test instabile di cards, indipendente)

migrazione tablet_kiosk
  devices + operator_pins + add_device (2)
    └── acting_operator_id / is_active_operator / is_admin estese (3)
          └── set_my_pin, unlock_cashier, end_cashier_turn, blocco (4)
                └── get_session_identity, list_cashiers, seed (5) ── integrazione HTTP (6)
                      │
                      ├── KioskService + guardia del confine (7) ── finto + provider (8)
                      └── AuthService.loadIdentity (9) ── AuthState "device" (10)
                                └── RequireCashier + rotte (11)
                                      ├── PinPad + useTabletLayout (12) ── /cassa (13) ── chip (14) ── accesso tablet (15)
                                      │       └── E2E tablet di base (16)
                                      ├── PIN dal telefono (17) ── Impostazioni sul tablet (18) ── LETTORE CARD (19)
                                      │       └── E2E PIN telefono → tablet e formato (20)
                                      └── layout 1280×800 (21–24) ── E2E dei layout (25)
                                                └── documentazione (26) ── criteri e PR (27)
```

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 0: CI stabile
- [x] Task 1: Test instabile `NewCustomerCardSection` "an unknown card becomes «Card letta»…": causa riprodotta sotto carico e corretta

### Fase 1: Database (rischio più alto)
- [x] Task 2: `app.devices`, `private.operator_pins`, `current_device_id`, `add_device` ↔ `add_operator`; pgTAP sui privilegi
- [x] Task 3: `acting_operator_id` / `is_active_operator` / `is_admin` estese al cassiere; matrice pgTAP del dispositivo senza cassiere
- [x] Task 4: `set_my_pin`, `unlock_cashier` (blocco con `for update`), `end_cashier_turn`; pgTAP del blocco e della scadenza
- [x] Task 5: `get_session_identity`, `list_cashiers`, seed dei dispositivi e dei PIN finti
- [x] Task 6: Integrazione su HTTP: dispositivo senza cassiere, corsa sul blocco, hash mai esposto

### Checkpoint A: `db:test` e `test:integration` verdi; pgTAP esistenti invariati; revisione `security-and-hardening` (forza bruta, corsa, privilegi del dispositivo)

### Fase 2: Servizi e identità
- [x] Task 7: `KioskService`, `supabaseKioskService` e guardia del confine
- [x] Task 8: `fakeKioskService`, `KioskServiceProvider`, `main.tsx` e `renderApp`
- [x] Task 9: `AuthService.loadIdentity` su `get_session_identity` (servizio Supabase e finto)
- [x] Task 10: `AuthProvider` con lo stato "device": cassiere come operatore corrente, `reportNotEnabled` sul dispositivo
- [x] Task 11: `RequireCashier`: `/cassa` senza turno, scadenza programmata, rilettura a ogni rotta e al ritorno visibile; lettura card solo con turno

### Checkpoint B: quality bar completa verde; test di identity invariati nel comportamento; revisione con l'utente prima della UI

### Fase 3: Cassa
- [x] Task 12: `PinPad` (tasti da 88 px) e `useTabletLayout`
- [ ] Task 13: `/cassa` "Chi è alla cassa?": selezione, invio alla 4ª cifra, tasti fisici fermati, stati
- [ ] Task 14: `CashierChip` nell'intestazione: "Alla cassa: <nome> · Cambia" → `end_cashier_turn` → `/cassa`
- [ ] Task 15: Accesso sul tablet: nota del layout tablet, dispositivo → `/cassa`
- [ ] Task 16: E2E tablet di base (progetto `tablet` 1280×800): PIN → card USB → spesa del cassiere, Cambia, blocco, card su `/cassa`, < 10 s

### Checkpoint C: flusso della cassa verde in E2E; detector Impeccable pulito; confronto con "Tablet: cambio operatore"

### Fase 4: PIN e Impostazioni
- [ ] Task 17: `/impostazioni/pin` e riga "PIN della cassa" nella sezione ACCOUNT (telefono)
- [ ] Task 18: Impostazioni sul tablet: cassiere nel riquadro, "Esci" chiude il turno, "Disconnetti il tablet", niente password né PIN
- [ ] Task 19: Sezione "LETTORE CARD" (formato del lettore USB) solo con cassiere amministratore
- [ ] Task 20: E2E: PIN impostato dal telefono e usato sul tablet, turno precedente chiuso; formato del lettore cambiato e ripristinato

### Checkpoint D: revisione `security-and-hardening` del client (PIN mai in log/URL/storage, tasti fisici, guardia, disconnessione)

### Fase 5: Layout 1280×800
- [ ] Task 21: Cerca: colonna "Passa la card sul lettore" (440), "Lettore USB pronto" / "Codice non riconosciuto…"
- [ ] Task 22: Scheda cliente (560 + movimenti) e Movimenti (colonna larga)
- [ ] Task 23: Registra spesa, Premio libero (tastierino a destra 480) e Riscatta premio (riepilogo 400)
- [ ] Task 24: Nuovo cliente (pannello Card 440), Associa card, Catalogo premi (480), Spesa/Premio registrato
- [ ] Task 25: E2E dei layout a 1280×800: colonne, nessuno scorrimento orizzontale, target ≥ 48 px

### Checkpoint E: Impeccable pulito su ogni schermata tablet; confronto con i wireframe Tablet-*; E2E `phone` invariati

### Fase 6: Chiusura
- [ ] Task 26: `docs/setup-tablet.md`, `docs/setup-accounts.md` (`add_device`), RUNBOOK, CLAUDE.md, memoria
- [ ] Task 27: Verifica dei criteri di successo (`scripts/kioskCriteria.test.ts`) e PR

### Checkpoint F: i criteri 1–8 verificati; quality bar completa verde; PR su `main` pronta per `code-review-and-quality`, da unire dopo #22

## Copertura dei criteri di successo

| Criterio (docs/specs/SPEC-tablet-kiosk.md) | Task |
|---|---|
| 1. Dispositivo creato con `add_device` accede e vede solo `/cassa`; senza cassiere 0 righe da ogni tabella/vista `app` e ogni RPC di scrittura fallisce (pgTAP) | 2, 3, 5, 6, 11, 15, 16 |
| 2. Dopo il PIN giusto la spesa ha `operator_id` = cassiere; header "Alla cassa: <nome> · Cambia"; toccarlo azzera il cassiere sul server | 3, 4, 13, 14, 16 |
| 3. 5 PIN errati bloccano per 5 minuti anche ricaricando; il 6°, pur giusto, rifiutato fino alla scadenza | 4, 5, 6, 13, 16 |
| 4. PIN impostato dal telefono e usato subito sul tablet; cambiandolo il turno aperto finisce e il tablet torna a `/cassa` alla rotta successiva | 4, 11, 17, 20 |
| 5. Card USB dalla home: nota → Registra spesa, sconosciuta → Nuovo cliente con card; su `/cassa` nessun cambio e nessuna cifra nel PIN | 11, 13, 16, 21, 24 |
| 6. Card → spesa confermata < 10 s sul tablet (E2E cronometrato) | 16 |
| 7. A 1280×800 colonne e larghezze del punto 10, nessuno scorrimento orizzontale, target ≥ 48 px (E2E); Impeccable pulito; E2E 390×844 invariati | 12, 13, 21–25 |
| 8. CI verde con pgTAP, componenti ed E2E telefono + tablet | ogni task; 27 |

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Dispositivo senza cassiere che legge o scrive (una RPC che controlla `current_operator_id()` invece di `acting_operator_id()`, una policy dimenticata) | Alto | Matrice pgTAP su **ogni** tabella/vista `app` e **ogni** RPC di scrittura (elenco preso dal catalogo, non a mano: un test fallisce se compare una funzione `app.*` non classificata); integrazione su HTTP |
| Forza bruta sul PIN (10 000 combinazioni; ~1 440 tentativi al giorno col blocco di 5 minuti) | Alto | Contatore per dispositivo sul server, blocco senza verifica, nessun oracolo di tempo; limite residuo scritto in Open Questions 1 della spec e riportato all'utente con l'alternativa dei blocchi crescenti |
| Corsa sul blocco: tentativi paralleli che superano 5 | Alto | `select … for update` sulla riga del dispositivo; integrazione con 10 chiamate concorrenti |
| Contatore annullato da un `raise` dopo l'incremento | Alto | `unlock_cashier` restituisce l'esito; pgTAP che rilegge il contatore in una nuova transazione |
| Hash o PIN esposti (colonna leggibile, log, URL, `localStorage`) | Alto | Tabella in `private` senza grant; pgTAP `has_table_privilege`; guardia del confine sul client; integrazione che cerca `pin_hash` e il PIN nelle risposte |
| Account di dispositivo con privilegi di operatore (chiama `set_my_pin`, `add_operator`, legge `operators` senza cassiere) | Alto | `set_my_pin` rifiuta i dispositivi (`42501`); `add_device`/`add_operator` si escludono; pgTAP |
| Turno scaduto lato server ma non lato client (letture a 0 righe scambiate per "nessun dato") | Medio | Rilettura di `get_session_identity()` a ogni rotta e a `visibilitychange`, timer su `turn_expires_at`, `reportNotEnabled()` → `/cassa` |
| Il lettore USB batte cifre o Invio nel PIN o su un pulsante a fuoco in `/cassa` | Medio | Cattura di ogni `keydown` su `/cassa`; nessun `CardReaderSession` montato; E2E con `page.keyboard` |
| Regressione dei layout del telefono | Medio | Solo `@media` sopra 1024×600; E2E `phone` invariati; nessun test esistente modificato nelle aspettative |
| Test E2E tablet che cambiano `app.settings` o bloccano il dispositivo usato da altri | Medio | Progetto seriale `tablet-settings`; dispositivo `cassa-blocco@example.com` solo per il blocco; operatore riservato per il cambio PIN |
| Test instabili per timer (conto alla rovescia, scadenza del turno) | Medio | `vi.useFakeTimers` nei test di componente; scadenza spostando `cashier_since` in pgTAP, mai attese reali |
| Template email persi dopo `supabase start` | Basso | `scripts/reload-auth-templates.sh` dopo l'avvio dello stack (RUNBOOK) |

## Open Questions

Nessuna bloccante: le Open Questions 1–14 della spec usano i default adottati. Da segnalare all'utente
durante l'implementazione, senza fermare il lavoro:

- **`has_pin` nell'identità dell'operatore**: lo stato "Impostato / Da impostare" sul telefono richiede di
  sapere se il proprio PIN esiste; il piano lo aggiunge al ramo `operator` di `get_session_identity()`
  invece di una RPC nuova. È una scelta di implementazione da confermare.
- **Password dell'account del bar dall'API**: la spec nasconde "Cambia password" sul tablet, ma chi ha la
  sessione del dispositivo può comunque chiamare l'API di Auth. Da verificare alla revisione di sicurezza se
  l'impostazione "secure password change" di Supabase basta o se serve altro; decisione dell'utente.
- **Forza bruta** (Open Question 1 della spec): con 5 tentativi ogni 5 minuti il PIN di un amministratore si
  indovina in pochi giorni di tentativi continui; l'alternativa dei blocchi crescenti richiede una decisione
  ("Ask first" della spec).
- Modello, formato del lettore e densità reale del tablet: da verificare all'acquisto (Open Question 10).
