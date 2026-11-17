# Implementation Plan: identity

Source spec: [SPEC-identity.md](../../SPEC-identity.md) (approvata il 2026-11-17)

## Overview

In V1 si entra nell'app con email e password. Gli account si creano a mano nel pannello di Supabase e si
collegano a un profilo operatore con `private.add_operator`. Alla fine ogni pagina richiede un operatore
collegato, le Impostazioni mostrano chi è entrato con il pulsante "Esci", e chi viene tolto dal pannello
perde subito l'accesso ai dati. È anche la prima volta che l'app parla davvero con Supabase: test E2E e CI
passano a usare lo stack Supabase locale.

## Architecture Decisions

- **Profilo separato dall'utente di Auth.** `app.operators.id` è un uuid suo, `user_id` punta a
  `auth.users` con `on delete set null`. Cancellare l'utente dal pannello non è bloccato dai movimenti
  futuri e lascia il nome nello storico (spec, "Modello dati").
- **Prima l'infrastruttura dei test, poi la UI.** Il rischio maggiore non è la pagina di accesso ma far
  girare E2E e CI contro Supabase locale: build con le variabili locali al posto dello staging del `.env`,
  CSP di `vite preview` che ammette `http://localhost:54321`, CI con Docker. Per questo è il task 2.
- **E2E e test di integrazione usano sempre lo stack locale, mai lo staging.** Il `.env` ora punta allo
  staging; `playwright.config.ts` e il config di integrazione passano le variabili locali lette da
  `supabase status` (le variabili d'ambiente hanno la precedenza sul `.env` in Vite).
- **Utenti finti nel seed.** `supabase/seed.sql` crea un amministratore e un operatore `@example.com` con
  password nota, usati da E2E e integrazione. Il repo è pubblico: nessun dato reale.
- **Accesso ai dati solo tramite hook.** `AuthProvider` tiene la sessione; `useCurrentOperator` legge il
  profilo collegato. Profilo assente = nessun accesso (stessa regola della RLS).
- **Revisione di sicurezza obbligatoria** (`security-and-hardening`) al Checkpoint B: auth e RLS.

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Fondamenta
- [x] Task 1: Migrazione `operators`, funzioni di accesso, `add_operator`, schema `app` esposto, seed, pgTAP
- [x] Task 2: E2E e CI contro Supabase locale (variabili, CSP di preview, CI con Docker)

### Checkpoint A: db:test e la suite E2E esistente verdi in locale e in CI

### Fase 2: Accesso
- [x] Task 3: `AuthProvider`, `useSession`, `useCurrentOperator` (test con client finto)
- [x] Task 4: Pagina `/accedi` e guardia `RequireAuth` su tutte le rotte
- [ ] Task 5: Impostazioni con riquadro account ed "Esci"; pulsante account nell'`AppShell`

### Checkpoint B: flusso completo in E2E; detector Impeccable pulito; revisione di sicurezza

### Fase 3: Account tolto e consegna
- [ ] Task 6: Account tolto o senza profilo → `/accedi` con messaggio; test di integrazione contro lo stack locale
- [ ] Task 7: Procedura in `docs/setup-accounts.md`, RUNBOOK, CLAUDE.md
- [ ] Task 8: Pubblicazione su staging e produzione (con l'utente)

### Checkpoint C: criteri di successo della spec; prova su Android; PR pronta per `code-review-and-quality`

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| E2E punta per errore allo staging (`.env`) | Alto | Variabili locali passate esplicitamente da `playwright.config.ts`; test che fallisce se l'URL non è locale |
| CSP di produzione blocca `http://localhost:54321` in `vite preview` | Medio | Origine locale aggiunta a `connect-src` solo nelle intestazioni di preview, mai in `vercel.json` |
| CI più lenta con Supabase completo | Medio | Avviare solo i servizi necessari (`supabase start -x` per studio, storage, realtime…) |
| Inserire utenti in `auth.users` dal seed cambia tra versioni di Supabase | Medio | Seed con la forma documentata (utente + identità); test di integrazione che accede con quelle credenziali |
| Il token di un utente cancellato resta valido fino a un'ora | Basso | La RLS controlla il profilo collegato, non il token: nessun dato leggibile (pgTAP + integrazione) |
| Remoto: schema `app` non esposto nella Data API | Medio | Passo esplicito nella procedura e nel task 8 |

## Open Questions

Nessuna. Deciso il 2026-11-17: un utente senza profilo collegato vede "Account non abilitato: chiedi a un
amministratore." (non il messaggio di sessione scaduta).
