# Todo: operators

Fonte: [plan.md](plan.md) · Spec: [SPEC-operators.md](../../docs/specs/SPEC-operators.md). Ogni task chiude
con la quality bar completa verde (`npm run typecheck && npm run lint && npm run format:check && npm test &&
npm run db:test && npm run test:integration && npm run e2e`) e un commit Conventional Commits sul branch
`feat/operators`, solo con i file del task, che termina con
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Test prima del codice
(`test-driven-development`). Solo lo stack Supabase locale (`npx supabase start -x
studio,imgproxy,storage-api,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta`, poi
`scripts/reload-auth-templates.sh`; dalla Fase 2 anche `npx supabase functions serve`); mai
`--linked`/`--remote`, mai `functions deploy`. Nessun test indebolito, saltato o cancellato; nessuna
soppressione di lint senza una riga di motivazione. UI: componenti e token del design system, testi in
italiano, target ≥ 48 px, detector Impeccable risolto dopo ogni modifica. Solo `@example.com`, nessun segreto.

## Task 1: Disattivato = nessun accesso; seed riservato
**Descrizione:** `npx supabase migration new operators` (dopo `*_tablet_kiosk_pin_lock_order.sql`). Prima,
`grep` di `app.operators` in tutte le migrazioni per elencare i punti che trattano "collegato" come "attivo".
Colonne nuove di `app.operators` (`deactivated_at`, `deactivated_by`, `invited_at`, `invited_by`, check
`(deactivated_at is null) = (deactivated_by is null)`); `create or replace` con stessa firma e privilegi di
`private.current_operator_id()`, `private.valid_cashier_id()`, `app.get_session_identity()`,
`app.list_cashiers()`, `app.unlock_cashier()` (disattivato → `no_pin`), `private.add_operator()` (ricollegando
azzera `deactivated_at`/`_by`). Seed: `disattiva@example.com` "Disattiva Prova", `ruolo@example.com` "Ruolo
Prova" (operatori, con PIN finto), `admin-operatori@example.com` "Admin Operatori" (admin, con PIN finto),
tablet `cassa-operatori@example.com` "Tablet operatori".
**Accettazione:**
- [x] pgTAP (`operators_access.test.sql`): un profilo con `deactivated_at` impostato (scritto dal test come
      `postgres`) legge 0 righe da ogni tabella/vista `app`, ogni RPC di scrittura lo rifiuta col codice già
      in uso, `get_session_identity()` è null; come cassiere: assente da `list_cashiers`, `unlock_cashier` →
      `no_pin`, il dispositivo non legge nulla; azzerato `deactivated_at` tutto torna
- [x] pgTAP: `add_operator` su un profilo disattivato lo riattiva; conteggio e somma dei movimenti invariati
- [x] Tutti i pgTAP esistenti verdi senza modifiche; suite E2E e integrazione verdi col seed nuovo
**Verifica:** `npm run db:reset && npm run db:test && npm run e2e`
**Dipendenze:** nessuna · **File:** supabase/migrations/*_operators.sql, supabase/tests/operators_access.test.sql,
supabase/seed.sql · **Dimensione:** M

## Task 2: Elenco, ruolo e attivazione sul server
**Descrizione:** nella stessa migrazione: `app.list_operators()` (solo `is_admin()`, stati `active`/`invited`/
`deactivated`/`removed` con la regola "email confermata **e** password", `email`, `has_pin`, `is_me` da
`acting_operator_id()`, ordine `lower(name)`, `id`, disattivati in fondo, niente dispositivi, mai hash né
token); `app.set_operator_role(uuid, text)` e `app.set_operator_active(uuid, boolean)` con blocco ordinato di
bersaglio e admin attivi, poi `42501`, `P0002`, `EO002`, `EO003`, `EO005` (admin da un dispositivo), `EO001`
(almeno un altro admin attivo con invito accettato), scrittura idempotente; la disattivazione imposta
`deactivated_by` e chiude i turni di cassa della persona su tutti i tablet. Privilegi come
`20261117230000_function_privileges.sql`.
**Accettazione:**
- [x] pgTAP (`operators.test.sql`): `list_operators` → `42501` per operatore, dispositivo senza cassiere e con
      cassiere operatore; ok per cassiere admin con `is_me` sul cassiere; i quattro stati, `invited` anche con
      email confermata e password vuota
- [x] pgTAP: `EO002` su sé stessi, `EO003` su `removed`, `EO001` sull'ultimo admin (un admin `invited` non
      conta), `EO005` per `set_operator_role(…, 'admin')` dal cassiere admin, idempotenza, profilo restituito
      con la forma di `list_operators`; turno di cassa chiuso alla disattivazione; movimenti invariati
- [x] `function_privileges.test.sql` verde con le funzioni nuove
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 1 · **File:** supabase/migrations/*_operators.sql, supabase/tests/operators.test.sql,
supabase/tests/function_privileges.test.sql · **Dimensione:** M

## Task 3: Prenotazioni d'invito
**Descrizione:** `private.operator_invites` (colonne e indici unici parziali `pending` su `lower(email)` e
`lower(name)`, nessun privilegio per `anon`/`authenticated`); `app.operator_invite_begin(uuid, text, text,
text)` (risposte `jsonb` `proceed` con `invited_by_name` ed eventuali `existing_user_id`/`existing_confirmed`/
`existing_has_password`, `done`, `in_progress`, `name_taken`, `email_taken` con `deactivated`,
`email_is_device`; eccezioni `42501`, `EO005`, `22023`; pending altrui più vecchie di 2 minuti → `failed`);
`app.operator_invite_finish(uuid, uuid)` (blocca `auth.users`, controlla email, richiedente ancora admin,
unicità, crea o ricollega il profilo `removed` con lo stesso nome, idempotente), `_fail` (solo da `pending`),
`_orphan` (utente non confermato e non collegato): queste tre solo `service_role`.
**Accettazione:**
- [x] pgTAP (`operators_invites.test.sql`): ogni risposta di `_begin`; `22023` per lo stesso `operation_id` con
      dati diversi; altra operazione `pending` recente su stessa email o nome → `in_progress`, più vecchia di 2
      minuti → `proceed`; utente confermato non collegato → `proceed` con `existing_confirmed`
- [x] pgTAP: cassiere admin con ruolo `admin` → `EO005`, con `operator` → `proceed`; `_finish` due volte →
      stesso profilo, con email di `user_id` diversa → rifiutato, nome di un `removed` → ricollegato;
      `_fail` su `done` non cambia; `_orphan` falso per utente confermato o collegato
- [x] pgTAP: `_finish`/`_fail`/`_orphan` non eseguibili da `authenticated`; `private.operator_invites`
      illeggibile da `authenticated`
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 2 · **File:** supabase/migrations/*_operators.sql, supabase/tests/operators_invites.test.sql,
supabase/tests/function_privileges.test.sql · **Dimensione:** M

## Task 4: Reinvio e annullamento sul server
**Descrizione:** `app.operator_resend_begin(uuid)` (`42501`, `EO002`, `P0002`, `EO004` se non `invited`; restituisce
`user_id, email, name, role_label, invited_by_name, email_confirmed, requested_by`), `app.operator_resend_finish(
p_operator_id, p_requested_by)` (solo `service_role`: richiedente ancora admin, aggiorna `invited_by`/`invited_at`),
`app.operator_cancel_begin(uuid)` (stessi codici; `{ user_id, requested_by }`), `app.operator_cancel_check(uuid,
uuid, uuid)` (solo `service_role`: blocca `auth.users`, persona ancora `invited`, profilo ancora collegato,
richiedente ancora admin).
**Accettazione:**
- [x] pgTAP: `resend_begin` accetta un `invited` con email confermata e password vuota (`email_confirmed: true`),
      rifiuta `active`/`deactivated`/`removed` con `EO004` e sé stessi con `EO002`
- [x] pgTAP: `cancel_begin` solo per `invited`; `_cancel_check` falso se nel frattempo la persona ha accettato
      o il richiedente non è più admin; `_resend_finish` rifiutato se il richiedente è stato retrocesso
- [x] pgTAP: `_resend_finish` e `_cancel_check` non eseguibili da `authenticated`
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 3 · **File:** supabase/migrations/*_operators.sql, supabase/tests/operators_invites.test.sql,
supabase/tests/function_privileges.test.sql · **Dimensione:** S

## Task 5: Corse sul database
**Descrizione:** test di integrazione con due connessioni (come `ledger-concurrency.test.ts`): A retrocede B
mentre B retrocede A; disattivazione durante `unlock_cashier` dello stesso operatore; due
`operator_invite_begin` alla stessa email con `operation_id` diversi in parallelo. Utenti creati e tolti dal test.
**Accettazione:**
- [x] Corsa tra admin: una riesce, l'altra `42501`; resta almeno un admin attivo
- [x] Disattivazione contro sblocco: nessun deadlock; dopo la corsa il dispositivo non legge nulla e
      `get_session_identity()` dà cassiere nullo (non si verifica `cashier_operator_id`)
- [x] Inviti paralleli: uno `proceed`, l'altro `in_progress`
**Verifica:** `npm run test:integration -- operators-concurrency`
**Dipendenze:** 4 · **File:** tests/integration/operators-concurrency.test.ts, tests/integration/localSupabase.ts
· **Dimensione:** S

## Checkpoint A
- [ ] `db:test` e `test:integration` verdi; pgTAP dei moduli precedenti invariati
- [ ] Revisione `security-and-hardening` del database (helper, `search_path`, privilegi, ultimo admin,
      prenotazioni, `EO005`), problemi risolti con un test

## Task 6: Confine della funzione e strumenti
**Descrizione:** `supabase/functions/operator-invites/handler.ts`: `handle(request, deps)` con client e ambiente
iniettati; solo `POST`/`OPTIONS`; `Origin` in `APP_ORIGINS` (o modello `APP_PREVIEW_ORIGIN`) altrimenti 403
`forbidden_origin` senza chiamate; CORS con `corsHeaders` di `@supabase/supabase-js/cors` (mai `*`), `Vary:
Origin`; corpo oltre 4 KB, JSON o campi non validi → 400 `invalid_input`; `Authorization` assente → 401.
Strumenti: `supabase/functions/**/*.test.ts` in `test.include`, `tsconfig.functions.json` richiamato da
`npm run typecheck`.
**Accettazione:**
- [x] Unità: origine non ammessa → 403 senza chiamate; `OPTIONS` con `Allow-Headers` uguale a `corsHeaders`,
      `Allow-Origin` = origine ammessa e mai `*`; metodo, corpo e campi sbagliati → 400/405; nessun token → 401
- [x] `npm run typecheck` controlla `handler.ts` e il test; `handler.ts` non usa globali di Deno
**Verifica:** `npm test -- operator-invites && npm run typecheck`
**Dipendenze:** 4 · **File:** supabase/functions/operator-invites/handler.ts, handler.test.ts,
tsconfig.functions.json, vite.config.ts, package.json · **Dimensione:** M

## Task 7: Funzione servita in locale
**Descrizione:** `index.ts` (solo `Deno.serve`, lettura di `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`/
`SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEYS`/`SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGINS`, creazione dei client con
`persistSession: false, autoRefreshToken: false`); `deno.json` (import map a `@supabase/supabase-js@2.119.0` e
`/cors`); `[functions.operator-invites] verify_jwt = true` in `config.toml`; `supabase/functions/.env.example`
(solo `APP_ORIGINS`), `.env` ignorato (verificato con `git check-ignore`). Primo test di integrazione.
**Accettazione:**
- [x] Integrazione (`operators.test.ts`) con `functions serve`: chiave `anon` → 401/403 senza effetti; operatore
      → 403 `forbidden`; dispositivo senza cassiere → 403
- [x] `index.ts` fuori da tsc e lint; nessuna chiave nel repo
**Verifica:** `npx supabase functions serve` in background, poi `npm run test:integration -- operators`
**Dipendenze:** 6 · **File:** supabase/functions/operator-invites/index.ts, deno.json, supabase/config.toml,
supabase/functions/.env.example, tests/integration/operators.test.ts · **Dimensione:** M

## Task 8: Invito nel handler
**Descrizione:** `action: "invite"` nell'ordine della spec: `operator_invite_begin` col client del chiamante →
`updateUserById` se `existing_user_id` (password casuale di 32 byte se `existing_has_password`) →
`inviteUserByEmail` (`redirectTo` = `<Origin>/imposta-password`, `data: { name, invited_by, role_label }`) o
`resetPasswordForEmail` se `existing_confirmed` → `operator_invite_finish` col client amministrativo →
compensazione (`_fail`; `deleteUser` solo se utente nuovo **e** `_orphan` vero). Mappa degli esiti HTTP della
tabella del punto 5; log solo `operation_id`, azione ed esito.
**Accettazione:**
- [x] Unità: ordine begin → metadati → invito → finish; `done` → nessun invito; 429 → `rate_limited` e `_fail`;
      422 `email_exists` → `email_taken`; finish `name_taken` → `deleteUser` solo con utente nuovo e `_orphan`
      vero; `existing_confirmed` → `resetPasswordForEmail` con lo stesso `redirectTo`; `EO005` → 403
      `admin_from_device`; `redirectTo` mai dal corpo
- [x] Unità: nessuna email, token o messaggio di Auth nei log né nelle risposte
**Verifica:** `npm test -- operator-invites`
**Dipendenze:** 6 · **File:** supabase/functions/operator-invites/handler.ts, handler.test.ts · **Dimensione:** M

## Task 9: Reinvio e annullamento nel handler
**Descrizione:** `action: "resend"` (begin → metadati → invito o recupero secondo `email_confirmed` →
`operator_resend_finish(operator_id, requested_by)`) e `action: "cancel"` (begin → `operator_cancel_check` →
`deleteUser` solo con `true`, altrimenti 409 `not_invited`; 200 `cancelled`); `EO002` → 403 `self`, `EO004` →
409 `not_invited`.
**Accettazione:**
- [x] Unità: `_resend_finish` riceve il `requested_by` di `_resend_begin`; link di recupero se `email_confirmed`
- [x] Unità: `deleteUser` solo con `_cancel_check` vero; codici HTTP della tabella
**Verifica:** `npm test -- operator-invites`
**Dipendenze:** 8 · **File:** supabase/functions/operator-invites/handler.ts, handler.test.ts · **Dimensione:** S

## Task 10: Email d'invito reale
**Descrizione:** `supabase/templates/invite.html` (oggetto "Enjoy Card: il tuo invito", testi e link della
spec, colori di `recovery.html`, nessuna immagine esterna); `[auth.email.template.invite]` in `config.toml`;
`scripts/reload-auth-templates.sh` aspetta anche "reloaded template type: invite". Integrazione con Mailpit.
Passo CI: copia di `.env.example`, `functions serve` in background con attesa della risposta.
**Accettazione:**
- [x] Integrazione: invito reale → una email, un profilo `invited`, metadati corretti, link con
      `token_hash`, `type=invite` e frammento `nome`/`da`/`ruolo`
- [x] Integrazione: stesso `operation_id` due volte, anche in parallelo → una sola email e un solo profilo;
      email di un dispositivo → `email_is_device`; nome usato / email di un account → nessuna email
- [ ] CI verde con la funzione servita (passo già in `ci.yml` dal Task 7; la stessa sequenza è verde in
      locale: da confermare sulla PR)
**Verifica:** `./scripts/reload-auth-templates.sh && npm run test:integration -- operators`; CI sulla PR
**Dipendenze:** 7, 8 · **File:** supabase/templates/invite.html, supabase/config.toml,
scripts/reload-auth-templates.sh, tests/integration/operators.test.ts, .github/workflows/ci.yml
· **Dimensione:** M

## Task 11: Reinvio e annullamento reali
**Descrizione:** integrazione contro lo stack locale e Mailpit per reinvio e annullamento.
**Accettazione:**
- [x] Reinvio → il token vecchio risponde `otp_expired`, il nuovo funziona
- [ ] Token verificato senza salvare la password → la persona resta `invited`, il reinvio le manda un link che
      funziona
      (aperto, da decidere: GoTrue dà una password temporanea casuale a chi verifica il token d'invito senza
      password, quindi la regola "email confermata e password" del punto 2 la legge `active` e il reinvio
      risponde 409 `not_invited`; il test di `operators.test.ts` fissa questo comportamento reale)
- [x] Annullamento → il link già spedito non funziona, profilo `removed`; un nuovo invito con lo stesso nome lo
      ricollega
**Verifica:** `npm run test:integration -- operators`
**Dipendenze:** 9, 10 · **File:** tests/integration/operators.test.ts, e2e/mailpit.ts (se serve un helper
condiviso) · **Dimensione:** S

## Checkpoint B
- [ ] Unità della funzione e integrazione verdi in locale e in CI
- [ ] Revisione `security-and-hardening`: chiave segreta solo in `index.ts` dall'ambiente, origine e CORS,
      `redirectTo`, compensazione, nessuna email nei log, `user_metadata` mai usato per autorizzare

## Task 12: Servizio del modulo e confine
**Descrizione:** `src/features/operators/types.ts` (`Operator`, `OperatorStatus`, `InviteResult`, risultati di
ruolo, attivazione, reinvio, annullamento come unioni discriminate); `supabaseOperatorsService.ts` (RPC e
`functions.invoke('operator-invites')`, `serverFaultFor` per primo, mappa codici → risultati: `EO001`–`EO005`,
`42501`, rete, `upstream`). Guardia `scripts/operatorsBoundary.test.ts`.
**Accettazione:**
- [x] Test del servizio con client finto: ogni codice e ogni esito HTTP della spec mappato; rete →
      `network`
- [x] Guardia: solo questo file nomina le RPC e la funzione; niente `getSupabase()` nelle pagine, `console.*`,
      `localStorage`/`sessionStorage`, email in URL; `src/` non nomina `service_role`, `SUPABASE_SECRET_KEYS`,
      `auth.admin`
**Verifica:** `npm test -- operators`
**Dipendenze:** 5, 9 · **File:** src/features/operators/types.ts, supabaseOperatorsService.ts,
supabaseOperatorsService.test.ts, scripts/operatorsBoundary.test.ts · **Dimensione:** M

## Task 13: Finto e provider
**Descrizione:** `src/test/fakeOperatorsService.ts` (regole del server in memoria: stati, ultimo admin, sé
stessi, `operation_id`, `admin-from-device`, rete giù, registro delle chiamate); `OperatorsServiceProvider` e
`useOperatorsService()`; montato in `main.tsx` e in `renderApp` (parametro facoltativo in coda).
**Accettazione:**
- [x] Test del finto: stesse risposte del server per i casi della spec
- [x] Test del provider: errore chiaro senza provider; `renderApp` esistente invariato per gli altri moduli
**Verifica:** `npm test`
**Dipendenze:** 12 · **File:** src/test/fakeOperatorsService.ts (+ .test.ts),
src/features/operators/OperatorsServiceProvider.tsx (+ .test.tsx), src/main.tsx, src/test/renderApp.tsx
· **Dimensione:** M

## Task 14: Guscio `Dialog`
**Descrizione:** `src/shared/ui/Dialog.tsx` estratto da `ConfirmDialog` (`showModal`, focus restituito, Esc,
titolo, `children`, "Chiudi"); `ConfirmDialog` ricostruito sopra; esempio in `/dev/ui`.
**Accettazione:**
- [x] Test di `Dialog`: focus restituito, Esc chiude, titolo accessibile
- [x] `ConfirmDialog.test.tsx` invariato e verde; stesso aspetto (nessun token nuovo); Impeccable pulito
**Verifica:** `npm test -- Dialog`
**Dipendenze:** nessuna · **File:** src/shared/ui/Dialog.tsx (+ .module.css, .test.tsx),
src/shared/ui/ConfirmDialog.tsx, src/app/dev/UiGallery.tsx · **Dimensione:** M

## Task 15: `AdminsOnly`, riga in GESTIONE e rotta
**Descrizione:** `AdminsOnly` spostato in `src/shared/ui/AdminsOnly.tsx` e usato da `RewardsCatalogPage`;
`OperatorsSettingsRow` ("Operatori" / "Account, ruoli e inviti") esportata da `operators` e mostrata da
`RewardsSettingsSection` come primo `<li>` (commento "riga Operatori rinviata" aggiornato); rotta
`/impostazioni/operatori` con `OperatorsPage` minima (`AppShell` "Operatori", Indietro → `/impostazioni`).
**Accettazione:**
- [x] Test di rewards invariati; test di `AdminsOnly` condiviso
- [x] Componente: la riga è prima di "Catalogo premi", solo per gli admin; tocco → `/impostazioni/operatori`
**Verifica:** `npm test`
**Dipendenze:** 13 · **File:** src/shared/ui/AdminsOnly.tsx (+ test), src/features/rewards/RewardsCatalogPage.tsx,
src/features/operators/OperatorsSettingsRow.tsx, src/features/rewards/RewardsSettingsSection.tsx (+ test),
src/app/routes.tsx · **Dimensione:** M

## Checkpoint C
- [ ] Quality bar completa verde; test di rewards e di `ConfirmDialog` invariati nel comportamento
- [ ] Revisione con l'utente prima della schermata

## Task 16: Elenco degli operatori
**Descrizione:** `OperatorsPage` come nel wireframe "Operatori": `<ul>` con righe ≥ 64 px (iniziale nel
cerchio, tratteggiata per i disattivati), nome, "ruolo · stato" dei testi della spec, "(tu)" senza azioni né
tocco, ordine del server; `StatusView` di caricamento ed errore con "Riprova"; regione `aria-live="polite"`
dei messaggi; operatore → `AdminsOnly`; `forbidden` → `reportNotEnabled()`.
**Accettazione:**
- [x] Componente: quattro stati con i testi giusti; "(tu)" senza pulsanti; errore e "Riprova"; operatore →
      vista "solo amministratori"
- [x] Impeccable pulito; screenshot 390×844 confrontato con il wireframe; glifi Display verificati
**Verifica:** `npm test -- operators`
**Dipendenze:** 15 · **File:** src/features/operators/OperatorsPage.tsx (+ .module.css, .test.tsx),
OperatorRow.tsx (+ .module.css) · **Dimensione:** M

## Task 17: Disattiva e Riattiva
**Descrizione:** "Disattiva" (stile pericoloso, 48 px) e "Riattiva" (secondario) con `ConfirmDialog` dei testi
della spec; esiti "{nome} è disattivato." / "{nome} è di nuovo attivo."; `EO001`, `EO002`, `upstream` nel
dialogo; elenco ricaricato dal server dopo ogni azione riuscita.
**Accettazione:**
- [ ] Componente: conferma, esito nella regione live, elenco ricaricato; `last_admin` col testo del punto 6;
      `removed` senza azioni
**Verifica:** `npm test -- operators`
**Dipendenze:** 16 · **File:** src/features/operators/OperatorRow.tsx, OperatorsPage.tsx, OperatorsPage.test.tsx
· **Dimensione:** S

## Task 18: Dialogo persona
**Descrizione:** `OperatorDialog` sul guscio `Dialog`: email e stato; `fieldset` "Ruolo" con "Salva ruolo"
attivo solo se cambia e seconda conferma (promozione/retrocessione); "Reinvia invito" con la nota e "Annulla
invito" con seconda conferma solo per `invited`; per `deactivated` solo email e stato; errori nel dialogo;
esiti nella regione live.
**Accettazione:**
- [ ] Componente: promozione e retrocessione con i testi della spec; reinvio e annullamento solo per `invited`;
      `not_invited`, `last_admin`, `upstream` nel dialogo; elenco ricaricato
- [ ] Focus restituito alla riga alla chiusura; Impeccable pulito
**Verifica:** `npm test -- operators`
**Dipendenze:** 14, 17 · **File:** src/features/operators/OperatorDialog.tsx (+ .module.css, .test.tsx),
OperatorRow.tsx · **Dimensione:** M

## Task 19: Invita operatore
**Descrizione:** `InviteForm` in fondo alla pagina (sezione con `aria-labelledby`): Nome, Email, `fieldset`
Ruolo ("Operatore" di default), "Invia invito" `busy`, nota; validazioni locali e pulizia del nome come
`private.clean_name`; `operation_id` con `crypto.randomUUID()` stabile finché i campi non cambiano (ref via
`useLatest`); errori del punto 6 nella posizione indicata; riuscito → modulo svuotato, messaggio, elenco
ricaricato.
**Accettazione:**
- [ ] Componente: ogni validazione; doppio tocco non parte; dopo `network` stesso `operation_id`, campi cambiati
      → id nuovo; ogni errore della tabella del punto 6 (`rate_limited` compreso) senza eccezioni
- [ ] Impeccable pulito; target ≥ 48 px
**Verifica:** `npm test -- operators`
**Dipendenze:** 16 · **File:** src/features/operators/InviteForm.tsx (+ .module.css, .test.tsx),
validateInvite.ts (+ .test.ts) · **Dimensione:** M

## Task 20: `/imposta-password` versione invito
**Descrizione:** `ResetPasswordPage` riconosce `type=invite`: testi da `URLSearchParams` del frammento (`nome`,
`da`, `ruolo` validati, altrimenti testi generici); errore solo con le chiavi `error`/`error_code` (in entrambe
le versioni); "Salva e accedi" → `verifyInvite` (`verifyOtp({ type: 'invite' })`) → `updatePassword` →
ricarica dell'identità → `/`; link scaduto → "Chiedi a chi ti ha invitato…" con "Vai all'accesso". Niente
campo Email (deviazione dichiarata).
**Accettazione:**
- [ ] Componente: "Ciao, {nome}" e testo con `da`/`ruolo`; valori non validi → testi generici; "Terrore" non fa
      scadere il link, `error_code` sì; link scaduto → "Vai all'accesso"; test del recupero invariati
- [ ] Servizio Supabase e finto: `verifyInvite` con `type: 'invite'`
**Verifica:** `npm test -- ResetPasswordPage supabaseAuthService`
**Dipendenze:** 13 · **File:** src/features/identity/ResetPasswordPage.tsx (+ .test.tsx),
supabaseAuthService.ts (+ test), types.ts, src/test/fakeAuthService.ts · **Dimensione:** M

## Task 21: Inoltro, nota di accesso, controllo a ogni rotta
**Descrizione:** `RootLayout` inoltra `/?token_hash=…&type=invite` a `/imposta-password` con query e frammento;
nota di `/accedi` del wireframe; l'identità si ricontrolla a ogni cambio di rotta anche per gli account
operatore (senza bloccare la schermata): risposta nulla → `/accedi` con "Account non abilitato…", ruolo
cambiato → sessione aggiornata.
**Accettazione:**
- [ ] Componente: inoltro con frammento conservato; nota di `/accedi`
- [ ] Componente: operatore disattivato → `/accedi` col messaggio al cambio di rotta; ruolo cambiato →
      Impostazioni ridotte o complete alla rotta successiva; test di `RequireAuth`/`RequireCashier` invariati
**Verifica:** `npm test -- identity RootLayout`
**Dipendenze:** 20 · **File:** src/app/RootLayout.tsx (+ test), src/features/identity/LoginPage.tsx (+ test),
src/features/identity/RequireAuth.tsx (+ test) · **Dimensione:** M

## Task 22: E2E telefono
**Descrizione:** `e2e/operators.spec.ts` (progetto `phone`, 390×844) con `admin-operatori@example.com`, invitati
`invito-<casuale>@example.com` e `e2e/mailpit.ts`.
**Accettazione:**
- [ ] Invito → una email in Mailpit → link → "Ciao, …" → password → home col ruolo scelto; nell'elenco
      "invito inviato" poi "attivo" (criteri 1, 2)
- [ ] Cambio ruolo di `ruolo@example.com` con la sua sessione aperta che vede le impostazioni del nuovo ruolo
      alla rotta successiva, poi ritorno al ruolo iniziale (criterio 6)
- [ ] Disattivazione di `disattiva@example.com` con una seconda sessione che al cambio di rotta torna su
      `/accedi` col messaggio, poi riattivazione e nuovo accesso con la stessa password (criterio 7)
**Verifica:** `npm run e2e -- operators`
**Dipendenze:** 10, 19, 21 · **File:** e2e/operators.spec.ts, e2e/mailpit.ts · **Dimensione:** M

## Checkpoint D
- [ ] Criteri 1–9 e 11 verdi; detector Impeccable pulito; confronto con i wireframe "Operatori", "Invito:
      scegli la password", "Accesso", "Impostazioni (amministratore)"
- [ ] Revisione `security-and-hardening` del client (sessioni disattivate, nessuna email in log/URL/storage,
      testi del frammento solo come testo)

## Task 23: Layout tablet
**Descrizione:** con `useTabletLayout()`: elenco a sinistra e `<aside aria-label="Invita operatore">` da 480 px
(`TabletColumns`); " · PIN impostato" / " · PIN da impostare" per `active` e `invited`; radio "Amministratore"
disabilitato con "Un amministratore si invita dal telefono." nel modulo e "Un amministratore si nomina dal
telefono." nel dialogo per chi è operatore; nota del modulo con il PIN; sottotitolo della riga "Account, ruoli,
inviti e PIN".
**Accettazione:**
- [ ] Componente (layout simulato): colonna, stati con PIN, radio disabilitato con le note, sottotitolo;
      `admin_from_device` col testo del punto 6
- [ ] Layout del telefono invariato
**Verifica:** `npm test -- operators`
**Dipendenze:** 18, 19 · **File:** src/features/operators/OperatorsPage.tsx (+ .module.css),
OperatorsPage.tablet.test.tsx, InviteForm.tsx, OperatorDialog.tsx · **Dimensione:** M

## Task 24: E2E tablet
**Descrizione:** `e2e/tablet-operators.spec.ts` (progetto `tablet`, 1280×800) col dispositivo riservato
`cassa-operatori@example.com` e il cassiere `admin-operatori@example.com`.
**Accettazione:**
- [ ] Elenco e colonna da 480 px, "(tu)" sul cassiere, stati con PIN, nessuno scorrimento orizzontale, target
      ≥ 48 px, radio "Amministratore" disabilitato (criterio 10)
- [ ] Un cassiere disattivato dal telefono torna su `/cassa` con "Turno scaduto…" e non compare più in "Chi è
      alla cassa?"; poi riattivato (criterio 7)
**Verifica:** `npm run e2e -- tablet-operators`
**Dipendenze:** 22, 23 · **File:** e2e/tablet-operators.spec.ts, e2e/tablet.ts · **Dimensione:** S

## Checkpoint E
- [ ] Impeccable pulito sul layout tablet; confronto con "Tablet: operatori" e "Tablet: impostazioni"
- [ ] E2E `phone` invariati

## Task 25: Documentazione
**Descrizione:** `docs/setup-accounts.md` §4 (inviti dall'app; `add_operator` solo per il primo admin e come
riserva), RUNBOOK (avvio di `functions serve`, `.env` delle funzioni, trappola dei template di Kong e
rimedio), `docs/specs/contract.md` (rotta, colonne, funzione, codici `EO001`–`EO005`), `CLAUDE.md` (Ruoli,
comandi), `docs/specs/cross-review.md` §1 voce 4, `brain/MAP.md`. Le note di deploy restano nella spec per
l'orchestratore.
**Accettazione:**
- [ ] Ogni passo indica il comando o la schermata esatta; nessun segreto né dato reale
- [ ] `CLAUDE.md` e `contract.md` coerenti con il codice
**Verifica:** rilettura; `npm run format:check`
**Dipendenze:** 24 · **File:** docs/setup-accounts.md, brain/topics/operations/RUNBOOK.md,
docs/specs/contract.md, CLAUDE.md, docs/specs/cross-review.md · **Dimensione:** M

## Task 26: Criteri di successo e PR
**Descrizione:** sezione "## Verifica dei criteri di successo" in `plan.md` con `file › titolo del test` per i
criteri 1–12; `scripts/operatorsCriteria.test.ts` (come `kioskCriteria.test.ts`) controlla che ogni criterio
abbia almeno una prova esistente, che la chiave segreta locale non compaia in `src/`, `dist/` né nei file
tracciati e che i documenti del modulo non contengano segreti o contatti reali. PR su `main` senza la riga
"rami in catena"; deploy e prova sullo staging lasciati all'orchestratore.
**Accettazione:**
- [ ] `operatorsCriteria.test.ts` verde; quality bar completa verde in locale e in CI
- [ ] PR aperta su `main` con le deviazioni dichiarate e le Open Questions da chiedere al titolare (7, 11)
**Verifica:** `npm test -- operatorsCriteria && npm run build && npm run check:bundle`; CI sulla PR
**Dipendenze:** 25 · **File:** scripts/operatorsCriteria.test.ts, tasks/operators/plan.md,
tasks/operators/todo.md, brain/STATUS.md · **Dimensione:** S

## Checkpoint F
- [ ] I 12 criteri di successo di SPEC-operators verificati (12: deploy e prova sullo staging dall'orchestratore)
- [ ] PR pronta per `code-review-and-quality`
