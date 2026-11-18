# Implementation Plan: export

Source spec: [SPEC-export.md](../../docs/specs/SPEC-export.md) (approvata il 2026-11-17; le Open Questions usano i
default adottati, da rivedere con il titolare: `docs/specs/cross-review.md` §3)

## Overview

Il titolare scarica sul telefono, in un tocco, due file CSV che si aprono bene in Excel in italiano:
**Clienti** (anagrafica e saldo) e **Movimenti** (tutto lo storico). In `/impostazioni`, ultima sezione,
"ESPORTA DATI" con i pulsanti "Clienti CSV" e "Movimenti CSV", solo per gli amministratori. I dati arrivano
da due RPC di sola lettura riservate agli admin (`app.export_customers`, `app.export_movements`), a pagine
da 1000 righe con cursore a chiave; i dati personali dei clienti anonimizzati sono azzerati **in SQL**. Il
client trasforma le righe in testo CSV con funzioni pure (BOM, `;`, CRLF, difesa dalle formule, euro da
centesimi, date in `Europe/Rome`) e lo salva con `Blob` + `<a download>`. Nessuna tabella nuova, nessuna
scrittura, nessuna chiave service role, nessuna funzione Edge.

## Architecture Decisions

- **Prima il database, poi la logica pura, poi il servizio, poi la UI** (rischio più alto in testa). I
  rischi gravi sono due: un operatore (o un ex admin) che esporta chiamando l'API a mano, e i dati personali
  di un anonimizzato che lasciano il server. Si fissano con pgTAP nei task 1–2 e con la revisione
  `security-and-hardening` al Checkpoint A, prima di ogni riga di client. Subito dopo la difesa dalla CSV
  injection (task 3), che è il rischio maggiore lato client.
- **Una sola migrazione `*_export.sql`**, creata con `npx supabase migration new export` (dopo quella di
  `ledger`) e completata nei task 1–2 (non pubblicata: si modifica in place e si applica con
  `npm run db:reset`). Le due funzioni sono `security definer`, `stable`, `set search_path = ''`; prima riga
  `if not private.is_admin() then raise exception … using errcode = '42501'`; poi la validazione
  (`p_limit` null o fuori 1–1000 → `22023`; cursore di `export_movements` con un solo campo null →
  `22023`). `execute` revocato a `public`/`anon`, concesso ad `authenticated` (resta verde
  `function_privileges.test.sql`). Saldo solo con `private.customer_balance()` di `ledger` (cross-review §2.8);
  l'indice `movements (created_at, id)` esiste già (`movements_created_idx`): nessun indice nuovo.
- **Anonimizzati azzerati nel `select`**, con `case when c.anonymized_at is not null then null else … end`
  su `name`, `phone`, `notes`, `active_card_uid` e `customer_name`, qualunque cosa contenga la riga; in più il
  client (task 5) scrive quei campi vuoti se `anonymizedAt` è valorizzato (difesa doppia, provata da unità).
- **Cursore come lo restituisce il server.** `created_at` arriva da PostgREST con i microsecondi: il cursore
  della pagina successiva è la stringa ricevuta, mai passata per `Date` (che tronca ai millisecondi e farebbe
  saltare o ripetere righe). `fetchAllPages` è generica (funzione pagina + estrattore del cursore), chiede
  pagine da 1000 finché ne riceve una più corta, ed è tutto-o-niente: un errore a qualunque pagina rifiuta.
- **Formato CSV in funzioni pure e senza DOM** (`csv.ts`, `formatExport.ts`, `build*Csv.ts`): campi tra
  virgolette solo con `;`, `"`, CR o LF; difesa dalle formule (apostrofo iniziale su `= + - @ TAB CR`) **solo
  sui campi di testo libero** (nomi, note, premio o descrizione, operatore); numeri e date intatti
  (`-12,50`, `-12`). `excelText` produce `="…"` solo per valori che rispettano `^\+?[0-9A-F]{1,20}$`, altrimenti
  ripiega sul testo libero protetto; il suo risultato contiene `"` e quindi passa da `escapeField`
  (`"=""+393331234567"""`), ma **non** dalla difesa dalle formule. Un test rilegge ogni riga con un parser
  RFC 4180 a `;` scritto nel test.
- **Euro e date solo in uscita**: `centsToEuroCell` (interi, niente `€` né migliaia; non intero →
  `RangeError`), distinta da `formatCents` di `src/shared/format.ts`; `romeDateTime` e `romeDateStamp` con
  `Intl.DateTimeFormat` `timeZone: 'Europe/Rome'`, `hourCycle: 'h23'`, componenti da `formatToParts`.
- **Un solo punto di accesso a Supabase.** Solo `supabaseExportService.ts` chiama le due RPC (guardia
  `scripts/exportBoundary.test.ts`, come `ledgerBoundary.test.ts`): `serverFaultFor` di
  `src/lib/serverFault.ts` per primo (un `42501` "permission denied for function" è un guasto, non un rifiuto)
  → `ServerFaultError`; `42501` dell'app → `forbidden`; `TypeError` di fetch → `network`; altro → `unknown`.
  La stessa guardia verifica che ogni `errcode` sollevato da `*_export.sql` abbia una traduzione, che solo
  `downloadFile.ts` tocchi `document`/`URL.createObjectURL`, e che il modulo non usi `console.*`,
  `localStorage` né `sessionStorage` (Boundaries: mai loggare il contenuto dei file).
- **Servizio iniettato come gli altri moduli.** `ExportServiceProvider` / `useExportService()` in
  `main.tsx` e in `renderApp` (nuovo parametro facoltativo in coda: i test esistenti restano invariati); il
  provider porta anche la funzione di download (default `downloadFile`), così i test di componente la
  sostituiscono. `src/test/fakeExportService.ts`: righe in memoria con dati `@example`, ruolo come il server
  (operatore → `forbidden`), rete giù anche alla seconda pagina, registro delle chiamate.
- **`useExport(kind)`** fa tutto il percorso (pagine → CSV → download → `ExportResult`) e ignora `run()`
  mentre è in corso (non solo il pulsante `busy`). Nessun `operation_id`: l'export legge soltanto.
- **Sezione nelle Impostazioni nell'ordine fissato** (cross-review §1, punto 6): `SettingsPage` rende
  `<ExportSection/>` dopo `RewardsSettingsSection` e prima di `OperatorFinalNote`, solo se
  `operator.role === 'admin'`. La nota finale dell'operatore esiste già (`settings`): nessun lavoro.
  Pulsanti `secondary` del design system, griglia a due colonne, nuova icona Lucide `download` in `Icon.tsx`
  (i tre tracciati del wireframe); regione `aria-live="polite"` per i messaggi della spec; `forbidden` chiama
  `useAuth().reportNotEnabled()`.
- **Enjoy Display**: "Clienti CSV", "Movimenti CSV" e il titolo "ESPORTA DATI" senza `… « » @ # * × →`
  (`scripts/displayGlyphs.test.ts`); i messaggi della regione sono testo normale.
- **E2E nel progetto `phone`** (parallelo, non tocca `app.settings`): cliente con nome univoco per esecuzione
  (`uniqueName` di `e2e/nfc.ts`), spesa di 12,50 € registrata con la UI; il file si legge da
  `download.path()`; la data attesa del nome file si calcola nel test con `Europe/Rome`.
- **Revisione di sicurezza obbligatoria** (`security-and-hardening`) al Checkpoint A (ruolo sul server,
  privilegi, anonimizzati, `search_path`, sola lettura) e al Checkpoint D (CSV injection, nessun dato nei log).
- **Pubblicazione esclusa da questo piano**: migrazioni remote, anteprima e produzione le gestisce
  l'orchestratore. La prova manuale sul telefono (criterio 10) si fa con l'utente sull'anteprima HTTPS dopo
  la pubblicazione su staging; questo piano scrive la procedura nel RUNBOOK. La PR va su `main` e si unisce
  dopo #21 (`feat/ledger`).

## Dependency Graph

```
migrazione export (task 1-2: export_customers, export_movements, privilegi)
    │
    ├── logica pura (task 3-6: csv, formatExport, build*Csv + tipi, fetchAllPages)
    │       │
    │       └── servizio + guardia (task 7) ── integrazione (task 8)
    │               │
    │               └── finto + provider + main/renderApp (task 9) ── useExport + downloadFile (task 10)
    │                       │
    │                       └── ExportSection nelle Impostazioni (task 11) ── stati e messaggi (task 12)
    │                               │
    │                               └── E2E (task 13) ── RUNBOOK e memoria (task 14) ── criteri e PR (task 15)
```

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Database (rischio più alto)
- [x] Task 1: `app.export_customers`: ruolo sul server, anonimizzati azzerati, saldo, paginazione, privilegi; pgTAP
- [x] Task 2: `app.export_movements`: cursore `(created_at, id)`, tipo, descrizione o premio, correzioni, anonimizzati; pgTAP

### Checkpoint A: `db:test` verde; revisione `security-and-hardening` su ruolo, privilegi, anonimizzati e sola lettura

### Fase 2: Logica pura
- [x] Task 3: `csv.ts`: BOM, `;`, CRLF, virgolette, difesa dalle formule, `excelText`
- [x] Task 4: `formatExport.ts`: euro da centesimi, date e nome file all'ora di Roma, etichette del tipo
- [ ] Task 5: Tipi, `buildCustomersCsv` e `buildMovementsCsv`: colonne, ordinamento, anonimizzati vuoti
- [ ] Task 6: `fetchAllPages`: paginazione a chiave tutto-o-niente

### Checkpoint B: unità verdi; test esistenti invariati

### Fase 3: Servizio
- [ ] Task 7: `supabaseExportService` e guardia del confine
- [ ] Task 8: Integrazione contro lo stack locale: operatore rifiutato, admin legge, anonimizzato senza nome nella risposta
- [ ] Task 9: `fakeExportService`, `ExportServiceProvider`, `main.tsx` e `renderApp`
- [ ] Task 10: `useExport` e `downloadFile`: percorso completo, niente doppio avvio, nessun file parziale

### Checkpoint C: quality bar completa verde; revisione con l'utente prima della UI

### Fase 4: Impostazioni
- [ ] Task 11: Sezione ESPORTA DATI (solo admin, ultima della pagina) con icona `download`
- [ ] Task 12: Stati della sezione: in corso, fatto, nessun dato, rete, permesso negato, imprevisto

### Checkpoint D: Impeccable pulito; confronto a 390×844 con il wireframe Impostazioni; revisione `security-and-hardening` del client

### Fase 5: E2E e chiusura
- [ ] Task 13: `e2e/export.spec.ts`: download e contenuto dei due file, rete interrotta, operatore senza sezione
- [ ] Task 14: Glifi, procedura manuale nel RUNBOOK, memoria di progetto
- [ ] Task 15: Verifica dei criteri di successo (`scripts/exportCriteria.test.ts`) e PR

### Checkpoint E: i criteri 1–9 verificati; quality bar completa verde; PR su `main` pronta per `code-review-and-quality`, da unire dopo #21; criterio 10 sul telefono con l'utente dopo la pubblicazione su staging

## Copertura dei criteri di successo

| Criterio (docs/specs/SPEC-export.md) | Task |
|---|---|
| 1. L'admin vede ESPORTA DATI con "Clienti CSV" e "Movimenti CSV" (48 px); l'operatore no | 11, 13 |
| 2. Da operatore le due RPC danno errore di permesso (pgTAP + integrazione) | 1, 2, 8 |
| 3. Movimenti: BOM, intestazione esatta, CRLF; spesa 1250 con rapporto 100 → `12,50`, `12`, `1,00` | 3, 4, 5, 13 |
| 4. 1° luglio 10:05 UTC → `01/07/2026 12:05:00`; 15 gennaio 10:05 UTC → `15/01/2026 11:05:00`, con qualunque fuso | 4, 5 |
| 5. Anonimizzato: campi personali vuoti, saldo corretto, `Cliente` vuoto; `null` dalle funzioni; nome originale assente dalla risposta HTTP | 1, 2, 5, 8 |
| 6. `=…` → `'=…`; nome con `;` e `"` tra virgolette, riletto identico da un parser RFC 4180 | 3, 5 |
| 7. 1001 movimenti → 1001 righe; errore di rete su una pagina → nessun download, messaggio, nuovo tocco riuscito | 6, 10, 12, 13 |
| 8. Nome file `enjoy-movimenti-AAAA-MM-GG.csv` con la data di Roma | 4, 10, 13 |
| 9. A 390×844 ultima sezione, titolo, pulsanti affiancati, ≥ 48 px con icona; Impeccable pulito; CI verde | 11, 12, 13; ogni task; 15 |
| 10. Prova manuale su Android con la PWA e lo staging; esito nel RUNBOOK | 14 (procedura); esito al Checkpoint E con l'utente |

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Operatore o ex admin che esporta chiamando l'API a mano | Alto | `private.is_admin()` come prima riga delle due funzioni; pgTAP per operatore, utente senza profilo, operatore scollegato e `anon`; integrazione con le credenziali del seed |
| Dati personali di un anonimizzato che escono dal server | Alto | Azzerati nel `select` SQL; pgTAP che li legge `null`; integrazione che cerca il nome originale nel corpo HTTP; il client li svuota comunque |
| CSV/formula injection (nome o descrizione che inizia con `=`, `+`, `-`, `@`, TAB, CR) | Alto | Apostrofo iniziale solo sul testo libero; unità per ogni carattere e per i numeri negativi lasciati intatti; `excelText` che non si fida del server |
| `execute` concesso di default a `public` sulle nuove funzioni | Alto | `revoke`/`grant` espliciti; `function_privileges.test.sql` e `has_function_privilege` nel pgTAP |
| Cursore `created_at` troncato ai millisecondi da `Date` (righe saltate o ripetute) | Alto | Cursore = stringa ricevuta; unità di `fetchAllPages` sui cursori passati; pgTAP con due pagine `p_limit = 2` senza duplicati, anche con lo stesso `created_at` |
| File parziale scaricato dopo un errore a metà paginazione | Medio | `fetchAllPages` tutto-o-niente; test di componente: `download` mai chiamato in caso d'errore |
| Data o ora sbagliate per il fuso del telefono o al cambio d'ora; `24:…` a mezzanotte | Medio | `timeZone: 'Europe/Rome'`, `hourCycle: 'h23'`, `formatToParts`; unità in ora solare e legale e a mezzanotte, con un fuso del processo diverso da Roma (fissato nel test senza cambiare quello degli altri file; CI già in UTC) |
| `42501` di un grant mancante confuso con "non sei admin" | Medio | `serverFaultFor` prima della traduzione; unità con i due messaggi |
| PostgREST tronca le pagine oltre `max_rows = 1000` | Medio | `p_limit` massimo 1000 = `max_rows` in `supabase/config.toml`; fine paginazione su pagina più corta del limite |
| Download annullato perché l'URL del `Blob` è già revocato; comportamento della PWA installata su Android | Medio | `revokeObjectURL` in `setTimeout`; prova manuale sul telefono (criterio 10) prima del lancio |
| Glifi mancanti in Enjoy Display | Basso | `displayGlyphs.test.ts`; testi della sezione senza glifi a rischio |
| Template email dopo `supabase start` | Basso | `scripts/reload-auth-templates.sh` dopo l'avvio dello stack (RUNBOOK) |

## Open Questions

Nessuna bloccante: le Open Questions 1–10 della spec usano i default adottati, da rivedere con il titolare
(`docs/specs/cross-review.md` §3). Da segnalare all'utente durante l'implementazione, senza fermare il lavoro:

- il file Clienti con nome e telefono di tutti resta nei Download del telefono: da citare nell'informativa
  privacy da far verificare al consulente (Open Question 10);
- la descrizione di un premio libero non viene toccata dall'anonimizzazione (Open Question 2).
