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
- [ ] Task 1: Tabella `rewards`, RLS, privilegi e `create_reward` idempotente; pgTAP
- [ ] Task 2: `update_reward` e `set_reward_active`; nessuna cancellazione né trigger; seed; pgTAP

### Checkpoint A: db:test verde; revisione di sicurezza su RLS, privilegi e RPC

### Fase 2: Contratto del frontend
- [ ] Task 3: Tipi, `sortRewards`, `validateReward` (funzioni pure)
- [ ] Task 4: `supabaseRewardsService`, guardia del confine, integrazione contro lo stack locale
- [ ] Task 5: Servizio finto, `RewardsServiceProvider` in `main.tsx` e `renderApp`

### Checkpoint B: unità e integrazione verdi; test esistenti invariati

### Fase 3: Impostazioni e catalogo
- [ ] Task 6: Sezione GESTIONE nelle Impostazioni (solo admin, nell'ordine fissato)
- [ ] Task 7: Rotta `/impostazioni/premi` e messaggio di permesso per l'operatore (icona `lock`)
- [ ] Task 8: Elenco del catalogo: caricamento, vuoto, errore con Riprova, ordine, premio inattivo
- [ ] Task 9: Casella Attivo: salvataggio immediato, ripristino in caso di errore, `forbidden`

### Checkpoint C: catalogo in sola lettura e attiva/disattiva verdi; Impeccable pulito

### Fase 4: Nuovo premio e modifica
- [ ] Task 10: Riquadro Nuovo premio: campi, validazione, aggiunta e annuncio
- [ ] Task 11: Errori in scrittura: nome già usato, rete e reinvio con lo stesso id, doppio tocco
- [ ] Task 12: Modifica premio nel riquadro in basso, con ritorno alla bozza

### Checkpoint D: tutti gli stati con test di componente; Impeccable pulito; confronto con il wireframe a 390×844

### Fase 5: E2E e chiusura
- [ ] Task 13: `e2e/rewards.spec.ts` (admin e operatore, Supabase locale)
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
