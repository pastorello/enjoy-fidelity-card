# Implementation Plan: customers

Source spec: [SPEC-customers.md](../../docs/specs/SPEC-customers.md) (approvata il 2026-11-17; le Open Questions usano i
default adottati)

## Overview

L'operatore trova un cliente dalla home per nome (senza accenti, parole in qualunque ordine) o per le cifre
del telefono, ne registra uno nuovo con solo nome e consenso privacy, ne apre la scheda e lo modifica; un
amministratore ne cancella i dati (anonimizzazione) senza perdere i movimenti. Nasce la tabella
`app.customers` con nome unico tramite `name_key`, scrivibile solo con RPC `security definer` idempotenti; la
home "Cerca cliente" sostituisce il segnaposto `src/app/HomePage.tsx`. Saldo reale, SERVITI OGGI con dati,
card e movimenti arrivano con `card-input`, `cards` e `ledger`: qui `balance` = 0 e
`app.customers_served_today()` è vuota, con firme già definitive.

## Architecture Decisions

- **Prima il database, poi il servizio, poi la UI.** I rischi maggiori sono sul server: unicità del nome
  senza accenti né apostrofi tipografici, gare tra invii contemporanei (`unique_violation` → cliente già
  creato o `customer_name_taken`, mai un 23505 grezzo), `not_operator` anche nelle RPC di lettura (che con
  `security definer` scavalcano la RLS), `forbidden` per l'anonimizzazione, ricerca con `%`/`_`/`\` alla
  lettera e sotto 50 ms con 1 000 clienti. Si fissa tutto con pgTAP nei task 1–3, prima di ogni riga di UI.
- **Una sola migrazione `*_customers.sql`**, creata con `npx supabase migration new customers` e completata
  nei task 1–3 (non ancora pubblicata: si modifica in place, si applica con `npm run db:reset`). Contiene
  `create or replace function private.acting_operator_id()` con il corpo comune parola per parola (già
  definito da `settings`); estensione `unaccent` nello schema `extensions`; `execute` revocato a
  `public`/`anon` su ogni funzione nuova (coperto da `function_privileges.test.sql`), `clean_name` e
  `customer_name_key` mai concesse ad `authenticated`.
- **Firme definitive per `ledger`.** `app.customer_summary (id, name, phone, notes, anonymized_at, balance
  int, last_served_at timestamptz)` e le tre RPC di lettura non cambiano più: `ledger` sostituisce solo i
  corpi (`create or replace`). `customers_served_today()` qui restituisce zero righe.
- **Un solo punto di accesso a Supabase.** Solo `supabaseCustomerService.ts` chiama le RPC dei clienti (guardia
  `scripts/customersBoundary.test.ts`, come `settingsBoundary.test.ts`); traduce i messaggi-codice di
  `errorCodes.ts` in errori tipizzati, la fetch fallita in `network`, e riusa `serverFaultFor` /
  `ServerFaultError` di `src/lib/serverFault.ts` per i guasti del server (`misconfigured`/`unavailable`).
  Il finto `src/test/fakeCustomerService.ts` segue lo stesso contratto, registra le chiamate (con
  `operation_id`) e simula errori di rete o "arrivato ma risposta persa".
- **Servizio iniettato come `SettingsService`.** `CustomerServiceProvider` in `main.tsx` e in `renderApp`;
  i componenti usano solo hook del modulo (`useCustomerSearch`, `useServedToday`, `useCustomer`) con stato
  caricamento/errore/dati e scarto delle risposte superate. Nessuna dipendenza nuova (niente TanStack Query).
- **`not_operator` → `useAuth().reportNotEnabled()`**, già presente da `settings`: nessuna modifica ad
  `AuthProvider`, solo la chiamata dai hook e dalle pagine del modulo.
- **Telefono**: `normalizePhone` in TS rispecchia la normalizzazione SQL con gli stessi vettori di test; il
  server resta l'autorità (il client la usa per l'anteprima e per gli errori prima dell'invio).
- **Idempotenza della creazione**: `operation_id` con `crypto.randomUUID()` al primo "Salva cliente", tenuto
  finché l'esito è incerto (rete), rigenerato solo dopo un rifiuto del server; "Salva cliente" `busy`.
- **`AppShell` con `headerAction` facoltativa** (pulsante icona a destra del titolo), comportamento attuale
  invariato e test esistenti verdi.
- **Enjoy Display**: le stringhe in `Button`, `ScreenTitle`, titolo di `AppShell`, `StatusView` e
  `ConfirmDialog` non usano `… « » @ # * × →` (`scripts/displayGlyphs.test.ts`). Il pulsante del wireframe
  "Nuovo cliente «Rossi Mari»" è in conflitto con questa regola: vedi Open Questions.
- **E2E nel progetto `phone`** (parallelo): i nomi portano un suffisso unico per esecuzione, così non toccano
  stato condiviso né si bloccano a vicenda per nome già usato.
- **Revisione di sicurezza obbligatoria** (`security-and-hardening`) al Checkpoint A: RLS, privilegi,
  `search_path` vuoto, ruolo solo sul server, nessun nome o telefono nei log.
- **Pubblicazione esclusa da questo piano:** migrazioni su staging e produzione le esegue l'orchestratore.
- **Nota sulla spec:** la sezione Commands dice che `test:integration` non esiste; oggi esiste
  (`tests/integration/`) e il task 5 lo usa per il servizio.

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Database (rischio più alto)
- [x] Task 1: Tabella `customers`, chiave del nome, RLS e `create_customer` idempotente; pgTAP
- [x] Task 2: `update_customer` e `anonymize_customer`; pgTAP
- [x] Task 3: Letture `search_customers`, `get_customer`, `customers_served_today`; prestazioni; seed

### Checkpoint A: db:test verde; revisione di sicurezza su RLS, privilegi e RPC

### Fase 2: Contratto del frontend
- [x] Task 4: `phone.ts` e classificazione del testo cercato (funzioni pure)
- [x] Task 5: Tipi, `errorCodes.ts`, `supabaseCustomerService`, guardia del confine; integrazione
- [x] Task 6: Servizio finto, `CustomerServiceProvider` in `main.tsx` e `renderApp`

### Checkpoint B: unità e integrazione verdi; test esistenti invariati

### Fase 3: Home "Cerca cliente"
- [x] Task 7: Ricerca con attesa, `?q=`, risultati, limite 20, risposte fuori ordine; rotta indice
- [x] Task 8: Nessun risultato, errore con Riprova, `not_operator` → `/accedi`
- [x] Task 9: SERVITI OGGI (vuota, errore, ricarica su `visibilitychange`) e messaggio di stato della home

### Checkpoint C: home verde nei test di componente; Impeccable pulito; confronto con Cerca cliente e Ricerca senza risultati

### Fase 4: Nuovo, scheda, modifica, cancellazione
- [x] Task 10: Modulo Nuovo cliente: campi, validazione, privacy con dialogo segnaposto
- [x] Task 11: Salvataggio: nome già usato, rete + Riprova con lo stesso `operation_id`, doppio tocco, `?nome=`
- [x] Task 12: `AppShell` `headerAction` e scheda cliente (stati, telefono, note, SALDO, cliente cancellato)
- [x] Task 13: Modifica cliente (precompilata, errori, Riprova, cliente cancellato → scheda)
- [x] Task 14: Cancellazione dei dati: sezione solo admin, `ConfirmDialog`, errori, messaggio sulla home

### Checkpoint D: tutti gli stati con test di componente; Impeccable pulito; confronto con i wireframe a 390×844

### Fase 5: E2E e chiusura
- [x] Task 15: `e2e/customers.spec.ts` (admin e operatore, Supabase locale)
- [x] Task 16: Documentazione e memoria di progetto; verifica finale dei criteri di successo

### Checkpoint E: gli 8 criteri di successo verificati; quality bar completa verde; PR pronta per `code-review-and-quality`

## Copertura dei criteri di successo

| Criterio (docs/specs/SPEC-customers.md) | Task |
|---|---|
| 1. Cliente con solo nome e consenso; senza consenso `consent_required`; utente senza profilo → `not_operator`, RLS | 1, 3, 5, 10, 11, 15 |
| 2. "Nicolò Rossi" esistente: creare o rinominare in "nicolo rossi" rifiutato, con link alla scheda esistente | 1, 2, 11, 13, 15 |
| 3. Doppio tocco o reinvio con lo stesso `operation_id` → un solo cliente | 1, 5, 11 |
| 4. "333 123 4521" → `+393331234521`; "4521" lo trova; "••• 4521" in elenco, "333 ••• 4521" in scheda (superato da SPEC-customers-v2 punto 1: telefono rimosso, `phone.ts` eliminato) | 1, 3, 4, 7, 12, 15 |
| 5. "rossi mari" trova "Maria Rossi"; "nicolo" trova "Nicolò"; "50%" non trova tutti | 3, 4, 7, 15 |
| 6. `search_customers` sotto 50 ms in media con 1 000 clienti (`performs_within`) | 3 |
| 7. Solo l'admin anonimizza; campi svuotati, righe intatte, assente da ricerca e SERVITI OGGI, scheda "Cliente cancellato"; operatore `forbidden` e senza sezione | 2, 3, 12, 14, 15 |
| 8. Ogni stato con test di componente; E2E verde a 390×844; Impeccable pulito; target ≥ 48 px | 7–14, 15, 16 |

I criteri che dipendono da altri moduli si verificano lì: card sconosciuta → Nuovo cliente e disattivazione
della card all'anonimizzazione in `cards`; saldo reale, SERVITI OGGI con dati e rifiuto di movimenti su un
cliente anonimizzato in `ledger`.

## Verifica dei criteri di successo

Verifica finale del task 16 (2026-11-18), con la quality bar completa verde in locale. Ogni prova è scritta
come `file › titolo del test` (per pgTAP la descrizione dell'asserzione); `scripts/customersCriteria.test.ts`
controlla che ogni criterio ne abbia almeno una e che ognuna esista davvero nel file indicato.

| Criterio (docs/specs/SPEC-customers.md) | Test che lo prova |
|---|---|
| 1. Solo nome e consenso; senza consenso `consent_required`; senza profilo `not_operator`, RLS | `supabase/tests/customers.test.sql › name and consent are enough; the name is cleaned and the balance is 0`, `supabase/tests/customers.test.sql › consent false is refused`, `supabase/tests/customers.test.sql › a user without a profile reads no customers`, `supabase/tests/customers.test.sql › a user without a profile cannot create a customer`, `supabase/tests/customers.test.sql › a direct insert is denied`, `tests/integration/customers.test.ts › every call is not_operator, reads included`, `e2e/customers.spec.ts › an operator creates a customer with only the name and the consent, and cannot erase data` |
| 2. "nicolo rossi" accanto a "Nicolò Rossi" rifiutato in creazione e rinomina, con link alla scheda esistente | `supabase/tests/customers.test.sql › an equivalent name is refused`, `supabase/tests/customers.test.sql › renaming to a name already used is refused`, `supabase/tests/customers.test.sql › the refusal carries the existing customer id in detail`, `tests/integration/customers.test.ts › an equivalent name is customer_name_taken with the existing id`, `src/features/customers/NewCustomerPage.test.tsx › name already used: the error, "Apri la scheda" to that customer and how to tell them apart`, `src/features/customers/EditCustomerPage.test.tsx › name already used: the error and "Apri la scheda" to the other customer` |
| 3. Doppio tocco o reinvio con lo stesso `operation_id` → un solo cliente | `supabase/tests/customers.test.sql › the same operation id twice writes one row`, `tests/integration/customers.test.ts › a resend with the same operation_id returns the same customer, and only one row`, `src/features/customers/NewCustomerPage.test.tsx › is busy while saving: a double tap sends one request`, `src/features/customers/NewCustomerPage.test.tsx › network error: the message and "Riprova", which resends the same operation_id`, `src/features/customers/NewCustomerPage.test.tsx › answer lost, form changed, "Riprova": opens the customer saved by the first send` |
| 4. "333 123 4521" → `+393331234521`; "4521" lo trova; "••• 4521" in elenco, "333 ••• 4521" in scheda (superato da SPEC-customers-v2 punto 1: telefono rimosso, `phone.ts` eliminato) | `supabase/tests/customers.test.sql › 333 123 4521 becomes +393331234521`, `supabase/tests/customers.test.sql › the last 4 digits find the phone, never the anonymized one`, `src/features/customers/CustomerPage.test.tsx › shows the name as title, "Indietro" to the home, "Modifica cliente", email, notes and SALDO`, `e2e/customers.spec.ts › creates, finds, edits and erases a customer` |
| 5. "rossi mari" trova "Maria Rossi"; "nicolo" trova "Nicolò"; "50%" non trova tutti | `supabase/tests/customers.test.sql › words in any order find Maria Rossi, never the anonymized Mario Rossi`, `supabase/tests/customers.test.sql › a search without the accent finds the accented name`, `supabase/tests/customers.test.sql › % is searched literally`, `tests/integration/customers.test.ts › lists it filtered by name without accents`, `e2e/customers.spec.ts › creates, finds, edits and erases a customer` |
| 6. `search_customers` sotto 50 ms in media con 1 000 clienti (`performs_within`) | `supabase/tests/customers.test.sql › a search by name on 1 000 customers takes under 50 ms on average`, `supabase/tests/customers.test.sql › a search by phone on 1 000 customers takes under 50 ms on average` |
| 7. Solo l'admin anonimizza; dati svuotati, righe intatte, fuori da ricerca e SERVITI OGGI, "Cliente cancellato" senza modifica; operatore `forbidden` e senza sezione | `supabase/tests/customers.test.sql › an admin anonymizes: technical name, phone and notes null, anonymized_at set`, `supabase/tests/customers.test.sql › the anonymized row stays, with its consent time`, `supabase/tests/customers.test.sql › an operator cannot anonymize a customer`, `supabase/tests/customers.test.sql › anonymized customers never appear in a search`, `tests/integration/customers.test.ts › anonymizes a customer: data erased, gone from search, still readable by id`, `src/features/customers/CustomerPage.test.tsx › a customer whose data was erased: "Cliente cancellato", the date, the balance, no edit`, `src/features/customers/AnonymizeSection.test.tsx › an operator does not see the section`, `src/features/customers/AnonymizeSection.test.tsx › forbidden (the role changed meanwhile): "Solo un amministratore…" and nothing erased`, `e2e/customers.spec.ts › creates, finds, edits and erases a customer` |
| 8. Ogni stato con test di componente; E2E verde a 390×844; Impeccable pulito; target ≥ 48 px | `src/features/customers/HomePage.test.tsx › shows "Carico i clienti…" while the first page is on its way`, `src/features/customers/HomePage.test.tsx › no results for a name: says so and turns the button into "Nuovo cliente «<testo>»"`, `src/features/customers/HomePage.test.tsx › a failed search shows "Clienti non caricati", and "Riprova" searches again`, `src/features/customers/CustomerPage.test.tsx › shows the loading state until the customer arrives`, `src/features/customers/CustomerPage.test.tsx › a missing customer: "Cliente non trovato" with a link to the home`, `src/features/customers/CustomerPage.test.tsx › a network error: says so and "Riprova" loads again`, `src/features/customers/EditCustomerPage.test.tsx › a load error: says so and "Riprova" loads again`, `e2e/customers.spec.ts › Nuovo cliente: touch targets are at least 48 px and the notice opens and closes`, `e2e/customers.spec.ts › Scheda cliente: the saved customer opens with SALDO, and the header buttons are 48 px` |

Note sul criterio 8: SERVITI OGGI "vuota" è la sezione assente (`has no section when nobody was served
today`), come dice la spec. Il detector Impeccable non è un test: `impeccable detect src/features/customers
src/shared/ui src/app` non segnala nulla (solo regole a espressioni regolari: le regole che richiedono la
pagina disegnata, come contrasto e testo minuscolo, girano sulle pagine pubbliche e non dietro l'accesso; i
48 px sono provati dagli E2E sopra). Il progetto Playwright è `phone` a 390×844.

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| `execute` concesso di default a `public` sulle nuove funzioni | Alto | `revoke`/`grant` espliciti; `function_privileges.test.sql` e pgTAP per `anon`/`authenticated` |
| RPC di lettura `security definer` senza controllo dell'operatore espongono i clienti | Alto | Ogni RPC comincia con `private.is_active_operator()`; pgTAP: utente senza profilo riceve `not_operator` da tutte |
| Gara tra due invii: 23505 grezzo al frontend o due clienti | Alto | Eccezione `unique_violation` gestita nella RPC per vincolo; pgTAP con lo stesso `operation_id` e con nomi equivalenti |
| `unaccent` non `immutable`: colonna generata e indice rifiutati | Medio | Wrapper `immutable` con il dizionario esplicito `extensions.unaccent`, `set search_path = ''`; pgTAP sui vettori |
| `like` con `%`, `_`, `\` nel testo cercato trova tutti | Medio | Escape prima del confronto; pgTAP "50%" e "a_b" |
| `performs_within` fragile in CI | Medio | Media su 10 esecuzioni con 1 000 clienti generati nel test, soglia 50 ms (spec) |
| Normalizzazione del telefono diversa tra SQL e TS | Medio | Stessi vettori di test in pgTAP e Vitest (task 1 e 4) |
| Risposte di ricerca fuori ordine mostrano risultati vecchi | Medio | Contatore di richiesta nel hook; test di componente con risposte invertite |
| Sostituire `src/app/HomePage.tsx` rompe test esistenti di rotte, identity e settings | Medio | I test che cercano il segnaposto si aggiornano al nuovo contenuto (stesso comportamento), non si tolgono |
| Testo con glifi assenti in Enjoy Display (`«»` del wireframe, nomi digitati dagli utenti nei titoli) | Basso | `displayGlyphs.test.ts` sulle stringhe fisse; per il pulsante, Open Question 1 |
| Template email dopo `supabase start` | Basso | `scripts/reload-auth-templates.sh` dopo l'avvio dello stack (RUNBOOK) |

## Open Questions

1. **Pulsante "Nuovo cliente «Rossi Mari»"** (wireframe Ricerca senza risultati): `Button` è in Enjoy Display,
   che non ha `«` e `»` (`scripts/displayGlyphs.test.ts`). Da chiedere all'utente prima del task 8; proposta:
   tenere il testo del wireframe mettendo le virgolette e il nome in un elemento con il font del corpo,
   oppure togliere le virgolette ("Nuovo cliente: Rossi Mari", i due punti il font li ha). Finché non è deciso, il task 8
   costruisce il pulsante con il nome già pronto in una costante unica, così cambiare forma tocca una riga.
2. Le altre Open Questions della spec usano i default adottati (note, chi modifica, "oggi" in `Europe/Rome`,
   parole in qualunque ordine, telefono non unico, `name_key` e `create_operation_id`, nome dopo
   l'anonimizzazione, solo data del consenso, duplicati solo al salvataggio, 20 risultati, hook propri,
   `?q=` nell'URL, testi proposti), da rivedere con il titolare insieme all'informativa
   (`docs/specs/cross-review.md` §3).
