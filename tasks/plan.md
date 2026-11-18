# Implementation Plan: platform

Source spec: [SPEC-platform.md](../docs/specs/SPEC-platform.md) (approvata il 2026-11-16)

## Overview

Base dell'app senza funzioni di dominio: PWA React/Vite installabile, Supabase locale con RLS
predefinita testata, componenti del design system "Enjoy Bar", CI su GitHub Actions e deploy su Vercel.
Alla fine, ogni modulo successivo aggiunge schermate, migrazioni e test senza nuove scelte di stack.

## Architecture Decisions

- **RLS "predefinita" con un event trigger.** Postgres non attiva la RLS da solo sulle nuove tabelle. Un
  event trigger su `ddl_command_end` la attiva su ogni tabella creata nello schema `app`. Un test pgTAP
  lo dimostra (criterio di successo 6).
- **Prima i rischi.** Supabase locale, RLS e CI con Docker sono le parti più incerte, quindi vengono
  subito dopo lo scaffold. La UI arriva dopo.
- **Prima `/impeccable init`, poi la UI.** Si parte dal design system, poi si costruiscono i componenti
  (task 4).
- **Logo e icona provvisori.** Finché non arrivano i file definitivi: testo "Enjoy" in Texturina
  nell'header e icona generata dal colore `enjoy-green`. Si sostituiscono senza toccare il codice.
- **Account esterni.** Supabase (produzione + staging, UE) e Vercel li crea l'utente. Il task 11 prepara
  configurazione e istruzioni; il collegamento richiede un'azione dell'utente.

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Fondamenta
- [x] Task 1: Scaffold Vite + React + TS strict, router (`/`, 404), error boundary, Oxlint, Prettier, Vitest
- [x] Task 2: `format.ts` (`formatCents`, `formatPoints`) con TDD
- [x] Task 3: Supabase locale, migrazione iniziale (schema `app`, RLS automatica), test pgTAP, client

### Checkpoint A: typecheck, lint, test, db:test verdi; revisione con l'utente

### Fase 2: Aspetto e componenti
- [x] Task 4: `/impeccable init`, token (`design/tokens.json` → `tokens.css`), font self-hosted, base.css
- [x] Task 5: `Button`, `TextField`, `SearchField` con test di accessibilità
- [x] Task 6: `ListRow`, `PointsBadge`, `ScreenTitle`, `StatusView`
- [x] Task 7: `ConfirmDialog` e `AppShell` con schermata segnaposto

### Checkpoint B: tutto verde; schermata segnaposto vista sul telefono (390×844); detector Impeccable pulito

### Fase 3: PWA, automazione, pubblicazione
- [x] Task 8: PWA (manifest, icone provvisorie, service worker solo app shell) + E2E Playwright
- [x] Task 9: `npm run dev:https` per provare sul telefono
- [x] Task 10: CI GitHub Actions (typecheck, lint, test, build, db:test, e2e)
- [ ] Task 11: Vercel (`vercel.json`, CSP, intestazioni), istruzioni per gli account, RUNBOOK e CLAUDE.md

### Checkpoint C (completo): i 9 criteri di successo della spec verificati, PR pronta per la review

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Versioni molto recenti (TS 7, Vite 8, Router 8) con plugin non ancora allineati | Medio | Verificare la compatibilità dei plugin nel task 1; in caso di problemi, chiedere prima di scendere di versione |
| L'event trigger per la RLS non agisce sulle tabelle create da migrazioni Supabase | Alto | Il test pgTAP crea una tabella vera e verifica l'accesso negato; è nel task 3, all'inizio |
| `supabase start` in CI lento o instabile | Medio | Avviare solo i servizi necessari (`-x` per escludere studio, storage ecc.); job separato per il database |
| La CSP blocca font, service worker o Supabase | Medio | Verificata dall'E2E (console pulita) e sull'anteprima Vercel |
| Web NFC e installazione non verificabili in CI | Basso | Prova manuale su Android (criteri 4 e 5), registrata nello STATUS |
| Logo e icona definitivi non ancora disponibili | Basso | Segnaposto sostituibili; il criterio 4 si chiude con l'icona definitiva |

## Open Questions

- Logo SVG e icona quadrata: quando arrivano? (non bloccanti)
- Monitoraggio errori: fuori da questo modulo, da decidere prima del lancio.
