# Spec: cards

Status: approvata (2026-11-17) su delega dell'utente — le Open Questions adottano i default proposti, da rivedere con il titolare (`docs/specs/cross-review.md` §3).
Rivista il 2026-11-17 per la decisione del titolare «punti visibili al cliente con la card»: link scritto
sulla card (punto 8), stato "link non scritto" (punti 4–5) e pagina pubblica dei punti (punto 9).
Modulo: `cards` ([CAPABILITY-MAP.md](CAPABILITY-MAP.md)) · Dipende da: `customers`, `card-input` ·
Fonti: specifiche ("Nuovo cliente e consegna della card", "Registrare una spesa" punto 1, "Modello dati",
"Sicurezza e privacy") e wireframe Cerca cliente, Card sconosciuta: nuovo cliente, Nuovo cliente senza card,
Associa o sostituisci card, Card già di un altro cliente, Modifica cliente, Scheda cliente, Registra spesa,
Associa-link, Associa-link-errore, Saldo-punti, Saldo-card-non-attiva (pagina "Telefono", tavole definitive
del titolare per scrittura del link e pagina pubblica), con le note n1, n2, n6 · Decisioni: `brain/DECISIONS.md` (2026-11-17 "Punti visibili al cliente con la
card": cambia i non-obiettivi "Nessuna schermata per il cliente" e "Non scriviamo le card" di
`brain/PROJECT.md`).

## Objective

La card è la scorciatoia per riconoscere il cliente alla cassa. Questo modulo lega ogni card (uid del tag
NTAG215) a un cliente e decide cosa succede quando una card viene letta. Alla consegna l'app scrive sulla
card un **link ai punti** (`https://<origine dell'app>/s/<token>`): il cliente, avvicinando la card al proprio
telefono (Android con NFC attivo, o iPhone XS e successivi, senza app, a schermo sbloccato: Android apre
il browser, iPhone mostra una notifica da toccare), vede solo il proprio saldo. Il token è segreto,
casuale e diverso dall'uid (l'uid lo legge chiunque):

- dalla schermata principale una card **attiva** apre subito Registra spesa del suo cliente; una card
  **sconosciuta** apre Nuovo cliente con la card già associata e, dopo il salvataggio, Registra spesa;
- da Modifica cliente si **associa** o **sostituisce** la card (card persa: la vecchia si disattiva, i punti
  restano, il suo link smette di funzionare) oppure la si **disattiva** soltanto;
- dopo ogni associazione confermata dal server l'app **scrive il link** sulla card; se non ci riesce
  (card allontanata, iPhone, tablet) l'associazione resta valida e la card è "link non scritto", con
  «Scrivi il link» da Modifica cliente o da Associa card;
- il percorso della spesa (card letta in home → Registra spesa → Conferma) **non scrive mai** la card e non
  chiama nessuna funzione del link: l'obiettivo dei 10 secondi resta quello di prima. La scrittura aggiunge
  pochi secondi solo alla consegna di una card (cliente nuovo, sostituzione) ed è sempre rimandabile.

L'app continua a **non contattare i clienti**: il link lo apre il cliente, dalla card, quando vuole.

**Utenti**: amministratori e operatori, con gli stessi permessi (le specifiche: "l'amministratore o
l'operatore la disattiva e ne associa una nuova"; l'operatore "consegna card").
**Successo**: card → Registra spesa senza toccare lo schermo; una card non è mai di due clienti; un
cliente non ha mai due card attive; un uid non passa mai a un altro cliente; il link di una card attiva
mostra solo i punti del suo cliente, quello di una card disattivata non mostra più nulla.

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
     lo stesso `operation_id` che il form di `customers` genera una volta e riusa nei reinvii), poi la
     **scrittura del link** (punto 8, la card è di solito ancora appoggiata) e infine
     `navigate('/clienti/:id/spesa', { replace: true })`, sia a link scritto sia con «Più tardi» o
     scrittura non riuscita (il cliente e la card restano salvati; la spesa non aspetta il link);
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
     letta sostituisce la precedente); il salvataggio usa la stessa RPC, seguita dalla scrittura del link
     (punto 8); la destinazione dopo il salvataggio resta quella di `customers`;
   - card già nota (attiva o disattivata, anche di cliente anonimizzato) → avviso del punto 4 («Card già
     associata», testi secondo il caso) senza perdere i dati scritti; «Apri la scheda di …» lascia il form;
   - lettura non disponibile → stati di `CardReadPanel` di `card-input` (NFC spento, permesso, iPhone): il
     cliente si salva comunque senza card.
4. **Associa o sostituisci card** (`/clienti/:id/card`, wireframe "Associa o sostituisci card"):
   intestazione «Associa card» con «Indietro» → `/clienti/:id/modifica`; riga cliente (nome, saldo in
   punti con `PointsBadge`, freccia) → `/clienti/:id`; riquadro `CardReadPanel` (`aria-label="Lettura
   card"`): «Avvicina la card nuova» · «L'app legge il codice della card e ci scrive il link per vedere i
   punti.» (il wireframe dice «non ci scrive nulla»: superato dalla decisione del 2026-11-17); se il
   cliente ha una card attiva, sotto il riquadro con icona card: «La card attuale (…E5F6) verrà
   disattivata. I punti restano a Maria.»; footer «Annulla» → `/clienti/:id/modifica`. Alla lettura
   (`app.associate_card`):
   - **riuscita** → riquadro e nota lasciano il posto alla **scrittura del link** (punto 8) sulla card
     appena letta, come nella tavola "Associa-link": sotto la riga cliente il messaggio `role="status"`
     con spunta «Card associata a Maria», poi il riquadro di scrittura (`aria-label="Scrittura del link"`,
     icona NFC) «Tieni la card appoggiata» · «Scrivo il link per vedere i punti…», la nota con icona link
     «Con il link, Maria vede i suoi punti avvicinando la card al proprio telefono. Sulla card va solo il
     link: nessun dato personale.» e nel footer il pulsante secondario «Salta, lo scrivo più tardi» (è il
     «Più tardi» del punto 8 durante la scrittura); link scritto → `navigate('/clienti/:id', { replace: true })` (Scheda cliente, come nelle tavole) con messaggio
     `role="status"` «Card …A1B2 associata»; scrittura non riuscita → resta sulla pagina con l'esito del
     punto 8, tavola "Associa-link-errore" («Scrivi di nuovo il link» / «Più tardi»); «Salta, lo scrivo più
     tardi», «Più tardi» o dispositivo che non scrive →
     `/clienti/:id` (Scheda cliente) con «Card …A1B2 associata. Link non scritto.»;
   - **card di un altro cliente** (wireframe "Card già di un altro cliente"): riquadro, nota e footer
     lasciano il posto all'avviso `role="alert"` (restano intestazione e riga cliente): «Card già
     associata» · «Questa card è di Antonio Esposito. Una card può essere di un solo cliente: usa un'altra
     card.» · «Riprova con un'altra card» (torna in lettura; in questo stato le letture sono ignorate) ·
     «Apri la scheda di Antonio» → `/clienti/<id di Antonio>`. Se quella card è disattivata: «Questa card
     era di Antonio Esposito. Una card può essere di un solo cliente: usa un'altra card.». Se il
     proprietario è anonimizzato: «Questa card era di un cliente i cui dati sono stati cancellati. Una card
     può essere di un solo cliente: usa un'altra card.» senza «Apri la scheda»;
   - **è già la card attiva di questo cliente** → «Questa è già la card attiva di Maria.», nessuna modifica
     della card; se il suo link non è scritto parte subito la scrittura (punto 8), altrimenti sotto il
     messaggio c'è «Scrivi di nuovo il link» (card con il link rovinato o riscritta da altri);
   - **card disattivata dello stesso cliente** (ritrovata) → si riattiva e l'eventuale card attiva si
     disattiva, con lo stesso esito di una riuscita (il vecchio link è morto con la disattivazione: se ne
     scrive uno nuovo);
   - salvataggio in corso: «Associazione in corso…», letture ignorate;
   - **dispositivo che non scrive** (`canWrite` falso: iPhone, NFC spento dopo la lettura): l'associazione
     si salva lo stesso e l'esito è quello di «Più tardi»; sul tablet (lettore USB, `tablet-kiosk`) è
     sempre così: il link si scrive poi da un telefono Android, da Modifica cliente;
   - errore di rete → «Card non associata: controlla la connessione.» con «Riprova» che rimanda lo stesso
     uid (operazione idempotente, vedi sotto);
   - lettura non disponibile (NFC spento, permesso negato, iPhone) → stati di `CardReadPanel` nel riquadro;
   - cliente anonimizzato (`customer_anonymized`) → `StatusView` errore «Questo cliente non può avere una
     card.»; inesistente (`customer_not_found`) → pagina non trovata di `customers`.
5. **Sezione CARD di Modifica cliente** (`/clienti/:id/modifica`, wireframe "Modifica cliente"):
   - con card attiva: «Card attiva …E5F6 · dal 3 nov» (data di associazione o di riattivazione, fuso
     `Europe/Rome`; anno aggiunto se diverso dal corrente), pulsanti «Sostituisci card» →
     `/clienti/:id/card` e «Disattiva card»;
   - stato del link sotto la riga della card (`LinkState`, da `link_written_at` e `link_pending_at`):
     `written` «Link ai punti scritto» e pulsante secondario «Scrivi di nuovo il link»; `not-written` avviso
     «Link non scritto: il cliente non può ancora vedere i suoi punti con la card.» e pulsante «Scrivi il
     link»; `unverified` (una riscrittura è partita dopo l'ultimo link verificato e non è stata
     confermata: la card potrebbe contenere un link che non vale) avviso «Link da controllare: l'ultima
     scrittura non è stata verificata, la card potrebbe non mostrare i punti.» e pulsante «Scrivi di nuovo
     il link». Entrambi aprono la scrittura del
     punto 8 nella sezione, con passo iniziale «Avvicina la card …E5F6» (la card va riconosciuta prima di
     scrivere). Se il dispositivo non scrive (`canWrite` falso) il pulsante non c'è e al suo posto: «Per
     scrivere il link serve un telefono Android con l'NFC attivo.»;
   - senza card attiva: «Nessuna card attiva» e pulsante «Associa card» → `/clienti/:id/card`;
   - «Disattiva card» apre `ConfirmDialog`: «Disattivare la card …E5F6?» · «La card non aprirà più la
     scheda di Maria e il suo link non mostrerà più i punti. I punti restano a Maria.» · «Disattiva card»
     (danger) / «Lascia com'è». Esito: la
     sezione passa a «Nessuna card attiva»; errore di rete → messaggio e «Riprova» (idempotente);
   - la sezione si aggiorna senza salvare il form: card e dati anagrafici si salvano separatamente;
   - errore di caricamento della card → riga «Card non caricata» con «Riprova»; il resto del form resta
     usabile.
6. **Scheda cliente** (wireframe "Scheda cliente"): la riga sotto il nome mostra «Card attiva …E5F6» o
   «Senza card» (stesso stile di «Senza telefono» della home), seguito da « · » e dalla parte telefono di
   `customers` («Tel. 333 ••• 4521» o «Senza telefono»). Cliente anonimizzato: la riga resta quella di
   `customers`, senza parte card.
7. **Cliente anonimizzato**: un trigger di questo modulo disattiva la card attiva quando `customers`
   imposta `anonymized_at`; l'uid resta legato a quel cliente e non si riusa mai. Con la disattivazione
   il link della card smette di funzionare (token cancellato, vedi "Modello dati").
8. **Scrittura del link** (`CardLinkWriter`, una sezione riusata dai punti 2, 3, 4 e 5; la scrittura vera è
   `useCardWriter().writeUrl` di `card-input`). Parte solo dopo che il server ha confermato
   l'associazione, sulla card associata (`expectedUid` = suo uid):
   1. `app.issue_card_link(card_id)` → token nuovo (solo in memoria, mai salvato nel browser, nei log o a
      schermo); URL = `cardLinkUrl(token)` = `${CARD_LINK_ORIGIN}/s/${token}`;
   2. `writeUrl(url, { expectedUid, signal })`, con i passi mostrati nella sezione (`aria-live="polite"`):
      `waiting-card` «Avvicina la card …E5F6», `writing` «Tieni la card appoggiata» · «Scrivo il link per
      vedere i punti…» (tavola "Associa-link"), `verifying` «Controllo del link: allontana la card e
      riavvicinala»; pulsante secondario «Salta, lo scrivo più tardi» (il «Più tardi» della scrittura in
      corso: interrompe con il `signal`) sempre disponibile;
   3. verifica riuscita → `app.confirm_card_link(card_id, token)`: solo ora il link funziona (prima il token
      è "in attesa" e la pagina pubblica non lo riconosce); esito «Link scritto: il cliente può vedere i
      suoi punti avvicinando la card al suo telefono.»;
   4. esiti non riusciti (`role="alert"`, «Scrivi di nuovo il link» primario e «Più tardi» secondario):
      `timeout` o `io` come nella tavola "Associa-link-errore": titolo «Link non scritto» · «La card è
      associata a Maria e funziona alla cassa. Il link per vedere i punti non è stato scritto: la card si è
      staccata troppo presto.» e, sotto l'avviso, «Puoi scriverlo anche dopo, da Modifica cliente.»; `wrong-card` «Questa non
      è la card …E5F6: il link non è stato scritto.»; `verify-failed` «Il link sulla card non risulta
      giusto. Riprova.»; `not-allowed` «Il telefono non permette di scrivere la card: controlla il
      permesso NFC di Chrome.»; `cannot-write` come dispositivo che non scrive (punto 4); errore di rete su
      `issue_card_link` «Link non scritto: controlla la connessione.». «Scrivi di nuovo il link»
      ricomincia dal passo 1 (token nuovo: quello vecchio in attesa non vale più); `card_inactive`
      (card disattivata nel frattempo da un altro operatore) → «Questa card non è più attiva.» senza
      «Scrivi di nuovo il link»;
      - errore di rete su `confirm_card_link` (la card è già scritta e verificata): «Link scritto ma non
        registrato: controlla la connessione.» con **«Riprova»** che rimanda `confirm_card_link` con lo
        **stesso** token ancora in memoria (idempotente), senza riavvicinare la card; «Più tardi» lascia il
        link `unverified` (il token in attesa si perde con la pagina);
      - `wrong-card` con `otherUid` (lo scrittore ha visto, durante la scrittura o la verifica, un'altra card
        che potrebbe aver ricevuto il link): «Il link potrebbe essere finito sulla card …ABCD. Avvicina la
        card …E5F6 e riprova; poi riscrivi il link della card …ABCD dalla scheda del suo cliente.» (il
        token in attesa non vale mai per nessuna card finché non è verificato su …E5F6, quindi la card
        sbagliata non mostra il saldo di Maria: al più ha perso il proprio link);
      - `unreadable` (la card risponde ma il suo contenuto non si legge, per esempio dopo una scrittura
        interrotta o una riscrittura con un'altra app: Chrome non dà nemmeno l'uid): «La card non si legge.
        È la card …E5F6? Puoi riscriverla.» con «Scrivi comunque» (nuovo tentativo con
        `allowUnreadable: true`, vedi `card-input` punto 9; la verifica richiede comunque l'uid giusto) e
        «Più tardi». Alla cassa una card così non si legge: si cerca il cliente per nome;
   5. una riscrittura non riuscita su una card che aveva già il link lascia valido il link precedente (il
      nuovo token resta in attesa e non vale), ma la card potrebbe non contenerlo più: per questo l'esito
      chiede comunque di riprovare e, se si rimanda, Modifica cliente mostra `unverified`;
   6. `CARD_LINK_ORIGIN` = `import.meta.env.VITE_CARD_LINK_ORIGIN` (origine `https://…` senza percorso né
      `/` finale, controllata all'avvio) oppure, se assente, `location.origin`. In produzione è obbligatoria:
      la build fallisce se `VERCEL_ENV === 'production'` e la variabile manca o non è `https:` (tutte le
      card scritte dipendono da quell'indirizzo). Nelle anteprime vale `location.origin` (database di
      staging): una card scritta da un'anteprima porta un link che in produzione non vale, quindi le card
      dei clienti si scrivono solo dall'app di produzione (RUNBOOK);
   7. spazio sulla card: l'URL è di circa 55–60 caratteri (`https://<progetto>.vercel.app/s/` + 22), cioè un
      messaggio NDEF di circa 60 byte con il prefisso `https://` compresso (al più ~70 senza): l'NTAG215 ha
      504 byte utili (anche un NTAG213 da 144 basterebbe). `card-input` rifiuta URL oltre 200 caratteri.
9. **Pagina pubblica dei punti** (`/s/:token`, `CardPointsPage`; tavole "Saldo-punti" e
   "Saldo-card-non-attiva", Open Question 15):
   - rotta **fuori da `RequireAuth`** e da `AppShell`: niente accesso, niente `CardReaderSession` (nessuna
     lettura card), nessun link verso le schermate degli operatori; funziona anche se sul telefono c'è una
     sessione di un operatore, e non la usa;
   - rotta caricata con `lazy` (il cliente non scarica le schermate degli operatori); token controllato nel
     client (`^[A-Za-z0-9_-]{22}$`): se non valido, messaggio neutro **senza** chiamata;
   - legge `public.card_points(p_token)` con la chiave anon (`getSupabase().schema('public').rpc(…)`, che
     manda il token nel corpo di una `POST`, non nell'URL della richiesta; mai `{ get: true }`); se sul
     telefono c'è la sessione di un operatore la richiesta porta il suo JWT e la risposta è identica;
   - caricamento «Carico i tuoi punti…»; timeout 8 s come errore di rete;
   - numero → tavola "Saldo-punti": logo Enjoy del design system in alto (`alt` «Bar Enjoy Gaeta»),
     riquadro verde con il titolo «ENJOY YOUR POINTS» (`lang="en"`), il saldo grande
     (`Intl.NumberFormat('it-IT')`, stile `figure` del design system, Enjoy Display) e «punti» («punto» se
     1); sotto il riquadro «Mostra la card alla cassa per usare i tuoi punti.» e, più piccolo, «Questa
     pagina mostra solo i punti della card, senza dati personali.»; piè di pagina «Enjoy Bar · Gaeta»;
     nessun nome, nessun altro dato;
   - `null` (token sconosciuto, malformato, in attesa, di una card disattivata o di un cliente anonimizzato:
     sempre lo stesso) → tavola "Saldo-card-non-attiva": icona card, «Card non attiva» · «Questa card non
     mostra punti. Chiedi al bar.», con lo stesso logo e lo stesso piè di pagina; il testo non dice se il
     link è esistito;
   - errore di rete → «Non riesco a caricare i punti. Controlla la connessione.» con «Riprova»;
   - `<meta name="robots" content="noindex, nofollow">` aggiunto dalla pagina; il token non si salva
     (niente `localStorage`, niente log, niente strumenti di analisi) e non compare nel titolo della pagina;
   - stile: token del design system "Enjoy Bar", testi in italiano, numero leggibile a colpo d'occhio su
     un telefono qualsiasi (anche iPhone: la pagina non usa nulla di Web NFC); contrasto AA, leggibile a
     320 px;
   - **niente PWA per il cliente**: su `/s/…` l'app non registra il service worker (oggi `registerSW.js` lo
     registra su ogni pagina: diventa una registrazione in `main.tsx` che salta i percorsi `/s/`, con
     `injectRegister: false`) e annulla `beforeinstallprompt` (`preventDefault()`), così il telefono del
     cliente non scarica in cache tutta l'app e Chrome non gli propone di installare "Enjoy Card";
   - il token è solo nel percorso della pagina: nessun gestore d'errore, `ErrorBoundary` o log dell'app
     registra `location.href`, e l'app non ha strumenti di analisi (Vercel Web Analytics e Speed
     Insights restano spenti: manderebbero il percorso con il token).

Etichetta della card: `formatCardLabel(uid)` → «…» + ultimi 4 caratteri dell'uid. Nome breve nei testi
(«a Maria», «di Antonio»): prima parola del nome, come nei wireframe. Le card si leggono solo su `/`,
`/clienti/nuovo` e `/clienti/:id/card` (consumatori di `useCardRead`) e durante una scrittura del link
(punto 8, anche in Modifica cliente); altrove le letture le scarta `card-input`.

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
link_written_at timestamptz null                       -- link ai punti scritto e verificato
link_written_by uuid null references app.operators(id)
link_pending_at timestamptz null                       -- ultima emissione non ancora confermata (non segreto)
check ((active and deactivated_at is null) or (not active and deactivated_at is not null))
check ((link_written_at is null) = (link_written_by is null))
check (active or (link_written_at is null and link_pending_at is null))  -- card disattivata = link morto
create unique index cards_one_active_per_customer on app.cards (customer_id) where active;

-- private.card_links: il segreto del link, fuori dallo schema esposto dall'API
card_id           uuid primary key references app.cards(id)
token_hash        bytea null unique check (octet_length(token_hash) = 32)   -- link valido (sha256)
pending_hash      bytea null unique check (octet_length(pending_hash) = 32) -- emesso, non verificato
pending_issued_at timestamptz null
pending_issued_by uuid null references app.operators(id)
check ((pending_hash is null) = (pending_issued_at is null) and (pending_hash is null) = (pending_issued_by is null))
```

**Perché una tabella a parte e non una colonna `balance_token` in `app.cards`**: `app.cards` è leggibile da
ogni operatore (policy `select`) e finisce in letture, servizi e export; una colonna segreta lì andrebbe
nascosta con privilegi di colonna, fragili con `select *` e PostgREST. `private` non è esposto dall'API e non
ha `grant`: il token lo toccano solo le funzioni `security definer` qui sotto. Inoltre si salva solo
l'**impronta sha256** del token: chi legge il database (SQL Editor, backup) non può ricostruire i link. Un
hash veloce senza sale basta perché il token ha 128 bit casuali (non è una password da indovinare). La
riga separata permette anche il token "in attesa": vale solo dopo che la card è stata riletta, quindi una
scrittura finita sulla card sbagliata o non verificata non pubblica mai il saldo di nessuno.
In `app.cards` resta solo lo stato non segreto (`link_written_at`, `link_written_by`, `link_pending_at`) che
serve alle schermate: `LinkState` = `not-written` se `link_written_at` è null, `unverified` se
`link_pending_at > link_written_at`, altrimenti `written`. `link_pending_at` sta anche in `private.card_links`
come `pending_issued_at`: le due si scrivono insieme nelle stesse RPC.

**Token**: `extensions.gen_random_bytes(16)` (pgcrypto, già nello schema `extensions` di Supabase), 128 bit,
in base64url senza `=` (`rtrim(translate(encode(b, 'base64'), '+/', '-_'), '=')`): 22 caratteri
`[A-Za-z0-9_-]`, non sequenziale, senza legami con uid, id o date. Generato solo sul server. L'impronta è
sempre `extensions.digest(convert_to(token, 'UTF8'), 'sha256')` del testo di 22 caratteri, identica in
`issue_card_link`, `confirm_card_link` e `card_points` (una funzione `private.card_token_hash(text)`).

- **Lettura**: policy `select` `to authenticated using ((select private.is_active_operator()))`.
  **Scrittura**: nessuna dall'API (`revoke insert, update, delete, truncate on app.cards from
  authenticated`); solo tramite le RPC. `private.card_links`: RLS attiva, nessuna policy, nessun `grant`
  (`revoke all … from public, anon, authenticated`).
- Trigger `before update`: `uid` e `customer_id` non cambiano mai; `associated_at` e `associated_by`
  cambiano solo nella riattivazione (`active` da false a true); `before delete`: sempre rifiutato.
  `link_written_at`, `link_written_by` e `link_pending_at` cambiano solo da `app.issue_card_link`
  (`link_pending_at`), `app.confirm_card_link` o con la disattivazione: quando `active` passa da true a
  false il trigger `before update` li azzera e un trigger
  `after update` cancella la riga di `private.card_links` (token e token in attesa): **qualsiasi**
  disattivazione — sostituzione in `associate_card`, `deactivate_card`, anonimizzazione — uccide il link
  della vecchia card. Una riattivazione riparte da "link non scritto" (token nuovo, punto 4).
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
  - `app.issue_card_link(p_card_id uuid) returns text` (volatile): blocca la riga della card (`for
    update`); inesistente → `card_not_found`; disattivata → `card_inactive`. Genera un token, salva
    `sha256(token)` in `pending_hash` (insert o update della riga di `private.card_links`, il token in
    attesa precedente viene sostituito), `pending_issued_at = now()`, `pending_issued_by` = chi agisce, e
    `app.cards.link_pending_at` allo stesso istante;
    restituisce il token in chiaro, **unica volta** in cui esce dal server. Non tocca `token_hash`: il link
    già scritto resta valido finché il nuovo non è confermato. Ripeterla dopo un errore di rete emette solo
    un altro token in attesa: nessun effetto doppio, quindi niente `operation_id` (come Open Question 9).
  - `app.confirm_card_link(p_card_id uuid, p_token text)` → riga della card: blocca la card; inesistente →
    `card_not_found`; disattivata → `card_inactive`; `sha256(p_token)` uguale a `token_hash` → nessuna
    modifica, restituisce la riga (reinvio idempotente); uguale a `pending_hash` → `token_hash :=
    pending_hash`, campi in attesa a null (anche `app.cards.link_pending_at`), `link_written_at = now()`,
    `link_written_by` = chi agisce;
    altrimenti (token sbagliato o sostituito da un'emissione più recente) → `link_token_mismatch`. Nessun
    messaggio d'errore, `raise` o log contiene `p_token`, l'impronta o l'uid. Il
    vecchio `token_hash` sostituito smette di valere nello stesso istante (rotazione).
  - **`public.card_points(p_token text) returns integer`** — l'unica funzione per i non autenticati:
    `language plpgsql stable security definer set search_path = ''`; `revoke execute … from public`,
    `grant execute … to anon, authenticated`. Sta in `public` perché `app` non è usabile da `anon`
    (`revoke all on schema app from public, anon` dell'init) e `public` è già esposto dall'API. Corpo:
    1. `set_config('response.headers', '[{"Cache-Control": "no-store"}]', true)` (PostgREST lo trasforma
       in intestazione: la risposta non resta in cache né nel browser né in proxy);
    2. `p_token` null o diverso da `^[A-Za-z0-9_-]{22}$` → `null`;
    3. cerca `token_hash = sha256(convert_to(p_token, 'UTF8'))` (indice unico) con card `active` e cliente
       con `anonymized_at is null`; nessuna riga → `null`; i token in attesa non contano;
    4. restituisce `private.customer_balance(customer_id)` di `ledger`, l'unico calcolo del saldo (nessuna
       funzione di saldo parallela). Finché `ledger` non è unito (`to_regprocedure('private.customer_balance(uuid)')`
       è null) restituisce `0`, come `customer_summary.balance` di `customers` prima di `ledger`: senza
       movimenti il saldo è zero. `ledger` non deve cambiare nulla.
    Risposta **sempre della stessa forma**: un intero o `null`, mai un errore, mai altri campi (niente
    nome, id, uid, date); nessuna differenza tra token mai esistito, in attesa, di card disattivata o di
    cliente anonimizzato. Non scrive nulla e non registra nulla.
- **Abuso della funzione pubblica.** Postgres non può limitare la frequenza delle chiamate, e la chiave
  anon è pubblica per definizione. Indovinare un link è inutile: con 128 bit e qualche centinaio di card
  attive la probabilità per tentativo è circa 10⁻³⁶; anche un miliardo di tentativi al secondo per cento
  anni non arriva a 10⁻¹⁸. Per questo il token non usa mai l'uid (leggibile da chiunque con un telefono)
  né valori sequenziali. Resta il rischio generico di traffico eccessivo verso il piano gratuito, uguale a
  quello di qualsiasi endpoint pubblico di Supabase: fuori perimetro, si osserva nella dashboard. Il token
  non finisce in referrer (`Referrer-Policy: no-referrer` già in `vercel.json`), né nella cache
  (`Cache-Control: no-store` sulla risposta della funzione e sulla pagina), né nei motori di ricerca
  (`noindex`). Compare invece nei log di accesso di Vercel come percorso `/s/…`: chi li legge vede al più
  un saldo, come un operatore. I log delle API di Supabase registrano percorso e intestazioni, non il corpo
  della `POST`, quindi il token non ci finisce. Il tempo di risposta può differire tra token valido e non
  valido: per accorgersene servirebbe già un token valido, quindi non aiuta a indovinarne uno.
- **Card scritta sul telefono del personale.** Mentre l'app è in primo piano con la lettura `active`,
  Chrome tiene l'NFC per sé (modalità lettore di Android) e la card arriva solo a `card-input`: in home apre
  Registra spesa, la pagina non cambia. Se invece la lettura non è attiva (app chiusa o in background,
  `/accedi`, stati `needs-permission`, `off`, `denied`, `checking`), Android gestisce la card da sé e apre il
  link: nel browser, o nell'app installata (il suo `scope` `/` comprende `/s/`), che lascia la schermata in
  corso e mostra la pagina dei punti; si torna indietro con il tasto Indietro di Android. Nessun dato in più
  esce: l'operatore vede già il saldo. Effetto collaterale: il link entra nella cronologia di quel telefono.
  Verifica manuale nel RUNBOOK (Open Question 21).
- **Card riscritta da altri.** Le card non sono bloccate: chiunque con un'app NFC può sovrascriverle, anche
  con un indirizzo falso che imita la pagina dei punti. Alla cassa l'uid continua a funzionare; il link si
  ripara con «Scrivi di nuovo il link». Il rischio resta finché le card non sono bloccate (Open Question 19).
- **Intestazioni** (`vercel.json`, aggiunte da questo modulo): per `/s/(.*)` `Cache-Control: no-store` e
  `X-Robots-Tag: noindex, nofollow` (oggi nel repo non c'è nessun `noindex`). Il service worker serve la
  stessa `index.html` per la navigazione, ma non mette in cache le risposte di Supabase (nessuna cache a
  runtime), quindi il saldo arriva sempre dal server.
- Gli errori sono `raise exception` con `errcode 'P0001'` e codice nel messaggio (come `customers`); il
  servizio frontend li traduce in errori tipizzati (`CardTakenError`, `CustomerUnavailableError`,
  `NetworkError`, …).
- I movimenti non dipendono dalla card: sostituirla, disattivarla o scriverne il link scrive solo su
  `app.cards` e `private.card_links` e non tocca saldo né storico.
- **Deviazioni dal contratto**: `CONTRACT.md` fissa la tabella ma nessuna RPC delle card; le RPC sopra,
  le colonne `link_written_*` e `link_pending_at`, `private.card_links`, `private.card_token_hash`, `public.card_points` e la rotta pubblica `/s/:token`
  sono aggiunte di questo modulo, e `create_customer_with_card` dipende dalla firma di
  `app.create_customer` di `customers`. Codici d'errore allineati a `customers` (`not_operator`,
  `customer_not_found`, `customer_anonymized`); nuovi `card_inactive` e `link_token_mismatch`. Su
  `not_operator` ogni schermata del modulo chiama `reportNotEnabled()` di `AuthProvider` (account tolto
  durante l'uso, nota n6); la pagina pubblica non ha errori di ruolo.

## Commands

Nessun comando nuovo (`npm test`, `npm run test:integration`, `npm run db:test`, `npm run e2e`). Variabile
nuova `VITE_CARD_LINK_ORIGIN` in `.env.example` (vuota in locale e nelle anteprime; in produzione l'origine
definitiva dell'app, impostata su Vercel solo per l'ambiente Production; il controllo di build usa
`VERCEL_ENV`, che Vercel imposta da solo).

## Project Structure

```
src/features/cards/           → CardsService (tipi), supabaseCardsService, formatCardLabel,
                                 useHomeCardRead, NewCustomerCardPanel, AssociateCardPage,
                                 CustomerCardSection (Modifica cliente), CardSummary (Scheda),
                                 CardLinkWriter, cardLinkUrl (+ controllo di VITE_CARD_LINK_ORIGIN),
                                 PurchasePlaceholderPage (finché non c'è ledger)
src/features/cards/public/    → CardPointsPage (/s/:token), cardPointsService (solo public.card_points)
src/test/fakeCardsService.ts  → servizio in memoria per i test dei componenti (simula errori di rete)
supabase/migrations/          → *_cards.sql (tabella, indici, trigger, RPC, policy, grant)
supabase/seed.sql             → una card finta (es. 04AABBCCDDEE01) su un cliente finto del seed, con
                                 link non scritto (nessun token nel seed: il repo è pubblico)
supabase/tests/cards.test.sql → pgTAP
e2e/cards.spec.ts             → flussi con window.__enjoyFakeCard(uid) e window.__enjoyFakeCardWrites
e2e/card-points.spec.ts       → pagina pubblica /s/:token senza accesso
modificati: vercel.json (intestazioni di /s/(.*)), vite.config.ts (controllo di VITE_CARD_LINK_ORIGIN con
  VERCEL_ENV=production; injectRegister: false), main.tsx (registrazione del service worker tranne su /s/),
  router (rotta /s/:token fuori da RequireAuth, lazy), .env.example
```

## Code Style

Come `platform` e `identity`: i componenti usano solo `CardsService` (mai `getSupabase()`), l'uid arriva
sempre da `useCardRead` di `card-input` (già normalizzato) o da `normalizeUid(…, 'hex')` per il parametro
`?card`; testi in italiano, identificatori in inglese.

```ts
export type LinkState = 'written' | 'not-written' | 'unverified'; // da link_written_at e link_pending_at

export type CardLookup =
  | { status: 'unknown' }
  | { status: 'active' | 'inactive'; cardId: string; customerId: string; customerName: string }
  | { status: 'anonymized'; cardId: string; customerId: string };

export function formatCardLabel(uid: string): string {
  return `…${uid.slice(-4)}`; // "04A1B2C3D4E5F6" → "…E5F6"
}

export function cardLinkUrl(token: string): string {
  return `${CARD_LINK_ORIGIN}/s/${token}`; // token: 22 caratteri base64url, mai l'uid
}
```

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP (`cards.test.sql`) | RLS: `anon` e utente senza profilo non leggono `cards` e non eseguono nessuna RPC (`not_operator` o permesso negato); `authenticated` non scrive direttamente; vincolo uid (minuscolo, separatori, lunghezza dispari, 7 e 11 byte rifiutati); trigger rifiutano cambio di `uid`/`customer_id`, cambio di `associated_by` fuori dalla riattivazione e delete; `associate_card` per operatore e admin con `associated_by` = operatore chiamante, sostituzione (vecchia `active=false`, `deactivated_at` impostato, `replaced_card_id`), `card_taken` per uid di altro cliente (attivo, disattivato, anonimizzato → `owner_name` null), ripetizione idempotente, riattivazione della propria card (`associated_at` aggiornato, l'altra disattivata), `customer_not_found`, `customer_anonymized`, `invalid_uid`; indice: due card attive sullo stesso cliente impossibili; `lookup_card` nei casi sconosciuta/attiva/disattivata/anonimizzata (nome null) e `invalid_uid`; `deactivate_card` idempotente e `card_not_found`; `create_customer_with_card`: crea cliente e card, stesso `operation_id` due volte → un cliente e una card, `card_taken` e `customer_name_taken` non lasciano né cliente né card; anonimizzazione disattiva la card; sostituzione e disattivazione non modificano righe fuori da `app.cards` e `private.card_links`. **Link**: `issue_card_link` dà 22 caratteri `[A-Za-z0-9_-]`, due chiamate danno token diversi, in `private.card_links` c'è solo l'impronta (nessuna colonna contiene il token in chiaro), `card_not_found`, `card_inactive`, `not_operator` per `anon` e utente senza profilo; `confirm_card_link`: token in attesa → `link_written_at`/`link_written_by` valorizzati e `card_points` lo riconosce, stesso token due volte → idempotente, token più vecchio dopo una nuova emissione → `link_token_mismatch`, rotazione (dopo la conferma del nuovo, il vecchio dà `null`); token solo in attesa → `card_points` dà `null`; sostituzione, `deactivate_card` e anonimizzazione → `link_written_at` null, riga di `card_links` cancellata, vecchio token → `null`; riattivazione → link non scritto e vecchio token ancora `null`; `link_pending_at` impostato da `issue`,
azzerato da `confirm` e dalla disattivazione, e uguale a `pending_issued_at`; nessun messaggio d'errore delle
tre funzioni contiene il token; `card_points` come `anon`: token valido → intero (0 senza movimenti; con `ledger` unito, uguale a `private.customer_balance`), token sconosciuto, malformato (21/23 caratteri, `+`, `/`, null) → `null` senza errore; `anon` non legge `private.card_links` né `app.cards` e non esegue `issue_card_link`/`confirm_card_link`; `has_function_privilege('anon', 'public.card_points(text)', 'execute')` vero e `prosecdef` vero con `search_path` vuoto; **allowlist**: in `public` l'insieme delle funzioni eseguibili da `anon` è esattamente `{card_points(text)}` (i privilegi predefiniti di Supabase danno `execute` ad `anon` su ogni nuova funzione di `public`: il test blocca le aggiunte involontarie) e `function_privileges.test.sql` resta verde per `app` e `private` |
| Integrazione (Vitest + stack locale, `npm run test:integration`) | due associazioni concorrenti dello stesso uid a clienti diversi: una riesce, l'altra `card_taken`; due associazioni concorrenti di uid diversi allo stesso cliente: alla fine una sola card attiva; `supabaseCardsService` traduce i codici d'errore (anche `card_inactive`, `link_token_mismatch`); `card_points` chiamata via HTTP con la chiave anon: risposta con `Cache-Control: no-store`, corpo solo numero o `null`, stessa forma per token mai esistito e di card disattivata |
| Componenti (Vitest + `fakeCardsService`, `fakeCustomerService`, adattatore card finto) | home: attiva → `/clienti/:id/spesa`, sconosciuta → `/clienti/nuovo?card=`, disattivata e anonimizzata → avvisi (nessun nome nel secondo), letture ignorate durante la ricerca, rete → «Riprova»; Nuovo cliente da card: riquadro «Card letta» con uid completo, `?card` non valido ignorato, salvataggio → `replace` su `/clienti/:id/spesa`, `card_taken` → avviso e «Continua senza card», reinvio dopo errore di rete con lo **stesso** `operation_id`; Nuovo cliente senza card: lettura sconosciuta/nota; Associa card: tutti gli stati del punto 4 e testi dei wireframe (nota sulla card attuale solo se c'è); Modifica cliente con e senza card, dialogo di disattivazione, errore di caricamento; riga della Scheda cliente; `formatCardLabel`; `cardLinkUrl` (origine da variabile o `location.origin`, origine con percorso o `http:` rifiutata). `CardLinkWriter` con uno scrittore finto: passi e testi, link scritto → `confirm_card_link` chiamata una volta con lo stesso token, ogni esito non riuscito con i suoi testi, «Scrivi di nuovo il link» → nuova `issue_card_link`, «Salta, lo scrivo più tardi» interrompe la scrittura, rete su `issue`/`confirm`, `card_inactive`, `canWrite` falso → niente pulsante e testo del dispositivo; il token non compare nel DOM; Nuovo cliente e Associa card: scrittura dopo il salvataggio e navigazione anche con «Più tardi»; Modifica cliente: «Link non scritto» / «Scrivi il link» e «Link ai punti scritto» / «Scrivi di nuovo il link». `CardPointsPage`: numero formattato, «punto»/«punti», `null` → messaggio neutro, token malformato → messaggio neutro senza chiamata, timeout 8 s → «Riprova», nessun nome, `meta robots` presente, nessuna scrittura in `localStorage`, nessuna attesa di `AuthProvider`, `beforeinstallprompt` annullato. `CardLinkWriter`: rete su `confirm` → «Riprova» rimanda lo **stesso** token senza nuova `issue` né nuova scrittura; `wrong-card` con `otherUid` → testo con le due card; `unreadable` → «Scrivi comunque» → `writeUrl` con `allowUnreadable: true`. Modifica cliente nei tre `LinkState`. Registrazione del service worker saltata su `/s/…` |
| E2E (Playwright 390×844, Supabase locale, `window.__enjoyFakeCard`; dati e uid creati dal test con nomi univoci, rieseguibile) | card sconosciuta → Nuovo cliente con codice → Salva → `/clienti/:id/spesa` con il nome del cliente; card nota → stessa pagina entro 2 s; Sostituisci card → la vecchia letta in home mostra «Card disattivata»; card di un altro cliente → «Card già associata» → «Apri la scheda di …»; Disattiva card → «Nessuna card attiva»; target touch ≥ 48 px. **Link**: card sconosciuta → Salva → «Avvicina la card …» (il form ha richiesto più di 1,5 s: il test riappoggia la card con `__enjoyFakeCard(uid)`) → scrittura finta → `__enjoyFakeCardWrites` ha una voce per quell'uid con URL `…/s/[A-Za-z0-9_-]{22}` che non contiene l'uid → in un contesto del browser **senza accesso** l'URL mostra «ENJOY YOUR POINTS» e `0`, nessun nome; Sostituisci card → il link della vecchia mostra «Card non attiva», quello della nuova il saldo; `failNextWrite('io')` → «Link non scritto…» → «Più tardi» → Modifica cliente con «Link non scritto» → «Scrivi il link» + `__enjoyFakeCard(uid)` → «Link ai punti scritto»; `setCanWrite(false)` → associazione salvata con link non scritto e nessuna voce nel registro; `/s/` con token inventato → messaggio neutro; sulla pagina pubblica le sole richieste a Supabase sono `rpc/card_points` in `POST` e nessuna URL di richiesta contiene il token; nessuna registrazione di service worker su `/s/…`; il percorso card nota → Registra spesa non produce voci nel registro delle scritture. Le intestazioni di `/s/(.*)` (`Cache-Control: no-store`, `X-Robots-Tag`) non si provano in locale (`vercel.json` vale solo su Vercel): le controlla un test Vitest che legge `vercel.json` e una verifica con `curl -I` sull'anteprima, annotata nel RUNBOOK |

Test scritti prima del codice (TDD). Solo dati finti (`@example.com`, nomi e uid inventati).

## Boundaries

- **Always**: ogni controllo (ruolo, unicità, una card attiva, validità del token) sul server; uid sempre
  normalizzato; operazioni ripetibili senza effetti doppi; token generati solo sul server, salvati solo come
  impronta, validi solo dopo la verifica sulla card; link scritto solo dopo l'associazione confermata;
  disattivazione = link morto; la pagina pubblica mostra solo il numero dei punti.
- **Ask first**: cancellare righe di `cards`; permettere di spostare un uid su un altro cliente; limitare le
  azioni sulle card ai soli amministratori; mostrare lo storico delle card; rendere le card di sola lettura
  (`makeReadOnly()`, irreversibile); mostrare sulla pagina pubblica qualcosa oltre al saldo (nome, premi,
  movimenti); cambiare `VITE_CARD_LINK_ORIGIN` dopo il lancio (rende inutili i link già scritti).
- **Never**: riusare un uid per un altro cliente; usare l'uid (o id, date, contatori) come token o dentro il
  link; esporre il token agli operatori oltre al passaggio che lo scrive (niente schermate, log, export,
  `localStorage`); salvare il token in chiaro; restituire dalla funzione pubblica qualcosa di diverso da un
  intero o `null`, o una risposta che distingua i casi di `null`; contattare i clienti (il link lo apre il
  cliente); chiave service role nell'app; uid, token o nomi reali in test, seed o log; registrare gli uid o
  gli URL dei link nei log.

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
10. Dopo un'associazione su Android il link è scritto e verificato senza altri tocchi oltre a tenere la
    card appoggiata (o riavvicinarla una volta); il link aperto da un telefono non collegato mostra solo
    «ENJOY YOUR POINTS» e il saldo; su iPhone XS o successivo la card apre la pagina senza app (verifica
    manuale, RUNBOOK).
11. Sostituire, disattivare o anonimizzare rende il vecchio link indistinguibile da un link inventato
    (pgTAP + E2E); un token emesso ma non verificato non mostra mai punti.
12. `anon` esegue soltanto `public.card_points`, che non restituisce mai altro che un intero o `null` e
    risponde con `Cache-Control: no-store`; `private.card_links` non contiene token in chiaro.
13. Un'associazione da un dispositivo che non scrive (iPhone, tablet) va a buon fine con «Link non scritto»,
    e il link si scrive dopo da Modifica cliente su un Android.
14. Il percorso card → Registra spesa non scrive la card e non chiama `issue_card_link`; con la lettura attiva
    in primo piano, una card con il link scritto apre Registra spesa e non il browser (E2E per il primo,
    verifica manuale nel RUNBOOK per il secondo).
15. Una scrittura riuscita ma non confermata (rete, verifica mancata, «Più tardi») lascia la card
    `unverified` in Modifica cliente, mai `written`.

## Out of Scope (Deferred)

- Lettura NFC, permesso, NFC spento, normalizzazione dell'uid, lettore USB, `CardReadPanel`: modulo
  `card-input`.
- Form cliente, ricerca, SERVITI OGGI, anonimizzazione: `customers`. Registra spesa (tastierino, conferma,
  «Riscatta premio») e saldo: `ledger`, che sostituisce il segnaposto di `/clienti/:id/spesa`.
- Schermata tablet "Associa card": `tablet-kiosk` (associa senza scrivere: la card resta "link non
  scritto" e il link si scrive poi da un telefono Android). Storico delle card di un cliente: non richiesto.
- Blocco delle card in sola lettura: escluso per ora dal titolare. Messaggi, notifiche o qualsiasi contatto
  con il cliente: non-obiettivo (invariato). Contenuti della pagina pubblica oltre al saldo: non richiesti.
- Testo dell'informativa privacy sulla pagina dei punti: consulente del bar (Open Question 16).

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
7. Dopo l'associazione. Risolta dalle tavole Associa-link e Associa-link-errore (2026-11-18): «Salta, lo
   scrivo più tardi» e «Più tardi» portano alla Scheda cliente; per coerenza anche il link scritto torna
   alla Scheda cliente `/clienti/:id`, con lo stesso messaggio di conferma. «Indietro» resta su Modifica cliente.
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
13. Token in tabella separata (`private.card_links`, solo impronta sha256) invece di una colonna
    `balance_token` in `app.cards`. Proposta: tabella separata, per le ragioni scritte in "Modello dati"
    (default adottato, tecnica).
14. Riscrittura e token in attesa. Proposta: ogni tentativo emette un token nuovo, che vale solo dopo la
    verifica sulla card; fino ad allora resta valido il link precedente (default adottato, tecnica).
15. Pagina pubblica dei punti: chiusa dalle tavole del titolare "Saldo-punti" («ENJOY YOUR POINTS», numero
    e «punti», con il logo) e "Saldo-card-non-attiva" («Card non attiva» · «Questa card non mostra punti.
    Chiedi al bar.»); testi al punto 9.
16. Informativa privacy. Proposta di riga per il consulente: «Avvicinando la card al tuo telefono vedi il
    saldo dei tuoi punti: la pagina mostra solo i punti, senza nome né altri dati, e smette di funzionare
    se la card viene disattivata.» Non blocca lo sviluppo (come cross-review §3.1).
17. Origine del link. Proposta: un indirizzo che non cambierà (il dominio `*.vercel.app` del progetto, o un
    dominio del bar se si compra), deciso prima di scrivere le 50 card del lancio; cambiarlo dopo richiede
    di riscrivere tutte le card (default: dominio Vercel del progetto, nessun costo).
18. Card con link non scritto al lancio. Proposta: nessun blocco; Modifica cliente mostra «Link non
    scritto» finché qualcuno non lo scrive da un Android (default adottato).
19. **Card non bloccate (titolare).** Chi ha un'app NFC può sovrascrivere una card, anche con un link falso
    che imita la pagina dei punti (truffa possibile ma poco probabile in un bar). Proposta: accettato per
    ora, come deciso; nessun controllo alla cassa del link contenuto nella card (default). Alternativa da
    rivalutare dopo il lancio: alla lettura in cassa segnalare «Link della card alterato» se l'URL non è
    quello atteso.
20. **Card illeggibile dopo una scrittura interrotta (tecnica).** Se il contenuto della card si rovina,
    Chrome non consegna nemmeno l'uid. Proposta: riparazione con «Scrivi comunque» (punto 8) e, alla cassa,
    ricerca per nome (default adottato).
21. **Card letta dal telefono del personale fuori dalla lettura attiva (tecnica).** Android apre la pagina
    dei punti (nel browser o nell'app installata). Proposta: accettato, nessun pulsante «Torna all'app»
    sulla pagina pubblica (default adottato); da annotare nel RUNBOOK dopo la prova sul telefono.
