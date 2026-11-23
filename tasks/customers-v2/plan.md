# Implementation Plan: customers-v2

Source spec: [SPEC-customers-v2.md](../../docs/specs/SPEC-customers-v2.md) (approvata il 2026-11-23; le Open
Questions 1–17 usano i default adottati, da rivedere con il titolare)

## Overview

Sei cambiamenti chiesti dal titolare il 2026-11-23, su un ramo solo (`feat/customers-v2`, base `main`):
il **telefono del cliente sparisce** dall'app, dal database e dai dati di prova; al suo posto un'**email
facoltativa e unica**, cercabile dalla home nello stesso campo del nome, mostrata in scheda e nell'export;
la **pagina pubblica dei punti** mostra sotto il saldo i **premi attivi**; una **card disattivata** riletta
alla cassa si può **riattivare** (anche scambiandola con l'altra card attiva del cliente) o **riformattare**
(svuotata con Web NFC e dissociata per sempre), solo da un amministratore; la card di un **cliente con dati
cancellati** si può solo riformattare; la **home** mostra sotto la ricerca l'elenco **CLIENTI** a scorrimento
infinito, 20 per pagina, per ultima attività, al posto di SERVITI OGGI. Tutto sul telefono 390×844 e sul
tablet 1280×800. La pubblicazione sui progetti remoti è esclusa: la fa l'orchestratore.

## Architecture Decisions

- **Database prima di tutto, dalle aggiunte che non rompono nulla** (rischio più alto: ruoli nelle RPC delle
  card, pagina pubblica letta da `anon`, uid riusabile, ordine a chiave dell'elenco). Le quattro migrazioni
  della spec si creano con `npx supabase migration new <nome>` **nell'ordine della spec** (task 1, 2, 4, 6:
  `customers_v2_activity`, `customers_v2_email`, `cards_v2_release`, `card_rewards_public`), così i timestamp
  restano in quell'ordine; non sono pubblicate, quindi si completano **in place** nei task successivi e si
  applicano con `npm run db:reset`. Se la PR #24 (`operators`) viene unita prima e aggiunge migrazioni, i
  quattro file si rinominano con timestamp successivi (spec, "Ordine delle migrazioni").
- **Telefono → email in tre tempi (espandi → passa → contrai)**, perché ogni commit deve lasciare verde
  l'intera quality bar (E2E compresi) e nessun task può toccare più di ~5 file. La migrazione 2 attraversa
  due forme:
  1. **forma transitoria** (task 2 e 16): colonna `email` con vincolo e indice unico; `create_customer`,
     `update_customer`, `create_customer_with_card` ricreate (`drop` + `create`) con **entrambi** i parametri
     `p_phone` e `p_email`, con `default null` per `p_phone` e per quelli che seguono (`p_privacy_consent` e
     `p_notes` hanno già i controlli nel corpo: un `null` dà `privacy_required` come oggi); attributo `email`
     aggiunto in coda ad `app.customer_summary` e ogni funzione che lo costruisce riscritta; `export_customers`
     restituisce `phone` **ed** `email`. Il frontend vecchio, i pgTAP posizionali e i test di integrazione
     continuano a funzionare;
  2. il frontend **passa all'email** a fette (task 17–24): dominio con `email`, poi senza `phone`; i servizi
     smettono di mandare `p_phone`;
  3. **forma finale** (task 25): il file della migrazione 2 viene riscritto con la forma esatta della spec
     (`rename attribute phone to email` nella stessa posizione, firme finali senza `p_phone`,
     `update … set phone = null` poi `drop column phone`, `drop function private.normalize_phone`,
     `app.search_customers`, `app.customers_served_today`). Il frontend non cambia in quel task: manda già
     esattamente i parametri finali per nome.
  Solo la forma finale arriva su staging e produzione; le forme intermedie esistono solo nella storia del ramo.
- **L'elenco della home prima dell'email** (fase 3): `app.list_customers` esiste dal task 2, la home ci passa
  nei task 10–15, così nel task 25 `search_customers` e `customers_served_today` si eliminano senza che nulla
  le chiami più.
- **`list_customers` non restituisce `email`** (la spec lascia la scelta al piano, "Contratto del servizio"):
  l'elenco non la mostra (Open Question 5) e il filtro per email lavora sul server; toglierla dalla tabella
  restituita è meno dati personali in transito, a parità di funzione. La firma diventa `returns table (id,
  name, balance, last_activity_at, created_at)`; da segnalare al titolare insieme alle Open Questions.
- **Stesse regole delle RPC esistenti**: `security definer`, `set search_path = ''`, `revoke execute … from
  public, anon`, `grant … to authenticated`, `not_operator` come prima istruzione, operatore da
  `private.acting_operator_id()`, ruolo da `private.is_admin()` (vale per il cassiere amministratore del
  tablet), blocchi sempre cliente → card. Ogni funzione nuova `app.*` entra nella classificazione di
  `supabase/tests/tablet_kiosk_access.test.sql` (lettura / scrittura: altrimenti quel test fallisce) e
  l'allowlist di `anon` in `function_privileges.test.sql` diventa `card_points`, `card_rewards`.
- **Servizi, finti e provider come negli altri moduli**: solo `supabaseCustomerService.ts`,
  `supabaseCardsService.ts`, `supabaseExportService.ts` e `public/cardPointsService.ts` nominano le RPC
  (guardie `scripts/*Boundary.test.ts`); `serverFaultFor` di `src/lib/serverFault.ts` per primo nella
  traduzione degli errori; i finti in `src/test/` seguono lo stesso contratto (ordine, filtro e cursore di
  `list_customers` compresi); gli hook nuovi (`useCustomerList`, `useInactiveCard`) usano `useLatest` di
  `src/lib/useLatest.ts` per le callback e scartano le risposte superate. Nessuna dipendenza nuova.
- **Cursore dell'elenco come stringhe**: i timestamp di PostgREST (con i microsecondi) si rimandano così come
  arrivano, mai convertiti in `Date` (parser proprio `customerListRow.ts`, non `customerRow.ts`).
- **Niente testo della ricerca né uid nell'URL**: `?q=` e `?card=` diventano stato della cronologia
  (`navigate('.', { replace: true, state })`); test che `location.search` non contiene mai `@` né l'uid.
- **Scrittura della card vuota nello stesso motore di `writeUrl`** (`webNfcWriter.ts`): stesso passo 1 (card
  appena letta, `IN_FIELD_MS`), stessi tempi, `mayHaveWritten` sull'esito `wrong-card` (anche per
  `writeUrl`), mai `makeReadOnly()`. L'adattatore finto degli E2E memorizza `uid → url | null`; il controllo
  del bundle non cambia (prefisso `__enjoyFakeCard`).
- **Schermata «Card non attiva» (`/card/:cardId`)** sotto `RequireCashier` accanto a `clienti/:id/card`, con
  i componenti esistenti (`AppShell`, `ListRow`, `PointsBadge`, `StatusView`, `Button`, `ConfirmDialog`,
  `CardLinkWriter`); `cardId` è l'id della riga, mai l'uid. La rotta si aggiunge a `docs/specs/contract.md` e
  a `src/app/routes.test.tsx`. La lettura in home di una card attiva non cambia (nessuna chiamata in più:
  obiettivo dei 10 secondi).
- **Enjoy Display**: titoli e pulsanti nuovi («CLIENTI», «PREMI», «Card non attiva», «Riattiva la card»,
  «Riformatta la card», «Scambia le card», «Mostra altri clienti»…) passano da `scripts/displayGlyphs.test.ts`;
  il pulsante «Nuovo cliente «<testo>»» resta costruito come oggi (soluzione già adottata da `customers` per
  le virgolette, Open Question 1 del suo piano), con il testo precompilato solo se non contiene `@`.
- **UI**: solo componenti e token del design system "Enjoy Bar", testi italiani della spec, target ≥ 48 px,
  confronto con i wireframe (Main, Scheda cliente, Nuovo/Modifica cliente, Ricerca vuota, Saldo-punti,
  Associa card, Tablet-*); per le schermate senza tavola (sezione PREMI, «Card non attiva») il disegno
  proposto dalla spec. Detector Impeccable pulito dopo ogni modifica UI.
- **Test prima del codice** (`test-driven-development`) in ogni task; E2E con nomi a prefisso unico per
  corsa (`uniqueName`) nel progetto `phone`, tablet nei progetti `tablet` (ogni test che sblocca un cassiere
  usa un dispositivo del seed riservato, RUNBOOK §4 trappola 47).
- **Stack locale soltanto**: `npx supabase status` (o `start -x …`), poi `scripts/reload-auth-templates.sh`
  (RUNBOOK); mai `--linked` o `--remote`, mai `*.supabase.co`.
- **Revisione `security-and-hardening` obbligatoria** al Checkpoint A (RPC, `anon`, ruoli, blocchi, uid
  riusabile, nessun uid/token/email in errori) e al Checkpoint E (client: niente `mailto:`, niente email o
  uid in URL o console, riformattazione solo dopo la card riconosciuta).

## Dependency Graph

```
migrazione 1 activity (1)
  └── migrazione 2: email + list_customers (2) ── piano con 1000/20000 (3)
        │
        ├── contratto list (10) ── activityLabel + useCustomerList (11)
        │     └── helper E2E del campo (12) ── home CLIENTI (13) ── card sconosciuta nello stato (14) ── E2E elenco (15)
        │
        └── email transitoria nelle RPC (16)
              └── normalizeEmail + codici (17) ── dominio con email (18)
                    ├── form (19) ── scheda (20) ── export (21)
                    └── servizi e dominio senza telefono (22) ── fixture integrazione (23) ── telefono fuori da UI/E2E (24)
                          └── migrazione 2 forma finale + seed (25) ── confine e codici d'errore (26)

migrazione 3 cards_v2_release (4) ── get_card / reactivate_card / admin (5)
migrazione 4 card_rewards_public (6) ── pagina pubblica PREMI (27)
4, 5, 6 ── integrazione e concorrenza (7)

motore eraseCard (8) ── useCardWriter.eraseCard + finto (9)

servizio delle card (28) ── lettura in home + rotta (29) ── «Card non attiva»: stati (30)
     ├── Riattiva (31)              ├── Associa card forbidden (33)
     └── Riformatta (32, dopo 9)    └── tablet (34) ── E2E telefono (35)
                                          └── documentazione (36) ── criteri e PR (37)
```

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Database, solo aggiunte (rischio più alto)
- [x] Task 1: Ultima attività: `last_activity_at`, colonne generate, riempimento, trigger sui movimenti, indice
- [x] Task 2: Colonna `email` (vincolo, indice unico) e `app.list_customers` a chiave
- [x] Task 3: Piano di `list_customers` con 1 000 clienti e 20 000 movimenti (`explain` in pgTAP)
- [x] Task 4: Card riformattate: colonne `released_*`, indice parziale `cards_uid_key`, ricerche per uid, `release_card`
- [x] Task 5: `get_card`, `reactivate_card` e riattivazione da Associa card solo per amministratori
- [x] Task 6: `private.card_customer_for_token`, `card_points` riscritta, `public.card_rewards`
- [x] Task 7: Integrazione su HTTP e concorrenza delle RPC nuove

### Checkpoint A: `db:test` e `test:integration` verdi, pgTAP esistenti invariati nel comportamento; revisione `security-and-hardening` del database

### Fase 2: Scrittura della card vuota (`card-input`)
- [x] Task 8: Motore di scrittura: `eraseCard`, `mayHaveWritten`, `blank` dall'adattatore Web NFC
- [x] Task 9: `useCardWriter().eraseCard` e adattatore finto degli E2E con card vuote

### Checkpoint B: quality bar completa verde; `npm run build && npm run check:bundle` verde

### Fase 3: Home con l'elenco CLIENTI
- [x] Task 10: Contratto `list` del servizio clienti (tipi, parser, Supabase, finto, ledger finto)
- [x] Task 11: `activityLabel` e `useCustomerList` (pagine, sentinella, ricerca, aggiornamento)
- [x] Task 12: Campo di ricerca della home negli E2E tramite un solo helper
- [x] Task 13: Home: sezione CLIENTI, ricerca nello stato della cronologia, «nome o email», tablet a due colonne
- [x] Task 14: Card sconosciuta dalla home a Nuovo cliente tramite lo stato della cronologia
- [x] Task 15: E2E dell'elenco (45 clienti a prefisso unico) e criterio 3 di `ledger`

### Checkpoint C: home verde in componenti ed E2E (telefono e tablet); Impeccable pulito; confronto con Main, Ricerca vuota, Tablet-Cerca

### Fase 4: Email al posto del telefono (espandi → passa → contrai)
- [x] Task 16: Email nelle RPC dei clienti, forma transitoria della migrazione 2
- [x] Task 17: `normalizeEmail` e codici d'errore `email_invalid`, `customer_email_taken`
- [x] Task 18: Dominio e servizi con `email` accanto al telefono
- [x] Task 19: Nuovo e Modifica cliente: campo email, errori, «Apri la scheda»; via il campo telefono
- [x] Task 20: Scheda: email o «Senza email», niente `mailto:`; testi della cancellazione dati
- [x] Task 21: Export CSV clienti: colonna «Email» con `guardFormula`
- [x] Task 22: Servizi e dominio senza telefono
- [x] Task 23: Test di integrazione senza telefono
- [x] Task 24: Telefono fuori da galleria, codici ed E2E; percorso E2E dell'email
- [x] Task 25: Migrazione 2 nella forma finale; seed con email
- [x] Task 26: Controlli di confine e dei codici d'errore

### Checkpoint D: criteri 1–4 provati; `grep` del telefono pulito (salvo il senso di dispositivo); Impeccable pulito; confronto con Nuovo cliente, Nome già usato, Modifica cliente, Scheda cliente

### Fase 5: Premi nella pagina pubblica
- [x] Task 27: `fetchCardRewards` e sezione PREMI di `/s/:token`

### Fase 6: Card non attiva: Riattiva e Riformatta
- [x] Task 28: Servizio delle card: `getCard`, `reactivateCard`, `releaseCard`, codici nuovi e `forbidden`
- [x] Task 29: Lettura in home di una card disattivata (admin → `/card/:cardId`, operatore → avviso) e rotta
- [x] Task 30: Schermata «Card non attiva»: dati e stati
- [x] Task 31: Riattiva (conferma, scambio, `active_card_changed`, scrittura del link)
- [x] Task 32: Riformatta (conferma, passi, esiti, `release_card` con lo stesso `operation_id`)
- [x] Task 33: Associa card: riattivazione rifiutata all'operatore con il testo giusto
- [x] Task 34: Tablet: «Card non attiva» a 1280×800, nota al posto di Riformatta, E2E dal lettore USB
- [x] Task 35: E2E telefono: riattiva con scambio, riformatta, operatore

### Checkpoint E: criteri 7–13 provati; revisione `security-and-hardening` del client; Impeccable pulito; E2E telefono e tablet verdi

### Fase 7: Chiusura
- [x] Task 36: Documentazione (RUNBOOK, note di rilascio, prove a mano, documenti senza telefono)
- [ ] Task 37: Verifica dei criteri di successo (`scripts/customersV2Criteria.test.ts`) e PR

### Checkpoint F: i criteri 1–13 verificati; quality bar completa verde; PR su `main` indipendente da #24, pronta per `code-review-and-quality`

## Copertura dei criteri di successo

| Criterio (docs/specs/SPEC-customers-v2.md) | Task |
|---|---|
| 1. Niente `phone`, `normalize_phone`, `search_customers`, `customers_served_today`; test di confine verde; nessun telefono nei dati di prova | 22, 23, 24, 25, 26, 36 |
| 2. Email normalizzata, unica senza maiuscole con «Apri la scheda», formato rifiutato, più clienti senza email | 2, 16, 17, 18, 19, 24 |
| 3. Cancellazione dati azzera nome, email, note; email subito riutilizzabile | 16, 20, 24 |
| 4. Ricerca per parte dell'email e per nome; email intera in scheda senza `mailto:`; CSV con «Email», vuota per gli anonimizzati, `guardFormula` | 2, 13, 20, 21, 24 |
| 5. CLIENTI: 20 righe e poi le successive, senza doppioni né buchi, ordine per ultima attività, niente anonimizzati, filtro con lo stesso ordine, ogni stato testato, tablet a due colonne | 1, 2, 7, 10, 11, 13, 15 |
| 6. Piano `Index Only Scan`/`Index Scan` su `customers_home_order_idx` con 1 000/20 000; tempo a mano < 500 ms | 3, 36 |
| 7. Sezione PREMI solo per i premi attivi, dal meno caro; senza premi nessuna sezione; «Card non attiva» invariata; `card_rewards` vuota per ogni token non valido; `anon` solo `card_points` e `card_rewards` | 6, 7, 27 |
| 8. Admin: card disattivata → «Card non attiva» → Riattiva con conferma (anche senza altra card), scambio con conferma, link scritto; mai due card attive | 4, 5, 7, 28, 29, 30, 31, 35 |
| 9. Riformatta: un solo record vuoto verificato, poi `release_card` (riga conservata, saldo invariato, nessun token); la card riletta apre Nuovo cliente e si associa a un altro; reinvio idempotente | 4, 7, 8, 9, 28, 32, 35 |
| 10. Card di un cliente con dati cancellati: solo Riformatta, stesso esito | 4, 30, 32, 35 |
| 11. Operatore: avviso «Card non attiva: chiedi a un amministratore»; `reactivate_card`, `release_card` e riattivazione da Associa card → `forbidden` | 4, 5, 28, 29, 33, 35 |
| 12. Tablet: card disattivata dal lettore USB (cassiere admin) → «Card non attiva» con Riattiva e la nota del telefono al posto di Riformatta | 5, 29, 34 |
| 13. Card attiva → Registra spesa senza chiamate in più, < 10 s; CI verde; Impeccable pulito; target ≥ 48 px | ogni task; 29, 35, 37 |

## Verifica dei criteri di successo

Verifica finale del task 37 (2026-11-23). Ogni prova è scritta come `file › titolo del test` (per pgTAP la
descrizione dell'asserzione, anche solo la sua parte fissa quando è composta); `scripts/customersV2Criteria.test.ts`
controlla che i criteri 1–13 ne abbiano almeno una e che ognuna esista davvero nel file indicato. Per il
criterio 13 le prove sono anche i passi della CI e i progetti Playwright; l'esito è quello della CI sulla PR.
Le note controllate a mano (criterio 1) e il tempo misurato a mano (criterio 6) sono nel RUNBOOK (task 36).

| Criterio (docs/specs/SPEC-customers-v2.md) | Test che lo prova |
|---|---|
| 1. Niente `phone`, `normalize_phone`, `search_customers`, `customers_served_today`; test di confine verde; nessun telefono nei dati di prova | `supabase/tests/customers_v2.test.sql › app.customers has no phone column`, `supabase/tests/customers_v2.test.sql › private.normalize_phone is gone`, `supabase/tests/customers_v2.test.sql › app.search_customers is gone`, `supabase/tests/customers_v2.test.sql › app.customers_served_today is gone`, `supabase/tests/customers_v2.test.sql › customer_summary carries email in the place of the phone`, `scripts/customersBoundary.test.ts › scans src, e2e, tests, scripts and the seed, without this file`, `scripts/customersBoundary.test.ts › finds no phone identifier, phone text or phone number`, `scripts/customersV2Docs.test.ts › finds no customer phone`, `src/features/customers/CustomerPage.test.tsx › no phone line any more under the name (SPEC-customers-v2, point 1)` |
| 2. Email normalizzata, unica senza maiuscole con «Apri la scheda», formato rifiutato, più clienti senza email | `supabase/tests/customers_v2.test.sql › create_customer: the email is trimmed and lowercased`, `supabase/tests/customers_v2.test.sql › create_customer: the same email in other case is taken, detail = the other customer`, `supabase/tests/customers_v2.test.sql › create_customer: a malformed email is refused`, `supabase/tests/customers_v2.test.sql › create_customer: two customers without an email (null, or only spaces)`, `supabase/tests/customers_v2.test.sql › email: two customers never share one`, `supabase/tests/customers_v2.test.sql › email: several customers without an email are allowed`, `tests/integration/customers.test.ts › create stores it normalized; get returns it; the same email is taken with its id`, `tests/integration/customers.test.ts › create: the same email twice at the same moment makes one customer, the other is taken`, `tests/integration/customers-v2.test.ts › an email committed meanwhile is customer_email_taken with its id`, `src/features/customers/email.test.ts › accepts 6 characters and refuses 5`, `src/features/customers/CustomerForm.test.tsx › rejects an email that does not normalize, accepts a blank one or one with spaces and capitals`, `src/features/customers/NewCustomerPage.test.tsx › email already used: the error under the email, "Apri la scheda" to that customer, no help text`, `src/features/customers/NewCustomerPage.test.tsx › an email in the wrong format is refused in the app: no call`, `src/features/customers/EditCustomerPage.test.tsx › email already used: the error and "Apri la scheda" to the other customer`, `e2e/customers.spec.ts › normalized, found by part of it, unique, freed by the erase (criteria 2, 3, 4)` |
| 3. Cancellazione dati azzera nome, email, note; email subito riutilizzabile | `supabase/tests/customers_v2.test.sql › anonymize_customer: name replaced, email and notes cleared`, `supabase/tests/customers_v2.test.sql › anonymize_customer: the stored row keeps neither name, email nor notes`, `supabase/tests/customers_v2.test.sql › after the erasure another customer reuses the email`, `tests/integration/customers.test.ts › the anonymization clears the email and frees it`, `src/features/customers/AnonymizeSection.test.tsx › confirmed: busy while sending, then the home (replace) with "Dati del cliente cancellati."`, `e2e/customers.spec.ts › normalized, found by part of it, unique, freed by the erase (criteria 2, 3, 4)` |
| 4. Ricerca per parte dell'email e per nome; email intera in scheda senza `mailto:`; CSV con «Email», vuota per gli anonimizzati, `guardFormula` | `supabase/tests/customers_v2.test.sql › filter by email: part of the email`, `supabase/tests/customers_v2.test.sql › filter by email: the text is lowercased`, `supabase/tests/customers_v2.test.sql › filter by name: every word, in any order, in the name key`, `tests/integration/customers.test.ts › list finds a customer by part of the email, and never returns the email in the rows`, `src/features/customers/HomePage.test.tsx › finds by part of the email, and the URL never carries the text`, `src/features/customers/CustomerPage.test.tsx › shows the name as title, "Indietro" to the home, "Modifica cliente", email, notes and SALDO`, `scripts/customersBoundary.test.ts › has no mailto: link anywhere in the app`, `supabase/tests/customers_v2.test.sql › export_customers returns the email in the place of the phone`, `supabase/tests/customers_v2.test.sql › export_customers: an anonymized customer has no email`, `src/features/export/buildCustomersCsv.test.ts › writes the columns in the order of the spec, the email after the name and the uid as Excel text`, `src/features/export/buildCustomersCsv.test.ts › blanks the personal fields of an anonymized customer even if the row has them (criterion 5)`, `src/features/export/buildCustomersCsv.test.ts › guards an email whose local part starts a formula (criterion 4)`, `e2e/customers.spec.ts › normalized, found by part of it, unique, freed by the erase (criteria 2, 3, 4)` |
| 5. CLIENTI: 20 righe e poi le successive, senza doppioni né buchi, ordine per ultima attività, niente anonimizzati, filtro con lo stesso ordine, ogni stato testato, tablet a due colonne | `supabase/tests/customers_v2.test.sql › order: latest activity first (a redemption counts), then without movements by creation; anonymized never`, `supabase/tests/customers_v2.test.sql › anonymized customers are never listed, even without a filter`, `supabase/tests/customers_v2.test.sql › order with ties to the microsecond: activity, then sort_at, then id descending`, `supabase/tests/customers_v2.test.sql › keyset: the three pages are the whole list, without duplicates or gaps`, `supabase/tests/customers_v2.test.sql › a cancelled purchase still counts: the customer came to the bar (Open Question 1)`, `supabase/tests/customers_v2.test.sql › a correction does not count as activity`, `tests/integration/customers-v2.test.ts › the filtered list comes in three pages, in order, with no row lost or repeated`, `tests/integration/customers-v2.test.ts › the whole list, page by page, is every customer not erased, each once`, `src/features/customers/useCustomerList.test.tsx › asks the next page with the last row received, its values as the strings sent`, `src/features/customers/useCustomerList.test.tsx › ends the list with a page shorter than 20 rows, and asks nothing more`, `src/features/customers/HomePage.test.tsx › lists every customer by last activity: name, activity, balance, never the email`, `src/features/customers/HomePage.test.tsx › shows "Carico i clienti…" while the first page is on its way`, `src/features/customers/HomePage.test.tsx › a failed first page shows "Clienti non caricati", and "Riprova" loads it again`, `src/features/customers/HomePage.test.tsx › a failed next page keeps the rows, says so, and "Riprova" loads it`, `src/features/customers/HomePage.test.tsx › an empty archive says "Ancora nessun cliente"`, `src/features/customers/HomePage.test.tsx › no results for a name: says so and turns the button into "Nuovo cliente «<testo>»"`, `src/features/customers/HomePage.test.tsx › filters the same list 250 ms after the last key, in the same order`, `src/features/customers/HomePage.test.tsx › loads the first page again when the page becomes visible, only with the first page loaded`, `src/features/customers/HomePage.tablet.test.tsx › shows CLIENTI in two columns beside the reader (wireframe "Tablet: cerca cliente")`, `e2e/customers-list.spec.ts › CLIENTI: 20 rows, the others by scrolling, no duplicates, the end at the 45th; the customer just served goes on top (criterion 5)`, `e2e/tablet-layout.spec.ts › every screen of the tablet wireframes at 1280×800 (criterion 7)` (CLIENTI in due colonne) |
| 6. Piano `Index Only Scan`/`Index Scan` su `customers_home_order_idx` con 1 000/20 000; tempo a mano < 500 ms | `supabase/tests/customers_v2.test.sql › customers_home_order_idx orders by activity, then sort_at, then id, without anonymized rows`, `supabase/tests/customers_v2_plan.test.sql › first page: an index scan on customers_home_order_idx`, `supabase/tests/customers_v2_plan.test.sql › middle page: an index scan on customers_home_order_idx`, `supabase/tests/customers_v2_plan.test.sql › search: an index scan on customers_home_order_idx`, `supabase/tests/customers_v2_plan.test.sql › search: list_customers returns the rows of the explained query`; tempo misurato a mano con `scripts/measure-list-customers.sql` (RUNBOOK) |
| 7. Sezione PREMI solo per i premi attivi, dal meno caro; senza premi nessuna sezione; «Card non attiva» invariata; `card_rewards` vuota per ogni token non valido; `anon` solo `card_points` e `card_rewards` | `supabase/tests/card_points.test.sql › a confirmed link gives only the active rewards, by points and then by name`, `supabase/tests/card_points.test.sql › card_rewards returns only the name and the points`, `supabase/tests/card_points.test.sql › an unknown token gives no rewards`, `supabase/tests/card_points.test.sql › the old token after a rotation gives no rewards`, `supabase/tests/card_points.test.sql › the link of a deactivated card gives no rewards`, `supabase/tests/card_points.test.sql › the link of a released card gives no rewards`, `supabase/tests/card_points.test.sql › the link of an anonymized customer gives no rewards`, `supabase/tests/card_points.test.sql › in public anon executes exactly card_points(text) and card_rewards(text)`, `supabase/tests/function_privileges.test.sql › in public anon executes exactly card_points and card_rewards`, `tests/integration/customers-v2.test.ts › a valid token answers the active rewards, cheapest first, name and points only`, `tests/integration/customers-v2.test.ts › a token that never existed, a malformed one and null all answer the same empty list`, `tests/integration/customers-v2.test.ts › anon executes none of the new app RPCs, and no refusal echoes the arguments`, `src/features/cards/public/CardPointsPage.test.tsx › lists the active rewards under the points, in the order of the server, and nothing else (criterion 7)`, `src/features/cards/public/CardPointsPage.test.tsx › shows the points of the card (Saldo-punti) and nothing else when no reward is active`, `src/features/cards/public/CardPointsPage.test.tsx › shows «Card non attiva» when the server answers null, without rewards`, `e2e/card-points.spec.ts › the page lists the active rewards of the seed under the points, cheapest first (criterion 7)` |
| 8. Admin: card disattivata → «Card non attiva» → Riattiva con conferma (anche senza altra card), scambio con conferma, link scritto; mai due card attive | `supabase/tests/cards_v2.test.sql › reactivate_card with the right expected card swaps the cards, link not written`, `supabase/tests/cards_v2.test.sql › after the swap the other card is deactivated: one active card`, `supabase/tests/cards_v2.test.sql › the swap leaves the points of the customer unchanged`, `supabase/tests/cards_v2.test.sql › a refused swap changes nothing`, `tests/integration/cards.test.ts › two admins reactivate two cards of one customer at once: one wins, one card active`, `tests/integration/cards.test.ts › release and reactivation of one card at once: exactly one wins, never both`, `src/features/cards/InactiveCardPage.test.tsx › without another active card: always a confirmation, and no call before «Riattiva»`, `src/features/cards/InactiveCardPage.test.tsx › with another active card: «Scambiare le card di Maria?» and the swap names that card`, `src/features/cards/InactiveCardPage.test.tsx › is written on the card (a token, never the uid); then the customer page says «riattivata»`, `e2e/cards-v2.spec.ts › an administrator reactivates a lost card in place of the active one: swap, new link, then a purchase in less than 10 s with no extra call (criteria 8, 13)`, `e2e/cards-v2.spec.ts › an administrator reactivates a deactivated card with no other card: asked first, then «Riattiva» (criterion 8)` |
| 9. Riformatta: un solo record vuoto verificato, poi `release_card` (riga conservata, saldo invariato, nessun token); la card riletta apre Nuovo cliente e si associa a un altro; reinvio idempotente | `src/features/card-input/webNfcWriter.test.ts › a card read less than IN_FIELD_MS ago is written at once with one empty record and overwrite`, `src/features/card-input/webNfcWriter.test.ts › createWebNfcWriter.eraseCard: verification of a blank card`, `src/features/cards/InactiveCardPage.test.tsx › shows the steps live, and releases the card only after the verification`, `src/features/cards/InactiveCardPage.test.tsx › emptied but not released: «Riprova» sends the same operation_id, without the card`, `supabase/tests/cards_v2.test.sql › release_card releases a deactivated card and records who did it with the operation_id`, `supabase/tests/cards_v2.test.sql › the released row is kept with its uid and its customer`, `supabase/tests/cards_v2.test.sql › the release deletes any link of the card`, `supabase/tests/cards_v2.test.sql › the balance and the movements of the customer do not change`, `supabase/tests/cards_v2.test.sql › the same operation_id again returns the row unchanged`, `supabase/tests/cards_v2.test.sql › lookup_card finds no card for a released uid`, `supabase/tests/cards_v2.test.sql › create_customer_with_card accepts a released uid`, `e2e/cards-v2.spec.ts › an administrator reformats a lost card: erased and verified, then freed for good (the network drops once: same operation); read again, it is a new customer’s (criterion 9)` |
| 10. Card di un cliente con dati cancellati: solo Riformatta, stesso esito | `supabase/tests/cards_v2.test.sql › the card of an anonymized customer can be released`, `supabase/tests/cards_v2.test.sql › it stays with the anonymized customer, released`, `src/features/cards/InactiveCardPage.test.tsx › has no customer row and no Riattiva, only Riformatta`, `src/features/cards/InactiveCardPage.test.tsx › the card of an erased customer: its own confirmation, and the same outcome`, `e2e/cards-v2.spec.ts › the card of an erased customer offers only Riformatta, with the same outcome (criterion 10)` |
| 11. Operatore: avviso «Card non attiva: chiedi a un amministratore»; `reactivate_card`, `release_card` e riattivazione da Associa card → `forbidden` | `supabase/tests/cards_v2.test.sql › reactivate_card: an operator is forbidden`, `supabase/tests/cards_v2.test.sql › release_card: an operator is forbidden`, `supabase/tests/cards_v2.test.sql › associate_card: an operator cannot reactivate a deactivated card`, `supabase/tests/cards_v2.test.sql › reactivate_card: the operator cashier of the device is forbidden`, `supabase/tests/cards_v2.test.sql › release_card: the operator cashier of the device is forbidden`, `tests/integration/cards.test.ts › gets forbidden from reactivate_card, release_card and the reactivation from associate_card`, `src/features/cards/useHomeCardRead.test.tsx › operator, a deactivated card: "Card non attiva: chiedi a un amministratore" with the customer (criterion 11)`, `src/features/cards/AssociateCardPage.test.tsx › an operator reading the customer’s own deactivated card: «Card non attiva: chiedi a un amministratore.» (criterion 11)`, `src/features/cards/InactiveCardPage.test.tsx › an operator opening the URL by hand is told it is for admins, without a request`, `e2e/cards-v2.spec.ts › cannot reactivate nor reformat a deactivated card: the notice on the home, the page refused, Associa card refused, the RPCs forbidden (criterion 11)` |
| 12. Tablet: card disattivata dal lettore USB (cassiere admin) → «Card non attiva» con Riattiva e la nota del telefono al posto di Riformatta | `supabase/tests/cards_v2.test.sql › reactivate_card: the admin cashier reactivates a card, recorded as the cashier, link not written`, `src/features/cards/useHomeCardRead.test.tsx › on the till, an admin cashier goes to /card/:cardId, an operator cashier gets the notice`, `src/features/cards/cardsPages.tablet.test.tsx › a deactivated card read on the home opens the page: Riattiva, the note in place of Riformatta`, `src/features/cards/cardsPages.tablet.test.tsx › Riattiva, confirmed: the customer page in place of this one, «Link non scritto.»`, `src/features/cards/InactiveCardPage.test.tsx › a device that does not write: the note in place of «Riformatta la card», Riattiva stays`, `e2e/tablet.spec.ts › a deactivated card on the USB reader, an admin at the till: «Card non attiva», Riattiva, «Link non scritto» (SPEC-customers-v2, criterion 12)` |
| 13. Card attiva → Registra spesa senza chiamate in più, < 10 s; CI verde; Impeccable pulito; target ≥ 48 px | `src/features/cards/useHomeCardRead.test.tsx › admin, an active card still opens Registra spesa with the same calls (criterion 13)`, `src/features/cards/useHomeCardRead.test.tsx › the active card path never issues a link nor writes the card (criterion 14)`, `e2e/card-points.spec.ts › a known card read on the home opens Registra spesa without writing the card or issuing a link (criteria 1, 14)`, `e2e/cards-v2.spec.ts › an administrator reactivates a lost card in place of the active one: swap, new link, then a purchase in less than 10 s with no extra call (criteria 8, 13)`, `e2e/customers.spec.ts › Nuovo cliente: touch targets are at least 48 px and the notice opens and closes`, `e2e/tablet-layout.spec.ts › every screen of the tablet wireframes at 1280×800 (criterion 7)`, `.github/workflows/ci.yml › npm test`, `.github/workflows/ci.yml › npm run db:test`, `.github/workflows/ci.yml › npm run test:integration`, `.github/workflows/ci.yml › npm run build && npm run check:bundle`, `.github/workflows/ci.yml › npm run e2e`, `playwright.config.ts › name: 'phone'`, `playwright.config.ts › name: 'phone-settings'`, `playwright.config.ts › name: 'tablet'`, `playwright.config.ts › name: 'tablet-settings'`; detector Impeccable pulito dopo ogni modifica di UI (hook di `.claude/settings.json`); esito: CI verde sulla PR |

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Un operatore riattiva o riformatta dall'API, o un dispositivo senza cassiere lo fa | Alto | `is_admin()` dentro `reactivate_card`, `release_card` e nel ramo di riattivazione di `associate_card_to`; pgTAP con operatore, admin, cassiere admin e cassiere operatore; classificazione in `tablet_kiosk_access.test.sql` |
| La pagina pubblica dice di più o distingue i casi | Alto | Token verificato da una sola funzione privata condivisa con `card_points`; zero righe per ogni caso non valido; allowlist `anon` in pgTAP; testo intero della pagina confrontato nel test di componente |
| Uid riusato che mostra i punti di un cliente vecchio | Alto | Token legati a `card_id`; `release_card` cancella `private.card_links`; `released_at is null` in ogni ricerca per uid, pgTAP per ognuna (`raise_card_taken` con due righe dello stesso uid) |
| Due card attive o stalli tra amministratori | Alto | Indice `cards_one_active_per_customer`; blocchi cliente → card; integrazione con chiamate concorrenti |
| Card svuotata sbagliata (Chrome scrive sul primo tag) | Alto | Passo 1 di `writeUrl` riusato; `wrong-card` con `mayHaveWritten` e testo che nomina la card colpita; mai `makeReadOnly()` |
| Commit rosso durante il passaggio telefono → email | Medio | Espandi → passa → contrai (Architecture Decisions); ogni task chiude con la quality bar completa |
| Cancellare per errore i telefoni già salvati in produzione senza conferma | Alto | La forma finale della migrazione 2 resta sul ramo; Open Question 17 della spec da chiudere con il titolare **prima del merge** (Checkpoint F, nota nella PR) |
| Elenco con buchi o doppioni (microsecondi persi, `null` nel confronto di riga) | Medio | Cursore come stringhe ricevute; `invalid_cursor`; pgTAP su 3 pagine con `created_at` uguali al microsecondo; deduplica per `id` solo come protezione |
| Elenco lento con molti movimenti | Medio | `last_activity_at` denormalizzata dal trigger e indice parziale; asserzione `explain` (non di tempo) in pgTAP |
| E2E dell'elenco instabile per i test paralleli sullo stesso database | Medio | E2E solo sull'elenco filtrato da un prefisso unico della corsa; l'elenco completo si prova con il finto |
| Email o uid in URL, log o console | Medio | Stato della cronologia; guardie di confine (niente `console.*` con dati, niente `mailto:`); test su `location.search` |
| Conflitti con la PR #24 (`operators`) aperta | Medio | Nessuna dipendenza; file probabilmente comuni (`routes.tsx`, `routes.test.tsx`, `tablet_kiosk_access.test.sql`, `function_privileges.test.sql`, `contract.md`, migrazioni) segnalati nella PR; rinomina dei timestamp se #24 arriva prima |
| Template email persi dopo `supabase start` | Basso | `scripts/reload-auth-templates.sh` dopo l'avvio (RUNBOOK) |

## Open Questions

Nessuna bloccante per l'implementazione: le Open Questions 1–17 della spec usano i default adottati. Da
riportare all'utente senza fermare il lavoro:

- **Open Question 17 della spec (cancellare i telefoni già salvati)**: blocca il **merge** e il rilascio della
  migrazione 2, non il lavoro sul ramo. La PR lo dice in apertura.
- **`email` tolta dalla tabella di `list_customers`** (scelta del piano, Architecture Decisions).
- **Firme transitorie con `default`**: esistono solo nei commit intermedi; la forma finale è quella della spec.
- **Documenti con il telefono**: la spec rimanda l'aggiornamento delle spec originali a dopo il rilascio, ma
  l'orchestratore chiede che nessun telefono del cliente resti nemmeno in `docs/`. Il task 36 aggiorna i
  documenti operativi (`setup-*.md`, RUNBOOK, `contract.md`, CLAUDE.md) e, nelle spec originali, sostituisce i
  passi sul telefono con un rimando a SPEC-customers-v2; da confermare con l'utente se preferisce la
  riscrittura completa delle spec originali ora.
