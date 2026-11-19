# HANDOFF — Rapporto di turno

> Si scrive quando l'utente cambia finestra o passa il lavoro ("hand off"). Prima di riscriverlo, spostare
> ciò che vale ancora in STATUS / DECISIONS / RUNBOOK, poi archiviarlo in `handoffs/AAAA-MM-GG-HHMM.md`.
> Sezioni (cancellare quelle vuote): Questo turno · Prima cosa per la prossima finestra · Procedure trovate ·
> In attesa di altri · Nuove trappole · Ancora caldo.

## Questo turno (2026-11-19)

- `tablet-kiosk`, task 27: tabella "Verifica dei criteri di successo" in `tasks/tablet-kiosk/plan.md` e
  `scripts/kioskCriteria.test.ts` (ogni criterio 1-8 cita prove che esistono davvero). Quality bar
  completa, build e `check:bundle` verdi in locale. PR da `feat/tablet-kiosk` verso `main` aperta in bozza.

## Prima cosa per la prossima finestra

- **Task 23-25 di `tablet-kiosk` ancora aperti** (layout 1280×800 di Registra spesa, Premio libero,
  Riscatta premio, Nuovo cliente, Associa card, Catalogo premi, conferme; E2E dei layout). Finché mancano,
  il criterio 7 è solo parziale e la PR resta in bozza. Fatti questi, aggiornare la riga 7 della tabella in
  `plan.md` con le prove E2E e togliere la bozza dalla PR.

## In attesa di altri

- Prova sul tablet vero con il lettore USB, con l'utente, dopo `db push` sullo staging (`docs/setup-tablet.md`).
- Decisioni aperte del piano: blocchi crescenti contro la forza bruta sul PIN; password dell'account del bar
  cambiabile dall'API di Auth.
