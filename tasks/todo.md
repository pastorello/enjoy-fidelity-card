# Todo: platform

Fonte: [plan.md](plan.md) · Spec: [SPEC-platform.md](../SPEC-platform.md). Ogni task chiude con typecheck,
lint e test verdi e un commit Conventional Commits sul branch del modulo.

## Task 1: Scaffold dell'app
**Descrizione:** progetto Vite + React 19 + TS 7 strict (`noUncheckedIndexedAccess`), React Router con `/`
segnaposto e pagina 404, error boundary globale in italiano con "Riprova", Oxlint (TypeScript, React,
react-hooks, jsx-a11y, type-aware), Prettier, Vitest + Testing Library, script npm della spec.
**Accettazione:**
- [x] `npm run build`, `typecheck` e `lint` passano senza warning
- [x] Test: `/` mostra "Enjoy Card"; una rotta sconosciuta mostra la 404; un errore mostra il boundary
**Verifica:** `npm test && npm run build`; `npm run dev` apre `/`
**Dipendenze:** nessuna · **File:** package.json, tsconfig*.json, vite.config.ts, .oxlintrc.json, src/app/*, src/main.tsx · **Dimensione:** M

## Task 2: Formattazione importi e punti
**Descrizione:** `formatCents` e `formatPoints` in `src/shared/format.ts`, test prima.
**Accettazione:**
- [x] `formatCents(1250)` → "12,50 €", `formatCents(0)` → "0,00 €", `formatCents(123456)` → "1.234,56 €"
- [x] `formatPoints(45)` → "45 pt"; un valore non intero genera un errore
**Verifica:** `npm test -- format`
**Dipendenze:** 1 · **File:** src/shared/format.ts, src/shared/format.test.ts · **Dimensione:** XS

## Task 3: Supabase locale e RLS predefinita
**Descrizione:** `supabase init`; migrazione iniziale con `pgcrypto`, schema `app`, event trigger che attiva
la RLS su ogni nuova tabella di `app`; test pgTAP; client `src/lib/supabase.ts` da variabili d'ambiente;
`.env.example`; seed vuoto.
**Accettazione:**
- [x] `npm run db:reset` applica la migrazione senza errori
- [x] pgTAP: una tabella creata in `app` ha la RLS attiva e, senza policy, un utente `authenticated` non legge righe
- [x] Il client fallisce in modo chiaro se mancano le variabili d'ambiente (test unitario)
**Verifica:** `npm run db:start && npm run db:test && npm test`
**Dipendenze:** 1 · **File:** supabase/config.toml, supabase/migrations/*_init.sql, supabase/tests/rls_default.test.sql, src/lib/supabase.ts, .env.example · **Dimensione:** M

## Checkpoint A
- [ ] typecheck, lint, test, db:test verdi
- [ ] Revisione con l'utente prima della UI

## Task 4: Design system nel codice
**Descrizione:** `/impeccable init` dal design system "Enjoy Bar"; `design/tokens.json` copiato dall'artifact;
`scripts/build-tokens` → `src/styles/tokens.css` (solo tema Chiaro); font Texturina e Stint Ultra Condensed
in woff2 (OFL) con `@font-face`; `base.css` con focus ring.
**Accettazione:**
- [x] `npm run tokens` rigenera un CSS identico a quello committato (test)
- [x] Nessuna richiesta a domini esterni per i font
**Verifica:** `npm run tokens && git diff --exit-code src/styles/tokens.css`; DevTools → Network
**Dipendenze:** 1 · **File:** design/tokens.json, scripts/build-tokens.ts, src/styles/{tokens,base,fonts}.css, public/fonts/* · **Dimensione:** M

## Task 5: Controlli di base
**Descrizione:** `Button` (primary, secondary, danger; 56 px), `TextField` (label, errore), `SearchField`.
**Accettazione:**
- [x] Ruoli e nomi accessibili corretti; errore collegato con `aria-describedby`
- [x] Target di tocco ≥ 48 px; solo variabili dei token nei CSS
**Verifica:** `npm test -- shared/ui`; detector Impeccable pulito
**Dipendenze:** 4 · **File:** src/shared/ui/{Button,TextField,SearchField}.{tsx,module.css,test.tsx} · **Dimensione:** M

## Task 6: Elementi di elenco e stato
**Descrizione:** `ListRow` (min 64 px, tocco su tutta la riga), `PointsBadge`, `ScreenTitle`, `StatusView`
(caricamento, vuoto, errore con "Riprova").
**Accettazione:**
- [x] `StatusView` errore chiama `onRetry`; caricamento annunciato con `role="status"`
- [x] `PointsBadge` usa `formatPoints`
**Verifica:** `npm test -- shared/ui`
**Dipendenze:** 4, 2 · **File:** src/shared/ui/{ListRow,PointsBadge,ScreenTitle,StatusView}.* · **Dimensione:** M

## Task 7: Dialogo di conferma e AppShell
**Descrizione:** `ConfirmDialog` (anche variante pericolosa, `<dialog>` nativo, focus intrappolato, Esc
annulla); `AppShell` con header verde 64 px, logo provvisorio, pulsante account 48×48; schermata `/` dentro
l'AppShell.
**Accettazione:**
- [ ] Il focus torna al pulsante che ha aperto il dialogo; Esc chiama `onCancel`
- [ ] A 390×844 header, contenuto e area azioni rispettano il wireframe "Cerca cliente"
**Verifica:** `npm test`; screenshot a 390×844
**Dipendenze:** 5, 6 · **File:** src/shared/ui/ConfirmDialog.*, src/app/AppShell.*, src/app/routes.tsx · **Dimensione:** M

## Checkpoint B
- [ ] Tutto verde; detector Impeccable pulito
- [ ] Schermata segnaposto vista dall'utente (screenshot 390×844)

## Task 8: PWA ed E2E
**Descrizione:** `vite-plugin-pwa` con il manifest della spec, icone provvisorie 192/512/maskable, service
worker con cache solo per l'app shell e `NetworkOnly` per `*.supabase.co`; Playwright 390×844 sulla build.
**Accettazione:**
- [ ] E2E: `/` carica, header e titolo visibili, console senza errori
- [ ] E2E: dopo una richiesta a Supabase (simulata), Cache Storage non contiene URL `supabase.co`
**Verifica:** `npm run build && npm run e2e`
**Dipendenze:** 7 · **File:** vite.config.ts, public/icons/*, playwright.config.ts, e2e/smoke.spec.ts, e2e/sw-cache.spec.ts · **Dimensione:** M

## Task 9: HTTPS in sviluppo
**Descrizione:** `npm run dev:https` con certificato di sviluppo, accessibile dalla rete locale.
**Accettazione:**
- [ ] Il telefono apre l'app in HTTPS dall'IP del computer (prova manuale dell'utente)
**Verifica:** `npm run dev:https` → URL in HTTPS stampato in console
**Dipendenze:** 1 · **File:** vite.config.ts, package.json · **Dimensione:** XS

## Task 10: CI
**Descrizione:** GitHub Actions su PR e `main`: job app (typecheck, lint, test, build, e2e) e job database
(`supabase start` ridotto + `db:test`).
**Accettazione:**
- [ ] Tutti i job verdi su una PR
**Verifica:** `gh pr checks`
**Dipendenze:** 3, 8 · **File:** .github/workflows/ci.yml · **Dimensione:** S

## Task 11: Deploy e documentazione
**Descrizione:** `vercel.json` (rewrite SPA, CSP verso il solo dominio Supabase, Referrer-Policy,
X-Content-Type-Options, Permissions-Policy con `nfc` consentito); istruzioni passo passo per l'utente
(account Supabase prod + staging in Francoforte, Vercel collegato al repo, variabili d'ambiente);
comandi reali in RUNBOOK e CLAUDE.md.
**Accettazione:**
- [ ] Anteprima Vercel della PR: segnaposto visibile, console pulita (dopo il collegamento fatto dall'utente)
- [ ] RUNBOOK documenta `supabase db push` in produzione
**Verifica:** anteprima Vercel; Lighthouse (PWA, Accessibilità ≥ 95, Best Practices ≥ 95)
**Dipendenze:** 8, 10 · **File:** vercel.json, brain/topics/operations/RUNBOOK.md, CLAUDE.md, docs/setup-accounts.md · **Dimensione:** M

## Checkpoint C (completo)
- [ ] I 9 criteri di successo di SPEC-platform verificati (4 e 5 su telefono Android dall'utente)
- [ ] PR pronta per `code-review-and-quality`
