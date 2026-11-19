# Todo: tablet-kiosk

Fonte: [plan.md](plan.md) · Spec: [SPEC-tablet-kiosk.md](../../docs/specs/SPEC-tablet-kiosk.md). Ogni task
chiude con la quality bar completa verde (`npm run typecheck && npm run lint && npm run format:check &&
npm test && npm run db:test && npm run test:integration && npm run e2e`) e un commit Conventional Commits
sul branch `feat/tablet-kiosk`, solo con i file del task, che termina con
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Test prima del codice
(`test-driven-development`). Solo lo stack Supabase locale (dopo `supabase start`:
`scripts/reload-auth-templates.sh`); mai `--linked`/`--remote`. Nessun test indebolito, saltato o
cancellato; nessuna soppressione di lint senza una riga di motivazione. UI: componenti e token del design
system, testi in italiano, target ≥ 48 px, detector Impeccable risolto dopo ogni modifica.

## Task 1: Test instabile di `NewCustomerCardSection`
**Descrizione:** `src/features/cards/NewCustomerCardSection.test.tsx`, test 'an unknown card becomes "Card
letta", saved with the customer; its link, then the customer page': nella CI (run 44321492570) `waitFor`
dentro `currentWrite` è scaduto con "expected 0 to be greater than 0"; in locale passa. Riprodurre sotto
carico (`npx vitest run src/features/cards/NewCustomerCardSection.test.tsx --repeat 50` con la CPU occupata,
ad es. più processi `npm test` in parallelo o `--pool=threads` con tutta la suite), misurare il tasso di
fallimento, trovare il passo asincrono che separa il salvataggio dall'avvio di `writeUrl` (risposta del
finto, navigazione, effetto, catena di promesse) e correggere la causa: nel test attendere un segnale
deterministico (ad es. lo stato a schermo che precede la scrittura) o, se il ritardo è nel codice, toglierlo.
**Accettazione:**
- [x] Fallimento riprodotto sotto carico prima della correzione, con il comando e il tasso annotati nel
      messaggio di commit
- [x] Causa spiegata nel commit; nessun timeout alzato, nessun `retry`, nessuna aspettativa tolta
- [x] Lo stesso comando sotto lo stesso carico passa N volte su N; gli altri test del file invariati
- [x] Se l'insidia vale anche altrove (altri `currentWrite`, `CardLinkWriter.test.tsx`), stessa correzione
      lì e nota in RUNBOOK §4
**Verifica:** `npx vitest run src/features/cards --repeat 50` sotto carico; `npm test`
**Dipendenze:** nessuna · **File:** src/features/cards/NewCustomerCardSection.test.tsx, eventualmente
src/test/fakeLinkWrites.ts, src/features/cards/useNewCustomerCard.ts o CardLinkWriter.test.tsx,
brain/topics/operations/RUNBOOK.md · **Dimensione:** S

## Task 2: Dispositivi e PIN nel database
**Descrizione:** `npx supabase migration new tablet_kiosk`: `app.devices` (colonne della spec, RLS senza
policy, `revoke all` da `anon`/`authenticated`), `private.operator_pins` (nessun grant), funzione
`private.current_device_id()`, `private.add_device(email, name)` eseguibile solo da `postgres` (rifiuta email
inesistente o utente già operatore; ricollega per nome come `add_operator`), `private.add_operator`
aggiornata con `create or replace` per rifiutare un utente collegato a un dispositivo.
**Accettazione:**
- [x] pgTAP: `authenticated` e `anon` non leggono né scrivono `app.devices` e `private.operator_pins`
      (`has_table_privilege` e prova reale con il ruolo impostato)
- [x] pgTAP: `add_device` crea e ricollega; rifiuta email inesistente e utente operatore; `add_operator`
      rifiuta un utente dispositivo; solo `postgres` esegue entrambe
- [x] pgTAP: cancellare l'utente lascia il dispositivo con `user_id` null; `current_device_id()` null per un
      operatore e per un utente sconosciuto
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** nessuna · **File:** supabase/migrations/*_tablet_kiosk.sql,
supabase/tests/tablet_kiosk.test.sql · **Dimensione:** S

## Task 3: Funzioni di accesso estese al cassiere
**Descrizione:** nella stessa migrazione, `create or replace` (stessa firma, stessi privilegi) di
`private.acting_operator_id()`, `private.is_active_operator()` e `private.is_admin()`: operatore collegato →
come oggi; dispositivo → valori del cassiere solo con turno valido (cassiere impostato, `cashier_since >
now() - interval '12 hours'`, operatore con `user_id` non null e con PIN), altrimenti null/false.
`supabase/tests/tablet_kiosk_access.test.sql`: con il token di un dispositivo senza cassiere, ogni tabella e
vista dello schema `app` (elenco letto da `pg_catalog`) restituisce 0 righe e ogni RPC di scrittura `app.*`
è rifiutata con il codice già usato dal modulo; un test fallisce se compare una funzione `app.*` non
classificata come lettura, scrittura o kiosk.
**Accettazione:**
- [x] pgTAP (criterio 1): dispositivo senza cassiere → 0 righe ovunque; `record_purchase`,
      `create_customer`, `update_settings` e le altre scritture rifiutate
- [x] pgTAP (criterio 2): con cassiere (impostato direttamente nella riga per ora) `movements.operator_id` e
      `customers.created_by` = cassiere; `update_settings` ok con cassiere admin, `42501` con cassiere operatore
- [x] pgTAP: turno oltre 12 h, cassiere con utente cancellato o senza PIN → null; per gli account operatore
      tutti i pgTAP esistenti verdi senza modifiche
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 2 · **File:** supabase/migrations/*_tablet_kiosk.sql,
supabase/tests/tablet_kiosk_access.test.sql · **Dimensione:** M

## Task 4: PIN, sblocco, blocco e fine turno
**Descrizione:** `app.set_my_pin(p_pin)` (solo operatori collegati; `^[0-9]{4}$` altrimenti `22023`; upsert
dell'hash bcrypt `gen_salt('bf', 8)`; chiude i turni di quella persona su tutti i dispositivi; idempotente),
`app.unlock_cashier(p_operator_id, p_pin)` (solo dispositivi; `for update` sulla riga; bloccato →
`locked` con `lock_seconds_left` senza verificare; operatore non collegato o senza PIN → `no_pin`; errato →
contatore, al 5° `locked_until = now() + 5 min` e contatore a 0; giusto → cassiere, `cashier_since`,
contatore a 0; restituisce `jsonb`, non solleva dopo l'incremento; PIN non di 4 cifre → `22023` senza
contare), `app.end_cashier_turn()` (solo dispositivi, idempotente). Privilegi espliciti.
**Accettazione:**
- [x] pgTAP (criterio 3): 5 errori → `locked`; il 6° con PIN giusto → `locked` finché `locked_until` non è
      passato (spostato nel test); contatore riletto dopo un errore in una nuova transazione; successo azzera
- [x] pgTAP (criterio 4): `set_my_pin` rifiuta dispositivi (`42501`) e PIN non validi (`22023`); salva solo
      un hash `$2a$`/`$2b$` diverso dal PIN; chiude i turni di quella persona; un operatore e `anon` non
      eseguono `unlock_cashier` né `end_cashier_turn`
- [x] pgTAP: `end_cashier_turn` azzera il cassiere (criterio 2) e ripetuto non fallisce;
      `function_privileges.test.sql` verde
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 3 · **File:** supabase/migrations/*_tablet_kiosk.sql, supabase/tests/tablet_kiosk.test.sql
· **Dimensione:** M

## Task 5: Identità della sessione, elenco dei cassieri e seed
**Descrizione:** `app.get_session_identity()` → `{kind: 'operator', operator: {id, name, role, has_pin}}` |
`{kind: 'device', device: {id, name}, cashier | null, turn_expires_at | null, lock_seconds_left}` | null;
`app.list_cashiers()` (solo dispositivi, anche senza cassiere; operatori collegati con `id, name, role,
has_pin`, in ordine alfabetico; altrimenti `42501`). Seed: dispositivi `cassa@example.com` ("Tablet cassa") e
`cassa-blocco@example.com` (riservato all'E2E del blocco), PIN finti per gli operatori del seed e un operatore
riservato all'E2E del PIN dal telefono; password di prova del seed.
**Accettazione:**
- [x] pgTAP: identità per operatore, dispositivo con e senza cassiere, turno scaduto (cassiere null),
      bloccato (`lock_seconds_left` > 0 anche in una nuova transazione: criterio 3 "ricaricando"), utente
      senza profilo → null
- [x] pgTAP: `list_cashiers` funziona senza cassiere, rifiuta un operatore; nessuna RPC restituisce
      `pin_hash`
- [x] `npm run db:reset` applica seed senza errori; nessun dato reale, solo `@example.com`
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 4 · **File:** supabase/migrations/*_tablet_kiosk.sql, supabase/tests/tablet_kiosk.test.sql,
supabase/seed.sql · **Dimensione:** M

## Task 6: Integrazione su HTTP
**Descrizione:** `tests/integration/tablet-kiosk.test.ts` con le credenziali del seed (dispositivo e
operatori creati e tolti dal test dove serve, per lasciare intatto il seed degli E2E): il token del
dispositivo senza cassiere legge 0 righe e non scrive; 10 `unlock_cashier` concorrenti con PIN errato →
esattamente 5 contati, gli altri `locked`; `set_my_pin` dal telefono chiude il turno aperto sul dispositivo;
nessuna risposta contiene `pin_hash` o il PIN.
**Accettazione:**
- [x] Corsa sul blocco provata in parallelo (criterio 3)
- [x] Dispositivo senza cassiere: 0 righe e scrittura rifiutata su HTTP (criterio 1)
- [x] La chiave segreta locale solo nel codice di test
**Verifica:** `npm run test:integration`
**Dipendenze:** 5 · **File:** tests/integration/tablet-kiosk.test.ts · **Dimensione:** S

## Checkpoint A
- [ ] `db:test` e `test:integration` verdi; pgTAP degli altri moduli invariati
- [ ] Revisione `security-and-hardening`: forza bruta, corsa sul blocco, privilegi del dispositivo
      (diretti e via RPC), hash bcrypt, `search_path`, `security definer`; problemi risolti con test
- [ ] Domande aperte del piano riportate all'utente (forza bruta, password dell'account del bar)

## Task 7: Servizio della cassa e guardia del confine
**Descrizione:** `src/features/tablet-kiosk/types.ts` (`KioskService`, `Cashier`, `UnlockResult` della spec,
`SetPinResult`), `supabaseKioskService.ts` (`listCashiers`, `unlock`, `endTurn`, `setMyPin`; `serverFaultFor`
per primo → `ServerFaultError`; `42501` dell'app → `forbidden`; `22023` → `invalid`; `TypeError` di fetch →
`network`; `turn_expires_at` → `Date`). `scripts/kioskBoundary.test.ts`: solo il servizio nomina le quattro
RPC e usa `getSupabase()`; solo `main.tsx` lo importa; nessun `console.*`, `localStorage`, `sessionStorage`
nel modulo; ogni `errcode` sollevato da `*_tablet_kiosk.sql` ha una traduzione.
**Accettazione:**
- [x] Unità con client finto: ogni esito di `unlock` mappato; i secondi del blocco passati come arrivano
- [x] La guardia fallisce se un componente chiama Supabase o se il modulo logga o salva in storage
**Verifica:** `npm test -- tablet-kiosk kioskBoundary`
**Dipendenze:** 5 · **File:** src/features/tablet-kiosk/types.ts, supabaseKioskService.ts (+ .test.ts),
scripts/kioskBoundary.test.ts · **Dimensione:** M

## Task 8: Finto, provider e collegamento
**Descrizione:** `src/test/fakeKioskService.ts` (operatori con e senza PIN, contatore e blocco come il
server, scadenza del turno, rete giù, attesa controllabile, registro delle chiamate senza PIN in chiaro);
`KioskServiceProvider` / `useKioskService()`; `main.tsx` e `renderApp` (parametro facoltativo in coda: i test
esistenti restano invariati).
**Accettazione:**
- [x] Unità del finto: 5 errori → `locked`, giusto durante il blocco → `locked`, successo azzera
- [x] `renderApp` senza il nuovo parametro funziona come prima (suite verde senza modifiche)
**Verifica:** `npm test`
**Dipendenze:** 7 · **File:** src/test/fakeKioskService.ts (+ .test.ts),
src/features/tablet-kiosk/KioskServiceProvider.tsx, src/main.tsx, src/test/renderApp.tsx · **Dimensione:** M

## Task 9: Identità della sessione nel servizio di Auth
**Descrizione:** `AuthService.loadOperator(userId)` sostituito da `loadIdentity()` su
`app.get_session_identity()` (`SessionIdentity` = operatore con `hasPin` | dispositivo con cassiere,
`turnExpiresAt`, `lockSecondsLeft` | null), in `supabaseAuthService.ts` e in `fakeAuthService.ts`
(dispositivi e cassiere impostabili dai test). Gli errori come oggi (`ServerFaultError`, rete).
**Accettazione:**
- [x] Unità del servizio Supabase: tre forme di risposta mappate; guasto e rete come prima
- [x] Il finto riproduce operatore, dispositivo senza cassiere, con cassiere e turno scaduto
**Verifica:** `npm test -- identity fakeAuthService`
**Dipendenze:** 5 · **File:** src/features/identity/types.ts, supabaseAuthService.ts (+ .test.ts),
src/test/fakeAuthService.ts · **Dimensione:** M

## Task 10: Stato "device" in `AuthProvider`
**Descrizione:** `AuthState` con `{ status: 'device', device, cashier, turnExpiresAt, lockSecondsLeft }`;
`useCurrentOperator()` restituisce il cassiere; `useSession`/hook nuovi `useDevice()` e
`refreshIdentity()`; `reportNotEnabled()` su un dispositivo rilegge l'identità e azzera il cassiere invece di
chiudere la sessione; `signOut` resta per "Disconnetti il tablet". Dopo `signIn` con un dispositivo lo stato è
`device`.
**Accettazione:**
- [x] Componente: dispositivo senza cassiere, con cassiere (operatore corrente = cassiere), turno finito
      dopo `reportNotEnabled()`; utente senza profilo → `/accedi` "Account non abilitato" (regressione)
- [x] Test esistenti di `AuthProvider` verdi senza cambiare le aspettative
**Verifica:** `npm test -- AuthProvider`
**Dipendenze:** 9 · **File:** src/features/identity/AuthProvider.tsx (+ .test.tsx) · **Dimensione:** M

## Task 11: Guardia del cassiere e rotte
**Descrizione:** `RequireCashier` (dentro `RequireAuth`): dispositivo senza turno valido → `/cassa` (con
"Turno scaduto: inserisci di nuovo il PIN" se c'era un cassiere); `refreshIdentity()` a ogni cambio di rotta
e a `visibilitychange`; timer su `turnExpiresAt`. `SettingsProvider` e `CardReaderSession` montati solo sotto
la guardia con `key` = cassiere (nessuna lettura card su `/cassa`). Rotta `/cassa` (segnaposto fino al task
13): operatore → `/`.
**Accettazione:**
- [x] Componente: dispositivo senza cassiere su `/` → `/cassa`; turno scaduto al cambio di rotta e all'ora
      di scadenza (timer finti) → `/cassa` con il messaggio; `reportNotEnabled()` su dispositivo → `/cassa`,
      su operatore → `/accedi` (regressione identity)
- [x] Componente: su `/cassa` l'adattatore USB resta spento (`usb.enabled` falso); con turno valido acceso
      con il formato delle impostazioni (criterio 5)
- [x] Turno chiuso da un nuovo PIN altrove → `/cassa` alla rotta successiva (criterio 4, con il finto)
**Verifica:** `npm test -- RequireAuth RequireCashier routes`
**Dipendenze:** 8, 10 · **File:** src/features/tablet-kiosk/RequireCashier.tsx (+ .test.tsx),
src/features/identity/RequireAuth.tsx (+ .test.tsx), src/app/routes.tsx · **Dimensione:** M

## Checkpoint B
- [ ] Quality bar completa verde; comportamento del telefono invariato (E2E `phone` verdi)
- [ ] Revisione con l'utente prima della UI della cassa

## Task 12: Tastierino del PIN e layout tablet
**Descrizione:** `PinPad` (`aria-label="Tastierino PIN"`, 1–9, 0, "Cancella ultima cifra", tasti alti 88 px,
disattivabile; 4 pallini `role="img"` con "N cifre su 4 inserite") riusabile da `/cassa` e
`/impostazioni/pin`; `useTabletLayout()` su `matchMedia('(min-width: 1024px) and (min-height: 600px)')`.
Solo componenti e token del design system; il PIN vive solo nello stato React.
**Accettazione:**
- [x] Componente: tocchi e cancellazione, pallini con l'etichetta giusta, `onComplete` alla 4ª cifra una
      sola volta, disattivato non accetta tocchi
- [x] `useTabletLayout` con `matchMedia` finto, aggiornato al cambio; test CSS: tasti ≥ 88 px
- [x] Detector Impeccable pulito; glifi Display verificati
**Nota:** i pallini sono un `<svg role="img">` (lint `prefer-tag-over-role`); con una cifra l'etichetta è
"1 cifra su 4 inserita". `PinPad` è controllato (`value`/`onChange`/`onComplete`/`disabled`): chi lo usa
svuota il PIN rimettendo `value` a `''`.
**Verifica:** `npm test -- PinPad useTabletLayout`
**Dipendenze:** 11 · **File:** src/features/tablet-kiosk/PinPad.tsx (+ .module.css, .test.tsx),
useTabletLayout.ts (+ .test.ts) · **Dimensione:** M

## Task 13: "Chi è alla cassa?"
**Descrizione:** `CashierPage` su `/cassa` come il wireframe "Tablet: cambio operatore": intestazione senza
cassiere e senza account; gruppo `aria-label="Operatori"` a 3 colonne di pulsanti `aria-pressed` (iniziale,
nome, ruolo) in ordine alfabetico, nessuno scelto ("Tocca il tuo nome", tastierino disattivato); scegliere un
altro nome svuota il PIN; testo esplicativo; `<aside aria-label="PIN">` largo 480 con "PIN di <nome>" e la
nota sui 5 errori. Verifica automatica alla 4ª cifra; ogni `keydown` fermato in cattura. Stati: caricamento,
nessuno col PIN, operatore senza PIN disattivato ("PIN da impostare dal telefono"), errato ("PIN errato.
Tentativi rimasti: N"), bloccato ("Troppi tentativi: riprova tra m:ss" dai secondi del server, anche
all'apertura se `lockSecondsLeft` > 0), rete ("Connessione assente. Riprova.", nessun reinvio). Successo →
`refreshIdentity()` → `/`.
**Accettazione:**
- [x] Componente: selezione e cambio nome, invio alla 4ª cifra, errato, bloccato con conto alla rovescia a
      timer finti, rete, nessun PIN, operatore senza PIN disattivato (criterio 3)
- [x] Componente: cifre e Invio da tastiera fisica, anche con un pulsante a fuoco, non cambiano nulla
      (criterio 5)
- [x] Detector Impeccable pulito; confronto 1280×800 con "Tablet: cambio operatore"
**Nota:** il blocco dei tasti è `useBlockedKeys` in `src/features/card-input/` (keydown, keypress e keyup su
`window` in cattura): `scripts/cardInputBoundary.test.ts` tiene lì gli ascoltatori di tastiera su
`document`/`window`. "Chi è alla cassa?" è un `h2` sotto il logo `h1`, come nel wireframe; i gruppi sono
`<fieldset>` (lint `prefer-tag-over-role`). Il conto alla rovescia scala di un secondo alla volta i secondi
del server; all'arrivo la pagina rilegge l'identità (un blocco di una lettura vecchia non resta).
`routes.tsx` era già pronto dal Task 11.
**Verifica:** `npm test -- CashierPage`
**Dipendenze:** 12 · **File:** src/features/tablet-kiosk/CashierPage.tsx (+ .module.css, .test.tsx),
src/app/routes.tsx · **Dimensione:** M

## Task 14: Cassiere nell'intestazione
**Descrizione:** `CashierChip` "Alla cassa: <nome> · Cambia" (iniziale nel cerchio, alto 48 px) nell'header
delle schermate tablet con intestazione; pulsante account con `aria-label` "Account e impostazioni: <nome>".
"Cambia" → `endTurn()` → `/cassa` anche se la chiamata fallisce. `AppShell` riceve il chip solo in una
sessione di dispositivo; sul telefono invariato.
**Accettazione:**
- [x] Componente: testo e etichette; "Cambia" chiama `endTurn` e porta a `/cassa` (criterio 2), anche con
      rete giù
- [x] `AppShell.test.tsx` esistente verde senza modifiche alle aspettative
- [x] Detector Impeccable pulito; target ≥ 48 px
**Verifica:** `npm test -- CashierChip AppShell`
**Dipendenze:** 13 · **File:** src/features/tablet-kiosk/CashierChip.tsx (+ .module.css, .test.tsx),
src/app/AppShell.tsx (+ .module.css) · **Dimensione:** M

## Task 15: Accesso sul tablet
**Descrizione:** `/accedi` con layout tablet (wireframe "Tablet: accesso") e la nota "Sul tablet della cassa
si accede una volta con l'account del bar; poi ognuno si alterna con il proprio PIN." solo nel layout tablet;
dopo l'accesso un dispositivo va a `/cassa`, un operatore a `/` (o alla pagina richiesta) come oggi.
**Accettazione:**
- [x] Componente: nota assente a 390 e presente con `matchMedia` tablet; dispositivo → `/cassa` (criterio 1)
- [x] Test esistenti di `LoginPage` verdi; "Password dimenticata?" invariato
- [x] Detector Impeccable pulito
**Verifica:** `npm test -- LoginPage`
**Dipendenze:** 11, 12 · **File:** src/features/identity/LoginPage.tsx (+ .module.css, .test.tsx)
· **Dimensione:** S

## Task 16: E2E del tablet: dalla cassa alla spesa
**Descrizione:** `playwright.config.ts`: progetto `tablet` (1280×800, `testMatch: /tablet.*\.spec\.ts$/`,
escluso dal progetto `phone`). `e2e/tablet.spec.ts`: accesso con `cassa@example.com` → `/cassa` → PIN →
card letta con `page.keyboard` (sequenza rapida + Invio, adattatore USB reale) e con `__enjoyFakeCard` →
spesa → nel movimento c'è il cassiere; "Cambia" → `/cassa`; card passata su `/cassa` senza effetti né cifre;
5 PIN errati con `cassa-blocco@example.com` → bloccato anche dopo il ricaricamento, 6° giusto rifiutato;
cronometro dalla lettura alla conferma < 10 s.
**Accettazione:**
- [x] Criteri 1, 2, 3, 5 e 6 provati in E2E; il progetto `phone` esegue gli stessi test di prima
- [x] Helper di accesso del dispositivo in `e2e/auth.ts`; nessun account reale
**Verifica:** `npm run e2e`
**Dipendenze:** 13, 14, 15 · **File:** playwright.config.ts, e2e/tablet.spec.ts, e2e/auth.ts,
e2e/db.ts (psql nel container locale: le righe di `app.devices` non passano dall'API)
· **Dimensione:** M

## Checkpoint C
- [x] Flusso cassa → PIN → card → spesa → Cambia verde in E2E
- [ ] Detector Impeccable pulito; screenshot 1280×800 confrontato con "Tablet: cambio operatore"

## Task 17: PIN dal proprio telefono
**Descrizione:** nella sezione ACCOUNT di Impostazioni (entrambi i ruoli, sotto "Cambia password") riga "PIN
della cassa" con "Impostato" / "Da impostare" (da `hasPin` dell'identità) → `/impostazioni/pin`:
`PinPad`, "Scegli il PIN" poi "Ripeti il PIN"; diversi → "I due PIN sono diversi" e si ricomincia; salvato →
"PIN salvato" e ritorno a Impostazioni (identità riletta); rete → "Connessione assente. Riprova." con il PIN
da reinserire. In una sessione di dispositivo `/impostazioni/pin` → `/`.
**Accettazione:**
- [x] Componente: ripetizione diversa, salvato, rete, assente su dispositivo (criterio 4)
- [x] Ordine delle sezioni di `SettingsPage.test.tsx` invariato (cross-review §1)
- [x] Detector Impeccable pulito; confronto a 390×844 con lo stile di Impostazioni
**Nota:** `hasPin` arriva nello stato `signed-in` di `AuthProvider`; "PIN salvato." è un avviso di
navigazione (`NavigationNotice`) dentro la sezione ACCOUNT, così l'ordine dei figli di `main` non cambia; la
riga compare solo con un account operatore (sul dispositivo la toglie già questo task, il Task 18 lo prova).
**Verifica:** `npm test -- PinSettingsPage SettingsPage`
**Dipendenze:** 12 · **File:** src/features/tablet-kiosk/PinSettingsPage.tsx (+ .module.css, .test.tsx),
src/features/identity/SettingsPage.tsx, src/app/routes.tsx · **Dimensione:** M

## Task 18: Impostazioni sul tablet
**Descrizione:** in una sessione di dispositivo (wireframe "Tablet: impostazioni"): il riquadro account
mostra il cassiere; "Esci" chiude il turno e porta a `/cassa` (non scollega); niente "Cambia password" né "PIN
della cassa"; solo con cassiere amministratore "Disconnetti il tablet" con `ConfirmDialog` pericoloso ("Per
riaccedere servono email e password dell'account del bar") → `signOut` → `/accedi`. Impostazioni complete o
ridotte secondo il ruolo del cassiere (già da `useCurrentOperator`).
**Accettazione:**
- [x] Componente: senza "Cambia password" e "PIN della cassa" sul dispositivo; "Esci" → `endTurn` →
      `/cassa`; "Disconnetti il tablet" solo con cassiere admin, con conferma
- [x] Test esistenti di `SettingsPage` (telefono) verdi senza modifiche alle aspettative
- [x] Detector Impeccable pulito
**Verifica:** `npm test -- SettingsPage`
**Dipendenze:** 14, 17 · **File:** src/features/identity/SettingsPage.tsx (+ .module.css, .test.tsx),
src/features/tablet-kiosk/DisconnectTabletButton.tsx · **Dimensione:** M

## Task 19: Sezione "LETTORE CARD"
**Descrizione:** `UsbFormatSection` tra GESTIONE ed ESPORTA DATI, solo in una sessione di dispositivo con
cassiere amministratore: scelta tra "Esadecimale", "Esadecimale, byte invertiti", "Decimale", "Decimale, byte
invertiti" e "Salva"; salva con `update_settings` passando rapporto e soglia appena riletti dal server
(servizio di `settings`, nessuna chiamata diretta); vale dalla lettura successiva.
**Accettazione:**
- [ ] Componente: assente sul telefono e con cassiere operatore; salva il formato senza toccare rapporto e
      soglia; `forbidden` → `reportNotEnabled()`
- [ ] Ordine delle sezioni del tablet coerente con cross-review §1
- [ ] Detector Impeccable pulito; glifi Display verificati
**Verifica:** `npm test -- UsbFormatSection SettingsPage`
**Dipendenze:** 18 · **File:** src/features/tablet-kiosk/UsbFormatSection.tsx (+ .module.css, .test.tsx),
src/features/identity/SettingsPage.tsx · **Dimensione:** M

## Task 20: E2E del PIN dal telefono e del formato del lettore
**Descrizione:** `e2e/tablet-pin.spec.ts` (progetto `tablet`, contesto telefono 390×844 nello stesso test):
l'operatore riservato imposta il PIN da Impostazioni sul telefono, il tablet lo usa subito; un secondo PIN
dal telefono chiude il turno e il tablet torna a `/cassa` alla rotta successiva. `e2e/tablet-settings.spec.ts`
in un progetto seriale `tablet-settings` dopo `phone-settings`: cassiere admin cambia il formato in
"Decimale", una lettura decimale da `page.keyboard` trova la card, poi rimette "Esadecimale".
**Accettazione:**
- [ ] Criterio 4 provato in E2E
- [ ] Formato ripristinato a fine test anche in caso di errore (`afterAll`)
- [ ] Nessun test del progetto `phone` modificato
**Verifica:** `npm run e2e`
**Dipendenze:** 16, 17, 19 · **File:** e2e/tablet-pin.spec.ts, e2e/tablet-settings.spec.ts,
playwright.config.ts · **Dimensione:** M

## Checkpoint D
- [ ] Revisione `security-and-hardening` del client: PIN mai in log, URL, storage o registro dei finti;
      `keydown` fermati su `/cassa`; guardia del cassiere; "Disconnetti il tablet" solo admin
- [ ] Quality bar completa verde

## Task 21: Cerca a 1280×800
**Descrizione:** `HomePage` con layout tablet (wireframe "Tablet: cerca cliente"): colonna "Passa la card sul
lettore" larga 440 con `CardReadPanel mode="usb"` e i testi del wireframe, accanto ricerca, "Nuovo cliente",
SERVITI OGGI. Indicatore "Lettore USB pronto"; se `usb.lastInvalidAt` è più recente di `usb.lastReadAt`
"Codice non riconosciuto: controlla il formato del lettore in Impostazioni".
**Accettazione:**
- [ ] Componente con `matchMedia` tablet: testi del wireframe, indicatore nei due stati; lettura nota →
      Registra spesa, sconosciuta → Nuovo cliente con card (criterio 5)
- [ ] `HomePage.test.tsx` del telefono invariato
- [ ] Detector Impeccable pulito; confronto con "Tablet: cerca cliente"
**Verifica:** `npm test -- HomePage`
**Dipendenze:** 16 · **File:** src/features/customers/HomePage.tsx (+ .module.css, .test.tsx),
src/features/tablet-kiosk/UsbReaderStatus.tsx · **Dimensione:** M

## Task 22: Scheda cliente e Movimenti a 1280×800
**Descrizione:** Scheda cliente: saldo e azioni a sinistra (560), ultimi movimenti a destra; Movimenti: una
colonna larga. Solo CSS e composizione; testi, stati e azioni dei moduli proprietari invariati; azioni lontane
dal bordo inferiore.
**Accettazione:**
- [ ] Componente con `matchMedia` tablet: le due colonne presenti con i ruoli e le etichette di prima
- [ ] Test del telefono invariati; detector Impeccable pulito; confronto con i wireframe
**Verifica:** `npm test -- CustomerPage MovementsPage`
**Dipendenze:** 21 · **File:** src/features/customers/CustomerPage.tsx (+ .module.css),
src/features/ledger/CustomerLedgerSection.module.css, src/features/ledger/MovementsPage.module.css
· **Dimensione:** M

## Task 23: Spesa, Premio libero e Riscatta premio a 1280×800
**Descrizione:** Registra spesa e Premio libero: importo/punti a sinistra, tastierino a destra (480; la spesa
con "00"); Riscatta premio: catalogo + riepilogo (400). Solo CSS e composizione.
**Accettazione:**
- [ ] Componente con `matchMedia` tablet: tastierino nella colonna destra; riepilogo del riscatto a destra
- [ ] `scripts/amountKeypadCss.test.ts` e test del telefono invariati; detector Impeccable pulito
**Verifica:** `npm test -- PurchasePage RedeemPage FreeRewardForm amountKeypadCss`
**Dipendenze:** 21 · **File:** src/features/ledger/PurchasePage.module.css, FreeRewardForm.module.css,
RedeemPage.module.css, AmountKeypad.module.css, PurchasePage.test.tsx · **Dimensione:** M

## Task 24: Nuovo cliente, Associa card, Catalogo premi e conferme a 1280×800
**Descrizione:** Nuovo cliente: form + pannello `aria-label="Card"` largo 440 con "Card (facoltativa)" /
"Passa una card nuova sul lettore per associarla adesso, oppure fallo più tardi dalla scheda."; Associa card
"Passa la card nuova sul lettore" (`mode="usb"`); Catalogo premi: elenco + "Nuovo premio" (480); Spesa e
Premio registrato senza intestazione, colonna larga. Il link ai punti resta "non scritto" (il lettore USB non
scrive).
**Accettazione:**
- [ ] Componente con `matchMedia` tablet: testi USB del wireframe; card sconosciuta letta in Nuovo cliente
      associata (criterio 5)
- [ ] Test del telefono invariati; detector Impeccable pulito
**Verifica:** `npm test -- NewCustomerCardPanel AssociateCardPage RewardsCatalogPage LedgerDoneView`
**Dipendenze:** 21 · **File:** src/features/cards/NewCustomerCardPanel.tsx (+ .module.css),
src/features/cards/AssociateCardPage.tsx, src/features/rewards/RewardsCatalogPage.module.css,
src/features/ledger/LedgerDoneView.module.css · **Dimensione:** M

## Task 25: E2E dei layout a 1280×800
**Descrizione:** `e2e/tablet-layout.spec.ts`: per ogni schermata della pagina tablet dei wireframe (Cerca,
Scheda, Registra spesa, Premio libero, Riscatta, Nuovo cliente, Associa card, Catalogo, Movimenti,
Spesa/Premio registrato, Impostazioni, `/cassa`, accesso) larghezze delle colonne del punto 10 (tolleranza di
pochi px), `scrollWidth <= clientWidth`, ogni elemento interattivo ≥ 48 px; screenshot confrontati a mano con i
wireframe.
**Accettazione:**
- [ ] Criterio 7 provato in E2E; progetto `phone` invariato e verde
- [ ] Detector Impeccable pulito su `src/features`
**Verifica:** `npm run e2e`; `npx impeccable detect src/features`
**Dipendenze:** 22, 23, 24 · **File:** e2e/tablet-layout.spec.ts, e2e/auth.ts · **Dimensione:** M

## Checkpoint E
- [ ] Ogni schermata Tablet-* confrontata a 1280×800; azioni principali lontane dal bordo inferiore
- [ ] E2E `phone` e `phone-settings` invariati e verdi

## Task 26: Documentazione
**Descrizione:** `docs/setup-tablet.md` (installazione PWA, accesso con l'account del bar, prova del lettore e
del formato dell'uid, "Mostra tastiera virtuale" di Android, densità reale dello schermo);
`docs/setup-accounts.md` (creare e togliere un dispositivo con `private.add_device`); RUNBOOK (procedura e
trappole trovate); CLAUDE.md (progetto Playwright `tablet`, rotte `/cassa` e `/impostazioni/pin`);
`brain/MAP.md`.
**Accettazione:**
- [ ] Ogni passo indica la schermata di Supabase o la riga SQL; nessun segreto né dato reale
- [ ] Differenze dal contratto (`/impostazioni/pin`) e da identity (PIN in `private`) richiamate dove servono
**Verifica:** rilettura; `npm run format:check`
**Dipendenze:** 25 · **File:** docs/setup-tablet.md, docs/setup-accounts.md,
brain/topics/operations/RUNBOOK.md, CLAUDE.md, brain/MAP.md · **Dimensione:** M

## Task 27: Verifica dei criteri di successo e PR
**Descrizione:** tabella "Verifica dei criteri di successo" in `plan.md` (criterio → `file › titolo del
test`) e `scripts/kioskCriteria.test.ts` che controlla che i criteri 1–8 abbiano almeno una prova esistente
nel file indicato. Quality bar completa più `npm run build && npm run check:bundle`. PR da `feat/tablet-kiosk`
su base `main`, da unire dopo #22; `brain/STATUS.md` e `brain/HANDOFF.md` aggiornati.
**Accettazione:**
- [ ] Ogni criterio ha almeno una prova verificata dallo script
- [ ] CI verde sulla PR (pgTAP, componenti, integrazione, E2E telefono + tablet: criterio 8)
- [ ] Nessuna pubblicazione su progetti remoti (la fa l'orchestratore)
**Verifica:** `npm test -- kioskCriteria`; CI su GitHub
**Dipendenze:** 26 · **File:** tasks/tablet-kiosk/plan.md, tasks/tablet-kiosk/todo.md,
scripts/kioskCriteria.test.ts, brain/STATUS.md, brain/HANDOFF.md · **Dimensione:** M

## Checkpoint F
- [ ] Gli 8 criteri di successo di SPEC-tablet-kiosk verificati
- [ ] PR su `main` pronta per `code-review-and-quality`, da unire dopo #22
- [ ] Prova sul tablet vero con il lettore USB, con l'utente, dopo la pubblicazione su staging
