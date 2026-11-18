# Implementation Plan: rewards

Source spec: [SPEC-rewards.md](../../docs/specs/SPEC-rewards.md) (approvata il 2026-11-17; le Open Questions usano i
default adottati)

## Overview

Gli amministratori tengono il catalogo dei premi fissi da `/impostazioni/premi`: aggiungono un premio (nome,
punti, attivo), lo attivano e disattivano con la casella della riga, ne correggono nome e punti; un premio
non si cancella mai. Nasce la tabella `app.rewards`, leggibile da ogni operatore attivo e scrivibile solo
con tre RPC `security definer` riservate agli amministratori (`create_reward` idempotente sull'id generato
dall'app, `update_reward`, `set_reward_active`). Le Impostazioni guadagnano la sezione GESTIONE (solo
admin); `RewardsService.listActive()` e `sortRewards()` sono l'interfaccia che userà `ledger` per "Riscatta
premio". La schermata di riscatto, il premio libero e la conservazione di nome e punti nei movimenti si
verificano in `ledger`.

## Architecture Decisions

- **Prima il database, poi il servizio, poi la UI.** I rischi maggiori sono sul server: un operatore che
  scrive nel catalogo chiamando l'API a mano, `execute` concesso di default a `public`, un reinvio con lo
  stesso id che crea due premi o risponde "nome già usato", l'unicità del nome senza distinzione di
  maiuscole e con gli spazi tolti, nessuna via per cancellare un premio. Si fissa tutto con pgTAP nei task
  1–2, prima di ogni riga di UI.
- **Una sola migrazione `*_rewards.sql`**, creata con `npx supabase migration new rewards` (quindi dopo
  quelle di `customers`) e completata nei task 1–2 (non ancora pubblicata: si modifica in place, si applica
  con `npm run db:reset`). Contiene `create or replace function private.acting_operator_id()` con il corpo
  comune parola per parola (`SPEC-settings.md`, cross-review §1), senza `grant`; `execute` delle tre RPC
  revocato a `public`/`anon` e concesso in modo esplicito ad `authenticated` (coperto da
  `function_privileges.test.sql`). Nessuna migrazione inserisce premi: in produzione il catalogo parte vuoto.
- **Codici di errore SQLSTATE, come fissati dalla spec** (non i messaggi-codice `P0001` di `customers`):
  `42501` ruolo, `23505` con vincolo `rewards_name_key`, `23514` valori fuori limite, `P0002` id
  inesistente. Ordine dei controlli in ogni RPC: ruolo → idempotenza → validazione. Una guardia in
  `scripts/rewardsBoundary.test.ts` verifica che ogni `errcode` sollevato dalla migrazione abbia una
  traduzione nel servizio (stesso scopo di `scripts/customerErrorCodes.test.ts`).
- **Un solo punto di accesso a Supabase.** Solo `supabaseRewardsService.ts` legge `app.rewards` e chiama le
  RPC (guardia `scripts/rewardsBoundary.test.ts`, come `customersBoundary.test.ts`); traduce gli errori in
  `'name-taken' | 'invalid' | 'not-found' | 'forbidden' | 'network' | 'unknown'`. Un `42501` di permesso
  mancante ("permission denied for …") e gli altri guasti del server passano da `serverFaultFor` di
  `src/lib/serverFault.ts`: le letture e le scritture rifiutano con `ServerFaultError` (stesso schema di
  `customers`), e la pagina li dice con le parole dei guasti già usate in `customers`.
- **Servizio iniettato come gli altri moduli.** `RewardsServiceProvider` / `useRewardsService()` in
  `main.tsx` e in `renderApp` (quarto parametro facoltativo, test esistenti invariati); `useRewards()`
  tiene caricamento/errore/dati e ricarica. Il finto `src/test/fakeRewardsService.ts` replica i controlli del
  server (ruolo, nome unico case-insensitive con `btrim`, idempotenza sull'id), registra le chiamate con gli
  id ricevuti e simula rete giù e "arrivato ma risposta persa".
- **Logica pura separata**: `sortRewards()` (attivi poi inattivi, per punti, poi nome con `localeCompare`
  `it`) è l'unica fonte dell'ordine, anche per `listActive()`; `validateReward()` ripete in app i limiti del
  server con i testi della spec.
- **Ruolo dall'interfaccia, autorità sul server.** `useCurrentOperator()` decide se mostrare GESTIONE e il
  catalogo; un operatore sull'URL diretto vede "Solo per gli amministratori" e non parte nessuna chiamata.
  Un `forbidden` in scrittura mostra lo stesso messaggio e chiama `useAuth().reportNotEnabled()`, già
  presente in `AuthProvider`.
- **Riga del catalogo propria, non `ListRow`** (la spec lo chiede: niente controlli annidati); casella
  Attivo con area ≥ 48 px e nome accessibile "<premio> attivo". Nuova icona `lock` in `Icon.tsx` (Lucide).
- **Enjoy Display**: titoli e pulsanti ("Catalogo premi", "Aggiungi premio", "Salva modifiche", titoli di
  `StatusView`) senza `… « » @ # * × →` (`scripts/displayGlyphs.test.ts`).
- **E2E nel progetto `phone`** (parallelo): il premio creato ha un nome con suffisso unico per esecuzione; i
  premi del seed non si modificano (servono all'E2E di `ledger`).
- **Revisione di sicurezza obbligatoria** (`security-and-hardening`) al Checkpoint A: RLS, privilegi,
  `search_path` vuoto, ruolo solo sul server, nessuna cancellazione possibile.
- **Pubblicazione esclusa da questo piano:** le migrazioni su staging e produzione le esegue l'orchestratore.
  La PR va su `main` e si unisce dopo #16 (`feat/customers`) e #17 (`chore/specs-folder`).

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Database (rischio più alto)
- [x] Task 1: Tabella `rewards`, RLS, privilegi e `create_reward` idempotente; pgTAP
- [x] Task 2: `update_reward` e `set_reward_active`; nessuna cancellazione né trigger; seed; pgTAP

### Checkpoint A: db:test verde; revisione di sicurezza su RLS, privilegi e RPC

### Fase 2: Contratto del frontend
- [x] Task 3: Tipi, `sortRewards`, `validateReward` (funzioni pure)
- [x] Task 4: `supabaseRewardsService`, guardia del confine, integrazione contro lo stack locale
- [x] Task 5: Servizio finto, `RewardsServiceProvider` in `main.tsx` e `renderApp`

### Checkpoint B: unità e integrazione verdi; test esistenti invariati

### Fase 3: Impostazioni e catalogo
- [x] Task 6: Sezione GESTIONE nelle Impostazioni (solo admin, nell'ordine fissato)
- [x] Task 7: Rotta `/impostazioni/premi` e messaggio di permesso per l'operatore (icona `lock`)
- [x] Task 8: Elenco del catalogo: caricamento, vuoto, errore con Riprova, ordine, premio inattivo
- [x] Task 9: Casella Attivo: salvataggio immediato, ripristino in caso di errore, `forbidden`

### Checkpoint C: catalogo in sola lettura e attiva/disattiva verdi; Impeccable pulito

### Fase 4: Nuovo premio e modifica
- [x] Task 10: Riquadro Nuovo premio: campi, validazione, aggiunta e annuncio
- [x] Task 11: Errori in scrittura: nome già usato, rete e reinvio con lo stesso id, doppio tocco
- [x] Task 12: Modifica premio nel riquadro in basso, con ritorno alla bozza

### Checkpoint D: tutti gli stati con test di componente; Impeccable pulito; confronto con il wireframe a 390×844

### Fase 5: E2E e chiusura
- [x] Task 13: `e2e/rewards.spec.ts` (admin e operatore, Supabase locale)
- [ ] Task 14: Documentazione, memoria di progetto e verifica dei criteri di successo

### Checkpoint E: i 9 criteri di successo verificati; quality bar completa verde; PR pronta per `code-review-and-quality`

## Copertura dei criteri di successo

| Criterio (docs/specs/SPEC-rewards.md) | Task |
|---|---|
| 1. "Spremuta, 80 punti, attivo" aggiunto compare al posto giusto e resta dopo il ricaricamento | 1, 3, 8, 10, 13 |
| 2. Disattivato: in grigio con "non visibile alla cassa né al cliente", assente da `listActive()`; riattivato ricompare | 2, 3, 4, 8, 9, 13 |
| 3. Rinomina, punti e disattivazione toccano solo la riga in `app.rewards` (nessun trigger, nessuna altra tabella) | 2 |
| 4. Doppio tocco o reinvio con lo stesso id → un solo premio | 1, 4, 5, 11 |
| 5. Stesso nome con maiuscole o spazi diversi → "Esiste già un premio con questo nome" | 1, 2, 3, 4, 11, 13 |
| 6. Operatore: `42501` da ogni RPC, `insert`/`update`/`delete` diretti rifiutati; nessuna cancellazione per nessuno | 1, 2, 4, 7, 9 |
| 7. Caricamento, vuoto, errore con Riprova e permesso con test di componente | 7, 8 |
| 8. A 390×844 gli elementi del wireframe "Catalogo premi"; Impeccable pulito; target ≥ 48 px | 6–12, 13 |
| 9. typecheck, lint, test, db:test (con `function_privileges.test.sql`) ed e2e verdi | ogni task; verifica finale nel 14 |

I criteri che dipendono da `ledger` si verificano lì: nome e punti dei riscatti già registrati invariati
dopo una modifica del premio, `redeem_reward` che rifiuta un premio inattivo, premio disattivato assente da
"Riscatta premio".

## Verifica dei criteri di successo

Verifica finale del task 14 (2026-11-18), con la quality bar completa verde in locale. Ogni prova è scritta
come `file › titolo del test` (per pgTAP la descrizione dell'asserzione); `scripts/rewardsCriteria.test.ts`
controlla che ogni criterio ne abbia almeno una e che ognuna esista davvero nel file indicato.

| Criterio (docs/specs/SPEC-rewards.md) | Test che lo prova |
|---|---|
| 1. "Spremuta, 80 punti, attivo" aggiunto compare al posto giusto e resta dopo il ricaricamento | `supabase/tests/rewards.test.sql › an admin creates a reward, the name saved without leading and trailing spaces`, `src/features/rewards/sortRewards.test.ts › lists the active rewards by points, then the inactive ones (the wireframe order)`, `src/features/rewards/RewardForm.test.tsx › adds "Spremuta" 80: the row lands between Caffè and Cornetto e cappuccino, the fields empty, "Premio aggiunto" announced`, `tests/integration/rewards.test.ts › creates a reward and gets the stored row back`, `e2e/rewards.spec.ts › adds, refuses a duplicate, deactivates, reloads, reactivates and renames a reward` |
| 2. Disattivato: in grigio con "non visibile alla cassa né al cliente", assente da `listActive()`; riattivato ricompare | `supabase/tests/rewards.test.sql › an admin deactivates a reward, name and points unchanged`, `supabase/tests/rewards.test.sql › an admin reactivates a reward`, `tests/integration/rewards.test.ts › a deactivated reward leaves listActive() and comes back when reactivated`, `src/features/rewards/supabaseRewardsService.test.ts › asks the server only for active = true and sorts by points, then name`, `src/features/rewards/RewardsCatalogPage.test.tsx › shows name, points and the Attivo box of each row; the inactive row is grey with its note`, `src/features/rewards/RewardsCatalogPage.test.tsx › deactivating saves at once: the row goes grey at the bottom with the focus on its box`, `src/features/rewards/RewardsCatalogPage.test.tsx › reactivating brings the row back among the active ones, the focus still on its box`, `e2e/rewards.spec.ts › adds, refuses a duplicate, deactivates, reloads, reactivates and renames a reward` |
| 3. Rinomina, punti e disattivazione toccano solo la riga in `app.rewards` (nessun trigger, nessuna altra tabella) | `supabase/tests/rewards.test.sql › app.rewards has no triggers`, `supabase/tests/rewards.test.sql › the rewards RPCs change no other table in app`, `supabase/tests/rewards.test.sql › the row count snapshot covers the other tables of app`, `supabase/tests/rewards.test.sql › update_reward does not change active` |
| 4. Doppio tocco o reinvio con lo stesso id → un solo premio | `supabase/tests/rewards.test.sql › the same id sent four times makes one row`, `supabase/tests/rewards.test.sql › the same id with a different name returns the existing row unchanged`, `tests/integration/rewards.test.ts › resending the same id returns the same row, even with other values`, `src/features/rewards/RewardForm.test.tsx › "Aggiungi premio" is busy until the answer: a double tap sends one call`, `src/features/rewards/RewardForm.test.tsx › a network error keeps the fields and offers "Riprova", which resends with the same id: one row`, `src/features/rewards/RewardForm.test.tsx › an answer lost after the save, then the form changed and "Riprova": the row of the server is listed` |
| 5. Stesso nome con maiuscole o spazi diversi → "Esiste già un premio con questo nome" | `supabase/tests/rewards.test.sql › a duplicate name in different case is refused`, `supabase/tests/rewards.test.sql › a duplicate name with leading and trailing spaces is refused`, `supabase/tests/rewards.test.sql › a rename to a used name reports the rewards_name_key constraint`, `tests/integration/rewards.test.ts › a new reward with the same name in capitals is name-taken`, `src/features/rewards/RewardForm.test.tsx › a name already used with other capitals: the message under the name, the focus there, the fields kept`, `src/features/rewards/RewardForm.test.tsx › a name already used with other capitals: the message under the name, the focus there, still changing`, `e2e/rewards.spec.ts › adds, refuses a duplicate, deactivates, reloads, reactivates and renames a reward` |
| 6. Operatore: `42501` da ogni RPC, `insert`/`update`/`delete` diretti rifiutati; nessuna cancellazione per nessuno | `supabase/tests/rewards.test.sql › an operator cannot call create_reward`, `supabase/tests/rewards.test.sql › an operator cannot call update_reward`, `supabase/tests/rewards.test.sql › an operator cannot call set_reward_active`, `supabase/tests/rewards.test.sql › an operator resending an existing id still gets 42501`, `supabase/tests/rewards.test.sql › an operator cannot insert directly`, `supabase/tests/rewards.test.sql › an operator cannot update directly`, `supabase/tests/rewards.test.sql › an operator cannot delete directly`, `supabase/tests/rewards.test.sql › no function in app or private deletes from app.rewards`, `supabase/tests/rewards.test.sql › no API role (anon, authenticated, service_role) can delete or truncate app.rewards`, `supabase/tests/rewards.test.sql › an admin cannot delete directly`, `tests/integration/rewards.test.ts › is forbidden from every write, even a resend of an existing id` |
| 7. Caricamento, vuoto, errore con Riprova e permesso con test di componente | `src/features/rewards/RewardsCatalogPage.test.tsx › shows the loading state while the catalogue loads, then the rewards`, `src/features/rewards/RewardsCatalogPage.test.tsx › an empty catalogue says so and invites to add the first reward`, `src/features/rewards/RewardsCatalogPage.test.tsx › a load error: says so, and "Riprova" loads again with the focus on the title`, `src/features/rewards/RewardsCatalogPage.test.tsx › tells an operator who opens the URL that the catalogue is for administrators, without calling the service`, `src/features/rewards/RewardsCatalogPage.test.tsx › forbidden after the role became operator: the page shows the permission message` |
| 8. A 390×844 gli elementi del wireframe "Catalogo premi"; Impeccable pulito; target ≥ 48 px | `src/features/rewards/RewardsCatalogPage.test.tsx › shows the catalogue title and a back link to the settings to administrators`, `src/features/rewards/RewardForm.test.tsx › shows the fields of the wireframe, Attivo ticked, in a box fixed at the bottom`, `src/features/rewards/RewardsSettingsSection.test.tsx › offers "Catalogo premi" to administrators`, `e2e/rewards.spec.ts › adds, refuses a duplicate, deactivates, reloads, reactivates and renames a reward`, `e2e/rewards.spec.ts › an operator has no Catalogo premi row, and the direct URL says it is for administrators` |
| 9. typecheck, lint, test, db:test (con `function_privileges.test.sql`) ed e2e verdi | `supabase/tests/function_privileges.test.sql › anon cannot execute any function in app or private`, `supabase/tests/function_privileges.test.sql › PUBLIC has no execute on any function in app or private`, `supabase/tests/rewards.test.sql › anon cannot execute create_reward`, `scripts/rewardsBoundary.test.ts › translates every errcode the rewards migrations raise`, `e2e/rewards.spec.ts › adds, refuses a duplicate, deactivates, reloads, reactivates and renames a reward` |

Note sul criterio 3: la conservazione di nome e punti nei riscatti già registrati si verifica nel pgTAP di
`ledger`, quando `app.movements` esisterà (lo dice la spec). Note sul criterio 8: il detector Impeccable non è
un test; `impeccable detect src/features/rewards src/shared/ui src/app` non segnala nulla (solo regole a
espressioni regolari, RUNBOOK trappola 36); i 48 px, caselle Attivo comprese, sono provati dall'E2E
dell'amministratore nel progetto Playwright `phone` (390×844). Note sul criterio 9: i comandi sono stati
eseguiti tutti, compresi `npm run format:check` e `npm run test:integration`; le prove citate sono i test che
il criterio nomina esplicitamente.

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| `execute` concesso di default a `public` sulle nuove RPC | Alto | `revoke`/`grant` espliciti; `function_privileges.test.sql` e pgTAP per `anon`/`authenticated` |
| Un operatore (o un ex admin) scrive nel catalogo chiamando le RPC | Alto | `private.is_admin()` come primo controllo, prima dell'idempotenza; pgTAP anche sul reinvio di un id esistente |
| Reinvio con lo stesso id: due righe o "nome già usato" | Alto | `insert … on conflict (id) do nothing` poi `select`; pgTAP con lo stesso id e nome diverso; test di componente con il finto che registra gli id |
| `23505` di un altro vincolo (la chiave primaria) scambiato per nome già usato | Medio | Il servizio traduce in `name-taken` solo se l'errore nomina `rewards_name_key`; unità con entrambi i casi e integrazione con l'errore reale |
| `42501` di permesso mancante confuso con "non sei admin" | Medio | `serverFaultFor` prima della traduzione (`permission denied for …` → `misconfigured`) |
| Ordine diverso tra database e app (collation) | Medio | Ordine calcolato solo da `sortRewards()`; il servizio non si fida dell'`order by` |
| Riga che si sposta dopo il cambio di stato e perde il focus | Medio | `key` = id e test di componente sul focus della casella dopo il riordino |
| Bozza Nuovo premio persa entrando in modifica | Basso | Stato della bozza (campi e id) separato da quello della modifica; test di componente |
| Seed dei premi modificato dagli E2E, che rompe `ledger` | Basso | L'E2E crea e rinomina solo il proprio premio con suffisso unico |
| Template email dopo `supabase start` | Basso | `scripts/reload-auth-templates.sh` dopo l'avvio dello stack (RUNBOOK) |

## Open Questions

Nessuna bloccante. Le Open Questions della spec usano i default adottati (nessuna cancellazione, modifica
nel riquadro in basso, limiti 1–60 e 1–99 999, "Caffe" ≠ "Caffè", punti attuali al riscatto, testo "né al
cliente", messaggio di permesso, colonne `created_by`/`updated_at`/`updated_by`, reinvio che restituisce il
premio salvato), da rivedere con il titolare (`docs/specs/cross-review.md` §3).
