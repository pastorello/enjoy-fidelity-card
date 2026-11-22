# Revisione incrociata delle specifiche dei moduli

Data: 2026-11-17 · Specifiche lette: `CONTRACT.md`, `CAPABILITY-MAP.md`, `SPEC-identity.md` (repo) e in
`specs/`: identity-password, settings, customers, rewards, card-input, cards, ledger, export, tablet-kiosk.
Scritta durante la stesura in parallelo delle specifiche (le copie intermedie non sono conservate).

## 1. A chi appartiene ogni schermata (wireframe del telefono)

Ogni wireframe ha **un solo modulo proprietario**: è il modulo che crea la pagina e la rotta. Gli altri moduli
aggiungono soltanto parti delimitate (colonna "Contributi").

| Wireframe (canvas) | Rotta | Proprietario | Contributi di altri moduli |
|---|---|---|---|
| Cerca cliente (`Main`) | `/` | `customers` | `card-input` (`CardReadPanel` completo), `cards` (consumatore della lettura), `ledger` (dati di SERVITI OGGI e saldo) |
| Ricerca senza risultati | `/?q=` | `customers` | `card-input` (`CardReadPanel variant="compact"`) |
| Registra spesa (aperta dalla card) | `/clienti/:id/spesa` | `ledger` | `cards` crea prima un segnaposto sulla stessa rotta, che `ledger` sostituisce |
| Importo insolito: avviso | `/clienti/:id/spesa` | `ledger` | `settings` (soglia e regola "strettamente sopra") |
| Spesa non salvata: errore di rete | `/clienti/:id/spesa` | `ledger` | — |
| Spesa registrata | `/clienti/:id/spesa` (stato `done`) | `ledger` | — |
| Scheda cliente | `/clienti/:id` | `customers` | `cards` (parte "Card attiva …"), `ledger` (`CustomerLedgerSection`: pulsanti e ULTIMI MOVIMENTI) |
| Riscatta premio | `/clienti/:id/premi` | `ledger` | `rewards` (`listActive()`, `sortRewards()`) |
| Premio libero: saldo insufficiente | `/clienti/:id/premi?libero` | `ledger` | — |
| Premio riscattato | `/clienti/:id/premi` (stato `done`) | `ledger` | — |
| Movimenti: conferma di annullamento | `/clienti/:id/movimenti` | `ledger` | — |
| Nuovo cliente senza card | `/clienti/nuovo` | `customers` | `cards` (sezione "Card (facoltativa)") |
| Nome già usato | `/clienti/nuovo` | `customers` | — |
| Card sconosciuta: nuovo cliente | `/clienti/nuovo?card=` | `cards` | usa il form di `customers` |
| Modifica cliente | `/clienti/:id/modifica` | `customers` | `cards` (sezione CARD) |
| Associa o sostituisci card | `/clienti/:id/card` | `cards` | `card-input` (`CardReadPanel`) |
| Card già di un altro cliente | `/clienti/:id/card` | `cards` | — |
| Lettura card: primo avvio | (riquadro) | `card-input` | — |
| Lettura card spenta o non disponibile | (riquadro) | `card-input` | — |
| Impostazioni (amministratore) | `/impostazioni` | `identity` (pagina e riquadro account) | `settings`, `identity-password`, `operators`, `rewards`, `export` (sezioni, ordine sotto) |
| Impostazioni (operatore) | `/impostazioni` | `identity` | `settings` (PUNTI, nota finale), `identity-password` (ACCOUNT) |
| Catalogo premi | `/impostazioni/premi` | `rewards` | — |
| Operatori | `/impostazioni/operatori` | `operators` (dal 2026-11-22, [SPEC-operators.md](SPEC-operators.md); prima rinviato) | anche la riga "Operatori" di GESTIONE e il layout "Tablet: operatori" |
| Accesso | `/accedi` | `identity` (V1) | `identity-password` (link "Password dimenticata?") |
| Password dimenticata | `/password-dimenticata` | `identity-password` | — |
| Invito: scegli la password | `/imposta-password` | `identity-password` (versione "recupero") | `operators` (versione "invito", [SPEC-operators.md](SPEC-operators.md)) |

Tutti i 15 wireframe della pagina tablet (Tablet-* e "Tablet: cambio operatore") appartengono a
`tablet-kiosk`, che cambia solo impaginazione e intestazione delle schermate dei moduli proprietari.

**Ordine unico delle sezioni di `/impostazioni`** (prima non era scritto in un solo posto, e la sezione
ACCOUNT non aveva una posizione per l'amministratore):
1. riquadro account: `identity` (sul tablet "Disconnetti il tablet" di `tablet-kiosk`);
2. PUNTI E CONTROLLI (admin) / PUNTI (operatore): `settings`;
3. ACCOUNT: "Cambia password" di `identity-password` e "PIN della cassa" di `tablet-kiosk`, nascosta sul tablet;
4. GESTIONE (solo admin): riga Operatori di `operators` (`OperatorsSettingsRow`, mostrata da
   `RewardsSettingsSection` come primo `<li>`), poi Catalogo premi di `rewards`;
5. LETTORE CARD (solo tablet con cassiere admin): `tablet-kiosk`;
6. ESPORTA DATI (solo admin): `export`;
7. nota finale (solo operatore): `settings`.

## 2. Correzioni applicate

1. **`private.acting_operator_id()`: tre definizioni diverse.**
   - Prima:
     - `settings`: `create or replace`, con `grant` ad `authenticated`;
     - `customers`: blocco `do` "solo se manca", senza `grant`;
     - `rewards`: `create or replace`, senza `grant`.
   - Ora c'è una sola definizione, scritta in `SPEC-settings.md` e richiamata da `customers`, `rewards` e `ledger`:
     - `create or replace` con corpo identico in tutti e tre i moduli;
     - `stable`, `security definer`, `search_path = ''`;
     - `execute` revocato a `public`, `anon` e `authenticated`.
   - `tablet-kiosk` la ridefinisce dopo: le sue migrazioni vengono sempre dopo.
   - Il pgTAP di `settings` la verifica attraverso `updated_by`.
   - Il "Never" di `customers` adesso vieta un corpo diverso da quello comune, non la sovrascrittura.
2. **Codice "nessun operatore" in `cards`.**
   - `cards` alzava `forbidden`, mentre `customers` usa `not_operator` e `tablet-kiosk` dà per scontato `not_operator`.
   - Ora `cards` usa `not_operator` e chiama `reportNotEnabled()` (nota n6).
3. **`reportNotEnabled()`: comportamento definito e usato ovunque.**
   - Prima `customers` portava sempre su `/accedi`. Così non si poteva usare sui `42501` di `settings`, `rewards` ed `export`, che possono voler dire solo "non sei più admin".
   - Ora ricontrolla il profilo, con lo stesso controllo che `AuthProvider` fa già al ritorno in primo piano:
     - profilo assente → `/accedi` con "Account non abilitato";
     - profilo presente → ruolo aggiornato.
   - Lo chiamano `customers`, `cards`, `ledger`, `settings`, `rewards` ed `export`; `tablet-kiosk` lo devia su `/cassa`.
   - Lo aggiunge il primo fra `settings`, `customers` e `rewards` che viene unito.
   - Il testo di `settings` ("il profilo si carica solo all'avvio") era impreciso ed è stato corretto.
4. **Formato del lettore USB.**
   - `card-input` assegnava la schermata a `settings`, mentre `settings` e `tablet-kiosk` la assegnano a `tablet-kiosk`.
   - Ora `card-input` la assegna a `tablet-kiosk`.
   - `CardReaderSession` legge il formato con `useSettings()` (`settings.usbUidFormat`). `SettingsProvider` sta dentro `RequireAuth` e avvolge `CardReaderSession`.
5. **Riquadro compatto "Lettura attiva: puoi anche avvicinare la card"** (wireframe Ricerca senza risultati).
   - `customers` lo attribuiva a `card-input`/`cards`, ma nessuno dei due lo definiva.
   - Ora è `CardReadPanel variant="compact"` di `card-input`: una riga, mostrata solo nello stato `active`.
   - La home di `customers` lo sceglie mentre mostra una ricerca.
6. **SERVITI OGGI.**
   - `ledger` diceva "la home ricarica su `visibilitychange`", ma la home è di `customers`, che non lo prevedeva. Ora lo prevede `customers`.
   - `ledger` sostituisce solo il corpo di `app.customers_served_today()`, con la stessa firma: già allineato.
7. **Sezione movimenti della scheda.**
   - `ledger` diceva "montata da `customers`", ma `customers` si costruisce prima e non può montare un componente che non esiste ancora.
   - Ora è `ledger` a montare `CustomerLedgerSection` in `CustomerPage`. `customers` lo cita.
8. **Saldo nell'export.**
   - `export` ricalcolava `sum(points)` per conto suo, in `bigint`.
   - Ora usa `private.customer_balance()` di `ledger`, in `int` come `customer_summary.balance`. In tutto il database c'è un solo calcolo del saldo.
   - L'indice `(created_at, id)` lo crea `ledger`. Prima `export` lo aggiungeva "se manca".
9. **Riquadro della home in `cards`:** ora dice che lo inserisce `card-input`, con il consumatore spento, e che `cards` accende soltanto il consumatore.
10. **Ordine delle sezioni di `/impostazioni`.** Sta nel punto 1 ed è richiamato da `settings`, `rewards`, `identity-password` e `tablet-kiosk`.

**Verificato e coerente, nessuna modifica:**
- **Ordine di costruzione.** Nessun modulo usa una tabella creata da un modulo successivo:
  - `cards` crea il segnaposto della spesa;
  - `customers` crea `customers_served_today()` vuota e `customer_summary.balance = 0`;
  - `card-input` legge `app.settings`, che viene prima;
  - `export` usa `cards` e `ledger`, che vengono prima.
- **Soglia di conferma:** 15000 centesimi, conferma solo strettamente sopra, la mostra `formatCents`; uguale in `settings` e `ledger`.
- **Arrotondamento:** per difetto, sul server.
- **Annullo:** l'operatore annulla solo i propri movimenti entro 10 s; uguale in `CONTRACT`, `ledger` e `tablet-kiosk`.
- **Anti-ripetizione della card:** 2 s.
- **Nomi e chiavi in comune:**
  - `normalizeUid` e il vincolo `uid` con numero pari di cifre;
  - `operation_id` condiviso fra `create_customer` e `create_customer_with_card`;
  - rotte uguali a quelle del contratto, più `?libero`, `/cassa` e `/impostazioni/pin`, già dichiarate come deviazioni.
- **Codici d'errore diversi per modulo** (`P0001` + messaggio-codice, `EC0xx`, SQLSTATE standard):
  - restano diversi, come dice la Open Question 15 di `ledger`;
  - ogni servizio traduce i propri;
  - adesso hanno lo stesso significato per "nessun operatore" (punto 2) e per l'aggancio `reportNotEnabled()` (punto 3).

## 3. Domande per il titolare

Solo scelte di attività, testi legali e hardware. Per ogni domanda c'è il default adottato: il lavoro va
avanti con quello.

1. **Informativa privacy** (consulente del bar).
   - Serve il testo approvato da mostrare in Nuovo cliente.
   - Il consulente deve dire se, oltre alla data del consenso, va salvata anche la versione dell'informativa accettata.
   - L'informativa deve citare che il CSV dei clienti, con nomi e telefoni, resta nei Download del telefono dell'amministratore.
   - *Default:* testo segnaposto marcato "bozza", si salva solo la data del consenso. È un bloccante del checkpoint di lancio, non dello sviluppo.
2. **Testi dell'app che non sono nei wireframe** (errori, conferme, dialoghi, stati vuoti in tutti i moduli).
   - *Default:* i testi scritti nelle specifiche, nello stile «Stati, errori e conferme» del design system.
   - Si rivedono tutti insieme, su una lista unica, prima del lancio.
3. **"Oggi" per SERVITI OGGI.** Il bar chiude dopo mezzanotte?
   - *Default:* giorno di calendario, da mezzanotte a mezzanotte, ora italiana. Contano spese e riscatti anche annullati.
   - Se il bar chiude più tardi, serve un'ora di cambio giornata (per esempio le 5:00).
4. **Correzioni manuali di punti per l'amministratore.** Le specifiche parlano di "correzione e annullamento movimenti".
   - *Default:* in V1 l'unica correzione è l'annullo di una spesa o di un riscatto.
   - Niente correzioni libere del tipo "+20 punti per errore".
5. **Limiti dei valori.**
   - *Default:*
     - spesa massima 99.999,99 €;
     - una spesa che vale 0 punti (per esempio 0,50 €) si registra lo stesso;
     - rapporto da 0,01 € a 100,00 € per punto;
     - soglia di conferma fino a 10.000,00 €;
     - premi e premio libero da 1 a 99.999 punti;
     - nomi dei premi fino a 60 caratteri, descrizione del premio libero fino a 80.
6. **Cosa possono fare i camerieri.**
   - *Default:*
     - modificano nome, telefono e note di un cliente;
     - associano, sostituiscono e disattivano card;
     - non vedono la soglia di conferma;
     - non annullano dallo storico: possono annullare solo dalla schermata di conferma, entro 10 s;
     - cancellare i dati di un cliente resta riservato all'amministratore.
7. **Clienti e premi.**
   - *Default:*
     - lo stesso telefono può appartenere a più clienti (per esempio una famiglia);
     - i premi non si cancellano mai, si disattivano;
     - nome e punti di un premio si possono modificare, e i riscatti già registrati non cambiano.
8. **File CSV.**
   - *Default:*
     - sempre tutto lo storico, senza filtri per periodo;
     - le colonne sono quelle di `SPEC-export.md` punto 5;
     - date in formato gg/mm/aaaa hh:mm:ss, ora italiana;
     - telefono e codice card scritti in modo che Excel non tolga il "+" e gli zeri iniziali.
9. **Tablet: sicurezza del PIN** (solo fase 3).
   - *Default:* blocco di 5 minuti dopo 5 PIN errati; turno valido 12 ore; nessuna uscita automatica per inattività.
   - Rischio 1: chi lascia la cassa senza "Cambia" lascia che altri registrino a suo nome.
   - Rischio 2: con tentativi continui, un PIN di 4 cifre si indovina in pochi giorni.
   - Alternativa: blocchi crescenti (5, 15, 60 minuti) e chiusura del turno dopo qualche minuto di inattività.
10. **Hardware del tablet** (solo fase 3, all'acquisto).
    - Da verificare:
      - quale lettore NFC USB si compra;
      - in che formato manda il codice (esadecimale o decimale, ordine dei byte);
      - se manda tutti i 7 byte;
      - la densità reale dello schermo del BESTTAB A20.
    - *Default:* formato `hex`, modificabile da Impostazioni → LETTORE CARD; layout a 1280×800 punti.

## 4. Aggiornamento del 2026-11-17: saldo visibile al cliente

Decisione del titolare (vedi `brain/DECISIONS.md`): il cliente vede il proprio saldo dal link scritto sulla
card. Il lavoro è in `SPEC-cards.md` (scrittura del link, pagina pubblica `/s/:token`, nuova schermata di
proprietà di `cards`) e `SPEC-card-input.md` (scrittura con Web NFC). Dettagli e controlli di sicurezza:
`docs/specs/customer-balance.md`. Domande aggiunte per il titolare (default adottati): dominio scritto sulle
card (`enjoy-fidelity-card.vercel.app`), card non bloccate (accettato), riga dell'informativa privacy per il
consulente, testi della pagina pubblica da allineare ai wireframe che il titolare aggiunge alla tela.
