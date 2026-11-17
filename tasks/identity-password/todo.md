# Todo: identity-password

Fonte: [plan.md](plan.md) · Spec: [SPEC-identity-password.md](../../SPEC-identity-password.md). Ogni task
chiude con `npm run typecheck && npm run lint && npm run format:check && npm test && npm run db:test &&
npm run test:integration && npm run e2e` verdi e un commit Conventional Commits sul branch
`feat/identity-password`. Test prima del codice (`test-driven-development`). Stack Supabase locale con
Mailpit (`npm run db:start`); mai i progetti remoti.

## Task 1: Email di recupero in locale e Mailpit in CI
**Descrizione:** `supabase/config.toml`: `minimum_password_length = 8`; `additional_redirect_urls` =
`http://localhost:5173/imposta-password`, `http://localhost:4173/imposta-password` (tolto
`https://127.0.0.1:3000`); `[auth.email.template.recovery]` con oggetto "Enjoy Card: scegli una nuova
password" e `content_path` verso `supabase/templates/recovery.html`; `[auth.rate_limit] email_sent` alzato
solo in locale (es. 100). Template HTML in italiano senza immagini esterne, pulsante "Scegli la password"
con `href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery"`. `e2e/mailpit.ts`: lettura dei
messaggi per destinatario dopo un istante dato (`/api/v1/search`) ed estrazione dell'`href` del pulsante.
Test di integrazione contro lo stack locale con un utente creato e tolto dal test. CI: `mailpit` tolto da
`-x` nel job `app`.
**Accettazione:**
- [x] Integrazione: `resetPasswordForEmail` con `redirectTo` `http://localhost:4173/imposta-password` →
      un'email in Mailpit con oggetto e testi del template e link che inizia con
      `http://localhost:4173/imposta-password?token_hash=` e contiene `type=recovery`
- [x] Integrazione: `verifyOtp({ type: 'recovery', token_hash })` del link → sessione; `updateUser` con 7
      caratteri → `weak_password`; con 8 → ok; secondo `verifyOtp` con lo stesso token → errore (link usato)
- [x] `config.toml` senza `https://127.0.0.1:3000`; CI verde con Mailpit avviato (in locale con lo
      stesso `supabase start -x …` della CI; la CI su GitHub si conferma alla prima push del branch)
**Verifica:** `npx supabase stop && npm run db:start && npm run test:integration`; CI su GitHub
**Dipendenze:** nessuna · **File:** supabase/config.toml, supabase/templates/recovery.html, e2e/mailpit.ts,
tests/integration/password.test.ts, .github/workflows/ci.yml · **Dimensione:** M

## Task 2: Contratto del servizio e mappatura degli errori
**Descrizione:** `types.ts`: `ResetRequestResult`, `VerifyRecoveryResult`, `UpdatePasswordResult` e i
metodi `currentEmail`, `requestPasswordReset`, `verifyRecovery`, `updatePassword`, `signOutOtherDevices`.
`supabaseAuthService`: mappatura della spec ("Modello dati e regole di accesso"); `currentEmail` da
`getSession()`; `signOutOtherDevices` → `signOut({ scope: 'others' })` con errore ignorato; nessun log con
email, password o token. `createFakeAuthService` esteso con risultati programmabili e contatori delle
chiamate.
**Accettazione:**
- [x] Unità: `requestPasswordReset` → `sent` per 200, 429, 400, 500, 502, 503 **e 504**; `network` solo per
      `fetch` fallita o `status` 0
- [x] Unità: `verifyRecovery` → `invalid-link` per `otp_expired` e 403, `network` senza risposta, `unknown`
      per 429 e altro; `updatePassword` → `same-password`, `weak`, `network`, `unknown`
- [x] Il fake rispetta il tipo `AuthService` e conta `requestPasswordReset`, `verifyRecovery`, `updatePassword`
**Verifica:** `npm test -- identity`
**Dipendenze:** nessuna · **File:** src/features/identity/types.ts, supabaseAuthService.ts,
supabaseAuthService.test.ts, src/test/fakeAuthService.ts · **Dimensione:** M

## Task 3: Recupero nell'AuthProvider
**Descrizione:** `AuthProvider` espone `currentEmail()`, `completeRecovery(tokenHash, password)` (a)
`verifyRecovery` (b) `updatePassword` (c) `signOutOtherDevices` (d) ricarica del profilo come al login, e
ricorda se la verifica è riuscita; `abandonRecovery()` chiude la sessione locale se la verifica è riuscita e
il salvataggio no. Il cambio di sessione dovuto a `verifyOtp` non produce "sessione scaduta".
**Accettazione:**
- [x] Test: dopo `network` su `updatePassword` un nuovo `completeRecovery` non richiama `verifyRecovery`;
      `same-password` dopo un errore di rete vale come successo
- [x] Test: verifica riuscita + `abandonRecovery` → stato "non collegato"; verifica con un altro account →
      operatore del link, nessun messaggio di sessione scaduta; profilo assente → "not-enabled"
- [x] Le pagine non chiamano mai il servizio direttamente (solo `useAuth()`)
**Verifica:** `npm test -- AuthProvider`
**Dipendenze:** 2 · **File:** src/features/identity/AuthProvider.tsx, AuthProvider.test.tsx · **Dimensione:** S

## Checkpoint A
- [ ] `test:integration` con Mailpit verde in locale e in CI
- [ ] `test`, `db:test`, `e2e` esistenti verdi (config cambiata: minimo 8 non rompe le password del seed)
- [ ] Revisione con l'utente prima della UI

## Task 4: Pagina Password dimenticata
**Descrizione:** `/password-dimenticata` pubblica come nel wireframe "Password dimenticata": `AppShell`
"Password dimenticata" con Indietro (→ `/accedi`, → `/impostazioni` se collegato), testo, campo Email
(`autoComplete="email"`, placeholder `nome@esempio.it`), "Invia il link" `busy`, nota sul link di un'ora.
`redirectTo` = `window.location.origin + '/imposta-password'`. Ogni `sent` → conferma neutra con "Torna
all'accesso" / "Torna alle impostazioni"; `network` → "Connessione assente: controlla la rete e riprova." con
il modulo compilato. Collegato: precompilata da `currentEmail()`, modificabile; l'email non passa mai in URL.
**Accettazione:**
- [x] Componente: "Inserisci l'email" / "Email non valida"; stessa conferma per qualunque email; rete → errore
      e reinvio; doppio tocco = una sola richiesta; `redirectTo` non dipende dall'input
- [x] Componente: non collegato → Indietro a `/accedi`; collegato → email precompilata, Indietro e "Torna
      alle impostazioni" verso `/impostazioni`
- [x] Detector Impeccable pulito; target ≥ 48 px; screenshot 390×844 confrontato con il wireframe
**Verifica:** `npm test -- ForgotPasswordPage && npm run e2e`
**Dipendenze:** 3 · **File:** src/features/identity/ForgotPasswordPage.tsx (+ .module.css, .test.tsx),
src/app/routes.tsx · **Dimensione:** M

## Task 5: Pagina Imposta password
**Descrizione:** `/imposta-password` pubblica come nel wireframe "Invito: scegli la password" adattato al
recupero: logo "Bar Enjoy Gaeta", nessuna barra con Indietro, titolo "Scegli una nuova password", testo,
"Nuova password" (aiuto "Almeno 8 caratteri.") e "Ripeti la password" (`new-password`), "Salva e accedi"
`busy` → `completeRecovery` → `/` (`replace`). Vista "Il link è scaduto o è già stato usato." con "Chiedi un
nuovo link" per `token_hash` mancante, `type` ≠ `recovery`, `error` nel frammento o `invalid-link`. Messaggi
in mappe `Record<Result, string>`. Avviso "Sei collegato come {nome}: salvando, accederai con l'account del
link."; uscita dalla pagina dopo una verifica riuscita → `abandonRecovery()`.
**Accettazione:**
- [x] Componente: < 8 caratteri, oltre 72 byte UTF-8 (anche 40 "è" = 80 byte), password diverse; doppio tocco
      = una sola richiesta; link mancante/scaduto → "Chiedi un nuovo link" → `/password-dimenticata`
- [x] Componente: `same-password`, `weak`, `unknown`, rete su verifica e su salvataggio con i testi della spec;
      reinvio dopo rete senza seconda verifica; profilo assente → `/accedi` "Account non abilitato"
- [x] Componente: avviso per l'utente collegato, che senza link resta collegato; uscita dopo verifica riuscita
      → "non collegato". Detector Impeccable pulito; target ≥ 48 px; screenshot 390×844 vs wireframe
**Verifica:** `npm test -- ResetPasswordPage && npm run e2e`
**Dipendenze:** 3 · **File:** src/features/identity/ResetPasswordPage.tsx (+ .module.css, .test.tsx),
src/app/routes.tsx · **Dimensione:** M

## Task 6: Inoltro di riserva da site_url
**Descrizione:** se Supabase scarta il `redirectTo`, il link arriva a `/?token_hash=…&type=recovery`.
`RootLayout` inoltra a `/imposta-password` conservando la query, prima di `RequireAuth`.
**Accettazione:**
- [x] Componente: `/?token_hash=abc&type=recovery` senza sessione → `/imposta-password?token_hash=abc&type=recovery`,
      non `/accedi`; `/` senza query invariato
**Verifica:** `npm test -- routes`
**Dipendenze:** 5 · **File:** src/app/RootLayout.tsx, src/app/routes.test.tsx · **Dimensione:** S

## Task 7: Ingressi da Accesso e Impostazioni
**Descrizione:** su `/accedi`, sotto "Accedi", il link "Password dimenticata?" → `/password-dimenticata`
(≥ 48 px; nota V1 invariata). Su `/impostazioni` sezione **ACCOUNT** (titolo come "PUNTI") con `ListRow`
"Cambia password" / "Ricevi un link via email" → `/password-dimenticata`, subito dopo il riquadro account
(ordine di `docs/specs/cross-review.md`), per amministratori e operatori.
**Accettazione:**
- [x] Componente: link su Accesso con la destinazione giusta; sezione ACCOUNT visibile ad admin e operatore,
      dopo il riquadro account, senza email nella destinazione
- [x] Detector Impeccable pulito; target ≥ 48 px; screenshot 390×844 vs wireframe "Accesso" e
      "Impostazioni (operatore)"
**Verifica:** `npm test -- LoginPage SettingsPage && npm run e2e`
**Dipendenze:** 4 · **File:** src/features/identity/LoginPage.tsx, LoginPage.test.tsx, SettingsPage.tsx,
SettingsPage.module.css, SettingsPage.test.tsx · **Dimensione:** M

## Checkpoint B
- [ ] Componenti e unità verdi; suite E2E esistente verde
- [ ] Le tre schermate conformi ai wireframe a 390×844; detector Impeccable pulito
- [ ] Revisione `security-and-hardening`: nessuna enumerazione degli account, token solo nella query e
      consumato solo da "Salva e accedi", `redirectTo` mai da input, nessun log con dati sensibili
- [ ] Revisione con l'utente

## Task 8: Percorso completo in E2E
**Descrizione:** seed con `recupero@example.com` ("Recupero Prova", operator), riservato a questo E2E.
`e2e/password.spec.ts` (390×844, regole della spec per `fullyParallel`):
(a) un solo test: richiesta → email da Mailpit → link → nuova password casuale → home → esci → accesso con
la nuova; vecchia password rifiutata; link riaperto → "Chiedi un nuovo link";
(b) email `nessuno-<casuale>@example.com` → stessa conferma, nessuna email in Mailpit;
(c) Impostazioni come `operatore@example.com` → "Cambia password" → email precompilata → conferma, senza
aprire il link.
**Accettazione:**
- [x] I tre scenari verdi; una seconda esecuzione senza `db:reset` resta verde
- [x] `db:test` verde con il seed esteso; nessun altro test accede con `recupero@example.com`
**Verifica:** `npm run db:reset && npm run db:test && npm run e2e && npm run e2e`
**Dipendenze:** 1, 6, 7 · **File:** supabase/seed.sql, e2e/auth.ts, e2e/password.spec.ts · **Dimensione:** S

## Task 9: Documentazione
**Descrizione:** `docs/setup-accounts.md`: procedura remota per il titolare, staging e poi produzione, dalla
dashboard (Site URL e Redirect URLs della tabella della spec con `<team>`, template Reset Password da
`supabase/templates/recovery.html`, minimo 8 caratteri e OTP 3600 s, prova reale da `info@enjoygaeta.it`),
mai `supabase config push`; la sezione V1 "reimpostare una password" rimanda al nuovo flusso. Rimandi in
`SPEC-identity.md` e `CAPABILITY-MAP.md`; RUNBOOK (Mailpit, limiti locali, trappole trovate); `brain/MAP.md`.
**Accettazione:**
- [x] Ogni passo indica la schermata esatta della dashboard; lo staging non riceve mai l'URL di produzione
- [x] Nessun segreto, dominio di team reale o dato personale nei documenti
**Verifica:** rilettura; `npm run format:check`
**Dipendenze:** 8 · **File:** docs/setup-accounts.md, SPEC-identity.md, CAPABILITY-MAP.md,
brain/topics/operations/RUNBOOK.md, brain/MAP.md · **Dimensione:** S

## Checkpoint C
- [x] Criteri di successo 1-7 e 9 di SPEC-identity-password verificati; criterio 8: procedura pronta
      (esecuzione remota a carico dell'orchestratore, fuori da questo piano)
- [ ] CI verde sulla PR (base `main`)
- [ ] PR pronta per `code-review-and-quality`
