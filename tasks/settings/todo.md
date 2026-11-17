# Todo: settings

Fonte: [plan.md](plan.md) · Spec: [SPEC-settings.md](../../SPEC-settings.md). Ogni task chiude con
`npm run typecheck && npm run lint && npm run format:check && npm test && npm run db:test &&
npm run test:integration && npm run e2e` verdi e un commit Conventional Commits sul branch
`feat/settings`. Test prima del codice (`test-driven-development`). Solo lo stack Supabase locale
(`npm run db:start`, poi `scripts/reload-auth-templates.sh`); mai i progetti remoti.

## Task 1: Configurazione nel database
**Descrizione:** `npx supabase migration new settings`: tabella `app.settings` a riga unica (`id boolean
primary key default true check (id)`, `cents_per_point` 1–10000 default 100, `confirm_threshold_cents`
1–1000000 default 15000, `usb_uid_format` in `hex`/`hex-reversed`/`dec`/`dec-reversed` default `'hex'`,
`updated_at`, `updated_by` → `app.operators` nullable) con `insert ... default values`; policy `select` per
`private.is_active_operator()`; `revoke insert, update, delete, truncate` da `authenticated` e `anon`;
`private.acting_operator_id()` con il corpo comune (spec, "Modello dati"); `app.update_settings(p_cents_per_point,
p_confirm_threshold_cents, p_usb_uid_format default null)` `security definer`, `set search_path = ''`:
42501 se non admin, 22023 fuori dai limiti o formato sconosciuto, null = formato invariato, aggiorna
`updated_at`/`updated_by` e restituisce la riga; `revoke execute` da `public, anon`, `grant` ad `authenticated`.
**Accettazione:**
- [x] pgTAP: una sola riga 100 / 15000 / `'hex'` / `updated_by` null; secondo `insert` e `delete` falliscono;
      operatore attivo legge, utente senza profilo e `anon` no; `update`/`insert`/`delete` diretti negati ad
      `authenticated`; `anon` senza `execute` su `update_settings`
- [x] pgTAP: `update_settings` da operatore e da utente senza profilo → 42501 con riga invariata; da admin
      aggiorna valori, `updated_at` e `updated_by` (= id del profilo admin, verifica di `acting_operator_id()`);
      0, negativi, 10001, 1000001, formato sconosciuto → 22023; limiti esatti 1, 10000, 1000000 accettati;
      null lascia il formato, `'dec'` lo cambia; chiamata ripetuta con gli stessi valori → stessi valori
- [x] pgTAP: `acting_operator_id()` senza `execute` per `authenticated` e `anon`
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** nessuna · **File:** supabase/migrations/*_settings.sql, supabase/tests/settings.test.sql ·
**Dimensione:** M

## Task 2: Servizio Supabase, servizio finto e integrazione
**Descrizione:** `src/features/settings/types.ts` (`Settings`, `UsbUidFormat`, `SettingsService`,
`UpdateSettingsResult`, `SettingsLoadError` con `kind` `network`/`not-found`/`unknown`);
`supabaseSettingsService.ts`: `load()` legge la riga (snake_case → `Settings`), `update()` chiama
`update_settings` senza formato USB e mappa gli errori; `src/test/fakeSettingsService.ts` in memoria con
risultati programmabili e conteggio delle chiamate; test di integrazione con le credenziali del seed.
**Accettazione:**
- [x] Unità: 42501 → `forbidden`, 22023 → `invalid`, fetch fallita → `network`, altro → `unknown`; nessuna
      riga → `SettingsLoadError('not-found')`, distinto da `network`; mappatura della riga
- [x] Integrazione: l'operatore legge `app.settings`, riceve 42501 da `update_settings`, un `update`
      diretto non cambia nulla; l'admin salva, rilegge e ripristina 100 / 15000
- [x] Solo questo file chiama `getSupabase()` per `settings` (`grep -rn "settings'" src`)
**Verifica:** `npm test -- settings && npm run test:integration`
**Dipendenze:** 1 · **File:** src/features/settings/types.ts, supabaseSettingsService.ts (+ .test.ts),
src/test/fakeSettingsService.ts, tests/integration/settings.test.ts · **Dimensione:** M

## Checkpoint A
- [ ] `db:test`, `test`, `test:integration` verdi
- [ ] Revisione `security-and-hardening`: RLS, privilegi delle funzioni, `search_path`, ruolo solo sul server
- [ ] Revisione con l'utente prima della UI

## Task 3: `reportNotEnabled()` in AuthProvider
**Descrizione:** `useAuth()` espone `reportNotEnabled()`, che riusa il ricontrollo del profilo del ritorno in
primo piano: profilo assente → sessione chiusa e `/accedi` con il motivo `not-enabled`; profilo presente →
operatore e ruolo aggiornati nello stato (anche il ricontrollo al focus aggiorna ora un ruolo cambiato).
Errore di rete: sessione mantenuta. Lo useranno `settings`, `customers`, `cards`, `ledger`, `rewards`, `export`.
**Accettazione:**
- [x] Test con `fakeAuthService`: profilo tolto → stato `signed-out` con `not-enabled`; ruolo da admin a
      operator → `useCurrentOperator().role === 'operator'`; rete assente → stato invariato
- [x] Test esistenti di `AuthProvider` e `RequireAuth` verdi senza modifiche al loro significato
**Verifica:** `npm test -- identity`
**Dipendenze:** nessuna · **File:** src/features/identity/AuthProvider.tsx, AuthProvider.test.tsx,
src/test/fakeAuthService.ts · **Dimensione:** S

## Task 4: `SettingsProvider` e `useSettings()`
**Descrizione:** contesto con stati `loading` / `error` (con `retry`) / `ready`, più `save` (= `update` del
servizio, seguito da ricarica). Il servizio si inietta come `AuthService` (`main.tsx` con l'implementazione
Supabase, `renderApp` con il finto); il caricamento parte una volta per sessione dentro `RequireAuth`
(che avvolge l'`Outlet` con il provider) e si ripete su `visibilitychange` quando la pagina torna visibile.
**Accettazione:**
- [x] Test: caricamento → pronto; errore → `retry` richiama `load`; `save` ok aggiorna i valori;
      `visibilitychange` visibile ricarica; nessun caricamento senza operatore collegato
- [x] `renderApp` monta il provider con `fakeSettingsService`; test esistenti verdi
**Verifica:** `npm test`
**Dipendenze:** 2 · **File:** src/features/settings/SettingsProvider.tsx (+ .test.tsx),
src/features/identity/RequireAuth.tsx, src/main.tsx, src/test/renderApp.tsx · **Dimensione:** M

## Task 5: Conversione degli importi
**Descrizione:** funzioni pure `parseEuroInput(text, { max })` → centesimi o errore con il messaggio
italiano della spec (punto 6) e `centsToEuroInput(cents)` → testo con virgola e due decimali.
**Accettazione:**
- [ ] Unità: "1" → 100, "1,5"/"1,50"/"1.50" → 150, " 2 " → 200; "" vuoto, "abc"/"-1" caratteri non validi,
      "1,555"/"1.250" più di due decimali, "0"/"0,00" zero; "100,00" ok e "100,01" oltre il massimo del
      rapporto; "10000,00" ok e "10000,01" oltre il massimo della soglia
- [ ] Unità: `centsToEuroInput` 100 → "1,00", 15000 → "150,00", 5 → "0,05"
**Verifica:** `npm test -- parseEuroInput`
**Dipendenze:** nessuna · **File:** src/features/settings/parseEuroInput.ts (+ .test.ts) · **Dimensione:** S

## Task 6: Campo in linea con suffisso
**Descrizione:** `TextField` accetta le prop facoltative `layout="inline"` (label a sinistra, campo a destra,
allineato a destra, alto 48 px) e `suffix` ("€" dopo il campo); senza le prop nulla cambia. Esempio nella
vetrina `/dev/ui`.
**Accettazione:**
- [ ] Test di componente: label associata, suffisso visibile, `aria-invalid`/`aria-describedby` con errore
      anche in linea; test esistenti di `TextField` verdi
- [ ] Solo token CSS; detector Impeccable pulito
**Verifica:** `npm test -- TextField`
**Dipendenze:** nessuna · **File:** src/shared/ui/TextField.tsx, TextField.module.css, TextField.test.tsx,
src/app/dev/UiGallery.tsx · **Dimensione:** S

## Checkpoint B
- [ ] `typecheck`, `lint`, `format:check`, `test` verdi; test esistenti di identity invariati

## Task 7: Sezione operatore e posizione nella pagina
**Descrizione:** `PointsSettingsSection` per l'operatore (wireframe Impostazioni operatore): "PUNTI",
"1 punto ogni 1,00 € di spesa" (con `formatCents`), "Il rapporto lo decide un amministratore."; nessuna
soglia, nessun campo. `SettingsPage` la rende subito dopo il riquadro account e aggiunge, solo per
l'operatore, la nota finale "Operatori, premi, esportazioni e annullamenti dei movimenti li gestiscono gli
amministratori." come ultimo elemento. Stati: `StatusView kind="loading"` nella sezione; errore "Impostazioni
non caricate" con Riprova; `not-found` solo stato di errore, senza dati.
**Accettazione:**
- [ ] Componente: operatore vede testo e rapporto, niente campi né Salva né soglia; nota finale ultima
- [ ] Componente: ordine account · PUNTI · ACCOUNT (asserzione esistente aggiornata all'ordine unico di
      `cross-review.md` §1); caricamento ed errore con Riprova che richiama `load`
- [ ] Detector Impeccable pulito; screenshot 390×844 confrontato con il wireframe
**Verifica:** `npm test -- settings SettingsPage`
**Dipendenze:** 4 · **File:** src/features/settings/PointsSettingsSection.tsx (+ .module.css, .test.tsx),
src/features/identity/SettingsPage.tsx, SettingsPage.test.tsx · **Dimensione:** M

## Task 8: Sezione amministratore e salvataggio
**Descrizione:** per l'amministratore "PUNTI E CONTROLLI" (wireframe Impostazioni): righe "1 punto ogni
[ 1,00 ] €" e "Chiedi conferma sopra [ 150,00 ] €" (`TextField` in linea, `inputmode="decimal"`), testo
d'aiuto della spec, pulsante primario **Salva** (≥ 48 px) che invia i due valori insieme. Validazione con
`parseEuroInput`: errori sotto il campo, focus sul primo campo errato, nessuna richiesta. Durante il
salvataggio Salva `busy` e campi in sola lettura; a salvataggio riuscito "Impostazioni salvate." in una
regione `aria-live="polite"` e campi riformattati con i valori del server.
**Accettazione:**
- [ ] Componente: campi precompilati "1,00" e "150,00"; "2" e "200" → `update` con 200 / 20000, messaggio,
      campi "2,00" e "200,00"; doppio tocco su Salva → una sola chiamata
- [ ] Componente: "0", "", "abc", "1,555", "1.250", "100,01" (rapporto), "10000,01" (soglia) → messaggio
      previsto, focus sul campo, `update` mai chiamato; "1.50" e "1,5" → 150
- [ ] Target touch ≥ 48 px; detector Impeccable pulito; screenshot 390×844 confrontato con il wireframe
**Verifica:** `npm test -- settings`
**Dipendenze:** 5, 6, 7 · **File:** src/features/settings/PointsSettingsSection.tsx (+ .module.css,
.test.tsx) · **Dimensione:** M

## Task 9: Errori del salvataggio e ricarica
**Descrizione:** `network` → "Impostazioni non salvate: controlla la connessione e riprova." con i valori
digitati conservati; `forbidden` → "Solo un amministratore può cambiare queste impostazioni.", Salva
disattivato e `reportNotEnabled()`; `invalid`/`unknown` → "Impostazioni non salvate. Ricarica la pagina e
riprova." con i valori conservati. La ricarica su `visibilitychange` aggiorna i campi non toccati e non
sovrascrive quelli modificati e non salvati.
**Accettazione:**
- [ ] Componente: rete assente → errore e valori conservati; rete tornata → nuovo Salva riuscito
- [ ] Componente: forbidden → messaggio, Salva disattivato, `reportNotEnabled` chiamato (con ruolo aggiornato
      a operatore la sezione passa alla vista "PUNTI"); invalid e unknown → messaggio, valori conservati
- [ ] Componente: un altro admin salva, la pagina torna visibile → campo modificato invariato, l'altro aggiornato
**Verifica:** `npm test -- settings`
**Dipendenze:** 3, 8 · **File:** src/features/settings/PointsSettingsSection.tsx, PointsSettingsSection.test.tsx,
src/test/fakeSettingsService.ts · **Dimensione:** M

## Checkpoint C
- [ ] Viste admin e operatore complete nei test di componente; detector Impeccable pulito
- [ ] Confronto con i wireframe Impostazioni e Impostazioni operatore a 390×844
- [ ] Revisione con l'utente

## Task 10: E2E in un progetto Playwright separato
**Descrizione:** `playwright.config.ts`: progetto `phone-settings` (stesso dispositivo 390×844) con
`dependencies: ['phone']` e `testMatch` su `settings.spec.ts`, escluso dal progetto `phone`;
`e2e/settings.spec.ts` in modalità seriale, ripristino 100 / 15000 in `afterAll` tramite l'admin del seed.
**Accettazione:**
- [ ] Admin: ordine delle sezioni e valori iniziali come nel wireframe; "2,00" e "200,00", Salva,
      "Impostazioni salvate.", ricarica della pagina → stessi valori; "1,555" → "Usa al massimo due decimali"
- [ ] Operatore: "1 punto ogni 2,00 € di spesa" (spazi normalizzati), "Il rapporto lo decide un
      amministratore.", nessun campo modificabile, nota finale ultima
- [ ] Target di tocco ≥ 48 px; nessun errore in console; nessuna chiamata a `*.supabase.co`
**Verifica:** `npm run db:reset && npm run e2e` (due volte di fila: il ripristino lascia lo stato iniziale)
**Dipendenze:** 9 · **File:** playwright.config.ts, e2e/settings.spec.ts · **Dimensione:** S

## Task 11: Documentazione e chiusura
**Descrizione:** `brain/MAP.md` (modulo settings, `acting_operator_id`, `reportNotEnabled`, progetto
`phone-settings`), `brain/STATUS.md`, RUNBOOK (trappole trovate), CLAUDE.md se cambiano comandi o struttura;
verifica in review del criterio 7 e spunta dei criteri di successo.
**Accettazione:**
- [ ] `grep -rn "settings'" src` trova solo `supabaseSettingsService.ts`; i componenti usano solo `useSettings()`
- [ ] Nessun segreto né dato reale nei documenti
**Verifica:** rilettura; quality bar completa verde
**Dipendenze:** 10 · **File:** brain/MAP.md, brain/STATUS.md, brain/topics/operations/RUNBOOK.md, CLAUDE.md ·
**Dimensione:** S

## Checkpoint D
- [ ] Gli 8 criteri di successo di SPEC-settings verificati (tabella in [plan.md](plan.md))
- [ ] `typecheck`, `lint`, `format:check`, `test`, `db:test`, `test:integration`, `e2e` verdi; CI verde
- [ ] PR pronta per `code-review-and-quality` (pubblicazione remota a cura dell'orchestratore)
