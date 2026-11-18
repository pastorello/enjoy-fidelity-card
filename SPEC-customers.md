# Spec: customers — V1

Status: approvata (2026-11-17) su delega dell'utente — le Open Questions adottano i default proposti, da rivedere con il titolare (`docs/specs/cross-review.md` §3)
Modulo: `customers` ([CAPABILITY-MAP.md](CAPABILITY-MAP.md)) · Dipende da: `identity` ·
Fonti: specifiche ("Nuovo cliente e consegna della card", "Sicurezza e privacy", "Modello dati"), wireframe
Cerca cliente, Ricerca senza risultati, Nuovo cliente senza card, Nome già usato, Modifica cliente, Scheda
cliente e note n2, n3, n6 (link in `brain/MAP.md` §5) · Decisioni: `brain/DECISIONS.md`.

## Objective

L'operatore trova un cliente in pochi tocchi, per nome o telefono, e ne registra uno nuovo in pochi secondi,
anche senza card e senza telefono. Il nome è l'unica chiave del cliente. Un amministratore può cancellare i
dati di un cliente su sua richiesta (GDPR) senza perdere i movimenti.

**Utenti**: operatori e amministratori; solo l'amministratore cancella i dati di un cliente.
**Successo**: dalla home un cliente si trova con il cognome, senza accenti o con le ultime 4 cifre del
telefono; due clienti con lo stesso nome (anche con maiuscole o accenti diversi) non possono esistere.

## Cosa include

1. **Home "Cerca cliente"** (`/`, sostituisce il segnaposto `src/app/HomePage.tsx`, che si elimina; la
   rotta indice in `src/app/routes.tsx` punta alla nuova pagina; wireframe Cerca cliente): `AppShell` con
   logo e pulsante account (già esistenti, `identity`), `SearchField` con placeholder "Es. Rossi o 4521",
   sezione **SERVITI OGGI**, pulsante "Nuovo cliente" nell'area azioni. Etichetta del campo: "Cerca per
   nome o telefono" (wireframe Ricerca senza risultati); diventa "Oppure cerca per nome o telefono"
   (wireframe Cerca cliente) solo quando `card-input` mostra sopra il riquadro grande "Avvicina la card".
   Il riquadro grande e quello compatto "Lettura attiva: puoi anche avvicinare la card" sono il
   `CardReadPanel` di `card-input` (varianti `full`/`compact`), la lettura è di `cards`: qui c'è solo il
   posto in cima alla pagina; con una ricerca mostrata la home passa `variant="compact"`. Il pulsante "Cancella la ricerca" (×)
   è già in `SearchField`: svuota il testo e torna a SERVITI OGGI.
2. **Ricerca** (mentre si scrive, attesa di 250 ms dall'ultimo tasto; mentre c'è una ricerca SERVITI OGGI
   non si mostra; il testo resta nell'URL come `/?q=<testo>` con `replace`, così "Indietro" dalla scheda
   ritrova la ricerca):
   - testo con sole cifre (ignorati spazi, `+`, `-`, `.`) e almeno 3 cifre → ricerca **per telefono**: il
     numero salvato contiene quelle cifre (es. "4521", "333 123", "+39 333…"; un `00` iniziale vale `+`);
   - altrimenti, almeno 2 caratteri → ricerca **per nome**: ogni parola cercata è contenuta nel nome,
     senza distinguere maiuscole, accenti e apostrofi (`'`/`’`), in qualunque ordine ("rossi maria",
     "nicolo" trova "Nicolò"); il testo cercato passa per la stessa chiave del nome (`customer_name_key`);
     `%`, `_` e `\` sono cercati alla lettera;
   - più corto → nessuna ricerca, resta SERVITI OGGI;
   - risultati in ordine alfabetico (`name_key`, poi `id`), al massimo 20; se sono di più, riga finale
     "Mostro i primi 20: scrivi qualcosa in più" (testo proposto, Open Question 10);
   - riga risultato (`ListRow`, non nel wireframe: stessa forma delle righe di SERVITI OGGI): nome;
     "••• 4521" o "Senza telefono"; `PointsBadge` col saldo; tocco → scheda;
   - **nessun risultato** (wireframe Ricerca senza risultati): "Nessun cliente trovato", "Controlla come è
     scritto, o cerca con le ultime 4 cifre del telefono."; il pulsante dell'area azioni diventa
     "Nuovo cliente «<testo>»" e apre Nuovo cliente con il nome già scritto; per una ricerca per telefono
     resta "Nuovo cliente" senza precompilare nulla;
   - caricamento: `StatusView` loading "Ricerca…"; errore: `StatusView` error "Ricerca non riuscita",
     "Controlla la connessione e riprova." con "Riprova". Le risposte arrivate fuori ordine si scartano.
   - I clienti con dati cancellati non compaiono mai nella ricerca né in SERVITI OGGI.
   - **Account tolto durante l'uso** (nota n6): se una RPC risponde `not_operator`, l'app torna su
     `/accedi` con il messaggio di `identity` "Account non abilitato: chiedi a un amministratore." (vale
     per tutte le schermate del modulo; serve un piccolo aggancio in `AuthProvider`,
     `reportNotEnabled()`, che riusa il controllo del profilo già fatto al ritorno in primo piano: profilo
     assente → `/accedi` con il motivo `not-enabled`; profilo presente → operatore e ruolo aggiornati nello
     stato. Così lo chiamano anche `settings`, `rewards`, `export` e `ledger` sui loro rifiuti di permesso,
     e `tablet-kiosk` lo devia su `/cassa`. Lo aggiunge il primo fra `settings`, `customers` e `rewards`
     che viene unito).
3. **SERVITI OGGI**: clienti con almeno una **spesa o un riscatto** registrati oggi (giorno di calendario
   `Europe/Rome`), anche se poi annullati; le correzioni non contano; esclusi i clienti con dati
   cancellati. Ordine: ultimo movimento più recente in alto, massimo 50 (regole proposte, Open Question 3).
   Riga: nome; "••• 0388 · 10:15" o "Senza telefono · 09:58" (ora dell'ultimo
   movimento); saldo. Si ricarica all'apertura della home e quando la pagina torna visibile
   (`visibilitychange`). Senza clienti oggi la sezione non si mostra; errore di caricamento: riga compatta
   "Non riesco a caricare i clienti di oggi" con "Riprova".
   **Dipendenza da `ledger`**: i dati vengono da `app.customers_served_today()`. Questo modulo la crea
   **vuota** (non esistono movimenti) e `ledger` la sostituisce (`create or replace`, stessa firma). Fino
   ad allora la home mostra solo ricerca e "Nuovo cliente".
4. **Nuovo cliente** (`/clienti/nuovo`, `?nome=` facoltativo; wireframe Nuovo cliente senza card):
   - "Nome e cognome" (placeholder "Es. Maria Rossi"), "Telefono (facoltativo)" (`type="tel"`,
     placeholder "Numero di cellulare"), testo "Il nome identifica il cliente: non può essere già di un
     altro. Il telefono serve solo a trovarlo più in fretta.";
   - **PRIVACY**: casella "Ha letto l’informativa privacy (obbligatorio)" (area di tocco ≥ 48 px) e
     pulsante-link "Mostra l’informativa" che apre un dialogo con il testo (vedi punto 9);
   - "Note (facoltative)", testo libero fino a 500 caratteri, in fondo al modulo (non nei wireframe: Open
     Question 1);
   - `?nome=`: ripulito (spazi) e tagliato a 80 caratteri prima di riempire il campo;
   - "Salva cliente" nell'area azioni; dopo il salvataggio si va alla scheda (`replace`, così "Indietro"
     torna alla home). La sezione "Card (facoltativa)" e il ramo `?card=<UID>` (salva → Registra spesa)
     li aggiunge `cards`.
5. **Errori del modulo** (sotto il campo, testo `danger-text`, fuoco sul primo campo errato):
   - nome vuoto: "Scrivi nome e cognome."; oltre 80 caratteri: "Al massimo 80 caratteri.";
   - **nome già usato** (wireframe Nome già usato): "Esiste già un cliente con questo nome." + link
     "Apri la scheda" (scheda del cliente esistente) + "Se è un’altra persona, aggiungi un dettaglio al
     nome, per esempio «Maria Rossi Serapo»." (al posto del testo d'aiuto sotto il nome, come nel
     wireframe). Il controllo lo fa il server al salvataggio;
   - telefono non valido: "Numero non valido: scrivi solo le cifre, con o senza prefisso.";
   - consenso mancante: "Serve il consenso privacy per registrare il cliente.";
   - note oltre 500 caratteri: "Al massimo 500 caratteri." (il campo lo impedisce già con `maxLength`);
   - rete: "Cliente non salvato: controlla la connessione e riprova." con "Riprova", che reinvia **lo
     stesso `operation_id`**; se il primo invio era arrivato, il server restituisce quel cliente e l'app
     apre la sua scheda (anche se nel frattempo il modulo è stato cambiato: si apre il cliente salvato
     davvero, che si corregge da Modifica). Durante l'invio "Salva cliente" è `busy` (pressioni ignorate):
     il doppio tocco non crea due clienti.
   - I testi degli errori di validazione, di rete e "Riprova" sono proposti (i wireframe mostrano solo
     "nome già usato").
6. **Scheda cliente** (`/clienti/:id`; wireframe Scheda cliente): intestazione con "Indietro" (alla home,
   con la ricerca `?q=` se c'era), nome come titolo e pulsante icona "Modifica cliente" a destra (l'`AppShell`
   oggi non ha un'azione a destra con il titolo: si aggiunge una prop facoltativa, es.
   `headerAction`, con test); riga "Card attiva …E5F6 · Tel. 333 ••• 4521" (la parte card è di
   `cards`; qui solo "Tel. …" o "Senza telefono"); note, se presenti, in testo secondario; riquadro
   **SALDO** con il numero e "punti". Appartengono a `ledger`: "Registra spesa", "Riscatta premio",
   "ULTIMI MOVIMENTI"/"Vedi tutti" (e lo stato "cliente senza movimenti" della nota n6), in
   `CustomerLedgerSection`, che `ledger` monta in `CustomerPage` sotto il riquadro SALDO. Stati:
   caricamento; "Cliente non trovato" (id inesistente **o non in formato uuid**, controllato nell'app
   prima di chiamare il server) con link alla home; errore con "Riprova". Cliente con dati cancellati:
   titolo "Cliente cancellato" (il nome tecnico del punto 8 non si mostra), riga "Dati cancellati il
   17 nov 2026" (testo proposto, Open Question 7), saldo, nessun pulsante di modifica. Il saldo è un
   dato per l'operatore: la scheda non ha modalità "da mostrare al cliente".
7. **Modifica cliente** (`/clienti/:id/modifica`; wireframe Modifica cliente): nome e telefono precompilati
   (telefono italiano mostrato come "333 123 4521"), note; "Salva modifiche" → scheda. Stessi errori del
   punto 5 (nome già usato: "Apri la scheda" porta all'altro cliente; rete: "Modifiche non salvate:
   controlla la connessione e riprova." con "Riprova", sicuro perché la modifica è idempotente);
   "Salva modifiche" è `busy` durante l'invio. Il telefono si può svuotare. Nessuna sezione privacy (il
   consenso si dà una volta sola). Stati: caricamento, non trovato, errore come nella scheda; un cliente
   con dati cancellati non si modifica: l'URL diretto riporta alla scheda (`replace`). La
   sezione **CARD** (Sostituisci/Disattiva) è di `cards`. Sezione **DATI DEL CLIENTE**, **solo per gli
   amministratori** (agli operatori non si mostra): pulsante pericoloso "Cancella i dati del cliente" e
   "Nome e telefono si cancellano, i movimenti restano senza dati personali. Solo amministratori."
8. **Cancellazione dei dati (anonimizzazione)**: `ConfirmDialog` `tone="danger"`, titolo "Cancellare i
   dati di <nome>?", descrizione "Nome, telefono e note si cancellano per sempre e la card si disattiva. I
   movimenti e il saldo restano, senza dati personali. Non si può tornare indietro.", conferma "Cancella i
   dati" (`busy` durante l'invio). Dopo: home (`replace`) con il messaggio "Dati del cliente cancellati."
   in una riga `role="status"` in cima al contenuto, passato nello stato della navigazione (non esiste un
   componente "toast" nel design system); errore di rete: il dialogo resta aperto con "Dati non
   cancellati: controlla la connessione e riprova." (ripetere è sicuro, operazione idempotente).
   Operatore che la chiama comunque (API): rifiutata dal server (`forbidden`); in UI "Solo un
   amministratore può cancellare i dati di un cliente." I testi del dialogo e dei messaggi sono proposti.
9. **Informativa privacy**: testo in una sola costante (`src/features/customers/privacyNotice.ts`), ora
   **segnaposto**: "Testo dell'informativa in attesa di verifica del consulente del bar." marcato
   `PRIVACY_NOTICE_STATUS = 'draft'`. Nessun testo legale inventato. Il testo approvato è un requisito del
   checkpoint di lancio (CAPABILITY-MAP).
10. **Telefono**: normalizzazione in E.164 (sul server, rispecchiata in TS per l'anteprima): tolti spazi,
    `.`, `-`, `/`, parentesi; `00` iniziale → `+`; senza `+` si antepone `+39` (lo `0` dei fissi resta:
    "0771 123456" → `+390771123456`); risultato valido se `^\+[1-9][0-9]{6,14}$`. Visualizzazione: elenchi
    "••• 4521" (ultime 4 cifre); scheda "333 ••• 4521" per i `+39` (prime 3 cifre nazionali), "+44 ••• 4521"
    per gli altri; modifica: cifre nazionali raggruppate 3-3-resto per i `+39`, E.164 per gli altri.

### Modello dati e regole di accesso

```sql
-- app.customers (dal contratto, più name_key e create_operation_id)
id                   uuid primary key default gen_random_uuid()
name                 text not null check (name = private.clean_name(name) and length(name) between 1 and 80)
name_key             text generated always as (private.customer_name_key(name)) stored
phone                text check (phone ~ '^\+[1-9][0-9]{6,14}$')            -- E.164, facoltativo
privacy_consent_at   timestamptz not null                                    -- now() del server
notes                text check (length(notes) <= 500)
created_at           timestamptz not null default now()
created_by           uuid not null references app.operators(id)
create_operation_id  uuid not null unique                                    -- idempotenza della creazione
anonymized_at        timestamptz
-- unique index customers_name_key on (name_key)
```

- `private.clean_name(text)`: `btrim` e spazi interni ridotti a uno. `private.customer_name_key(text)`
  (`immutable`): `lower(extensions.unaccent('extensions.unaccent', clean_name))` con `’` → `'`. Estensione
  `unaccent` nello schema `extensions`. Niente `pg_trgm`: con centinaia di clienti (anche 1 000) una
  scansione con `like` su `name_key` e `phone` resta sotto pochi millisecondi; si rivaluta oltre 10 000.
  `clean_name` e `customer_name_key` non si concedono ad `authenticated` (le usano solo vincoli, colonna
  generata e RPC `security definer`).
- **RLS**: `select` per `private.is_active_operator()`; `insert/update/delete/truncate` revocati ad
  `authenticated`: si scrive solo con le RPC. Nessuna riga si cancella mai.
- `private.acting_operator_id()`: `create or replace function private.acting_operator_id()` con il corpo comune a `settings`, `customers` e `rewards` (identico parola per parola): `select private.current_operator_id()`, `stable`, `security definer`, `set search_path = ''`, `revoke execute ... from public, anon, authenticated` (la chiamano solo funzioni `security definer`) (definizione in `SPEC-settings.md`). Le migrazioni di
  questi tre moduli precedono sempre quella di `tablet-kiosk`, che la estende dopo.
- RPC (`security definer`, `set search_path = ''`, eseguibili solo da `authenticated`; errori con
  `errcode` `P0001` e messaggio-codice che il frontend traduce). Ogni RPC, **anche quelle di lettura**
  (che con `security definer` scavalcano la RLS), comincia con il controllo `private.is_active_operator()`
  e altrimenti alza `not_operator`. Testo vuoto (solo spazi) per telefono e note = `null`.
  - `app.create_customer(p_operation_id uuid, p_name text, p_phone text, p_privacy_consent boolean,
    p_notes text) returns app.customer_summary` — idempotente su `create_operation_id` (un secondo invio
    restituisce il cliente già creato); errori `name_required`, `name_too_long`, `phone_invalid`,
    `consent_required`, `notes_too_long`, `customer_name_taken` (con `detail` = id del cliente
    esistente); `created_by = private.acting_operator_id()`. Le gare tra due invii contemporanei si
    chiudono con i vincoli: un `unique_violation` su `create_operation_id` restituisce il cliente già
    creato, uno su `name_key` diventa `customer_name_taken` (mai un errore 23505 grezzo al frontend).
  - `app.update_customer(p_customer_id, p_name, p_phone, p_notes)` — tutti gli operatori; stessi errori
    (escluso il consenso, anche qui `unique_violation` → `customer_name_taken`); `customer_not_found`,
    `customer_anonymized` (riga bloccata `for update` prima del controllo). Ultima scrittura vince.
  - `app.anonymize_customer(p_customer_id)` — solo `private.is_admin()` (`forbidden` altrimenti;
    `customer_not_found` se l'id non esiste); blocca
    la riga (`for update`), imposta `name = 'Cliente cancellato ' || <primi 8 caratteri dell'id>` (unico),
    `phone`, `notes` a null, `anonymized_at = now()`; ripetuta su un cliente già anonimizzato non cambia
    nulla. Movimenti e `privacy_consent_at` restano. La disattivazione delle card la aggiunge `cards` (es.
    trigger su `anonymized_at`), che la verifica nei suoi test.
  - Lettura (`stable`): `app.search_customers(p_query text)` (testo oltre 80 caratteri tagliato; max 21
    righe, la 21ª dice "ce ne sono altre"; mai clienti con `anonymized_at`), `app.get_customer(p_customer_id)`
    (anche anonimizzati; nessuna riga se non esiste), `app.customers_served_today()` (senza anonimizzati);
    tutte restituiscono `app.customer_summary (id, name, phone, notes, anonymized_at, balance int,
    last_served_at timestamptz)`. Finché non c'è `ledger`, `balance` = 0 (vero: nessun movimento) e
    `last_served_at` null; `ledger` sostituisce i corpi con la somma dei punti (convertita in `int`), senza
    cambiare le firme né il controllo `not_operator`.
- I movimenti (`ledger`) devono rifiutare nuove spese e riscatti su un cliente con `anonymized_at`, e non
  copiare nome o telefono del cliente in nessuna colonna dei movimenti (l'anonimizzazione non li
  raggiungerebbe).

## Commands

Nessun comando nuovo (`npm test`, `npm run db:test`, `npm run e2e`). Nota (2026-11-18, task 16): quando la
spec è stata scritta `test:integration` non esisteva; oggi esiste (`npm run test:integration`,
`tests/integration/`) e `tests/integration/customers.test.ts` prova le RPC e la traduzione degli errori di
`supabaseCustomerService` contro lo stack locale, oltre ai test unitari con `getSupabase` finto.

## Project Structure

```
src/features/customers/
  types.ts                    → CustomerSummary, CustomerService (search, servedToday, get, create, update, anonymize)
  supabaseCustomerService.ts  → implementazione con le RPC; traduce i codici di errore
  phone.ts                    → normalizePhone, maskPhone, formatPhoneForCard, formatPhoneForEdit
  HomePage.tsx                → Cerca cliente (ricerca, SERVITI OGGI, Nuovo cliente)
  NewCustomerPage.tsx · CustomerPage.tsx · EditCustomerPage.tsx
  CustomerForm.tsx            → campi comuni a nuovo/modifica, errori
  PrivacyNoticeDialog.tsx · privacyNotice.ts · AnonymizeSection.tsx
  errorCodes.ts               → elenco unico dei codici d'errore del server e dei testi italiani
src/app/routes.tsx            → rotte /, /clienti/nuovo, /clienti/:id, /clienti/:id/modifica (src/app/HomePage.tsx si elimina)
src/app/AppShell.tsx          → prop facoltativa per l'azione a destra del titolo (Modifica cliente)
src/features/identity/AuthProvider.tsx → aggancio per `not_operator` (torna su /accedi, motivo `not-enabled`)
src/test/fakeCustomerService.ts → servizio in memoria (registra le chiamate, simula errori di rete)
src/test/renderApp.tsx        → accetta anche il fake dei clienti (provider dei servizi)
supabase/migrations/<ts>_customers.sql · supabase/tests/customers.test.sql
supabase/seed.sql             → 5 clienti finti (telefoni +39333000000x)
e2e/customers.spec.ts
```

## Code Style

Come `platform` e `identity`: i componenti usano solo `CustomerService` tramite piccoli hook del modulo
(`useCustomerSearch`, `useCustomer`…, con stato caricamento/errore/dati e scarto delle risposte superate),
mai `getSupabase()`. Nessuna dipendenza nuova: TanStack Query non è installato (Open Question 11).
`operation_id` con `crypto.randomUUID()` al primo "Salva cliente", tenuto finché
l'esito è incerto (errore di rete), rigenerato solo dopo un rifiuto del server.

```ts
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[\s.\-/()]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith('+')) digits = `+39${digits}`;
  return /^\+[1-9][0-9]{6,14}$/.test(digits) ? digits : null;
}
```

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP (`customers.test.sql`) | RLS: `anon` e utente senza profilo non leggono la tabella; utente senza profilo riceve `not_operator` da **ogni** RPC (anche di lettura); `authenticated` non scrive direttamente (insert/update/delete); nessuna funzione nuova eseguibile da `anon`/`PUBLIC` (già coperto da `function_privileges.test.sql`); unicità di `name_key` ("Nicolò Rossi" = "nicolo  rossi"; "D'Angelo" = "D’Angelo"); `create_customer`: consenso falso, nome vuoto/lungo, telefono non valido rifiutati, normalizzazione (`333 123 4521`, `0039…`, `+44…`, `0771…`), stesso `operation_id` due volte → una riga e stesso id, nome già usato → `detail` con l'id, `created_by` = operatore chiamante, `privacy_consent_at` = ora del server; `update_customer`: rinomina su un nome già usato rifiutata, telefono svuotato → null, rifiuto su anonimizzato, id inesistente; `anonymize_customer`: operatore rifiutato, admin ok, campi svuotati, idempotente, sparisce dalla ricerca, movimenti intatti (quando esistono); `search_customers`: parole in ordine qualsiasi, accenti, apostrofo `’`, cifre parziali, `%`/`_`/`\` alla lettera, ordine alfabetico, limite 21, anonimizzati esclusi; `customers_served_today` vuota; `performs_within` media < 50 ms su 10 esecuzioni con 1 000 clienti finti generati nel test (meno fragile di una misura singola) |
| Unit (Vitest) | `phone.ts` con gli stessi vettori di pgTAP; classificazione testo nome/telefono; `supabaseCustomerService` con `getSupabase` finto (come `supabaseAuthService.test.ts`): ogni codice di `errorCodes.ts` → errore tipizzato, errore di rete → `network`, `customer_name_taken` → id dal `detail` |
| Componenti (Vitest + `fakeCustomerService`) | ricerca con attesa e risposte fuori ordine; nessun risultato con "Nuovo cliente «q»" precompilato; errore + Riprova; SERVITI OGGI piena, nascosta se vuota, errore; nuovo cliente: errori di validazione, nome già usato con "Apri la scheda", errore di rete → Riprova con lo **stesso** `operation_id`, doppio tocco = una chiamata; `?nome=` precompila; scheda: caricamento, non trovato (anche id non uuid, senza chiamare il servizio), errore, cliente cancellato senza "Modifica cliente"; modifica: precompilata, errori, rete + Riprova, cliente cancellato → scheda; sezione cancellazione visibile solo all'admin, `ConfirmDialog`, messaggio sulla home; `not_operator` → `/accedi` con "Account non abilitato"; ricerca nell'URL ritrovata con Indietro |
| E2E (Playwright, 390×844, Supabase locale) | (nomi con un suffisso unico per esecuzione, così un test fallito a metà non blocca il successivo per nome già usato) admin crea "Nicolò Prova E2E <suffisso>" con telefono → lo trova con "nicolo", con le ultime 4 cifre → scheda → modifica telefono → nome duplicato rifiutato → cancella i dati → non si trova più; operatore crea un cliente con solo nome e consenso; nessuna sezione "Dati del cliente". Nessun adattatore card: la card sconosciuta → nuovo cliente si prova in `cards` con `window.__enjoyFakeCard` |

## Boundaries

- **Always**: unicità e normalizzazione sul server; controllo di ruolo nelle RPC (l'interfaccia nasconde
  soltanto); solo dati finti (`@example.com`, telefoni `+39333000…`, nessun nome di clienti veri); il
  telefono non si usa per contattare nessuno (niente link `tel:`/`sms:`); niente nomi o telefoni dei
  clienti nei log della console o nei messaggi d'errore inviati altrove.
- **Ask first**: rendere unico il telefono; cambiare cosa conta come "servito oggi"; testo dell'informativa
  (solo dal consulente); conservare la versione dell'informativa accettata.
- **Never**: cancellare righe di `customers` o movimenti; scrittura diretta sulla tabella dall'API;
  definire `private.acting_operator_id()` con un corpo diverso da quello comune; mostrare il saldo al cliente; anonimizzazione
  senza `ConfirmDialog`; testo legale scritto dall'agente.

## Success Criteria

1. Un operatore crea un cliente con solo nome e consenso; senza consenso il server rifiuta (`consent_required`);
   un utente autenticato senza profilo operatore non legge né scrive clienti (`not_operator`, RLS).
2. "Nicolò Rossi" esistente → creare "nicolo rossi" o rinominare un altro cliente così è rifiutato, con
   link alla scheda esistente.
3. Doppio tocco o reinvio dopo errore di rete con lo stesso `operation_id` → un solo cliente.
4. "333 123 4521" si salva `+393331234521`; la ricerca "4521" lo trova; in elenco si vede "••• 4521", in
   scheda "333 ••• 4521".
5. La ricerca "rossi mari" trova "Maria Rossi"; "nicolo" trova "Nicolò"; "50%" non trova tutti.
6. Con 1 000 clienti finti `search_customers` resta in media sotto 50 ms (pgTAP `performs_within`).
7. Solo un amministratore anonimizza: nome sostituito, telefono e note a null, `anonymized_at` valorizzato,
   righe e movimenti presenti, cliente assente dalla ricerca e da SERVITI OGGI, scheda "Cliente
   cancellato" senza modifica; un operatore riceve `forbidden` e non vede la sezione.
8. Ogni stato descritto (caricamento, vuoto, errore con Riprova, non trovato, cliente cancellato) ha un
   test di componente; E2E verde a 390×844; detector Impeccable pulito; target di tocco ≥ 48 px.

## Out of Scope

- Lettura card, riquadro "Avvicina la card", sezione Card dei moduli, card sconosciuta → `card-input`, `cards`.
- Saldo reale, Registra spesa, Riscatta premio, movimenti, SERVITI OGGI con dati → `ledger`.
- Esportazione CSV dei clienti → `export`. Schermate tablet → `tablet-kiosk`.
- Unione di clienti doppi, storico delle modifiche, contatto dei clienti (non-obiettivo).

## Open Questions

1. **Note**: le specifiche le hanno nel modello, i wireframe no. Proposta: campo facoltativo (500
   caratteri) in fondo a Nuovo e Modifica, mostrato in scheda; cancellato all'anonimizzazione (default adottato).
2. **Chi modifica un cliente**: le specifiche non lo dicono per l'operatore. Proposta: nome, telefono e
   note li modificano tutti; la cancellazione dei dati solo l'amministratore (default adottato).
3. **"Oggi" per SERVITI OGGI**: Proposta: giorno di calendario `Europe/Rome` (mezzanotte), spese e riscatti
   anche annullati, massimo 50, sezione nascosta se vuota (default adottato). Se il bar chiude dopo
   mezzanotte serve un'ora di cambio giornata.
4. **Ricerca per nome**: il wireframe mostra "Rossi Mari" senza risultati. Proposta: ogni parola contenuta
   nel nome, in qualunque ordine (default adottato): con un cliente "Maria Rossi" quella ricerca lo trova.
5. **Telefono unico?** Proposta: no, due clienti possono avere lo stesso numero (es. famiglia); la ricerca
   li mostra entrambi (default adottato).
6. **Contratto**: aggiunte `name_key` (unicità senza accenti) e `create_operation_id` (idempotenza della
   creazione, che il contratto prevede solo per i movimenti). Proposta: tenerle (default adottato).
7. **Nome dopo l'anonimizzazione**: Proposta: "Cliente cancellato" + 8 caratteri dell'id nel database,
   "Cliente cancellato" e "Dati cancellati il <data>" in scheda; il cliente resta apribile da link diretti e
   movimenti, mai nella ricerca né in SERVITI OGGI (default adottato).
8. **Versione dell'informativa accettata**: Proposta: si salva solo la data del consenso, come nelle
   specifiche (default adottato); chiedere al consulente se serve la versione.
9. **Duplicati controllati mentre si scrive**: Proposta: solo al salvataggio, dal server (default adottato).
10. **Più di 20 risultati**: i wireframe non mostrano l'elenco dei risultati. Proposta: righe come SERVITI
    OGGI, massimo 20, riga finale "Mostro i primi 20: scrivi qualcosa in più" (default adottato).
11. **TanStack Query**: non è tra le dipendenze. Proposta: hook propri del modulo, nessuna dipendenza nuova
    (default adottato); si riconsidera se `ledger` ha bisogno di cache condivisa e invalidazioni.
12. **Ricerca ritrovata con "Indietro"**: non nelle fonti. Proposta: il testo resta nell'URL (`/?q=`) e la
    scheda torna lì (default adottato).
13. **Testi non presenti nei wireframe** (errori di validazione e di rete, dialogo di cancellazione, messaggio
    "Dati del cliente cancellati.", "Dati cancellati il …"): proposti dall'agente in stile design system
    («Stati, errori e conferme», nota n6); da rivedere con il titolare insieme all'informativa (default:
    quelli di questa specifica).
