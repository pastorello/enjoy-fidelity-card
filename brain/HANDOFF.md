# HANDOFF — Rapporto di turno

> Si scrive quando l'utente cambia finestra o passa il lavoro ("hand off"). Prima di riscriverlo, spostare
> ciò che vale ancora in STATUS / DECISIONS / RUNBOOK, poi archiviarlo in `handoffs/AAAA-MM-GG-HHMM.md`.
> Sezioni (cancellare quelle vuote): Questo turno · Prima cosa per la prossima finestra · Procedure trovate ·
> In attesa di altri · Nuove trappole · Ancora caldo.

## Questo turno (2026-11-19)

- `tablet-kiosk`, task 27: tabella "Verifica dei criteri di successo" in `tasks/tablet-kiosk/plan.md` e
  `scripts/kioskCriteria.test.ts` (ogni criterio 1-8 cita prove che esistono davvero). Quality bar
  completa, build e `check:bundle` verdi in locale. PR da `feat/tablet-kiosk` verso `main` aperta in bozza.
- `tablet-kiosk`, task 23-25: layout 1280×800 di Registra spesa, Premio libero, Riscatta premio, Nuovo
  cliente, Associa card, Catalogo premi e conferme (cornice comune `TabletColumns`), misurati in
  `e2e/tablet-layout.spec.ts`. Criterio 7 completo; PR #23 pronta per la revisione.

## Prima cosa per la prossima finestra

- PR #23 (`tablet-kiosk`) da unire; poi `db push` delle due migrazioni `*_tablet_kiosk*.sql` sullo staging
  e, dopo il merge, in produzione.

## In attesa di altri

- Prova sul tablet vero con il lettore USB, con l'utente, dopo `db push` sullo staging (`docs/setup-tablet.md`).
- Decisioni aperte del piano: blocchi crescenti contro la forza bruta sul PIN; password dell'account del bar
  cambiabile dall'API di Auth.
