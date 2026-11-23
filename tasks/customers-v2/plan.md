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
- [ ] Task 26: Controlli di confine e dei codici d'errore

### Checkpoint D: criteri 1–4 provati; `grep` del telefono pulito (salvo il senso di dispositivo); Impeccable pulito; confronto con Nuovo cliente, Nome già usato, Modifica cliente, Scheda cliente

### Fase 5: Premi nella pagina pubblica
- [ ] Task 27: `fetchCardRewards` e sezione PREMI di `/s/:token`

### Fase 6: Card non attiva: Riattiva e Riformatta
- [ ] Task 28: Servizio delle card: `getCard`, `reactivateCard`, `releaseCard`, codici nuovi e `forbidden`
- [ ] Task 29: Lettura in home di una card disattivata (admin → `/card/:cardId`, operatore → avviso) e rotta
- [ ] Task 30: Schermata «Card non attiva»: dati e stati
- [ ] Task 31: Riattiva (conferma, scambio, `active_card_changed`, scrittura del link)
- [ ] Task 32: Riformatta (conferma, passi, esiti, `release_card` con lo stesso `operation_id`)
- [ ] Task 33: Associa card: riattivazione rifiutata all'operatore con il testo giusto
- [ ] Task 34: Tablet: «Card non attiva» a 1280×800, nota al posto di Riformatta, E2E dal lettore USB
- [ ] Task 35: E2E telefono: riattiva con scambio, riformatta, operatore

### Checkpoint E: criteri 7–13 provati; revisione `security-and-hardening` del client; Impeccable pulito; E2E telefono e tablet verdi

### Fase 7: Chiusura
- [ ] Task 36: Documentazione (RUNBOOK, note di rilascio, prove a mano, documenti senza telefono)
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

Da compilare nel task 37: ogni prova scritta come `file › titolo del test` (per pgTAP la descrizione
dell'asserzione); `scripts/customersV2Criteria.test.ts` controlla che i criteri 1–13 ne abbiano almeno una e
che ognuna esista davvero nel file indicato.

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
