# Todo: rewards

Fonte: [plan.md](plan.md) · Spec: [SPEC-rewards.md](../../docs/specs/SPEC-rewards.md). Ogni task chiude con
`npm run typecheck && npm run lint && npm run format:check && npm test && npm run db:test &&
npm run test:integration && npm run e2e` verdi e un commit Conventional Commits sul branch
`feat/rewards`. Test prima del codice (`test-driven-development`). Solo lo stack Supabase locale
(`npm run db:start`, poi `scripts/reload-auth-templates.sh`); mai i progetti remoti. Solo dati finti.

## Task 1: Tabella premi, regole di accesso e creazione idempotente
**Descrizione:** `npx supabase migration new rewards`: `create or replace` di `private.acting_operator_id()`
con il corpo comune parola per parola (senza `grant`); tabella `app.rewards` (spec, "Modello dati": `name`
con `check (name = btrim(name) and length between 1 and 60)`, `points` 1–99 999, `active` default true,
`created_at`, `created_by`, `updated_at`, `updated_by` → `app.operators`); indice unico `rewards_name_key`
su `lower(name)`; RLS con policy `select` per `private.is_active_operator()`; `insert/update/delete/truncate`
revocati ad `authenticated`. `app.create_reward(p_id, p_name, p_points, p_active)` `security definer`,
`set search_path = ''`: ruolo (`private.is_admin()`, altrimenti `42501`; autore null → `42501`) →
idempotenza (`insert … on conflict (id) do nothing`, poi `select`) → validazione; nome salvato con `btrim`;
`execute` revocato a `public`/`anon`, concesso ad `authenticated`.
**Accettazione:**
- [ ] pgTAP: RLS attiva; operatore e admin leggono, utente senza profilo e `anon` no; `insert`/`update`/
      `delete`/`truncate` diretti negati ad `authenticated` anche se admin
- [ ] pgTAP: operatore e utente senza profilo ricevono `42501`, anche come reinvio di un id esistente;
      l'admin crea con `created_by`/`updated_by` = operatore che agisce; stesso id due volte (anche con nome
      diverso) → una riga restituita invariata
- [ ] pgTAP: nome duplicato con maiuscole diverse o spazi iniziali/finali → `23505`; punti 0, negativi,
      100 000, nome vuoto, di soli spazi o di 61 caratteri → `23514`; " Spremuta " salvato "Spremuta";
      `function_privileges.test.sql` verde
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** nessuna · **File:** supabase/migrations/*_rewards.sql, supabase/tests/rewards.test.sql ·
**Dimensione:** M

## Task 2: Modifica, attivazione, nessuna cancellazione e seed
**Descrizione:** `app.update_reward(p_id, p_name, p_points)` e `app.set_reward_active(p_id, p_active)` con lo
stesso ordine dei controlli; id inesistente → `P0002`; aggiornano `updated_at`/`updated_by`; restituiscono la
riga. Nessuna funzione di cancellazione e nessun trigger su `app.rewards`. Seed con i premi del wireframe
(Caffè 50, Cornetto e cappuccino 100, Colazione per due 180, Aperitivo 200 attivi; Dolce del giorno 120
inattivo) creati dall'"Admin Prova" del seed.
**Accettazione:**
- [ ] pgTAP: operatore e utente senza profilo → `42501`; id inesistente → `P0002`; rinomina su un nome già
      usato (maiuscole o spazi diversi) → `23505`; valori fuori limite → `23514`; `update_reward` non cambia
      `active`; `updated_by` = chi agisce e `updated_at` aggiornato
- [ ] pgTAP (criterio 3): nessun trigger su `app.rewards` (`triggers_are`); dopo le tre RPC il numero di righe
      delle altre tabelle di `app` non cambia; nessuna funzione in `app` o `private` cancella da
      `app.rewards`; nessun ruolo API ha `delete`
- [ ] `npm run db:reset` carica il seed senza errori; nessun dato reale
**Verifica:** `npm run db:reset && npm run db:test`
**Dipendenze:** 1 · **File:** supabase/migrations/*_rewards.sql, supabase/tests/rewards.test.sql,
supabase/seed.sql · **Dimensione:** M

## Checkpoint A
- [ ] `db:test` verde (anche `function_privileges.test.sql` e `rls_default.test.sql`)
- [ ] Revisione `security-and-hardening`: RLS, privilegi, `search_path`, ruolo prima dell'idempotenza,
      nessuna cancellazione possibile
- [ ] Revisione con l'utente prima della UI

## Task 3: Tipi, ordinamento e validazione
**Descrizione:** `src/features/rewards/types.ts` (`Reward`, `RewardWriteError`, `RewardWriteResult`,
`RewardsService` come nella spec, "Code Style"); `sortRewards.ts` (attivi poi inattivi, per punti, a parità
per nome con `localeCompare` `it`); `validateReward.ts` (nome con `trim`, 1–60; punti solo cifre, 1–99 999)
con i testi della spec ("Scrivi il nome del premio", "Il nome è troppo lungo (massimo 60 caratteri)",
"Scrivi i punti: un numero intero maggiore di zero", "Al massimo 99.999 punti").
**Accettazione:**
- [ ] Unità `sortRewards`: ordine del wireframe (Dolce del giorno in fondo), parità di punti per nome,
      l'array in ingresso non cambia
- [ ] Unità `validateReward`: 0, 1, 99 999, 100 000, "1,5", "-3", "+3", "1 000", nome vuoto, di soli spazi,
      di 60 e 61 caratteri
**Verifica:** `npm test -- rewards`
**Dipendenze:** nessuna · **File:** src/features/rewards/types.ts, sortRewards.ts (+ .test.ts),
validateReward.ts (+ .test.ts) · **Dimensione:** M

## Task 4: Servizio Supabase dei premi e integrazione
**Descrizione:** `supabaseRewardsService.ts`: `listAll()` e `listActive()` (solo `active = true`) da
`app.rewards`, ordinate con `sortRewards()`; `create`/`update`/`setActive` con le tre RPC. Traduzione:
`serverFaultFor` → `ServerFaultError`; `42501` → `forbidden`; `23505` con `rewards_name_key` → `name-taken`;
`23514` → `invalid`; `P0002` → `not-found`; fetch fallita → `network`; altro → `unknown`. Guardia
`scripts/rewardsBoundary.test.ts`: solo il servizio legge `rewards` o chiama le RPC, solo `main.tsx` lo
importa, nessun `getSupabase()` altrove nel modulo, ogni `errcode` sollevato da `*_rewards.sql` ha una
traduzione. Integrazione con le credenziali del seed.
**Accettazione:**
- [ ] Unità con client finto: ogni codice → l'errore giusto (anche `23505` di un altro vincolo → `unknown`,
      `42501` "permission denied for function" → `ServerFaultError('misconfigured')`); `listActive()` chiede
      solo `active = true`
- [ ] Integrazione: l'admin crea (nome con suffisso unico), reinvia lo stesso id e riceve la stessa riga,
      riprova il nome in maiuscolo → `name-taken`, disattiva e il premio esce da `listActive()`; l'operatore
      legge `listActive()` e riceve `forbidden` da ogni scrittura
- [ ] Guardia del confine verde
**Verifica:** `npm test -- rewards && npm run test:integration`
**Dipendenze:** 2, 3 · **File:** src/features/rewards/supabaseRewardsService.ts (+ .test.ts),
scripts/rewardsBoundary.test.ts, tests/integration/rewards.test.ts · **Dimensione:** M

## Task 5: Servizio finto e iniezione
**Descrizione:** `src/test/fakeRewardsService.ts` in memoria (ruolo admin/operatore, nome unico
case-insensitive con `trim`, idempotenza sull'id, limiti, `not-found`, registro delle chiamate con gli id,
risposte ritardate, rete giù, "arrivato ma risposta persa", guasti `ServerFaultError`);
`RewardsServiceProvider` / `useRewardsService()`; iniezione in `main.tsx` e in `renderApp` (quarto parametro
facoltativo).
**Accettazione:**
- [ ] Test del finto: stesso id due volte → una riga; nome equivalente → `name-taken`; operatore →
      `forbidden`; "risposta persa" applica la scrittura e rifiuta con `network`
- [ ] I test esistenti che usano `renderApp` passano senza modifiche alle chiamate
**Verifica:** `npm test`
**Dipendenze:** 3 · **File:** src/test/fakeRewardsService.ts (+ .test.ts),
src/features/rewards/RewardsServiceProvider.tsx, src/main.tsx, src/test/renderApp.tsx · **Dimensione:** M

## Checkpoint B
- [ ] `test`, `test:integration`, `db:test` verdi; test esistenti di identity, settings e customers invariati

## Task 6: Sezione GESTIONE nelle Impostazioni
**Descrizione:** `RewardsSettingsSection`: titolo "GESTIONE" e `ListRow` "Catalogo premi" / "Premi fissi e
punti richiesti" con `to="/impostazioni/premi"`, solo se `useCurrentOperator().role === 'admin'`.
`SettingsPage` la monta dopo ACCOUNT e prima della nota finale (ordine di `docs/specs/cross-review.md`).
**Accettazione:**
- [ ] Componenti: l'admin vede GESTIONE dopo ACCOUNT e prima di ogni sezione successiva; l'operatore non la
      vede; il tocco porta a `/impostazioni/premi`
- [ ] Detector Impeccable pulito; riga ≥ 48 px
**Verifica:** `npm test -- Settings`
**Dipendenze:** 5 · **File:** src/features/rewards/RewardsSettingsSection.tsx (+ .test.tsx),
src/features/identity/SettingsPage.tsx, src/features/identity/SettingsPage.test.tsx · **Dimensione:** S

## Task 7: Rotta del catalogo e messaggio di permesso
**Descrizione:** rotta `impostazioni/premi` dentro `RequireAuth`; `RewardsCatalogPage` con `AppShell`
"Catalogo premi" e Indietro verso `/impostazioni`. Per un operatore: `StatusView kind="empty"` con icona
`lock` (nuova in `Icon.tsx`, Lucide), "Solo per gli amministratori" / "Il catalogo premi lo gestiscono gli
amministratori." e `ButtonLink` secondario "Torna alle impostazioni"; nessuna chiamata al servizio e nessun
riquadro Nuovo premio.
**Accettazione:**
- [ ] Componenti (`renderApp`): operatore sull'URL diretto → messaggio, link alle Impostazioni, **zero**
      chiamate al finto; admin → titolo e Indietro
- [ ] `displayGlyphs.test.ts` verde
**Verifica:** `npm test`
**Dipendenze:** 6 · **File:** src/features/rewards/RewardsCatalogPage.tsx (+ .test.tsx), src/app/routes.tsx,
src/shared/ui/Icon.tsx · **Dimensione:** S

## Task 8: Elenco del catalogo e suoi stati
**Descrizione:** `useRewards()` (in `RewardsServiceProvider.tsx`: caricamento, errore, dati, `reload`) con
`listAll()` all'apertura. Elenco che scorre dentro `main`, righe proprie (non `ListRow`) con `key` = id:
nome 18 px, "N punti", casella Attivo (sola visualizzazione in questo task); premio inattivo in `ink-muted`
con "120 punti · non visibile alla cassa né al cliente". Stati: `StatusView` "loading" al posto dell'elenco;
vuoto "Nessun premio nel catalogo" / "Aggiungi il primo premio qui sotto."; errore "Catalogo non caricato" /
"Controlla la connessione e riprova." (o le parole dei guasti del server) con "Riprova".
**Accettazione:**
- [ ] Componenti: caricamento, vuoto, errore e Riprova che ricarica; righe nell'ordine di `sortRewards()`;
      riga inattiva con il suo sottotitolo
- [ ] Caselle con nomi accessibili distinti ("Caffè attivo", …)
**Verifica:** `npm test`
**Dipendenze:** 7 · **File:** src/features/rewards/RewardsCatalogPage.tsx (+ .module.css, .test.tsx),
src/features/rewards/RewardsServiceProvider.tsx · **Dimensione:** M

## Task 9: Attiva e disattiva dalla riga
**Descrizione:** toccare la casella chiama `setActive()` subito; durante il salvataggio la casella è
disabilitata; in caso di errore torna allo stato precedente e sotto la riga compare "Premio non salvato:
controlla la connessione e riprova." (rete) o "Premio non salvato: riprova." (`not-found`/`unknown`, con
ricarica); `forbidden` → messaggio di permesso e `reportNotEnabled()`. Dopo il successo l'elenco si ricarica,
la riga si sposta al suo posto e il focus resta sulla sua casella. Area di tocco ≥ 48 px.
**Accettazione:**
- [ ] Componenti: disattiva → riga in grigio in fondo con il focus sulla sua casella; riattiva → torna tra
      gli attivi; casella disabilitata durante la chiamata; errore di rete → stato ripristinato e messaggio
- [ ] Componenti: `forbidden` → "Solo per gli amministratori" e `reportNotEnabled()` chiamato
**Verifica:** `npm test`
**Dipendenze:** 8 · **File:** src/features/rewards/RewardRow.tsx (+ .module.css),
src/features/rewards/RewardsCatalogPage.tsx (+ .test.tsx) · **Dimensione:** M

## Checkpoint C
- [ ] Suite unità/componenti verde
- [ ] Detector Impeccable pulito; screenshot 390×844 dell'elenco confrontato con "Catalogo premi"
- [ ] Revisione con l'utente

## Task 10: Riquadro Nuovo premio
**Descrizione:** `RewardForm` fisso in basso (`surface-alt`): "Nuovo premio", "Nome del premio" ("Es.
Spremuta"), "Punti richiesti" ("Es. 80", `inputMode="numeric"`), casella "Attivo" spuntata, "Aggiungi premio"
primario. Id con `crypto.randomUUID()` all'apertura del modulo. Validazione con `validateReward()`: errore
sotto il campo e focus sul primo campo errato, nessuna chiamata. Successo: il premio compare in elenco, campi
svuotati, nuovo id, `aria-live` "Premio aggiunto", elenco ricaricato. Disabilitato durante il caricamento.
**Accettazione:**
- [ ] Componenti: "Spremuta" 80 → riga tra Caffè e Cornetto e cappuccino, campi vuoti, annuncio; errori di
      validazione con il focus giusto e nessuna chiamata
- [ ] Componenti: dopo un salvataggio riuscito il successivo usa un id nuovo
- [ ] Etichette accessibili; target ≥ 48 px
**Verifica:** `npm test`
**Dipendenze:** 8 · **File:** src/features/rewards/RewardForm.tsx (+ .module.css, .test.tsx),
src/features/rewards/RewardsCatalogPage.tsx · **Dimensione:** M

## Task 11: Errori in scrittura del nuovo premio
**Descrizione:** "Aggiungi premio" `busy` e disabilitato fino alla risposta; `name-taken` → "Esiste già un
premio con questo nome" sotto il nome; rete → "Premio non salvato: controlla la connessione e riprova." con
campi intatti, e "Riprova" o un nuovo tocco reinviano **con lo stesso id**; se il server restituisce un premio
già salvato con quell'id, in elenco va la riga del server; `invalid` → messaggi di validazione;
`not-found`/`unknown` → "Premio non salvato: riprova." e ricarica; `forbidden` → messaggio di permesso e
`reportNotEnabled()`; guasti del server con le loro parole.
**Accettazione:**
- [ ] Componenti: doppio tocco = una chiamata; rete poi Riprova → due chiamate con lo stesso id e una sola
      riga; risposta persa poi modulo cambiato e Riprova → in elenco i valori del server
- [ ] Componenti: nome già usato con maiuscole diverse → messaggio sotto il nome; `forbidden` → permesso
**Verifica:** `npm test`
**Dipendenze:** 10 · **File:** src/features/rewards/RewardForm.tsx (+ .test.tsx),
src/features/rewards/RewardsCatalogPage.tsx · **Dimensione:** M

## Task 12: Modifica premio
**Descrizione:** nome e punti della riga sono un pulsante (≥ 48 px) che porta il riquadro in "Modifica
premio" con i campi compilati, senza casella Attivo, con "Salva modifiche" (primario, `busy`) e "Annulla"
(secondario), e la nota "Nome e punti valgono per i riscatti da ora in poi: i riscatti già registrati non
cambiano." La riga è evidenziata; le altre non aprono una seconda modifica. Dopo il salvataggio o
"Annulla" il riquadro torna a "Nuovo premio" con la bozza e l'id di prima. Stessi errori del task 11
(il reinvio di `update` è sicuro di per sé).
**Accettazione:**
- [ ] Componenti: modifica nome e punti → riga aggiornata e riordinata; "Annulla" → bozza Nuovo premio intatta
      con lo stesso id; durante la modifica le altre righe non aprono la modifica
- [ ] Componenti: nome già usato, rete, `not-found` con ricarica in modifica
**Verifica:** `npm test`
**Dipendenze:** 11 · **File:** src/features/rewards/RewardForm.tsx (+ .test.tsx), RewardRow.tsx,
src/features/rewards/RewardsCatalogPage.tsx (+ .test.tsx) · **Dimensione:** M

## Checkpoint D
- [ ] Ogni stato della spec ha un test di componente (criterio 7)
- [ ] Detector Impeccable pulito; screenshot 390×844 confrontato con "Catalogo premi" e "Impostazioni
      (amministratore)"
- [ ] Revisione con l'utente

## Task 13: E2E dei premi
**Descrizione:** `e2e/rewards.spec.ts` nel progetto `phone`: admin → Impostazioni → Catalogo premi → premi
del seed nell'ordine del wireframe → aggiunge "Spremuta E2E <suffisso>" 80 punti → lo vede al suo posto →
riprova lo stesso nome in maiuscolo e vede "Esiste già un premio con questo nome" → lo disattiva
("non visibile alla cassa") → ricarica e lo stato resta → lo riattiva → lo rinomina. Operatore: nessuna riga
"Catalogo premi"; l'URL diretto mostra "Solo per gli amministratori". Target ≥ 48 px, caselle comprese. I
premi del seed non si modificano.
**Accettazione:**
- [ ] E2E verde a 390×844 contro Supabase locale, anche ripetuto senza `db:reset`
- [ ] Nessuna chiamata a `*.supabase.co` (fixture `onlyLocalSupabase`)
**Verifica:** `npm run db:start && scripts/reload-auth-templates.sh && npm run e2e`
**Dipendenze:** 12 · **File:** e2e/rewards.spec.ts · **Dimensione:** S

## Task 14: Documentazione e chiusura
**Descrizione:** sezione "Verifica dei criteri di successo" in `plan.md` (ogni criterio con le prove scritte
come `file › titolo del test`) e `scripts/rewardsCriteria.test.ts` che la controlla (come
`customersCriteria.test.ts`); `brain/MAP.md` (file del modulo), `brain/STATUS.md`, RUNBOOK (trappole
trovate); i task segnati in questo file.
**Accettazione:**
- [ ] Ognuno dei 9 criteri di successo con almeno un test che esiste davvero nel file indicato
- [ ] Nessun segreto né dato reale nei documenti
**Verifica:** quality bar completa verde; rilettura
**Dipendenze:** 13 · **File:** tasks/rewards/plan.md, tasks/rewards/todo.md, scripts/rewardsCriteria.test.ts,
brain/MAP.md, brain/STATUS.md · **Dimensione:** S

## Checkpoint E
- [ ] I 9 criteri di successo di SPEC-rewards verificati
- [ ] Quality bar completa verde in locale e in CI
- [ ] PR (base `main`, da unire dopo #16 e #17) pronta per `code-review-and-quality`
