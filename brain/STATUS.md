# STATUS — Stato attuale

> Stato istantaneo, sovrascrivibile. Limite indicativo: ~80 righe / ~6.000 caratteri.
> Prima di sovrascrivere, spostare ciò che vale in `MAP.md` o `DECISIONS.md`.

---

## Cosa stiamo facendo

Spec-driven development: capability map e `SPEC-platform.md` approvate (2026-11-16). Piano `platform`
approvato; task 1-3 fatti sul branch `feat/platform-scaffold`. Checkpoint A: revisione con l'utente, poi push e PR. Nessun codice applicativo ancora.

## Come verificarlo

- `npm run typecheck && npm run lint && npm test && npm run build`; `npm run db:start && npm run db:test`.
- `git log --oneline` e `git status -sb` per lo stato del repo.

## Prossimi passi

1. ~~Approvazione di `SPEC-platform.md`~~ fatto. Ancora aperti (non bloccanti): logo SVG/icona,
   monitoraggio errori prima del lancio.
2. `planning-and-task-breakdown` per `platform`, poi implementazione; poi spec dei moduli successivi
   nell'ordine della mappa (le aggiunte al modello dati vanno nelle spec di settings/ledger/tablet-kiosk).
3. `/impeccable init` partendo dal design system "Enjoy Bar" prima del primo lavoro di UI.
4. Setup progetto: Supabase (regione UE), Vercel, struttura app PWA; compilare i comandi in
   `CLAUDE.md` e `brain/topics/operations/RUNBOOK.md`.

## Bloccanti / da confermare

- **Testo dell'informativa e del consenso privacy**: da far verificare al consulente del bar (blocca il
  lancio, non lo sviluppo).
- **Lettore NFC USB**: da scegliere e acquistare (blocca la fase tablet); verificare il formato dell'uid.
- **Amministratori iniziali** (nomi/email): servono al primo deploy.
- **Account Supabase (prod + staging, UE) e Vercel**: li crea l'utente; servono prima del deploy, non per lo sviluppo locale.

## Modifiche non pubblicate

- Branch `docs/claude-md-from-spec` (CLAUDE.md + brain/) non ancora su GitHub.
- 2 commit locali su `main` non pubblicati (skill webapp-testing, plugin project-brain).

## Ultima sessione

- Repo creato (pubblico) e skill installate: Addy Osmani, Impeccable, webapp-testing, project-brain.
- CLAUDE.md riscritto in base a specifiche e wireframe.
- `interview-me` completata: perimetro = tutte e tre le fasi; decisioni in `DECISIONS.md`.
- `brain/` creato e compilato.
