# Spec: cards

Status: approvata (2026-11-17) su delega dell'utente — le Open Questions adottano i default proposti, da rivedere con il titolare (`docs/specs/cross-review.md` §3)
Modulo: `cards` ([CAPABILITY-MAP.md](CAPABILITY-MAP.md)) · Dipende da: `customers`, `card-input` ·
Fonti: specifiche ("Nuovo cliente e consegna della card", "Registrare una spesa" punto 1, "Modello dati",
"Sicurezza e privacy") e wireframe Cerca cliente, Card sconosciuta: nuovo cliente, Nuovo cliente senza card,
Associa o sostituisci card, Card già di un altro cliente, Modifica cliente, Scheda cliente, Registra spesa,
con le note n1, n2, n6 · Decisioni: `brain/DECISIONS.md`.

## Objective

La card è la scorciatoia per riconoscere il cliente alla cassa. Questo modulo lega ogni card (uid del tag
NTAG215, solo letto, mai scritto) a un cliente e decide cosa succede quando una card viene letta:

- dalla schermata principale una card **attiva** apre subito Registra spesa del suo cliente; una card
  **sconosciuta** apre Nuovo cliente con la card già associata e, dopo il salvataggio, Registra spesa;
- da Modifica cliente si **associa** o **sostituisce** la card (card persa: la vecchia si disattiva, i punti
  restano) oppure la si **disattiva** soltanto.

**Utenti**: amministratori e operatori, con gli stessi permessi (le specifiche: "l'amministratore o
l'operatore la disattiva e ne associa una nuova"; l'operatore "consegna card").
**Successo**: card → Registra spesa senza toccare lo schermo; una card non è mai di due clienti; un
cliente non ha mai due card attive; un uid non passa mai a un altro cliente.

## Cosa include

1. **Lettura dalla schermata principale** (`/`, wireframe "Cerca cliente"). Il riquadro è il
   `CardReadPanel` di `card-input` (già inserito nella home da quel modulo, con consumatore disattivato) con i testi del wireframe («Avvicina la card» · «Lettura attiva: appoggia
   la card sul retro del telefono. Una card nuova apre la registrazione del cliente.»); `cards` monta il
   consumatore (`useCardRead`), che riceve l'uid già normalizzato, e chiama `app.lookup_card`:
   - card attiva, cliente non anonimizzato → `navigate('/clienti/:id/spesa')` (wireframe "Registra spesa
     (aperta dalla card)");
   - card sconosciuta → `navigate('/clienti/nuovo?card=<UID>')`;
   - card disattivata (card persa e poi ritrovata) → **non** apre la spesa; avviso nel riquadro di lettura
     (`role="alert"`): «Card disattivata» · «Questa card non è più attiva: era di Maria Rossi. Cerca il
     cliente per nome o telefono.» · pulsante «Apri la scheda di Maria» (`/clienti/:id`); la lettura resta
     attiva e una nuova card sostituisce l'avviso;
   - card di un cliente anonimizzato (sempre disattivata, vedi punto 7) → «Card non più valida» · «I dati
     del cliente di questa card sono stati cancellati. Usa un'altra card.»; nessun nome, nessun pulsante
     verso la scheda;
   - durante la ricerca: «Lettura della card…» nel riquadro; altre letture ignorate finché non finisce;
   - errore di rete: «Card non letta: controlla la connessione.» con «Riprova» (ripete la stessa ricerca:
     è una lettura, nessun rischio di doppioni). La ricerca per nome resta sempre utilizzabile.
   - **Prima di `ledger`**: `cards` si costruisce prima di `ledger` (CAPABILITY-MAP), quindi registra
     `/clienti/:id/spesa` come segnaposto (intestazione «Registra spesa» con «Indietro» e riga cliente con
     nome e saldo, nessun tastierino) che `ledger` sostituisce mantenendo la stessa rotta.
2. **Nuovo cliente da card nuova** (`/clienti/nuovo?card=<UID>`, wireframe "Card sconosciuta: nuovo
   cliente"). Il modulo estende il form di `customers`:
   - titolo e campi restano quelli di `customers` (Nome e cognome, Telefono, PRIVACY, «Salva cliente»);
   - riquadro `aria-label="Card letta"` al posto della sezione «Card (facoltativa)»: «Card nuova letta» ·
     «Codice 04A1B2C3D4E5F6: non è di nessun cliente, verrà associata a questo.» (uid completo);
   - testo e link «È la nuova card di un cliente già registrato? Cerca il cliente e associa la card dalla
     sua scheda.» → `/`;
   - «Salva cliente» crea cliente e card **nella stessa transazione** (`app.create_customer_with_card`, con
     lo stesso `operation_id` che il form di `customers` genera una volta e riusa nei reinvii), poi
     `navigate('/clienti/:id/spesa', { replace: true })`;
   - parametro `card` non valido (`normalizeUid(card, 'hex')` dà `null`) → ignorato, il form resta "senza
     card" (punto 3);
   - card diventata nel frattempo di un altro cliente (`card_taken`) → cliente **non** creato, form intatto,
     avviso come nel punto 4 con, in più, «Continua senza card» (toglie `?card` e resta nel form; il
     salvataggio successivo usa `app.create_customer` con lo stesso `operation_id`, che non ha creato nulla);
   - una nuova lettura sulla pagina segue le regole del punto 3 (l'ultima card letta vale);
   - errori del form (nome già usato, consenso mancante, telefono non valido) restano quelli di `customers`.
3. **Card nel form Nuovo cliente senza card** (`/clienti/nuovo`, wireframe "Nuovo cliente senza card"):
   sezione `aria-label="Card"` «Card (facoltativa)» · «Lettura attiva: avvicina una card nuova per
   associarla adesso, oppure fallo più tardi dalla scheda.» Alla lettura si chiama `app.lookup_card`:
   - card sconosciuta → la sezione diventa il riquadro «Card letta» del punto 2 (l'ultima card sconosciuta
     letta sostituisce la precedente); il salvataggio usa la stessa RPC; la destinazione dopo il salvataggio
     resta quella di `customers`;
   - card già nota (attiva o disattivata, anche di cliente anonimizzato) → avviso del punto 4 («Card già
     associata», testi secondo il caso) senza perdere i dati scritti; «Apri la scheda di …» lascia il form;
   - lettura non disponibile → stati di `CardReadPanel` di `card-input` (NFC spento, permesso, iPhone): il
     cliente si salva comunque senza card.
4. **Associa o sostituisci card** (`/clienti/:id/card`, wireframe "Associa o sostituisci card"):
   intestazione «Associa card» con «Indietro» → `/clienti/:id/modifica`; riga cliente (nome, saldo in
   punti con `PointsBadge`, freccia) → `/clienti/:id`; riquadro `CardReadPanel` (`aria-label="Lettura
   card"`): «Avvicina la card nuova» · «L'app legge solo il codice della card: non ci scrive nulla.»; se il
   cliente ha una card attiva, sotto il riquadro con icona card: «La card attuale (…E5F6) verrà
   disattivata. I punti restano a Maria.»; footer «Annulla» → `/clienti/:id/modifica`. Alla lettura
   (`app.associate_card`):
   - **riuscita** → `navigate('/clienti/:id/modifica', { replace: true })` con messaggio `role="status"`
     «Card …A1B2 associata»;
   - **card di un altro cliente** (wireframe "Card già di un altro cliente"): riquadro, nota e footer
     lasciano il posto all'avviso `role="alert"` (restano intestazione e riga cliente): «Card già
     associata» · «Questa card è di Antonio Esposito. Una card può essere di un solo cliente: usa un'altra
     card.» · «Riprova con un'altra card» (torna in lettura; in questo stato le letture sono ignorate) ·
     «Apri la scheda di Antonio» → `/clienti/<id di Antonio>`. Se quella card è disattivata: «Questa card
     era di Antonio Esposito. Una card può essere di un solo cliente: usa un'altra card.». Se il
     proprietario è anonimizzato: «Questa card era di un cliente i cui dati sono stati cancellati. Una card
     può essere di un solo cliente: usa un'altra card.» senza «Apri la scheda»;
   - **è già la card attiva di questo cliente** → «Questa è già la card attiva di Maria.», nessuna modifica;
   - **card disattivata dello stesso cliente** (ritrovata) → si riattiva e l'eventuale card attiva si
     disattiva, con lo stesso esito di una riuscita;
   - salvataggio in corso: «Associazione in corso…», letture ignorate;
   - errore di rete → «Card non associata: controlla la connessione.» con «Riprova» che rimanda lo stesso
     uid (operazione idempotente, vedi sotto);
   - lettura non disponibile (NFC spento, permesso negato, iPhone) → stati di `CardReadPanel` nel riquadro;
   - cliente anonimizzato (`customer_anonymized`) → `StatusView` errore «Questo cliente non può avere una
     card.»; inesistente (`customer_not_found`) → pagina non trovata di `customers`.
5. **Sezione CARD di Modifica cliente** (`/clienti/:id/modifica`, wireframe "Modifica cliente"):
   - con card attiva: «Card attiva …E5F6 · dal 3 nov» (data di associazione o di riattivazione, fuso
     `Europe/Rome`; anno aggiunto se diverso dal corrente), pulsanti «Sostituisci card» →
     `/clienti/:id/card` e «Disattiva card»;
   - senza card attiva: «Nessuna card attiva» e pulsante «Associa card» → `/clienti/:id/card`;
   - «Disattiva card» apre `ConfirmDialog`: «Disattivare la card …E5F6?» · «La card non aprirà più la
     scheda di Maria. I punti restano a Maria.» · «Disattiva card» (danger) / «Lascia com'è». Esito: la
     sezione passa a «Nessuna card attiva»; errore di rete → messaggio e «Riprova» (idempotente);
   - la sezione si aggiorna senza salvare il form: card e dati anagrafici si salvano separatamente;
   - errore di caricamento della card → riga «Card non caricata» con «Riprova»; il resto del form resta
     usabile.
6. **Scheda cliente** (wireframe "Scheda cliente"): la riga sotto il nome mostra «Card attiva …E5F6» o
   «Senza card» (stesso stile di «Senza telefono» della home), seguito da « · » e dalla parte telefono di
   `customers` («Tel. 333 ••• 4521» o «Senza telefono»). Cliente anonimizzato: la riga resta quella di
   `customers`, senza parte card.
7. **Cliente anonimizzato**: un trigger di questo modulo disattiva la card attiva quando `customers`
   imposta `anonymized_at`; l'uid resta legato a quel cliente e non si riusa mai.

Etichetta della card: `formatCardLabel(uid)` → «…» + ultimi 4 caratteri dell'uid. Nome breve nei testi
(«a Maria», «di Antonio»): prima parola del nome, come nei wireframe. Le card si leggono solo su `/`,
`/clienti/nuovo` e `/clienti/:id/card` (consumatori di `useCardRead`); altrove le letture le scarta
`card-input`.

### Modello dati e regole di accesso

```sql
-- app.cards: una riga per ogni tag mai associato; le righe non si cancellano
id             uuid primary key default gen_random_uuid()
uid            text not null unique
               check (uid ~ '^[0-9A-F]{8,20}$' and length(uid) % 2 = 0)  -- come normalizeUid
customer_id    uuid not null references app.customers(id)
active         boolean not null default true
associated_at  timestamptz not null default now()
associated_by  uuid not null references app.operators(id)
deactivated_at timestamptz null
check ((active and deactivated_at is null) or (not active and deactivated_at is not null))
create unique index cards_one_active_per_customer on app.cards (customer_id) where active;
```

- **Lettura**: policy `select` `to authenticated using ((select private.is_active_operator()))`.
  **Scrittura**: nessuna dall'API (`revoke insert, update, delete, truncate on app.cards from
  authenticated`); solo tramite le RPC.
- Trigger `before update`: `uid` e `customer_id` non cambiano mai; `associated_at` e `associated_by`
  cambiano solo nella riattivazione (`active` da false a true); `before delete`: sempre rifiutato.
  Trigger `after update of anonymized_at on app.customers` (quando passa da null a valorizzato): disattiva
  la card attiva.
- RPC (`security definer`, `set search_path = ''`; `execute` revocato a `public` e `anon`, concesso ad
  `authenticated`; prima istruzione: se non `private.is_active_operator()` → errore `not_operator`, come `customers`; operatore
  registrato con `private.acting_operator_id()`, mai `auth.uid()`):
  - `app.lookup_card(p_uid text)` (`stable`) → zero righe se sconosciuta, altrimenti `card_id,
    customer_id, customer_name` (null se il cliente è anonimizzato), `active`, `customer_anonymized`.
    Uid non valido → `invalid_uid`.
  - `app.associate_card(p_customer_id uuid, p_uid text)` → riga della card attiva + `replaced_card_id`.
    Blocca la riga del cliente (`for update`), così due associazioni allo stesso cliente si mettono in fila.
    Cliente inesistente → `customer_not_found`; anonimizzato → `customer_anonymized` (codici di
    `customers`). Uid di un altro cliente → `card_taken` (dettaglio: `owner_id`, `owner_name` o null se
    anonimizzato, `active`). Uid già attivo sullo stesso cliente → nessuna modifica, restituisce la riga
    (idempotente). Uid disattivato dello stesso cliente → riattivato (`associated_at = now()`,
    `associated_by` = chi agisce), l'eventuale altra card attiva disattivata. Altrimenti disattiva la card
    attiva e inserisce la nuova; una `unique_violation` su `uid` (corsa con un altro operatore) si traduce
    in `card_taken`. Uid non valido → `invalid_uid`.
  - `app.deactivate_card(p_card_id uuid)` → riga aggiornata; già disattivata → nessuna modifica;
    inesistente → `card_not_found`.
  - `app.create_customer_with_card(p_operation_id uuid, p_name text, p_phone text, p_privacy_consent
    boolean, p_notes text, p_uid text) returns app.customer_summary`: stessa firma di
    `app.create_customer` più `p_uid`. Se `create_operation_id = p_operation_id` esiste già restituisce
    quel cliente senza toccare le card (il primo invio era tutto-o-niente). Altrimenti, nella stessa
    transazione, chiama `app.create_customer` (stessi controlli ed errori) e poi la logica di
    `associate_card`; qualsiasi errore (`card_taken`, `invalid_uid`, errori del cliente) annulla tutto.
- Gli errori sono `raise exception` con `errcode 'P0001'` e codice nel messaggio (come `customers`); il
  servizio frontend li traduce in errori tipizzati (`CardTakenError`, `CustomerUnavailableError`,
  `NetworkError`, …).
- I movimenti non dipendono dalla card: sostituirla o disattivarla scrive solo su `app.cards` e non tocca
  saldo né storico.
- **Deviazioni dal contratto**: `CONTRACT.md` fissa la tabella ma nessuna RPC delle card; le quattro RPC
  sopra sono aggiunte di questo modulo, e `create_customer_with_card` dipende dalla firma di
  `app.create_customer` di `customers`. Codici d'errore allineati a `customers` (`not_operator`,
  `customer_not_found`, `customer_anonymized`). Su `not_operator` ogni schermata del modulo chiama
  `reportNotEnabled()` di `AuthProvider` (account tolto durante l'uso, nota n6).

## Commands

Nessun comando nuovo (`npm test`, `npm run test:integration`, `npm run db:test`, `npm run e2e`).

## Project Structure

```
src/features/cards/           → CardsService (tipi), supabaseCardsService, formatCardLabel,
                                 useHomeCardRead, NewCustomerCardPanel, AssociateCardPage,
                                 CustomerCardSection (Modifica cliente), CardSummary (Scheda),
                                 PurchasePlaceholderPage (finché non c'è ledger)
src/test/fakeCardsService.ts  → servizio in memoria per i test dei componenti (simula errori di rete)
supabase/migrations/          → *_cards.sql (tabella, indici, trigger, RPC, policy, grant)
supabase/seed.sql             → una card finta (es. 04AABBCCDDEE01) su un cliente finto del seed
supabase/tests/cards.test.sql → pgTAP
e2e/cards.spec.ts             → flussi con window.__enjoyFakeCard(uid)
```

## Code Style

Come `platform` e `identity`: i componenti usano solo `CardsService` (mai `getSupabase()`), l'uid arriva
sempre da `useCardRead` di `card-input` (già normalizzato) o da `normalizeUid(…, 'hex')` per il parametro
`?card`; testi in italiano, identificatori in inglese.

```ts
export type CardLookup =
  | { status: 'unknown' }
  | { status: 'active' | 'inactive'; cardId: string; customerId: string; customerName: string }
  | { status: 'anonymized'; cardId: string; customerId: string };

export function formatCardLabel(uid: string): string {
  return `…${uid.slice(-4)}`; // "04A1B2C3D4E5F6" → "…E5F6"
}
```

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP (`cards.test.sql`) | RLS: `anon` e utente senza profilo non leggono `cards` e non eseguono nessuna RPC (`not_operator` o permesso negato); `authenticated` non scrive direttamente; vincolo uid (minuscolo, separatori, lunghezza dispari, 7 e 11 byte rifiutati); trigger rifiutano cambio di `uid`/`customer_id`, cambio di `associated_by` fuori dalla riattivazione e delete; `associate_card` per operatore e admin con `associated_by` = operatore chiamante, sostituzione (vecchia `active=false`, `deactivated_at` impostato, `replaced_card_id`), `card_taken` per uid di altro cliente (attivo, disattivato, anonimizzato → `owner_name` null), ripetizione idempotente, riattivazione della propria card (`associated_at` aggiornato, l'altra disattivata), `customer_not_found`, `customer_anonymized`, `invalid_uid`; indice: due card attive sullo stesso cliente impossibili; `lookup_card` nei casi sconosciuta/attiva/disattivata/anonimizzata (nome null) e `invalid_uid`; `deactivate_card` idempotente e `card_not_found`; `create_customer_with_card`: crea cliente e card, stesso `operation_id` due volte → un cliente e una card, `card_taken` e `customer_name_taken` non lasciano né cliente né card; anonimizzazione disattiva la card; sostituzione e disattivazione non modificano righe fuori da `app.cards` |
| Integrazione (Vitest + stack locale, `npm run test:integration`) | due associazioni concorrenti dello stesso uid a clienti diversi: una riesce, l'altra `card_taken`; due associazioni concorrenti di uid diversi allo stesso cliente: alla fine una sola card attiva; `supabaseCardsService` traduce i codici d'errore |
| Componenti (Vitest + `fakeCardsService`, `fakeCustomerService`, adattatore card finto) | home: attiva → `/clienti/:id/spesa`, sconosciuta → `/clienti/nuovo?card=`, disattivata e anonimizzata → avvisi (nessun nome nel secondo), letture ignorate durante la ricerca, rete → «Riprova»; Nuovo cliente da card: riquadro «Card letta» con uid completo, `?card` non valido ignorato, salvataggio → `replace` su `/clienti/:id/spesa`, `card_taken` → avviso e «Continua senza card», reinvio dopo errore di rete con lo **stesso** `operation_id`; Nuovo cliente senza card: lettura sconosciuta/nota; Associa card: tutti gli stati del punto 4 e testi dei wireframe (nota sulla card attuale solo se c'è); Modifica cliente con e senza card, dialogo di disattivazione, errore di caricamento; riga della Scheda cliente; `formatCardLabel` |
| E2E (Playwright 390×844, Supabase locale, `window.__enjoyFakeCard`; dati e uid creati dal test con nomi univoci, rieseguibile) | card sconosciuta → Nuovo cliente con codice → Salva → `/clienti/:id/spesa` con il nome del cliente; card nota → stessa pagina entro 2 s; Sostituisci card → la vecchia letta in home mostra «Card disattivata»; card di un altro cliente → «Card già associata» → «Apri la scheda di …»; Disattiva card → «Nessuna card attiva»; target touch ≥ 48 px |

Test scritti prima del codice (TDD). Solo dati finti (`@example.com`, nomi e uid inventati).

## Boundaries

- **Always**: ogni controllo (ruolo, unicità, una card attiva) sul server; uid sempre normalizzato;
  operazioni ripetibili senza effetti doppi; card mai scritte.
- **Ask first**: cancellare righe di `cards`; permettere di spostare un uid su un altro cliente; limitare le
  azioni sulle card ai soli amministratori; mostrare lo storico delle card.
- **Never**: riusare un uid per un altro cliente; scrivere sul tag; mostrare dati al cliente; chiave
  service role nell'app; uid o nomi reali in test, seed o log; registrare gli uid nei log.

## Success Criteria

1. Card attiva letta in home → `/clienti/:id/spesa` del suo cliente, con il suo nome visibile, entro 2 s
   sullo stack locale, senza tocchi (E2E; contribuisce all'obiettivo < 10 s).
2. Card sconosciuta in home → `/clienti/nuovo?card=UID` con il codice completo; dopo «Salva cliente» si è
   su `/clienti/:id/spesa` (Indietro non torna al form) e `lookup_card` dà la card attiva per quel cliente.
3. Sostituisci card: dopo la lettura la vecchia ha `active=false` e `deactivated_at` valorizzato, la nuova
   è attiva, e nessuna riga fuori da `app.cards` cambia (il saldo lo verifica anche `ledger`).
4. Non esistono, nemmeno con chiamate concorrenti, due card attive per un cliente né due clienti per un uid
   (pgTAP + integrazione).
5. Una card di un altro cliente mostra «Card già associata» con i testi del wireframe; il nome non compare
   se quel cliente è anonimizzato.
6. Una card disattivata letta in home non apre la spesa e mostra «Card disattivata».
7. Ripetere `associate_card`, `deactivate_card` o `create_customer_with_card` (stesso `operation_id`)
   dopo un errore di rete non crea doppioni né errori.
8. `anon` e un utente senza profilo operatore non leggono `cards` e non eseguono nessuna RPC del modulo.
9. Detector Impeccable pulito; typecheck, lint, test, pgTAP ed E2E verdi in CI.

## Out of Scope (Deferred)

- Lettura NFC, permesso, NFC spento, normalizzazione dell'uid, lettore USB, `CardReadPanel`: modulo
  `card-input`.
- Form cliente, ricerca, SERVITI OGGI, anonimizzazione: `customers`. Registra spesa (tastierino, conferma,
  «Riscatta premio») e saldo: `ledger`, che sostituisce il segnaposto di `/clienti/:id/spesa`.
- Schermata tablet "Associa card": `tablet-kiosk`. Storico delle card di un cliente: non richiesto.

## Open Questions

1. Card disattivata letta in home (card persa e ritrovata). Proposta: avviso «Card disattivata» con link
   alla scheda, nessuna spesa; per rimetterla in uso si legge da Associa card del suo cliente, che la
   riattiva (default adottato).
2. Card disattivata letta in Associa card di un altro cliente. Proposta: rifiutata come «Card già
   associata» («era di …»), perché un uid non si riusa mai (default adottato).
3. Cliente anonimizzato. Proposta: la card si disattiva in automatico; testi senza nome; nessuna card
   associabile a un cliente anonimizzato (default adottato).
4. Nuovo cliente + card in una sola operazione. Proposta: RPC aggiuntiva `app.create_customer_with_card`,
   non presente nel contratto condiviso, tutto-o-niente e idempotente sull'`operation_id` di `customers`
   (default adottato).
5. Card già nota al salvataggio di Nuovo cliente da card. Proposta: cliente non creato, avviso e «Continua
   senza card» (default adottato).
6. Testi non presenti nei wireframe (avvisi in home, «Nessuna card attiva», «Associa card» senza card,
   «Senza card», dialogo di disattivazione, conferma «Card … associata», «Questa è già la card attiva…»,
   errori di rete e di caricamento, cliente anonimizzato in Associa card). Proposta: quelli scritti sopra,
   nello stile dei wireframe (default adottato).
7. Dopo l'associazione. Proposta: ritorno a Modifica cliente con messaggio di conferma (default adottato).
8. Chi può disattivare/associare. Proposta: amministratori e operatori, come nelle specifiche (default
   adottato).
9. Idempotenza di associazione e disattivazione. CLAUDE.md chiede un identificativo generato dall'app per
   ogni operazione; qui il reinvio è innocuo per costruzione (stesso uid sullo stesso cliente = nessuna
   modifica; card già disattivata = nessuna modifica). Proposta: nessun `operation_id` per queste due RPC
   (default adottato).
10. Seconda card letta nel form Nuovo cliente. Proposta: vale l'ultima card sconosciuta letta (default
    adottato).
11. Data «dal …» dopo una riattivazione. Proposta: data della riattivazione, non della prima associazione
    (default adottato).
12. Registra spesa prima di `ledger`. Proposta: segnaposto sulla stessa rotta, sostituito da `ledger`
    (default adottato; è solo ordine di costruzione).
