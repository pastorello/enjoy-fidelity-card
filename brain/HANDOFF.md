# HANDOFF — Rapporto di turno

> Si scrive quando l'utente cambia finestra o passa il lavoro ("hand off"). Prima di riscriverlo, spostare
> ciò che vale ancora in STATUS / DECISIONS / RUNBOOK, poi archiviarlo in `handoffs/AAAA-MM-GG-HHMM.md`.
> Sezioni (cancellare quelle vuote): Questo turno · Prima cosa per la prossima finestra · Procedure trovate ·
> In attesa di altri · Nuove trappole · Ancora caldo.

## Questo turno (2026-11-23)

- `customers-v2` (richiesta del titolare del 2026-11-23), task 37: tabella "Verifica dei criteri di successo"
  in `tasks/customers-v2/plan.md` e `scripts/customersV2Criteria.test.ts` (ogni criterio 1-13 cita prove che
  esistono davvero; pgTAP, integrazione, E2E telefono e tablet e passi della CI dove la spec li chiede).
  Quality bar completa, build e `check:bundle` verdi in locale. PR da `feat/customers-v2` verso `main`,
  indipendente dalla #24 (`operators`).
- Turno precedente archiviato in `handoffs/2026-11-19-0000.md` (`tablet-kiosk`, PR #23).

## Prima cosa per la prossima finestra

- **Open Question 17** di `docs/specs/SPEC-customers-v2.md`, da chiedere al titolare **prima del merge**:
  «Cancelliamo anche i numeri già salvati? Non si potranno recuperare.»
- Ordine di merge tra #24 e la PR di `customers-v2`: nessuna dipendenza, ma file in comune (elencati nella
  PR). Chi arriva secondo si riallinea a `main` e rilancia la quality bar; le migrazioni di #24 hanno
  timestamp precedenti a quelle di `customers-v2`.
- Dopo il merge: `db push` delle migrazioni sullo staging, poi in produzione (RUNBOOK, note di rilascio di
  `customers-v2`); prove a mano su Android (Riformatta, pagina pubblica con i premi).

## In attesa di altri

- Titolare: Open Question 17; revisione dei testi nuovi (Open Question 15) e dell'informativa senza telefono
  con il consulente.
- Prova sul tablet vero con il lettore USB, con l'utente (`docs/setup-tablet.md`).
