# Todo: identity

Fonte: [plan.md](plan.md) · Spec: [SPEC-identity.md](../../SPEC-identity.md). Ogni task chiude con
`npm run typecheck && npm run lint && npm test` verdi (più `db:test` ed E2E dove indicato) e un commit
Conventional Commits sul branch del modulo. Test prima del codice (`test-driven-development`).

## Task 1: Profili operatore e regole di accesso nel database
**Descrizione:** migrazione `*_identity.sql`: tabella `app.operators` (`id`, `user_id` unique → `auth.users`
`on delete set null`, `name` unico 1-60, `role` admin/operator, `created_at`); funzioni `private`
`current_operator_id()`, `is_active_operator()`, `is_admin()`; policy di sola lettura per operatori
attivi; `private.add_operator(email, name, role)` eseguibile solo da `postgres`. Schema `app` esposto in
`config.toml`. Seed con un amministratore e un operatore finti (`@example.com`).
**Accettazione:**
- [x] pgTAP: un utente senza profilo, o con profilo scollegato, non legge `operators`; un operatore attivo
      la legge; nessuno ci scrive direttamente; `is_admin()` vero solo per gli admin
- [x] pgTAP: `add_operator` crea, ricollega per nome, rifiuta email inesistente o già collegata;
      `authenticated` non può eseguirla
- [x] pgTAP: cancellare l'utente lascia il profilo con `user_id` null
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** nessuna · **File:** supabase/migrations/*_identity.sql, supabase/tests/identity.test.sql,
supabase/seed.sql, supabase/config.toml · **Dimensione:** M

## Task 2: E2E e CI contro Supabase locale
**Descrizione:** `playwright.config.ts` costruisce l'app con `VITE_SUPABASE_URL=http://localhost:54321` e la
chiave locale letta da `supabase status`; `vite.config.ts` aggiunge l'origine locale a `connect-src` solo
per `vite preview`; il job `app` della CI avvia Supabase (solo i servizi necessari) prima di E2E.
**Accettazione:**
- [x] La suite E2E esistente passa con lo stack locale avviato, anche se `.env` punta allo staging
- [x] Ogni test E2E fallisce se l'app chiama un progetto `*.supabase.co` (fixture automatica `onlyLocalSupabase`)
- [x] `vercel.json` invariato; CI verde sulla PR
**Verifica:** `npm run db:start && npm run e2e`; CI su GitHub
**Dipendenze:** 1 · **File:** playwright.config.ts, vite.config.ts, .github/workflows/ci.yml, e2e/smoke.spec.ts
· **Dimensione:** S

## Checkpoint A
- [x] `db:test`, `test`, `e2e` verdi in locale e in CI
- [ ] Revisione con l'utente prima della UI

## Task 3: Sessione e operatore corrente
**Descrizione:** `src/features/identity/`: `AuthProvider` (sessione persistente, ascolta `onAuthStateChange`),
`useSession`, `useCurrentOperator` (legge da `app.operators` il profilo collegato: loading / operatore /
nessun profilo), `signIn`, `signOut`.
**Accettazione:**
- [x] Test con client finto: stato iniziale di caricamento, sessione presente, sessione assente, profilo
      mancante
- [x] I componenti non chiamano mai `getSupabase()` direttamente (solo questi hook)
**Verifica:** `npm test -- identity`
**Dipendenze:** 1 · **File:** src/features/identity/AuthProvider.tsx, useCurrentOperator.ts, *.test.tsx,
src/main.tsx · **Dimensione:** M

## Task 4: Pagina di accesso e guardia delle rotte
**Descrizione:** `/accedi` come nel wireframe "Accesso" (logo, email, password, "Accedi", nota sugli
account creati dall'amministratore); errore unico "Email o password non corretti"; `RequireAuth` su tutte
le rotte tranne `/accedi` e la 404; dopo l'accesso si torna alla pagina richiesta.
**Accettazione:**
- [x] Test di componente: errore generico, pulsante disattivato durante l'invio, etichette accessibili
- [x] E2E: senza sessione `/` porta a `/accedi`; accesso con l'utente del seed → home; credenziali sbagliate
      → messaggio generico; pagina richiesta ripristinata dopo l'accesso
- [x] Detector Impeccable pulito; screenshot 390×844 confrontato con il wireframe
**Verifica:** `npm test && npm run e2e`
**Dipendenze:** 2, 3 · **File:** src/features/identity/LoginPage.tsx (+ .module.css, .test.tsx),
RequireAuth.tsx, src/app/routes.tsx, e2e/identity.spec.ts · **Dimensione:** M

## Task 5: Impostazioni ed "Esci"
**Descrizione:** `/impostazioni` come nei wireframe "Impostazioni" e "Impostazioni operatore": riquadro
account (iniziale, nome, ruolo) ed "Esci". Il pulsante account dell'`AppShell` mostra l'iniziale
dell'operatore e porta qui.
**Accettazione:**
- [x] Test di componente: nome e ruolo in italiano ("Amministratore", "Operatore"), iniziale nel cerchio
- [x] E2E: home → pulsante account → Impostazioni → Esci → `/accedi`; tornare indietro non riapre i dati
- [x] Detector Impeccable pulito; target touch ≥ 48 px
**Verifica:** `npm test && npm run e2e`
**Dipendenze:** 4 · **File:** src/features/identity/SettingsPage.tsx (+ .module.css, .test.tsx),
src/app/routes.tsx, src/app/HomePage.tsx, e2e/identity.spec.ts · **Dimensione:** M

## Checkpoint B
- [x] Flusso accesso → home → Impostazioni → Esci verde in E2E
- [x] Accessibilità Lighthouse ≥ 95 su `/accedi` (mobile, build sullo stack locale: accessibilità 100,
      best practices 100)
- [x] Revisione `security-and-hardening` su auth e RLS, problemi risolti (4 risolti con test)
- [ ] Revisione con l'utente

## Task 6: Account tolto o senza profilo
**Descrizione:** se il profilo collegato manca (utente cancellato dal pannello, o mai collegato con
`add_operator`) o il rinnovo della sessione fallisce, l'app chiude la sessione locale e porta a `/accedi`
con il messaggio previsto: "La sessione è scaduta: accedi di nuovo" (sessione non rinnovabile) oppure
"Account non abilitato: chiedi a un amministratore." (utente senza profilo collegato). Test di integrazione (Vitest) contro lo stack locale, con lo script
`test:integration` e il passo in CI.
**Accettazione:**
- [x] Integrazione: accesso con un operatore di prova (creato e tolto dal test, così il seed usato
      dagli E2E resta intatto); dopo la cancellazione dell'utente (API admin, chiave locale solo nei
      test) il vecchio token non legge `operators` e la sessione non si rinnova
- [x] E2E o componente: profilo assente → `/accedi` con il messaggio (anche quando l'app torna in
      primo piano: il profilo si ricontrolla al focus e al ritorno visibile)
- [x] La chiave segreta locale compare solo nel codice di test, mai in `src/`
**Verifica:** `npm run db:start && npm run test:integration`
**Dipendenze:** 5 · **File:** vitest.integration.config.ts, tests/integration/identity.test.ts,
src/features/identity/RequireAuth.tsx, package.json, .github/workflows/ci.yml · **Dimensione:** M

## Task 7: Documentazione
**Descrizione:** `docs/setup-accounts.md`: esporre lo schema `app` nella Data API, creare il primo
amministratore, togliere e rimettere un operatore, reimpostare una password. RUNBOOK (procedure e
trappole trovate), CLAUDE.md (`test:integration`), `brain/MAP.md`.
**Accettazione:**
- [ ] Ogni passo della procedura indica la schermata esatta di Supabase o la riga SQL da eseguire
- [ ] Nessun segreto né dato reale nei documenti
**Verifica:** rilettura con l'utente
**Dipendenze:** 6 · **File:** docs/setup-accounts.md, brain/topics/operations/RUNBOOK.md, CLAUDE.md,
brain/MAP.md · **Dimensione:** S

## Task 8: Pubblicazione (con l'utente)
**Descrizione:** l'utente esegue `supabase login`; poi `db push` sullo staging, verifica dell'event trigger,
schema `app` esposto, primo utente creato e collegato; prova sull'anteprima Vercel della PR e su Android.
Solo dopo, lo stesso in produzione.
**Accettazione:**
- [ ] Staging: accesso riuscito dall'anteprima Vercel; console pulita
- [ ] Android: accesso dal telefono, sessione ancora aperta dopo aver chiuso e riaperto l'app
- [ ] Produzione: migrazioni applicate e primo amministratore collegato, dopo il merge in `main`
**Verifica:** prova manuale guidata
**Dipendenze:** 7 · **File:** nessuno (solo `brain/STATUS.md`) · **Dimensione:** S

## Checkpoint C
- [ ] Gli 8 criteri di successo di SPEC-identity verificati
- [ ] PR pronta per `code-review-and-quality`
