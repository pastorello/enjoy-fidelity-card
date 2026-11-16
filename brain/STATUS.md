# STATUS — Stato attuale

> Stato istantaneo, sovrascrivibile. Limite indicativo: ~80 righe / ~6.000 caratteri.
> Prima di sovrascrivere, spostare ciò che vale in `MAP.md` o `DECISIONS.md`.

---

## Cosa stiamo facendo

Fase di definizione chiusa: intento confermato con `interview-me` e `brain/` creato. Nessun codice
applicativo ancora. Prossimo: portare la specifica nel repo.

## Come verificarlo

- Nulla di automatico: nessun codice né test ancora.
- `git log --oneline` e `git status -sb` per lo stato del repo.

## Prossimi passi

1. `spec-driven-development`: unire specifiche (doc), wireframe e `DECISIONS.md` in `docs/specs/`,
   includendo le aggiunte al modello dati (DECISIONS 2026-11-16).
2. `planning-and-task-breakdown`: piano dei task per le tre fasi.
3. `/impeccable init` partendo dal design system "Enjoy Bar" prima del primo lavoro di UI.
4. Setup progetto: Supabase (regione UE), Vercel, struttura app PWA; compilare i comandi in
   `CLAUDE.md` e `brain/topics/operations/RUNBOOK.md`.

## Bloccanti / da confermare

- **Testo dell'informativa e del consenso privacy**: da far verificare al consulente del bar (blocca il
  lancio, non lo sviluppo).
- **Lettore NFC USB**: da scegliere e acquistare (blocca la fase tablet); verificare il formato dell'uid.
- **Amministratori iniziali** (nomi/email): servono al primo deploy.

## Modifiche non pubblicate

- Branch `docs/claude-md-from-spec` (CLAUDE.md + brain/) non ancora su GitHub.
- 2 commit locali su `main` non pubblicati (skill webapp-testing, plugin project-brain).

## Ultima sessione

- Repo creato (pubblico) e skill installate: Addy Osmani, Impeccable, webapp-testing, project-brain.
- CLAUDE.md riscritto in base a specifiche e wireframe.
- `interview-me` completata: perimetro = tutte e tre le fasi; decisioni in `DECISIONS.md`.
- `brain/` creato e compilato.
