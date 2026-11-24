# Spec Delta: customers-v2 — email al posto del telefono, premi nella pagina dei punti, card riattivabili o riformattabili, elenco clienti in home

Status: proposed (2026-11-23) — Open Questions con default conservativi adottati, da rivedere con il titolare
Modulo: `customers-v2` ([CAPABILITY-MAP.md](../../CAPABILITY-MAP.md)) · Dipende da: `customers`, `cards`,
`card-input`, `ledger`, `rewards`, `export`, `tablet-kiosk` (tutti già rilasciati su `main`) · Non dipende da
`operators` (PR #24, non unita).
Fonti: richiesta del titolare del 2026-11-23 e sue risposte (registrate in `brain/DECISIONS.md`, voce
"Clienti V2"); wireframe Cerca cliente (`Main`), Scheda cliente, Nuovo cliente, Nuovo cliente da card, Nome
già usato, Modifica cliente, Ricerca senza risultati, Card già di un altro cliente, Associa card,
Saldo-punti, Saldo-card-non-attiva, Tablet: cerca cliente / cliente / nuovo cliente / associa card, note della
tela (`canvas.json`); design system "Enjoy Bar".
Spec originali che questa delta modifica (restano valide per tutto il resto; si aggiornano **dopo** il
rilascio, come vuole `spec-driven-development`, "Follow-up changes get a delta spec"):
`SPEC-customers.md`, `SPEC-cards.md`, `SPEC-card-input.md`, `SPEC-ledger.md` (SERVITI OGGI),
`SPEC-export.md`, `SPEC-tablet-kiosk.md`, `customer-balance.md`, `contract.md`, `cross-review.md`.

> Perché una delta sola per sei richieste: le sei toccano le stesse tabelle (`app.customers`, `app.cards`),
> le stesse funzioni (`app.customer_summary` e tutte le RPC che lo restituiscono) e la stessa schermata (la
> home); separarle avrebbe prodotto quattro migrazioni che si riscrivono a vicenda. Il piano
> (`tasks/plan.md`, fase successiva) le taglia comunque in fette verticali indipendenti, seguendo
> l'"Ordine delle migrazioni" qui sotto.

## Objective

Il titolare ha deciso sei cambiamenti (2026-11-23):

1. il bar **non raccoglie più il telefono** dei clienti: sparisce dall'app e dal database;
2. al suo posto un'**email facoltativa e unica**, cercabile dalla home come il nome;
3. la **pagina pubblica dei punti** mostra, sotto i punti, l'**elenco dei premi attivi**;
4. una **card disattivata** riletta alla cassa si può **riattivare** (anche scambiandola con l'altra card
   attiva del cliente) o **riformattare** (svuotarla e dissociarla per sempre, così torna disponibile);
5. la card di un **cliente con dati cancellati** si può **riformattare**;
6. la **home** mostra sotto la ricerca l'**elenco dei clienti** con scorrimento infinito, 20 per pagina,
   in ordine di ultima attività.

Riattivare e riformattare sono **solo per gli amministratori**. L'app continua a **non contattare i
clienti**: l'email non si usa per scrivere a nessuno (niente `mailto:`); una newsletter futura chiederebbe un
consenso marketing separato, fuori da questa spec.

**Utenti**: operatori e amministratori (alla cassa, telefono e tablet); il cliente (solo la pagina pubblica).
**Successo**: nessun telefono nella colonna né nell'app né nei dati di prova (note controllate a mano); un cliente si ritrova scrivendo parte
dell'email; il cliente vede i premi che può chiedere; un amministratore recupera in meno di un minuto una
card ritrovata o di un cliente cancellato; la home mostra subito i clienti di oggi in cima senza scrivere
nulla; l'obiettivo "dalla card alla conferma in meno di 10 secondi" non peggiora.

## Comportamento attuale (in breve)

- `app.customers.phone` (E.164, facoltativo, non unico), normalizzato da `private.normalize_phone`; ricerca
  "per telefono" con le cifre; "••• 4521" in elenco, "333 ••• 4521" in scheda; colonna "Telefono" nell'export
  (`SPEC-customers.md` punti 2, 4, 6, 7, 10; `SPEC-export.md`).
- Home: `CardReadPanel`, campo "Cerca per nome o telefono" (placeholder "Es. Rossi o 4521"), risultati solo
  mentre si cerca (al massimo 20, ordine alfabetico, `app.search_customers`), altrimenti **SERVITI OGGI**
  (`app.customers_served_today`, al massimo 50).
- Card disattivata letta in home: avviso «Card disattivata» · «Questa card non è più attiva: era di Maria
  Rossi. Cerca il cliente per nome o telefono.» · «Apri la scheda di Maria»; card di un cliente
  anonimizzato: «Card non più valida». Nessuna azione sulla card (`SPEC-cards.md` punto 1). Da Associa card
  di **quel** cliente qualunque operatore può riattivare la sua card disattivata (`SPEC-cards.md` punto 4).
- Un uid non passa mai a un altro cliente (`app.cards.uid` unico per sempre, `SPEC-cards.md` Objective).
- Pagina `/s/:token`: solo i punti (`public.card_points`), «Card non attiva» altrimenti.

## Nuovo comportamento

### 1. Telefono: rimosso ovunque

- **Database** (migrazione 2, "Ordine delle migrazioni"): prima `update app.customers set phone = null where
  phone is not null`, poi `alter table app.customers drop column phone`, `drop function
  private.normalize_phone(text)`. Il `drop column` di Postgres **non cancella fisicamente** i valori: li rende
  invisibili e lo spazio si recupera "man mano che le righe vengono aggiornate" (documentazione di `ALTER
  TABLE`, "DROP COLUMN"). Per questo l'`update … set phone = null` viene prima (le versioni vecchie delle
  righe restano come tuple morte fino al `VACUUM`), e dopo il rilascio si esegue a mano `vacuum full
  app.customers;` (note di rilascio; `VACUUM` non può girare dentro la transazione di una migrazione).
  **Da confermare col titolare prima del rilascio** (Open Question 17): il titolare ha deciso di non raccogliere
  più il telefono e di toglierlo dall'app; cancellare **anche i numeri già salvati** è la conseguenza proposta
  qui, ma è irreversibile e va confermata esplicitamente. Se il titolare preferisse conservarli, la migrazione 2
  toglie la colonna dall'app (funzioni e tipo) ma il `drop column` slitta: decisione da prendere prima del merge.
- **Numeri scritti a mano nelle note**: `app.customers.notes` (testo libero, fino a 500 caratteri) può
  contenere telefoni scritti dagli operatori; la migrazione non li tocca (non si riscrive testo libero in
  automatico). Le note di rilascio prevedono un controllo a mano prima del `vacuum full` (sotto).
- **Tipo `app.customer_summary`**: `alter type app.customer_summary rename attribute phone to email` (stessa
  posizione e stesso tipo `text`: i costruttori posizionali `(id, name, email, notes, …)::app.customer_summary`
  restano validi; verificato sullo stack locale, Postgres 17). Tutte le funzioni che leggevano `c.phone`
  vanno riscritte **nella stessa migrazione**, perché in PL/pgSQL l'errore arriverebbe solo all'esecuzione:
  `app.create_customer`, `app.update_customer`, `app.anonymize_customer`, `app.get_customer`,
  `app.create_customer_with_card`, `app.export_customers`; `app.search_customers` e
  `app.customers_served_today` si eliminano (sostituite da `app.list_customers`, punto 6).
- **Firme cambiate**: `p_phone` diventa `p_email`. Postgres non permette di rinominare un parametro con
  `create or replace` ("cannot change name of input parameter"): `drop function` della firma vecchia e
  `create function` della nuova, con `revoke … from public, anon` e `grant … to authenticated` ripetuti.
  `app.export_customers` cambia la tabella restituita (`phone` → `email`): anche lei `drop` + `create`.
- **App**: via `src/features/customers/phone.ts` (+ test), il campo "Telefono (facoltativo)" di Nuovo e
  Modifica cliente, "Tel. …"/"Senza telefono" in scheda, "••• 4521" negli elenchi, `classifyQuery`, il ramo
  "ricerca per telefono", il testo «Il telefono serve solo a trovarlo più in fretta», `phone_invalid` in
  `errorCodes.ts`, la colonna "Telefono" del CSV, i telefoni del `seed.sql` (`+39333000000x`) e di tutti i
  fixture (`src/test/fake*`, `tests/integration/*`, `e2e/*`, `scripts/*Criteria*.test.ts`).
- **Testi che citano il telefono** e diventano email: home («Cerca per nome o email», placeholder «Es. Rossi o
  rossi@»), Ricerca senza risultati («Controlla come è scritto, o cerca con l'email.»), avviso della card
  disattivata (punto 4), `CardReadPanel` stato `off` («Su iPhone le card non si leggono: cerca il cliente per
  nome o email.»), dialogo di anonimizzazione («Nome, email e note si cancellano per sempre…»), sezione DATI DEL
  CLIENTE («Nome ed email si cancellano, i movimenti restano senza dati personali. Solo amministratori.»).
  Restano invece le parole "telefono"/"phone" che indicano il **dispositivo** (Android, "dal proprio
  telefono", "avvicina la card al suo telefono", `openPhone`, "the card on the phone"…).
- **Controllo di confine** (`scripts/customersBoundary.test.ts`; **la stessa regola** vale per il Success
  Criterion 1): nei file di `src/`, `e2e/`, `tests/`, `scripts/` e in `supabase/seed.sql`, **escluso il file
  del test stesso**, sono vietati:
  - gli identificatori del telefono del cliente come proprietà, campo, parametro o colonna: `phone:`, `.phone`,
    `p_phone`, `'phone'`, `normalize_phone`, `maskPhone`, `phone_invalid`;
  - i testi dell'interfaccia «Telefono», «Senza telefono», «Tel.»;
  - letterali simili a E.164: `\+39\d{6,}`.
  Le parole in senso di dispositivo non corrispondono a questi modelli (commenti, `openPhone`, `phone.on(…)`);
  l'unico parametro che oggi coincide, `setPinFromPhone(phone: Page, …)` in `e2e/tablet-pin.spec.ts`, si
  rinomina (`operatorPhone`).

### 2. Email facoltativa e unica

- **Colonna**: `email text null`, con
  `constraint customers_email_check check (email = lower(btrim(email)) and length(email) between 6 and 254
  and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')` e
  `create unique index customers_email_key on app.customers (email)` (i `null` non collidono: più clienti
  senza email sono ammessi; un cliente anonimizzato ha `email = null`, quindi la libera). L'unicità
  "senza distinguere maiuscole" la dà la normalizzazione: si salva tutto in minuscolo (Open Question 6).
- **Normalizzazione** (server, rispecchiata in TS per l'anteprima e la validazione nel modulo,
  `src/features/customers/email.ts`): `btrim` degli spazi (anche Unicode, come `clean_name`), `lower`;
  vuota → `null`; poi il controllo di formato del vincolo. Nessuna verifica di esistenza (niente email di
  conferma: l'app non scrive ai clienti).
- **RPC** (stesse regole di `SPEC-customers.md`: `security definer`, `set search_path = ''`, prima
  istruzione `not_operator`, errori `P0001` con codice):
  - `app.create_customer(p_operation_id uuid, p_name text, p_email text, p_privacy_consent boolean,
    p_notes text) returns app.customer_summary`; nuovi codici `email_invalid` ed `customer_email_taken`
    (`detail` = id del cliente che l'ha già). Ordine dei controlli: come oggi, poi email (dopo il nome). Una
    `unique_violation` su `customers_email_key` (corsa tra due operatori) diventa `customer_email_taken`
    come oggi `customers_name_key` diventa `customer_name_taken` (diagnostica `constraint_name`).
  - `app.update_customer(p_customer_id uuid, p_name text, p_email text, p_notes text)`: stessi errori; email
    vuota = la toglie. Rinominare con la propria email non è un conflitto.
  - `app.create_customer_with_card(p_operation_id, p_name, p_email, p_privacy_consent, p_notes, p_uid)`.
  - `app.anonymize_customer`: `email = null` insieme a `notes = null` e al nome tecnico.
  - `app.get_customer`, `app.list_customers` (punto 6) e `app.customer_summary` portano `email`.
- **Moduli Nuovo cliente e Modifica cliente** (`CustomerForm`): al posto del telefono il campo «Email
  (facoltativa)», `type="email"`, `inputMode="email"`, `autoComplete="off"` (è l'email del cliente scritta
  dall'operatore: il browser non deve proporre quella dell'operatore), `autoCapitalize="none"`,
  `spellCheck={false}`, `maxLength={254}`, placeholder «nome@esempio.it». Testo d'aiuto sotto il nome: «Il nome
  identifica il cliente: non può essere già di un altro. L'email serve solo a ritrovarlo: l'app non scrive ai
  clienti.» Modifica cliente mostra l'email salvata così com'è (già minuscola) e la si può svuotare.
- **Errori** (sotto il campo, `danger-text`, fuoco sul primo campo errato, come `SPEC-customers.md` punto 5):
  - formato: «Email non valida: controlla come è scritta.»;
  - già usata (come «nome già usato», wireframe "Nome già usato"): «Esiste già un cliente con questa email.» +
    link «Apri la scheda» (scheda dell'altro cliente) al posto del testo d'aiuto. Il controllo lo fa il server
    al salvataggio (come per il nome, `SPEC-customers.md` Open Question 9);
  - se nome **ed** email sono già usati il server risponde solo `customer_name_taken` (primo controllo): dopo
    la correzione del nome, il salvataggio successivo segnala l'email.
- **Scheda cliente**: la riga sotto il nome diventa «Card attiva …E5F6 · rossi@example.com» oppure «… · Senza
  email» (l'email intera, testo selezionabile, **non** un link `mailto:`; va a capo con
  `overflow-wrap: anywhere`). Cliente anonimizzato: invariato («Dati cancellati il …»).
- **Ricerca**: vedi punto 6 (stesso campo del nome).
- **Export CSV clienti** (`SPEC-export.md`): la colonna «Telefono» diventa «Email», stessa posizione (dopo
  «Nome»); valore passato da `guardFormula` (una parte locale come `=cmd@…` è un'email valida e Excel la
  eseguirebbe come formula), vuota per i clienti anonimizzati (il server la manda già `null`, il builder la
  svuota comunque, come oggi per il telefono). L'export dei movimenti non cambia.

### 3. Premi attivi nella pagina pubblica dei punti

- **Server**: nuova funzione `public.card_rewards(p_token text) returns table (name text, points int)`,
  `language plpgsql stable security definer set search_path = ''`, `revoke execute … from public`, `grant
  execute … to anon, authenticated`. Corpo: la stessa intestazione `Cache-Control: no-store` di
  `card_points`; token `null` o diverso da `^[A-Za-z0-9_-]{22}$` → **nessuna riga**; stesso controllo del token
  di `card_points` (impronta valida, card `active`, cliente non anonimizzato) → se non vale, **nessuna riga**;
  altrimenti `select r.name, r.points from app.rewards r where r.active order by r.points, lower(r.name),
  r.id limit 100`. Mai errori, mai altri campi (niente id, date, stato). La verifica del token è la **stessa
  funzione privata** usata da `card_points` (`private.card_customer_for_token(text) returns uuid`, estratta
  da `card_points` in questa migrazione senza cambiarne il comportamento), così le due non possono divergere.
- **Perché una funzione nuova e non un cambio di `card_points`**: `card_points` resta identica (firma, tipo
  restituito `integer`, test `card_points.test.sql`), quindi l'app già in produzione continua a funzionare nei
  minuti tra la migrazione e il nuovo frontend; il nuovo frontend chiama le due funzioni in parallelo
  (`Promise.all`, stesso timeout di 8 s, un solo «Riprova»).
- **Perché solo con un token valido**: il catalogo non è un dato personale, ma `anon` oggi non legge nulla
  dello schema `app`; legarlo al token non apre una porta nuova a chi non ha una card e lascia «Card non
  attiva» identica per ogni token non valido (stessa regola di `card_points`: la risposta non distingue mai i
  casi).
- **Pagina «Card non attiva»: senza premi** (default da confermare, Open Question 8): chi ha in mano una card disattivata non è (o non è
  più) un cliente che può usarla; il titolare ha chiesto i premi "sotto i punti", e lì i punti non ci sono;
  mostrare il catalogo a qualunque link non valido toglierebbe la garanzia "nessuna differenza tra i casi".
- **Disegno** (nessuna tavola nei wireframe: proposto qui con il design system "Enjoy Bar", da aggiungere
  alla tela come "Saldo-punti-premi"). Ordine della pagina "Saldo-punti": logo · riquadro verde «ENJOY YOUR
  POINTS» con il saldo · **sezione premi** · «Mostra la card alla cassa per usare i tuoi punti.» · «Questa pagina
  mostra i punti della card e i premi del bar, senza dati personali.» (al posto di «Questa pagina mostra solo i
  punti della card, senza dati personali.», che non descriverebbe più la pagina; da rivedere col titolare e
  col consulente insieme all'informativa) · piè di pagina.
  - `<section aria-labelledby="rewards-title">` con titolo `h2` «PREMI» nello stile `spaced-caps-condensed`
    in `--color-ink-muted` (lo stesso dei titoli di sezione della home e delle Impostazioni);
  - elenco `<ul>` con una riga per premio, altezza minima 56 px (non è un'area da toccare: niente
    freccia, niente link), separatore `1px solid var(--color-divider)` come `ListRow`; a sinistra il nome
    (`body-lg`, `--color-ink`, va a capo con `overflow-wrap: anywhere`), a destra i punti come
    `PointsBadge` con il testo «150 punti» («1 punto» al singolare; non «pt»: il cliente non conosce
    l'abbreviazione), cifre con `Intl.NumberFormat('it-IT')`;
  - margini laterali come il resto della pagina, leggibile a 320 px; contrasto AA (colori già usati sulla
    pagina);
  - **nessun segno** di "premio raggiungibile" o "mancano N punti": il titolare ha chiesto nome e punti e
    nient'altro (Open Question 8);
  - catalogo senza premi attivi → la sezione non c'è (la pagina torna quella di oggi);
  - niente `lang="en"`: i nomi dei premi sono del bar.
- **Testo della pagina**: il test che confronta l'intero testo della pagina (`CardPointsPage.test.tsx`,
  "nothing else") si aggiorna con il titolo «PREMI», le righe e la frase nuova «Questa pagina mostra i punti
  della card e i premi del bar, senza dati personali.»; continua a vietare qualunque altro dato.

### 4. Card disattivata riletta alla cassa: Riattiva o Riformatta

**Lettura in home** (`useHomeCardRead`, telefono Web NFC e tablet lettore USB, stessi esiti): `lookup_card`
risponde come oggi; cambia solo cosa succede con una card **non attiva** (`active = false`):

- **amministratore** (`useCurrentOperator().role === 'admin'`, sul tablet il cassiere amministratore) →
  `navigate('/card/<card_id>')`, schermata **Card non attiva** (sotto). La lettura in home non scrive nulla e
  non chiama altre RPC: l'obiettivo dei 10 secondi resta intatto (le card attive vanno a Registra spesa come
  oggi);
- **operatore** → avviso nel riquadro di lettura (`role="alert"`), la lettura resta attiva:
  - card di un cliente: titolo «Card non attiva: chiedi a un amministratore» · testo «Era la card di Maria
    Rossi. Per servirla adesso cercala per nome o email.» · pulsante «Apri la scheda di Maria» (come oggi);
  - card di un cliente con dati cancellati: titolo «Card non attiva: chiedi a un amministratore» · testo «I
    dati del cliente di questa card sono stati cancellati.» · nessun nome, nessun pulsante.

**Schermata «Card non attiva»** (`/card/:cardId`, nuova rotta sotto **`RequireCashier`**, accanto a
`clienti/:id/card` in `src/app/routes.tsx`: la pagina usa `useCurrentOperator()`, che su un dispositivo senza
cassiere non ha un operatore; la rotta si aggiunge anche a `docs/specs/contract.md` e a
`src/app/routes.test.tsx`; `cardId` è l'id della riga di `app.cards`, **mai l'uid** nell'URL; id non uuid →
"Card non trovata" senza chiamare il server). Non c'è nei wireframe: disegno proposto con i componenti
esistenti (`AppShell`, `ListRow`, `StatusView`, `Button`, `ConfirmDialog`, `CardLinkWriter`), da aggiungere
alla tela come "Card-non-attiva-admin":

- **Tablet** (`SPEC-tablet-kiosk.md` punto 10 e criterio 7): una colonna larga, come Associa card, azioni
  principali ≥ 70 px dal bordo inferiore; `e2e/tablet-layout.spec.ts` ha un passo che misura questa rotta come
  le altre;

- intestazione «Card non attiva» con «Indietro» → `/`;
- riga con icona card: «Card …E5F6» e, sotto, «Disattivata il 12 nov» (fuso `Europe/Rome`, anno se diverso);
- riga cliente (`ListRow` con `PointsBadge`, → `/clienti/:id`): «Era di Maria Rossi»; se il cliente è
  anonimizzato: testo «Era di un cliente i cui dati sono stati cancellati.» senza riga cliente;
- **Riattiva la card** (pulsante primario; non per clienti anonimizzati) con il testo «La card torna a Maria e
  apre di nuovo la sua spesa.»; se il cliente ha **un'altra card attiva** il testo diventa «La card torna a
  Maria al posto della card …A1B2, che si disattiva. I punti restano a Maria.»;
- **Riformatta la card** (pulsante secondario `danger`) con il testo «La card si svuota e non sarà più di
  Maria, per sempre: potrà essere data a un cliente nuovo. Punti e movimenti restano a Maria.» (cliente
  anonimizzato: «La card si svuota e torna come nuova: potrà essere data a un cliente nuovo.»);
- stati: caricamento; «Card non trovata» (id inesistente o rilasciato, link alla home); errore con
  «Riprova»; card **già attiva** (riattivata da un altro amministratore nel frattempo) → «Questa card è
  attiva.» con «Apri la scheda di Maria»; card **già riformattata** → «Questa card è già stata riformattata:
  ora è libera.»; **operatore** che apre l'URL a mano → `StatusView` errore «Solo un amministratore può
  riattivare o riformattare una card.» con link alla home (il server comunque rifiuterebbe);
- dati: nuova RPC di lettura `app.get_card(p_card_id uuid)` (sotto).

**Riattiva**:

1. **sempre una conferma**, anche senza un'altra card attiva: una card si disattiva di solito perché è
   stata persa, e chi la riporta alla cassa può spendere i punti del cliente appena è riattivata; i punti
   riscattati nel frattempo non si recuperano disattivandola di nuovo. Senza altra card attiva:
   `ConfirmDialog` (tono normale) «Riattivare la card …E5F6?» · «Disattivata il 12 nov. Riattiva solo se la
   card è tornata a Maria: chi la usa potrà spendere i suoi punti.» · «Riattiva» / «Lascia com'è» →
   `app.reactivate_card(p_card_id, null)`;
2. con un'altra card attiva: `ConfirmDialog` (tono normale) «Scambiare le card di Maria?» · «La card …E5F6
   (disattivata il 12 nov) torna attiva. Riattiva solo se la card è tornata a Maria: chi la usa potrà spendere
   i suoi punti. La card …A1B2, ora attiva, si disattiva e il suo link non mostrerà più i punti. I punti
   restano a Maria.» · «Scambia le card» / «Lascia com'è» → `app.reactivate_card(p_card_id,
   <id della card …A1B2>)`. Se nel frattempo la card attiva del cliente è cambiata il server risponde
   `active_card_changed`: la schermata ricarica i dati e mostra di nuovo la conferma con la card giusta;
3. riuscita → sulla stessa schermata il messaggio `role="status"` «Card …E5F6 riattivata per Maria» e la
   **scrittura del link** di `cards` (`CardLinkWriter`, `SPEC-cards.md` punto 8): il link vecchio è morto con
   la disattivazione (`private.card_links` cancellata dal trigger), quindi se ne scrive uno nuovo; esiti e
   «Salta, lo scrivo più tardi» come in Associa card; alla fine → `/clienti/:id` con «Card …E5F6 riattivata»
   (o «… Link non scritto.»). Dispositivo che non scrive (tablet, `canWrite` falso): subito la scheda con «Card
   …E5F6 riattivata. Link non scritto.»;
4. errori: `customer_anonymized` → «Questo cliente non può avere una card.» (non dovrebbe accadere: la
   schermata non offre Riattiva); `card_released` → «Questa card è già stata riformattata.»; `forbidden` →
   «Card non attiva: chiedi a un amministratore.»; rete → «Card non riattivata: controlla la connessione.» con «Riprova» (sicuro:
   riattivare una card già attiva non cambia nulla).

**Riformatta** (telefono Android con Web NFC; **non sul tablet**, Open Question 4):

1. `ConfirmDialog` `tone="danger"`: «Riformattare la card …E5F6?» · «La card si svuota e non sarà più di Maria
   Rossi, per sempre. Punti e movimenti restano a Maria. Non si può tornare indietro.» · «Riformatta» /
   «Lascia com'è» (per un cliente anonimizzato: «La card si svuota e torna come nuova. Non si può tornare
   indietro.»);
2. **scrittura della card vuota** con il nuovo `useCardWriter().eraseCard` di `card-input` (sotto), con i
   passi nella sezione `aria-live="polite"` (`aria-label="Riformattazione della card"`): `waiting-card`
   «Avvicina la card …E5F6», `writing` «Tieni la card appoggiata» · «Svuoto la card…», `verifying` «Controllo:
   allontana la card e riavvicinala»; «Annulla» secondario sempre disponibile (interrompe con il `signal`);
3. verifica riuscita → `app.release_card(p_operation_id, p_card_id)` con un `operation_id` generato al tocco
   di «Riformatta» e tenuto finché l'esito è incerto;
4. riuscita → `navigate('/', { replace: true })` con il messaggio della home «Card …E5F6 riformattata: ora è
   libera.»; la stessa card riletta in home apre **Nuovo cliente** con la card (`lookup_card` non la trova
   più);
5. esiti non riusciti (`role="alert"`, «Riprova» primario e «Annulla» secondario; nulla cambia sul server):
   `timeout`/`io` «Card non riformattata: si è staccata troppo presto.»; `wrong-card` con `mayHaveWritten:
   false` (card sbagliata nel passo `waiting-card`, prima di scrivere) «Questa non è la card …E5F6: avvicina
   quella giusta.»; `wrong-card` con `mayHaveWritten: true` (durante `write()` o la verifica) «Questa non è la
   card …E5F6. La card …ABCD potrebbe essere stata svuotata: se aveva il link ai punti, riscrivilo dalla scheda
   del suo cliente.»; `verify-failed` «La card non risulta vuota. Riprova.»; `not-allowed` «Il
   telefono non permette di scrivere la card: controlla il permesso NFC di Chrome.»; `unreadable` «La card non
   si legge. È la card …E5F6? Puoi riformattarla comunque.» con «Riformatta comunque» (`allowUnreadable:
   true`; la verifica richiede comunque l'uid giusto); `cannot-write` → la nota del dispositivo che non scrive;
6. **card svuotata ma server non raggiunto** (errore di rete su `release_card`): «Card svuotata ma non
   liberata: controlla la connessione.» con «Riprova» che rimanda `release_card` con lo **stesso**
   `operation_id`, senza riavvicinare la card. Se si abbandona, la card resta vuota ma ancora di Maria (e
   disattivata): riletta in home riapre questa schermata e si riformatta di nuovo, senza danni;
7. errori del server dopo la scrittura: `card_active` (un altro amministratore l'ha riattivata nel frattempo)
   → «La card è stata riattivata nel frattempo e non è stata liberata. Il suo link è stato cancellato:
   riscrivilo dalla scheda di Maria.»; `forbidden` → «Card non attiva: chiedi a un amministratore.»;
8. **dispositivo che non scrive** (tablet con lettore USB, iPhone, NFC spento dopo la lettura): il pulsante
   «Riformatta la card» non c'è; al suo posto la nota «Per riformattare la card serve un telefono Android con
   l'NFC attivo: apri Enjoy Card sul telefono e avvicina la card.» Riattiva resta disponibile.

**Associa card di un cliente** (`SPEC-cards.md` punto 4, caso «card disattivata dello stesso cliente → si
riattiva»): per coerenza con la regola del titolare (riattivare una card disattivata: solo amministratori),
solo un amministratore la riattiva da lì; un operatore riceve `forbidden` e vede «Card non attiva: chiedi a un
amministratore.» (Open Question 3). Oggi un `forbidden` dai servizi delle card cade in
`CustomerError('forbidden')`, il cui testo è «Solo un amministratore può cancellare i dati di un cliente.»:
`forbidden` entra in `CARD_ERROR_CODES` (`src/features/cards/supabaseCardsService.ts`) con una traduzione
propria (vedi "Codici d'errore nuovi"). Gli altri casi di
Associa card, Nuovo cliente da card e card già associata non cambiano; una card **riformattata** vi appare come
sconosciuta.

**`card-input`: scrittura di una card vuota** (`SPEC-card-input.md` punto 9, esteso):

```ts
type EraseCard = (options: { expectedUid: string; signal?: AbortSignal; allowUnreadable?: boolean;
                             onStep?: (step: CardWriteStep) => void }) => Promise<CardWriteResult>;
function useCardWriter(): { canWrite: boolean; writeUrl: WriteUrl; eraseCard: EraseCard };

// webNfcWriter.ts: the wrong-card outcome says whether write() had already started.
type CardWriteResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-card'; otherUid: string; mayHaveWritten: boolean }
  | { ok: false; reason: Exclude<CardWriteFailure, 'wrong-card'> };
```

`mayHaveWritten` vale anche per `writeUrl` (stesso motore): `false` per una card sbagliata letta nel passo
`waiting-card`, `true` da quando `write()` è partito. I testi di `cards` si scelgono su questo campo.

- stesse precondizioni, sessione esclusiva, passo 1 (card giusta, `IN_FIELD_MS`), tempi
  (`WRITE_TIMEOUT_MS`, `VERIFY_TIMEOUT_MS`), esiti e regola "mai ritentare da solo" di `writeUrl`: le due
  condividono lo stesso motore, cambia solo il messaggio e la verifica;
- messaggio: `NDEFReader.write({ records: [{ recordType: 'empty' }] }, { overwrite: true, signal })`. Web NFC
  non ha un metodo per "formattare" o cancellare: esistono solo `scan()`, `write()` e `makeReadOnly()`; un
  messaggio con `records` vuoto è rifiutato con `TypeError`; un record `empty` diventa un record NDEF con TNF 0,
  senza tipo, id né contenuto (specifica Web NFC, w3c-cg.github.io/web-nfc, "create NDEF message" e tabella
  dei tipi di record; developer.chrome.com/docs/capabilities/nfc: «An unformatted NFC tag that supports NDEF
  contains a single record of the empty type»). È quindi lo stato "vergine" che Chrome vede su un NTAG215
  nuovo; **mai `makeReadOnly()`** (irreversibile; la card resta riscrivibile, come oggi);
- **vuota** (definizione stretta): messaggio con **zero record o soli record `empty`**; qualunque altro
  record (`url`, `text`, `mime`, `absolute-url`, `unknown`, tipi esterni…) non è vuoto;
- verifica: una lettura di `expectedUid` vuota → riuscita; `expectedUid` con un altro contenuto →
  `verify-failed`; un **altro uid** letto durante `write()` → `abort()` e `wrong-card` con `otherUid` e
  `mayHaveWritten: true` (Chrome scrive sul primo tag che trova); un **altro uid letto vuoto durante la
  verifica** → **non** si ignora: `wrong-card` con `otherUid` e `mayHaveWritten: true` (`write()` può essersi
  risolto sulla card B, e l'evento di lettura di B può arrivare dopo: B è stata svuotata, l'amministratore deve
  saperlo); un altro uid letto **non vuoto** durante la verifica → ignorato come oggi per `writeUrl` (non
  l'abbiamo scritta noi); un altro uid nel passo `waiting-card` → `wrong-card` con `mayHaveWritten: false`;
- l'adattatore Web NFC inoltra allo scrittore, oltre agli URL, `blank: boolean` (nessun record o solo record
  `empty`); come gli URL, non arriva mai ai consumatori di `useCardRead`;
- adattatore finto (build E2E): la memoria dei tag diventa `uid → url | null` (`null` = card vuota);
  `__enjoyFakeCardWrites` registra `{ uid, url: null, at }` per una card svuotata; `failNextWrite(...)` vale anche
  per `eraseCard`. Il controllo del bundle non cambia (stesso prefisso `__enjoyFakeCard`);
- comportamento atteso dei telefoni con la card vuota (da verificare a mano, RUNBOOK): Chrome con la lettura
  attiva consegna l'uid come per ogni card (quindi in home apre Nuovo cliente); fuori dall'app Android e iPhone
  **non aprono nulla** (non c'è un link).

### 5. Card di un cliente con dati cancellati: solo Riformatta

Stessa schermata e stessa meccanica del punto 4, senza «Riattiva» (il server rifiuta comunque con
`customer_anonymized`) e senza riga cliente. Dopo la riformattazione la riga della card resta legata al
cliente anonimizzato per lo storico (`released_at` valorizzato), l'uid torna libero.

### 6. Home: elenco dei clienti con scorrimento infinito

- **Al posto di SERVITI OGGI** (default da confermare col titolare, Open Question 2: il titolare ha chiesto
  l'elenco sotto la ricerca, non di togliere SERVITI OGGI): una sola sezione **CLIENTI** sotto il campo di
  ricerca, sempre presente (anche senza ricerca). L'ordine per ultima attività mette già in cima i clienti
  serviti oggi, quindi SERVITI OGGI non serve più; titolo `h2` «CLIENTI» nello stesso stile di «SERVITI OGGI».
- **Riga** (`ListRow`, tocco → scheda con `customerBackState(text)` come oggi): nome; sotto l'ultima attività
  in fuso `Europe/Rome`: oggi «Oggi, 10:15», ieri «Ieri, 18:40», quest'anno «12 nov», altri anni «12 nov 2025»,
  nessun movimento «Nessun movimento»; a destra `PointsBadge` con il saldo. **L'email non compare
  nell'elenco** (si vede solo in scheda e in Modifica: la home è sotto gli occhi di chi è al banco; Open
  Question 5).
- **Ordine**: prima i clienti con almeno una **spesa o un riscatto** (anche annullati: il cliente è venuto al
  bar; le correzioni non contano; Open Question 1), dal più recente; poi quelli senza movimenti, dal più
  recente per data di creazione; a parità, `id` decrescente. Clienti con dati cancellati **mai** presenti.
- **Ricerca nello stesso elenco**: il testo filtra la stessa lista con lo stesso ordine (attesa di 250 ms
  dall'ultimo tasto, risposte superate scartate: come oggi). **Il testo non va più nell'URL**: ora che si cerca
  anche per email, `?q=rossi@example.com` finirebbe nella cronologia del browser e, a ogni caricamento non
  servito dal service worker, nei log delle richieste di Vercel. Si salva nello **stato della cronologia**
  (`navigate('.', { replace: true, state: { q } })`, letto da `useLocation().state` all'apertura; lo stato
  sopravvive al ricaricamento e a «Indietro» dalla scheda, come oggi `?q=`); `HomePage.tsx` `changeText` non
  usa più `setSearchParams`. Lo stesso vale per l'uid della card sconosciuta: `?card=<uid>` di
  `useNewCustomerCard` (home → Nuovo cliente, `SPEC-cards.md` punto 2) diventa `state: { card: uid }`. Test:
  durante una ricerca per email `location.search` non contiene mai `@`, e dopo una lettura di card sconosciuta
  non contiene l'uid. Da 2
  caratteri: un cliente compare se **ogni parola** è contenuta nella chiave del nome (regola attuale di
  `search_customers`, via `customer_name_key`) **oppure** il testo intero, in minuscolo, è contenuto nella sua
  email (`%`, `_` e `\` cercati alla lettera). Con meno di 2 caratteri l'elenco è quello completo. La regola
  "sole cifre = telefono" sparisce. Etichetta del campo «Cerca per nome o email» (con il riquadro grande della
  card sopra: «Oppure cerca per nome o email»), placeholder «Es. Rossi o rossi@».
- **Paginazione a chiave (keyset), 20 per pagina**: la prima pagina all'apertura della home; le successive
  quando una sentinella dopo l'ultima riga entra nella vista (`IntersectionObserver` con **`root: null`**, cioè
  la finestra, e `rootMargin: '400px'`, sul telefono **e** sul tablet: su entrambi scorre il documento —
  `AppShell` ha `min-height: 100dvh` senza contenitore che scorre, e sul tablet la colonna del lettore è
  `position: sticky`, non la colonna destra a scorrere da sola);
  sotto l'elenco resta anche il pulsante secondario «Mostra altri clienti» finché ce ne sono (per tastiera,
  TalkBack e browser senza `IntersectionObserver`). Una sola richiesta per volta. Fine elenco: quando una
  pagina ha meno di 20 righe (una pagina piena seguita da una vuota non mostra nulla di più).
- **Clienti serviti mentre si scorre** (comportamento accettato): `last_activity_at` cresce soltanto, quindi un
  cliente servito sale **sopra il cursore**. Se era già caricato resta dov'era nell'elenco; se non era ancora
  caricato **non compare in questo scorrimento** finché la prima pagina non si ricarica (apertura della home,
  `visibilitychange`, ritorno dalla scheda). "Senza doppioni né buchi" vale su dati fermi; la deduplica per
  `id` resta solo come protezione (non dovrebbe mai scattare).
- **Cursore**: i valori dell'ultima riga ricevuta (`last_activity_at`, `created_at`, `id`) rimandati **così come
  sono arrivati** (stringhe ISO di PostgREST, con i microsecondi): convertirli in `Date` di JavaScript perde i
  microsecondi e salterebbe o ripeterebbe righe.
- **Stati**: prima pagina in caricamento `StatusView` loading «Carico i clienti…»; errore della prima pagina
  `StatusView` error «Clienti non caricati» · testo di `loadErrorText` · «Riprova»; pagina successiva in
  caricamento: riga `role="status"` «Carico altri clienti…» sotto l'elenco; errore di una pagina successiva:
  riga `role="alert"` «Non riesco a caricare altri clienti.» con «Riprova» (le righe già caricate restano);
  archivio vuoto senza ricerca: `StatusView` empty «Ancora nessun cliente» · «Registra il primo con «Nuovo
  cliente».»; ricerca senza risultati: «Nessun cliente trovato» · «Controlla come è scritto, o cerca con
  l'email.» e il pulsante «Nuovo cliente «<testo>»» con il nome precompilato come oggi, **solo se il testo non
  contiene `@`** (altrimenti «Nuovo cliente» senza precompilare). Regione live: «Clienti trovati» o «Nessun
  cliente trovato» alla fine di ogni ricerca.
- **Aggiornamento**: la prima pagina si ricarica all'apertura della home e quando la pagina torna visibile
  (`visibilitychange`) **solo se è caricata soltanto la prima pagina** (chi sta scorrendo non perde il punto);
  tornando dalla scheda con «Indietro» l'elenco riparte dalla prima pagina (nessun ripristino della posizione,
  Open Question 10).
- **Tablet** (`SPEC-tablet-kiosk.md` punto 10): colonna destra con ricerca, «Nuovo cliente» e la sezione
  CLIENTI in **due colonne** (la griglia di oggi di SERVITI OGGI), sentinella e «Mostra altri clienti» sotto la
  griglia; il lettore USB a sinistra non cambia.
- **Riquadro della card**: invariato, ma la condizione "compatto" cambia: oggi è `search.status !== 'idle'`
  (`HomePage.tsx`), che con l'elenco sempre caricato sarebbe sempre vera; diventa **"il testo ha almeno 2
  caratteri"** (dopo `clean_name`, la stessa soglia della ricerca). La lettura card non aspetta l'elenco.
- **Server** — `app.list_customers(p_query text default null, p_after_activity_at timestamptz default null,
  p_after_created_at timestamptz default null, p_after_id uuid default null, p_limit int default 20) returns
  table (id uuid, name text, email text, balance int, last_activity_at timestamptz, created_at timestamptz)`,
  `stable security definer set search_path = ''`, `not_operator` per primo; `p_limit` fuori da 1–50 →
  `invalid_limit` (22023); cursore incompleto → `invalid_cursor` (22023): `p_after_id` null con
  `p_after_activity_at` o `p_after_created_at` valorizzato, oppure `p_after_id` valorizzato con
  `p_after_created_at` null (senza questo controllo il confronto di riga con un `null` dà `NULL` e restituisce
  una pagina vuota, che sembra la fine dell'elenco); il cursore valido è "tutti null" (prima pagina) oppure
  `p_after_id` e `p_after_created_at` valorizzati;
  testo tagliato a 80 caratteri e ripulito con `clean_name`. Saldo con `private.customer_balance` solo per le
  righe restituite (sottoquery limitata, come oggi `search_customers`).
- **Ultima attività denormalizzata** (migrazione 1): `app.customers.last_activity_at timestamptz null`,
  aggiornata da un trigger `after insert on app.movements for each row when (new.kind in ('purchase',
  'redemption'))`: `update app.customers set last_activity_at = greatest(coalesce(last_activity_at,
  '-infinity'), new.created_at) where id = new.customer_id`. Le RPC di `ledger` bloccano già la riga del
  cliente (`private.lock_customer_for_ledger`, `for update`) prima di inserire, quindi l'aggiornamento non
  aggiunge attese né rischi di stallo. Riempimento iniziale nella migrazione dal `max(created_at)` di spese e
  riscatti. Due colonne generate per l'ordine: `has_activity boolean generated always as (last_activity_at is
  not null) stored` e `sort_at timestamptz generated always as (coalesce(last_activity_at, created_at))
  stored`; indice `create index customers_home_order_idx on app.customers (has_activity desc, sort_at desc, id
  desc) where anonymized_at is null`. Condizione della pagina successiva: `(c.has_activity, c.sort_at, c.id) <
  (p_after_activity_at is not null, coalesce(p_after_activity_at, p_after_created_at), p_after_id)` e `order
  by c.has_activity desc, c.sort_at desc, c.id desc limit p_limit`: sullo stack locale (Postgres 17, 20 000
  righe) il piano è un `Index Only Scan` su quell'indice con la condizione di riga come `Index Cond`.
  `last_activity_at` si scrive solo dal trigger (nessun `grant` di scrittura, come il resto della tabella).
  Perché non calcolarla ogni volta: ordinare tutti i clienti per `max(created_at)` dei movimenti richiede di
  aggregare l'intero storico a ogni pagina; il valore salvato rende ogni pagina una lettura di 20 righe da un
  indice.
- `app.get_customer` continua a valorizzare `last_served_at` (ultimo movimento di **oggi**): dopo la
  rimozione di SERVITI OGGI nessuna schermata lo usa più, ma resta nel tipo per non cambiare altre firme (Open
  Question 11).
- **Contratto del servizio** (`src/features/customers/types.ts`; lo condividono `supabaseCustomerService`,
  `fakeCustomerService`, `useCustomerList` e `HomePage`):

  ```ts
  /** One row of the home list: what list_customers returns, nothing else. */
  type CustomerListRow = {
    id: string;
    name: string;
    balance: number;
    /** PostgREST's ISO string, microseconds included; null without purchases or redemptions. */
    lastActivityAt: string | null;
    /** PostgREST's ISO string, kept as received. */
    createdAt: string;
  };
  /** The last row received, sent back unchanged; null for the first page. */
  type CustomerListCursor = { activityAt: string | null; createdAt: string; id: string };

  interface CustomerService {
    // …create, update, get, anonymize as today (email instead of phone)…
    list(input: { query: string; after: CustomerListCursor | null }): Promise<{
      customers: CustomerListRow[];
      hasMore: boolean; // customers.length === 20
    }>;
  }
  ```

  - `email` **non** è in `CustomerListRow` (l'elenco non la mostra, Open Question 5) anche se `list_customers`
    la restituisce: il parser la scarta; si valuta di toglierla dalla tabella restituita in fase di piano.
  - Righe lette da un parser proprio (`customerListRow.ts`, +test), **non** da `customerRow.ts`, che richiede
    `notes` e `anonymizedAt` assenti in `list_customers`; i timestamp restano stringhe (mai `Date`).
  - `search` e `servedToday` **spariscono** da `CustomerService`, da `supabaseCustomerService` e da
    `fakeCustomerService`; il fake implementa `list` con lo stesso ordine, filtro e cursore del server.

### Modello dati e regole di accesso (riepilogo delle modifiche)

```sql
-- app.customers
- phone                                      -- eliminata (dati azzerati prima)
+ email            text null  check (email = lower(btrim(email)) and length(email) between 6 and 254
+                                     and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
+ last_activity_at timestamptz null           -- solo dal trigger dei movimenti
+ has_activity     boolean generated always as (last_activity_at is not null) stored
+ sort_at          timestamptz generated always as (coalesce(last_activity_at, created_at)) stored
+ unique index customers_email_key on (email)
+ index customers_home_order_idx on (has_activity desc, sort_at desc, id desc) where anonymized_at is null

-- app.customer_summary: attributo phone rinominato email (stessa posizione)

-- app.cards
+ released_at          timestamptz null       -- riformattata: dissociata per sempre
+ released_by          uuid null references app.operators (id)
+ release_operation_id uuid null unique       -- idempotenza di release_card
+ check (released_at is null or not active)
+ check ((released_at is null) = (released_by is null) and (released_at is null) = (release_operation_id is null))
- constraint cards_uid_key unique (uid)
+ unique index cards_uid_key on (uid) where released_at is null   -- stesso nome
+ index cards_released_by_idx on (released_by)
```

- **Righe delle card riformattate**: restano (le card non si cancellano mai, `cards_before_delete`), con l'uid
  e il cliente di allora, per lo storico; `released_at` le esclude dall'indice unico, quindi lo stesso uid può
  avere **una nuova riga** per un cliente nuovo. L'indice parziale mantiene il nome `cards_uid_key`: la
  diagnostica `constraint_name` di una `unique_violation` su un indice unico restituisce il nome dell'indice
  (verificato sullo stack locale), quindi `private.associate_card_to` continua a tradurla in `card_taken`
  senza modifiche. Alternativa scartata: azzerare `uid` nella riga vecchia (perde lo storico e richiede di
  togliere il `not null` e il controllo del formato).
- **Tutte le ricerche per uid** aggiungono `and released_at is null`: `app.lookup_card`,
  `private.associate_card_to` (`select … where uid = p_uid for update`), `private.raise_card_taken` (`into
  strict`: con due righe dello stesso uid fallirebbe con `too_many_rows`). Un test pgTAP prova ognuna con un
  uid riformattato e riassociato.
- **Trigger** `private.cards_before_update` esteso: `released_at`, `released_by` e `release_operation_id` si
  scrivono una sola volta, solo su una card non attiva, e non tornano mai `null`; una card con `released_at` non
  torna mai `active` (oltre al `check`). `private.cards_after_deactivate` invariato.
- **Una card attiva per cliente**: resta garantita dall'indice parziale `cards_one_active_per_customer`;
  `reactivate_card` disattiva l'altra card **prima** di riattivare questa, nella stessa transazione, con la riga
  del cliente bloccata (stessa sequenza di `associate_card_to`).
- **Ordine dei blocchi** (niente stalli): sempre riga del **cliente** (`for update`) poi riga della **card**
  (`for update`), come `associate_card_to`. `release_card` e `reactivate_card` leggono prima il
  `customer_id` della card senza blocco, bloccano il cliente, poi bloccano e rileggono la card.

**Nuove RPC** (`security definer`, `set search_path = ''`, `revoke execute … from public, anon`, `grant …
to authenticated`; prima istruzione `not_operator`; operatore registrato con `private.acting_operator_id()`;
nessun messaggio, `detail` o log contiene uid, token o email):

- `app.get_card(p_card_id uuid) returns table (card_id uuid, uid text, customer_id uuid, customer_name text,
  active boolean, deactivated_at timestamptz, released_at timestamptz, customer_anonymized boolean,
  customer_balance int, other_active_card_id uuid, other_active_card_uid text)` (`stable`; qualunque operatore
  attivo, come `lookup_card`: sono dati che un operatore legge già da `app.cards`); `customer_name` null se
  anonimizzato; nessuna riga se l'id non esiste.
- `app.reactivate_card(p_card_id uuid, p_expected_active_card_id uuid) returns app.card_association`: non admin
  (`private.is_admin()`, che sul tablet vale per il cassiere) → `forbidden`; card inesistente →
  `card_not_found`; `released_at` → `card_released`; cliente anonimizzato → `customer_anonymized`; card già
  attiva → restituisce la riga senza modifiche (reinvio idempotente, nessun controllo della conferma); card
  attiva attuale del cliente diversa da `p_expected_active_card_id` (anche `null` contro una card attiva) →
  `active_card_changed`; altrimenti la logica di `private.associate_card_to` (disattiva l'altra, riattiva questa
  con `associated_at = now()`, `associated_by` = chi agisce, link "non scritto"). Non serve un
  `operation_id`: ripeterla dopo un errore di rete non ha effetti doppi.
- `app.release_card(p_operation_id uuid, p_card_id uuid) returns app.cards`: `p_operation_id` null → 22023;
  non admin → `forbidden`; card inesistente → `card_not_found`; card con `release_operation_id =
  p_operation_id` o già rilasciata → restituisce la riga senza modifiche (idempotente); `p_operation_id` già usato
  per un'altra card → 22023; card attiva → `card_active`; altrimenti `released_at = now()`, `released_by` = chi
  agisce, `release_operation_id = p_operation_id` e, per sicurezza, `delete from private.card_links where
  card_id = p_card_id` (di norma già vuota: la disattivazione l'ha cancellata). Movimenti, saldo e cliente non si
  toccano. Il server **non può sapere** se la card è stata davvero svuotata: la scrittura è un passo
  dell'interfaccia (vedi Sicurezza).
- `private.associate_card_to`: nel ramo "card disattivata dello stesso cliente → riattivata" aggiunge `if not
  private.is_admin() then raise exception 'forbidden'` (Open Question 3).
- `app.list_customers`, `public.card_rewards`, `private.card_customer_for_token` (sopra).
- Eliminate: `app.search_customers(text)`, `app.customers_served_today()`, `private.normalize_phone(text)`.
- Codici d'errore nuovi (in `errorCodes.ts` e nelle tabelle di traduzione dei servizi): clienti
  `email_invalid`, `customer_email_taken`; card `card_released`, `card_active`, `active_card_changed` e
  **`forbidden`** (oggi assente da `CARD_ERROR_CODES` in `src/features/cards/supabaseCardsService.ts`); via
  `phone_invalid`. La voce `forbidden` di `TRANSLATIONS` delle card produce un errore tipizzato il cui testo, in
  Associa card e su `/card/:cardId`, è «Card non attiva: chiedi a un amministratore.» (non più il
  `CustomerError('forbidden')` della cancellazione dati).
- Test dei codici da cambiare: `scripts/ledgerErrorCodes.test.ts`, `scripts/customersBoundary.test.ts`,
  **`scripts/customerErrorCodes.test.ts`** (oggi legge il solo file che finisce in `_customers.sql`, dove
  `phone_invalid` è ancora sollevato: fallirebbe togliendolo) e **`scripts/cardErrorCodes.test.ts`** (oggi legge
  solo `_cards.sql`: nulla di `<ts>_customers_v2_email.sql` né di `<ts>_cards_v2_release.sql` verrebbe
  controllato). Entrambi leggono `_customers*.sql` / `_cards*.sql` (o un elenco esplicito di file) e costruiscono
  l'insieme dei codici dalla **definizione più recente di ogni funzione ancora presente**, escludendo quelle
  eliminate (`private.normalize_phone`, `app.search_customers`, `app.customers_served_today`), così i codici
  nuovi sono obbligatori e `phone_invalid` sparisce.

## Ordine delle migrazioni

Quattro file nuovi in `supabase/migrations/`, dopo `20261119094918_tablet_kiosk_pin_lock_order.sql` (i
timestamp esatti li sceglie chi li crea; se la PR #24 `operators` viene unita prima e aggiunge migrazioni,
questi file vanno rinominati con timestamp successivi ai suoi):

1. `<ts>_customers_v2_activity.sql` — `last_activity_at`, colonne generate, riempimento, trigger sui
   movimenti, indice dell'elenco. **Non rompe nulla** (solo aggiunte).
2. `<ts>_customers_v2_email.sql` — `email` + vincolo + indice unico; rinomina dell'attributo di
   `app.customer_summary`; `drop`/`create` di `create_customer`, `update_customer`,
   `create_customer_with_card`, `export_customers`; `create or replace` di `anonymize_customer` e
   `get_customer`; `app.list_customers`; `drop` di `search_customers`, `customers_served_today`; azzeramento e
   `drop column phone`; `drop function private.normalize_phone`. **Rompe il frontend vecchio** (parametri
   `p_phone`, funzioni eliminate): vedi note di rilascio.
3. `<ts>_cards_v2_release.sql` — colonne `released_*`, vincoli, sostituzione di `cards_uid_key` con l'indice
   parziale (stesso nome, nella stessa transazione: `alter table … drop constraint cards_uid_key; create unique
   index cards_uid_key …`), trigger esteso, `lookup_card`/`associate_card_to`/`raise_card_taken` con
   `released_at is null`, restrizione admin della riattivazione, `get_card`, `reactivate_card`,
   `release_card`.
4. `<ts>_card_rewards_public.sql` — `private.card_customer_for_token`, `public.card_points` riscritta per
   usarla (stesso comportamento), `public.card_rewards` con i suoi `grant`.

`supabase/seed.sql`: email `@example.com` al posto dei telefoni (alcuni clienti senza email); qualche movimento
già presente continua a valorizzare `last_activity_at` tramite il trigger.

## Note di rilascio (per chi coordina il lavoro)

- **Prima staging, poi produzione** (RUNBOOK "Pubblicazione"): `npx supabase link --project-ref <staging>` →
  `npx supabase db push` → prova sull'anteprima della PR (lista RUNBOOK sotto) → solo dopo, produzione.
- **Produzione: migrazioni e frontend insieme, a bar chiuso.** Dopo la migrazione 2 l'app in produzione (vecchia)
  non riesce più a cercare, creare o modificare clienti finché Vercel non pubblica `main`. Sequenza: unire la PR
  su `main` **subito dopo** `db push` in produzione (o viceversa entro pochi minuti), fuori dall'orario di
  apertura; nessun telefono della cassa deve restare con l'app vecchia aperta (un ricaricamento basta: il service
  worker prende la versione nuova al riavvio dell'app).
- **Prima del merge**: conferma esplicita del titolare sulla cancellazione dei telefoni già salvati
  (Open Question 17). Senza conferma la migrazione 2 non si rilascia.
- **Telefoni nelle note** (dopo il `db push`, **prima** del `vacuum full`): un amministratore esegue dal SQL
  Editor
  `select id, name from app.customers where anonymized_at is null and notes ~ '\+?\d[\d .-]{7,}';`
  e, per ogni cliente trovato, toglie il numero dalle note da Modifica cliente (l'app; mai un `update` a mano
  sul testo). La query non stampa le note: chi la esegue le legge solo nell'app.
- **Dopo il `db push` in produzione** (e su staging), finito il controllo delle note: dal SQL Editor
  `vacuum full app.customers;` per riscrivere
  la tabella senza le versioni vecchie delle righe con i telefoni. È un blocco esclusivo di pochi millisecondi su
  qualche centinaio di righe. Se il SQL Editor lo rifiuta perché lo avvolge in una transazione, eseguirlo con
  `psql` sulla stringa di connessione del progetto. Le copie di sicurezza automatiche di Supabase che contengono
  ancora i telefoni scadono da sole secondo la conservazione del piano: nessuna azione, da citare al consulente.
- **Card già consegnate**: nessun cambiamento (il link e il token non cambiano; `card_points` è identica).
- **Informativa**: `PRIVACY_NOTICE_STATUS` resta `'draft'` finché il consulente non approva il testo nuovo
  (sotto); il checkpoint di lancio della CAPABILITY-MAP lo richiede ancora.
- **Wireframe**: aggiungere alla tela "Saldo-punti-premi", "Card-non-attiva-admin" (telefono e tablet) e la home
  con CLIENTI al posto di SERVITI OGGI; togliere il telefono dalle tavole dei moduli.

## Cosa deve dire ora l'informativa privacy (punti per il consulente, non testo legale)

L'agente non scrive testo legale (`SPEC-customers.md` Boundaries). Il consulente deve ricontrollare
l'informativa con queste novità:

- dati raccolti: nome e cognome; **email facoltativa** (non più il telefono); note dell'operatore; movimenti
  di punti (importi, punti, data, operatore); codice della card associata;
- finalità dell'email: **solo** ritrovare il cliente in cassa; **nessun invio** di messaggi; una newsletter o
  qualunque comunicazione promozionale futura richiederà un **consenso separato e facoltativo** (non
  richiesto oggi, non pre-selezionato);
- la pagina dei punti aperta con la card mostra punti e premi attivi del bar, senza dati personali;
- cancellazione su richiesta: nome, email e note si cancellano, i movimenti restano anonimi; card riformattate
  restano nello storico senza dati personali;
- telefoni già raccolti: tolti dalla colonna e dai dati di prova (se il titolare conferma la cancellazione); le
  **note** dell'operatore, testo libero, sono state controllate **a mano** per togliere i numeri scritti lì, ma
  non c'è una garanzia automatica; restano nelle copie di sicurezza di Supabase fino alla loro scadenza;
- se in produzione sono già stati registrati clienti con un'informativa che citava il telefono: il consulente
  valuta se serve informarli (il dato è stato cancellato, non aggiunto).

## Sicurezza (revisione, `security-and-hardening`)

| Rischio | Esito / misura |
|---|---|
| `anon` legge più di prima | Le funzioni eseguibili da `anon` in `public` diventano due: `card_points` e `card_rewards` (allowlist di `function_privileges.test.sql` e `card_points.test.sql` aggiornata; qualunque altra funzione nuova eseguibile da `anon` fa fallire il test). `card_rewards` restituisce solo nome e punti dei premi attivi e solo con un token valido. |
| Risposta della pagina pubblica che distingue i casi | `card_rewards` dà zero righe per ogni token non valido, in attesa, di card disattivata, rilasciata o di cliente anonimizzato: lo stesso "niente" di `card_points` (`null`). |
| Token o email nei log | Nessun `raise`, `detail` o log con token, uid o email; `customer_email_taken` porta in `detail` solo l'id dell'altro cliente (come `customer_name_taken`); il frontend non registra email in console. |
| Operatore che riattiva o riformatta dall'API | `is_admin()` dentro `reactivate_card`, `release_card` e nel ramo di riattivazione di `associate_card_to`; pgTAP con operatore, admin, cassiere admin e cassiere operatore del tablet. |
| Liberare una card senza svuotarla | Possibile solo a un amministratore che chiami l'API a mano: la card conserva un link già morto (`private.card_links` cancellata alla disattivazione), che apre «Card non attiva». Nessun dato esce. Accettato. |
| Uid riusato per un altro cliente | Ora voluto (decisione 2026-11-23) e solo dopo `release_card`; la riga vecchia resta col suo cliente, la nuova riparte senza link. Un link vecchio non può mostrare i punti del cliente nuovo: i token sono legati a `card_id`, non all'uid, e quelli della riga vecchia sono già cancellati. |
| Due card attive / stalli | Indice parziale `cards_one_active_per_customer`; blocchi cliente → card in ogni RPC; test di concorrenza in `tests/integration` (due `reactivate_card` contemporanee su due card dello stesso cliente: una sola attiva alla fine; `release_card` contro `reactivate_card` sulla stessa card: una sola vince). |
| Conferma dello scambio superata | `p_expected_active_card_id` → `active_card_changed`: nessuno scambio diverso da quello confermato. |
| Telefoni residui | Nessun telefono nella colonna né nei dati di prova: `update … set phone = null`, `drop column`, `vacuum full`; nessun telefono in seed, fixture, test o documentazione nuova (test di confine). **Note controllate a mano** (query delle note di rilascio prima del `vacuum full`): testo libero, nessuna garanzia automatica. |
| Email doppia per corsa | Indice unico; `unique_violation` tradotta in `customer_email_taken`. |
| Formula nel CSV | `guardFormula` sull'email. |
| Ricerca con caratteri speciali | `%`, `_`, `\` scappati anche nel pattern dell'email; testo tagliato a 80 caratteri; `p_limit` limitato a 50. |
| Enumerazione delle email da parte di un operatore | Un operatore attivo cerca già i clienti per nome: nessun aumento del perimetro. `anon` non arriva mai a `list_customers` (`revoke`, controllo `not_operator`). |
| Contatto dei clienti | Niente `mailto:` né invii: Boundaries e test che nel DOM della scheda non ci siano link `mailto:`. |
| Scrittura sulla card sbagliata | `eraseCard` riusa il passo 1 di `writeUrl` (card appena letta, `IN_FIELD_MS`) e la segnalazione `wrong-card` con `otherUid`. |

## Commands

Nessun comando nuovo: `npm run typecheck && npm run lint && npm run format:check && npm test`,
`npm run db:reset`, `npm run db:test`, `npm run test:integration`, `npm run e2e`, `npm run build && npm run
check:bundle`.

## Project Structure (file principali toccati)

```
supabase/migrations/<ts>_customers_v2_activity.sql · <ts>_customers_v2_email.sql
                    <ts>_cards_v2_release.sql · <ts>_card_rewards_public.sql
supabase/tests/customers_v2.test.sql (nuovo) · customers.test.sql · cards.test.sql · card_links.test.sql
               card_points.test.sql · export.test.sql · ledger_reads.test.sql · function_privileges.test.sql
supabase/seed.sql
src/features/customers/  email.ts (+test, nuovo) · phone.ts (eliminato) · CustomerForm · CustomerPage
                         HomePage (testo nello stato della cronologia, riquadro compatto da 2 caratteri)
                         useCustomerList.ts (nuovo; sostituisce useCustomerSearch e useServedToday)
                         customerListRow.ts (+test, nuovo)
                         activityLabel.ts (+test, nuovo) · AnonymizeSection · errorCodes · types
                         customerRow.ts (email al posto di phone; lo usa anche cards)
                         supabaseCustomerService
src/features/cards/      InactiveCardPage.tsx (+css, +test, +tablet test, nuovo) · useInactiveCard.ts (nuovo)
                         useHomeCardRead · homeCardNotice · supabaseCardsService (forbidden) · types
                         CardSummary.tsx (+test: «Card attiva …E5F6 · email» o «Senza email»)
                         useNewCustomerCard (uid nello stato della cronologia, non in ?card=)
                         public/CardPointsPage · public/cardPointsService (+ fetchCardRewards)
src/features/card-input/ webNfcWriter (eraseCard) · webNfcAdapter (blank) · useCardWriter · fakeCardAdapter
                         web-nfc.d.ts · CardReadPanel (testo stato off)
src/features/export/     buildCustomersCsv · types · supabaseExportService
src/app/routes.tsx       rotta /card/:cardId sotto RequireCashier · routes.test.tsx
src/app/dev/UiGallery.tsx campo telefono e «Cerca per nome o telefono» → email
src/test/                fakeCustomerService (list; via search e servedToday) · fakeCardsService · fakeWebNfc
                         fakeExportService · fakeLedgerService (applyMovement aggiorna lastActivityAt e l'ordine
                         dell'elenco al posto di lastServedAt)
scripts/                 customersBoundary · customerErrorCodes · cardErrorCodes · ledgerErrorCodes (.test.ts)
e2e/                     customers · cards · card-points · export · tablet*.spec.ts (tablet-layout: /card/:cardId;
                         tablet-pin: parametro phone rinominato) · nfc.ts
                         ledger.spec.ts (criterio 3: il cliente è in cima a CLIENTI con «Oggi, HH:MM», non più
                         «in Serviti oggi»)
tests/integration/       customers · cards · export · ledger (trigger di last_activity_at)
                         tablet-kiosk (p_phone → p_email in create_customer e update_customer)
docs/specs/contract.md   rotta /card/:cardId
```

Criterio di `SPEC-ledger.md` che cambia: il criterio 3 ("dopo 10 s si torna alla home, con il cliente in
Serviti oggi") diventa "… con il cliente in cima a CLIENTI con «Oggi, HH:MM»"; si aggiorna con le spec
originali dopo il rilascio.

## Code Style

Come i moduli esistenti: componenti solo tramite servizi e hook del modulo; nessuna dipendenza nuova (niente
libreria di scorrimento infinito né di validazione email). Esempio della normalizzazione, specchio del vincolo:

```ts
/** The stored form of an email typed by an operator, `null` when empty, or `'invalid'`. */
export function normalizeEmail(input: string): string | null | 'invalid' {
  const email = input.replace(/^[\s  -​　]+|[\s  -​　]+$/g, '').toLowerCase();
  if (email === '') return null;
  return email.length >= 6 && email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    ? email
    : 'invalid';
}
```

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP (`customers_v2.test.sql` e test esistenti aggiornati) | colonna `phone` assente e `private.normalize_phone` assente; `email` normalizzata (`'  Rossi@Example.COM '` → `rossi@example.com`), formato rifiutato (`email_invalid`), unica (anche `ROSSI@example.com` contro `rossi@example.com` → `customer_email_taken` con `detail`), liberata dall'anonimizzazione (un altro cliente la riusa), svuotata con `update_customer`, `null` multipli ammessi; `anonymize_customer` azzera nome, email, note; `list_customers`: ordine (spesa annullata conta, correzione no, riscatto conta, senza movimenti per creazione), anonimizzati esclusi, filtro per parole del nome e per parte dell'email, `%`/`_`/`\` alla lettera, keyset senza duplicati né buchi su 3 pagine (dati fermi) anche con `created_at` uguali al microsecondo, cursore non valido (`p_after_id` null con un timestamp valorizzato, `p_after_id` senza `p_after_created_at` → `invalid_cursor`), limite fuori intervallo, `not_operator`; trigger: `last_activity_at` aggiornata da spesa e riscatto, non da correzione, mai all'indietro; con 1 000 clienti e 20 000 movimenti finti (test annullato a fine transazione) `explain` di prima pagina, pagina centrale e ricerca mostra `Index Only Scan` o `Index Scan` su `customers_home_order_idx` (**questo** è il controllo bloccante, deterministico); nessuna asserzione di tempo in pgTAP (i runner condivisi della CI la renderebbero casuale): il tempo si misura a mano (RUNBOOK) con un limite largo, < 500 ms; card: `get_card`, `reactivate_card` (operatore `forbidden`, admin ok, scambio con `p_expected_active_card_id`, `active_card_changed`, cliente anonimizzato, card rilasciata, idempotenza), `release_card` (operatore `forbidden`, card attiva `card_active`, idempotenza con lo stesso `operation_id`, `operation_id` riusato su un'altra card, riga conservata con uid, `private.card_links` vuota), uid rilasciato → `lookup_card` vuota → `associate_card` e `create_customer_with_card` lo associano a un altro cliente, `raise_card_taken` con due righe dello stesso uid, trigger che vieta di togliere `released_at` o riattivare una card rilasciata; riattivazione da `associate_card` riservata all'admin; `card_rewards`: token valido → premi attivi in ordine di punti, inattivi esclusi, token non valido/in attesa/card disattivata/rilasciata/cliente anonimizzato → zero righe, intestazione `no-store`; allowlist `anon` = `card_points`, `card_rewards`; `export_customers` con `email` |
| Unit (Vitest) | `normalizeEmail` con gli stessi vettori di pgTAP; `activityLabel` (oggi, ieri, quest'anno, altri anni, nessun movimento, cambio dell'ora legale); `buildCustomersCsv` (colonna Email, `guardFormula`, anonimizzati vuoti); `webNfcWriter.eraseCard` con `fakeWebNfc` (un solo record `empty`, `overwrite: true`, verifica `blank`, `verify-failed` se resta un URL, un record `text` o un record `mime`, `wrong-card` con `mayHaveWritten: false` nel passo `waiting-card` e `true` durante `write()`, un altro uid letto vuoto durante la verifica → `wrong-card` con `mayHaveWritten: true`, `unreadable`/`allowUnreadable`, tempi, `makeReadOnly` mai chiamato; `writeUrl` con `mayHaveWritten`); adattatore: `blank` vero per nessun record e per soli `empty`, falso con un record `text`, `mime` o `url`, mai ai consumatori; `customerListRow` (timestamp come stringhe, righe senza `notes`); servizi delle card: `forbidden` → «Card non attiva: chiedi a un amministratore.»; servizi: ogni codice d'errore nuovo → errore tipizzato; `fetchCardRewards` (forma, timeout, token non valido senza chiamata) |
| Componenti | Home: prima pagina, sentinella (IntersectionObserver finto) e «Mostra altri clienti» caricano la pagina 2 con il cursore come stringhe ricevute, deduplica, fine elenco, errori della prima e delle pagine successive, archivio vuoto, ricerca (attesa, testo nello stato della cronologia e ripristinato dopo «Indietro», `location.search` mai con `@` né con l'uid della card, risposte superate scartate, nessun risultato con e senza `@`), riquadro compatto solo da 2 caratteri, `IntersectionObserver` con `root: null`, etichette nuove, nessuna email nelle righe, aggiornamento su `visibilitychange` solo con la sola prima pagina, layout tablet a due colonne; card in home: admin → `/card/:id`, operatore → avviso «Card non attiva: chiedi a un amministratore» (cliente e anonimizzato); `InactiveCardPage`: stati, Riattiva **senza** scambio passa dalla conferma («Riattiva solo se la card è tornata a Maria…», con «Disattivata il …»; nessuna chiamata a `reactivate_card` prima del tocco su «Riattiva»), Riattiva con scambio (conferma, `active_card_changed` → nuova conferma), `forbidden` → testo per l'operatore, scrittura del link dopo la riattivazione, Riformatta (conferma, passi, ogni esito, i due testi di `wrong-card` secondo `mayHaveWritten`, rete dopo la scrittura → «Riprova» con lo stesso `operation_id`, `card_active`), tablet e `canWrite` falso senza Riformatta, operatore → errore, card anonimizzata senza Riattiva; form: campo email, errori, «Apri la scheda»; scheda: email o «Senza email», nessun `mailto:`; pagina pubblica: sezione PREMI, singolare «1 punto», catalogo vuoto senza sezione, «Card non attiva» senza premi, errore di una delle due chiamate → «Riprova» |
| Integrazione (`tests/integration`) | RPC nuove e traduzione degli errori contro lo stack locale; concorrenza (`reactivate_card` × 2, `release_card` contro `reactivate_card`, `create_customer` × 2 con la stessa email) |
| E2E (390×844 e tablet 1280×800, Supabase locale) | admin: cliente con email → lo trova scrivendo parte dell'email → email doppia rifiutata con «Apri la scheda» → cancella i dati → l'email si riusa; home: 45 clienti del test con un prefisso unico della corsa (`uniqueName`) → si scrive il prefisso nel campo → nell'elenco filtrato 20 righe, poi le altre scorrendo, nessun doppione, fine dell'elenco al 45°, il cliente appena servito in cima (l'elenco senza filtro, che cambia per gli altri test in parallelo sullo stesso database, si prova solo nei test di componente con il servizio finto); card: disattiva → riletta con `__enjoyFakeCard` da admin → Riattiva con scambio → link scritto (`__enjoyFakeCardWrites`) → spesa; disattiva → Riformatta → registro con `url: null` → riletta → Nuovo cliente con la card; operatore → avviso; tablet: card disattivata dal lettore USB (`page.keyboard`) → Riattiva, nessun Riformatta; pagina `/s/<token>` con i premi attivi del seed in ordine |
| Manuale (RUNBOOK, anteprima su staging, NTAG215 di prova) | Riformatta su Android: la card si svuota e Chrome la verifica; riletta in home apre Nuovo cliente; fuori dall'app Android e un iPhone non aprono nulla con la card vuota; una card riformattata si riassocia e riceve un link nuovo che funziona; pagina dei punti con i premi su un telefono qualsiasi a 320 px |

## Boundaries (delta rispetto alle spec originali)

- **Always**: email normalizzata e unica sul server; ruolo controllato nelle RPC; solo dati finti
  (`@example.com`, nessun telefono); `guardFormula` sull'email nel CSV; cursore rimandato com'è arrivato;
  `released_at is null` in ogni ricerca per uid; card svuotata solo dopo averla riconosciuta (`expectedUid`).
- **Ask first**: mostrare l'email negli elenchi; contare o non contare le spese annullate nell'ultima attività;
  cancellare i telefoni già salvati (Open Question 17); riattivare senza conferma;
  rendere disponibile Riformatta sul tablet o senza scrittura; mostrare premi o altro su «Card non attiva»;
  qualunque uso dell'email per scrivere ai clienti (newsletter: consenso marketing separato).
- **Never**: link `mailto:` o invii di email ai clienti; `makeReadOnly()`; cancellare righe di `app.cards`,
  `app.customers` o movimenti; uid, token o email in log, messaggi o `detail` d'errore, o nell'URL (anche lato client: testo della ricerca e uid della card sconosciuta passano per lo stato della cronologia, punto 6); consenso marketing pre-selezionato o
  unito al consenso privacy; testo legale scritto dall'agente.

## Success Criteria

1. Dopo le migrazioni `app.customers` non ha la colonna `phone`, `private.normalize_phone`,
   `app.search_customers` e `app.customers_served_today` non esistono; il test di confine (regola del punto 1:
   identificatori `phone:`, `.phone`, `p_phone`, `'phone'`, `normalize_phone`, `maskPhone`, `phone_invalid`,
   testi «Telefono»/«Senza telefono»/«Tel.», letterali `\+39\d{6,}`, in `src/`, `e2e/`, `tests/`, `scripts/` e
   `supabase/seed.sql`, escluso il test stesso) è verde: nessun telefono nella colonna né nei dati di prova;
   note controllate a mano (note di rilascio).
2. Un operatore crea un cliente con `'  Rossi@Example.COM '`: si salva `rossi@example.com`; un secondo cliente con
   `ROSSI@example.com` è rifiutato con «Esiste già un cliente con questa email.» e «Apri la scheda» del primo;
   `rossi@` senza dominio è rifiutato con «Email non valida: controlla come è scritta.»; due clienti senza email
   convivono.
3. «Cancella i dati del cliente» azzera nome, email e note; subito dopo un altro cliente può salvare la stessa
   email.
4. Dalla home, scrivendo «rossi@exa» si trova il cliente; scrivendo «maria rossi» si trova per nome; la scheda
   mostra l'email per intero e nessun link `mailto:`; il CSV dei clienti ha la colonna «Email» al posto di
   «Telefono», vuota per gli anonimizzati, con `guardFormula`.
5. La home senza ricerca mostra la sezione CLIENTI: 20 righe, poi le successive scorrendo, su dati fermi senza
   doppioni né buchi, fino all'ultimo cliente (un cliente servito durante lo scorrimento compare al ricaricamento
   della prima pagina); prima chi ha la spesa o il riscatto più recente (anche annullati), poi chi non
   ha movimenti dal più nuovo; nessun cliente con dati cancellati; scrivendo nel campo la stessa lista si filtra
   con lo stesso ordine; ogni stato (caricamento, errore della prima pagina, errore di una pagina successiva,
   archivio vuoto, nessun risultato) ha un test di componente; anche sul tablet a 1280×800, in due colonne.
6. Con 1 000 clienti e 20 000 movimenti finti il piano di `list_customers` (prima pagina, pagina centrale,
   ricerca) è un `Index Only Scan` o `Index Scan` su `customers_home_order_idx` (asserzione `explain` in pgTAP);
   il tempo, misurato a mano (RUNBOOK), resta sotto un limite largo di 500 ms.
7. La pagina `/s/<token>` di una card attiva mostra sotto i punti la sezione «PREMI» con nome e punti dei soli
   premi attivi, dal meno caro, e nient'altro; senza premi attivi la sezione non c'è; «Card non attiva» resta
   identica a oggi; `card_rewards` non restituisce righe per nessun token non valido; `anon` può eseguire solo
   `card_points` e `card_rewards`.
8. Un amministratore che avvicina in home una card disattivata arriva a «Card non attiva» e con «Riattiva la
   card», dopo la conferma «Riattiva solo se la card è tornata a Maria…» (anche senza un'altra card attiva), la
   card torna al suo cliente; se il cliente aveva un'altra card attiva, dopo la conferma che la nomina
   quella si disattiva e restano i punti; subito dopo il link si scrive sulla card; un cliente non ha mai due
   card attive (anche con due amministratori in contemporanea).
9. Un amministratore che con «Riformatta la card» conferma e tiene la card sul telefono ottiene una card con un
   solo record vuoto, verificata rileggendola; solo dopo il server la dissocia per sempre (`released_at`,
   riga conservata, movimenti e saldo del cliente invariati, nessun token); la stessa card riletta in home apre
   Nuovo cliente e può essere associata a un cliente nuovo; un reinvio con lo stesso `operation_id` non cambia
   nulla.
10. La card di un cliente con dati cancellati offre solo «Riformatta la card», con lo stesso esito.
11. Un operatore che avvicina una card disattivata vede «Card non attiva: chiedi a un amministratore»; le RPC
    `reactivate_card` e `release_card` e la riattivazione da Associa card gli rispondono `forbidden`.
12. Sul tablet (lettore USB) una card disattivata letta da un cassiere amministratore apre «Card non attiva» con
    «Riattiva la card» e la nota sul telefono Android al posto di «Riformatta la card».
13. Il percorso card attiva → Registra spesa non cambia (nessuna chiamata in più) e resta sotto i 10 secondi;
    CI verde (unit, componenti, pgTAP, integrazione, E2E telefono e tablet, bundle), detector Impeccable pulito,
    target di tocco ≥ 48 px.

## Out of Scope (Deferred)

- Newsletter e qualunque invio di email: servirà un consenso marketing separato (decisione del titolare).
- Riformatta dal tablet con il solo scollegamento sul server: escluso finché il tablet non scrive card.
- Gestire una card disattivata di **un altro** cliente da Associa card o Nuovo cliente (oggi «Card già
  associata»): si fa dalla home.
- Storico delle card di un cliente in Modifica cliente (anche quelle riformattate).
- Ripristino della posizione dell'elenco tornando dalla scheda.
- Indicatore "premio raggiungibile" o "mancano N punti" sulla pagina pubblica.
- Email di conferma o verifica dell'indirizzo.

## Open Questions (default conservativi adottati)

1. **Spese e riscatti annullati nell'ultima attività?** Default: sì, contano (il cliente è venuto al bar, come in
   SERVITI OGGI); le correzioni no.
2. **SERVITI OGGI si toglie?** Il titolare ha chiesto l'elenco dei clienti sotto la ricerca, non la rimozione di
   SERVITI OGGI. **Deciso dal titolare (2026-11-23)**: un solo elenco CLIENTI che la sostituisce; i clienti di
   oggi stanno in cima con «Oggi, 10:15». Nessuna sezione separata.
3. **Riattivazione da Associa card per gli operatori** (oggi permessa per la card disattivata dello stesso
   cliente). Default, conseguenza della regola del titolare «riattivare una card disattivata: solo
   amministratori» (da confermare che valga anche da lì): solo amministratori; l'operatore vede
   «Card non attiva: chiedi a un amministratore.»
4. **Riformatta sul tablet** (il lettore USB non scrive). Default: non disponibile; nota che rimanda al telefono
   Android. Niente scollegamento sul solo server.
5. **Email negli elenchi della home?** Default: no, solo in scheda e in Modifica (meno dati personali sotto gli
   occhi di chi è al banco).
6. **Maiuscole nella parte locale dell'email** (tecnicamente può distinguerle). Il titolare ha detto "unica",
   non "senza distinguere maiuscole". Default da confermare: tutto minuscolo; due indirizzi che differiscono solo
   per le maiuscole sono la stessa email.
7. **Controllo dell'email**: default formato semplice (`qualcosa@dominio.estensione`), nessuna verifica di
   esistenza, nessuna email di conferma (l'app non scrive ai clienti).
8. **Premi sulla pagina pubblica**: default da confermare: ordine per punti crescenti poi nome, nessun segno di
   "raggiungibile", sezione nascosta senza premi attivi, «Card non attiva» senza premi (il titolare ha chiesto i
   premi "sotto i punti"; non ha escluso la pagina «Card non attiva»).
9. **Errore di una sola delle due chiamate della pagina pubblica**: default la pagina mostra l'errore con
   «Riprova» (un solo stato d'errore, nessun saldo senza premi o viceversa).
10. **Posizione dell'elenco tornando dalla scheda**: default nessun ripristino; l'elenco riparte dalla prima pagina
    (il testo della ricerca invece resta, nello stato della cronologia).
11. **`last_served_at` in `app.customer_summary`**: non lo usa più nessuna schermata. Default: resta nel tipo e
    `get_customer` continua a valorizzarlo (nessun cambio di firma in più); si toglie in una pulizia futura.
12. **Riattiva senza un'altra card attiva**: chiusa dalla revisione della spec: **sempre una conferma** (una card
    disattivata di solito è stata persa; i punti riscattati da chi l'ha trovata non tornano). Non contraddice il
    titolare, che ha chiesto la conferma per lo scambio.
13. **Riga della card riformattata**: il titolare ha chiesto di dissociarla per sempre e renderla di nuovo
    disponibile, non come. Default da confermare: riga conservata con uid e cliente di allora (`released_at`);
    l'uid si libera con un indice unico parziale.
14. **Nuovo cliente da una ricerca per email senza risultati**: default «Nuovo cliente» senza precompilare
    l'email (come oggi per il telefono).
15. **Testi nuovi** (errori email, «Card non attiva», Riattiva/Riformatta, CLIENTI, «Oggi, 10:15», «PREMI»…):
    proposti in stile design system («Stati, errori e conferme»); da rivedere con il titolare insieme
    all'informativa.
16. **Clienti già registrati con l'informativa che citava il telefono**: decide il consulente se informarli;
    default nessuna azione dell'app.
17. **Cancellare i telefoni già salvati** (irreversibile). Il titolare ha detto «rimuoviamo il numero di
    telefono, abbiamo deciso di non collezionarli»: è deciso che il campo sparisce e che non se ne raccolgono più;
    non è stato detto esplicitamente di cancellare quelli già in archivio. Default proposto: cancellarli
    (`update … set phone = null`, `drop column`, `vacuum full`). **Deciso dal titolare (2026-11-23)**: «Sì,
    cancellali»: i numeri già salvati si cancellano con la migrazione 2.
