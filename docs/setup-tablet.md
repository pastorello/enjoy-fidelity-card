# Preparare il tablet della cassa

Guida per chi prepara il tablet condiviso della cassa (fase 3, `docs/specs/SPEC-tablet-kiosk.md`): il
BESTTAB A20 (10,1″, 1280×800 in orizzontale, senza NFC) con un **lettore NFC USB in emulazione tastiera**.
Il tablet accede **una volta** con l'account del bar; chi sta alla cassa si alterna con il proprio PIN di
4 cifre, e spese e riscatti fatti dal tablet sono registrati a suo nome.

Nessun segreto né dato reale in questo repository: password e email vere stanno solo nella dashboard di
Supabase e nel gestore di password. Per le prove si usano solo card di prova e clienti di prova (nomi
inventati), mai una card già consegnata; nelle note non si scrivono mai uid, link o PIN.

## 1. Prima di toccare il tablet

1. **Database**: la migrazione `supabase/migrations/*_tablet_kiosk.sql` è applicata al progetto in uso
   (`npx supabase db push`, prima staging poi produzione: `docs/setup-accounts.md` §2).
2. **Account del bar**: creato in Supabase con `private.add_device` (`docs/setup-accounts.md` §4,
   "Tablet della cassa (account di dispositivo)"): **Authentication → Users → Add user → Create new user**,
   poi nello **SQL Editor** `select private.add_device('<email>', '<nome del tablet>');`.
3. **Operatori**: chi lavora alla cassa ha già il proprio account (`docs/setup-accounts.md` §4,
   `private.add_operator`) e ha impostato il **PIN della cassa dal proprio telefono** (§4 qui sotto).
   Senza nessun PIN impostato, "Chi è alla cassa?" dice "Nessuno ha ancora impostato il PIN: ognuno lo
   imposta dal proprio telefono, in Impostazioni".
4. **Lettore**: un lettore NFC USB che legge gli NTAG215 e "batte" l'uid come una tastiera, chiuso da
   Invio; se il tablet ha una presa USB-C o micro-USB serve l'adattatore OTG. Modello e formato dell'uid
   si verificano all'acquisto (domanda aperta 10 della spec): §5 e §6.

## 2. Installare l'app

1. Sul tablet, in orizzontale, aprire **Chrome** (aggiornato dal Play Store) all'indirizzo dell'app di
   produzione (`https://enjoy-fidelity-card.vercel.app`, o il dominio deciso: `docs/setup-accounts.md`
   §5). Per una prova, l'anteprima della PR (dati di staging).
2. Menu **⋮** → **Installa app** (in alcune versioni **Aggiungi a schermata Home** → **Installa**).
   L'icona "Enjoy Card" compare nella schermata Home: da qui in poi si apre sempre l'app installata, non la
   scheda del browser.
3. Facoltativo, dalle impostazioni del tablet: tenere lo schermo acceso più a lungo durante il servizio
   (**Display → Spegnimento schermo**). Non c'è una modalità offline: il tablet deve stare sul Wi-Fi del bar.

## 3. Accesso con l'account del bar

1. Aprire l'app: si apre `/accedi` con la nota "Sul tablet della cassa si accede una volta con l'account
   del bar; poi ognuno si alterna con il proprio PIN.".
2. Email e password dell'account del bar (§1 punto 2), **non** quelle di una persona: con un account
   personale il tablet funzionerebbe come il telefono di quella persona e tutto sarebbe registrato a suo
   nome.
3. Dopo l'accesso si apre **`/cassa`**, "Chi è alla cassa?", con i nomi in ordine alfabetico. La sessione
   resta aperta: non serve riaccedere ogni giorno. Su questa pagina la lettura card è spenta.
4. Prova: toccare il proprio nome, inserire il PIN → si apre la home (Cerca) con "Alla cassa: <nome> ·
   Cambia" in alto. "Cambia" chiude il turno e torna a `/cassa`.

Password dell'account del bar dimenticata: "Password dimenticata?" su `/accedi` (l'email arriva alla
casella dell'account del bar), oppure `docs/setup-accounts.md` §4.

## 4. PIN della cassa (dal proprio telefono)

Ognuno imposta il proprio PIN **dal proprio telefono**, mai dal tablet e mai un amministratore per un altro:

1. Telefono, app Enjoy Card → **Impostazioni → ACCOUNT → PIN della cassa** ("Da impostare" o
   "Impostato"): si apre `/impostazioni/pin`.
2. "Scegli il PIN" (4 cifre), poi "Ripeti il PIN"; se non coincidono, "I due PIN sono diversi" e si
   ricomincia. "PIN salvato" → il PIN vale subito sul tablet.
3. PIN dimenticato: se ne sceglie uno nuovo allo stesso modo (non serve quello vecchio). Il PIN nuovo
   chiude i turni aperti di quella persona su tutti i tablet.

Due differenze dalle spec precedenti, volute:

- **`/impostazioni/pin` è una rotta nuova anche sul telefono**, in più rispetto a quelle elencate in
  `docs/specs/contract.md` (che elenca solo le rotte del telefono già note); nessuna tabella, RPC o rotta
  del contratto cambia nome.
- **Il PIN non è una colonna di `app.operators`** come annunciava `docs/specs/SPEC-identity.md`: se ne salva
  solo l'hash bcrypt in `private.operator_pins`, una tabella dello schema `private` che l'API non espone e
  nessun ruolo dell'app può leggere. Il PIN in chiaro non è salvato da nessuna parte, nemmeno sul tablet.

## 5. Densità reale dello schermo

L'app usa il layout del tablet (colonne affiancate, tastierino a destra) quando la finestra è almeno
**1024×600 punti** CSS; sotto mostra il layout del telefono. I 1280×800 del BESTTAB A20 sono pixel fisici:
con la densità di Android i punti CSS possono essere meno (per esempio 1280 / 1,5 ≈ 853 di larghezza, cioè
il layout del telefono).

1. Controllo a vista: su `/cassa` i nomi devono stare a sinistra e il riquadro del PIN con il tastierino a
   destra; nella home la colonna "Passa la card sul lettore" a sinistra della ricerca. Se tutto è in una
   colonna sola, è il layout del telefono.
2. Misura (facoltativa, con il computer): tablet collegato via USB con il debug USB attivo, in Chrome sul
   computer `chrome://inspect` → **inspect** sulla scheda dell'app → nella console
   `[innerWidth, innerHeight, devicePixelRatio]`. Annotare i tre valori nella tabella del RUNBOOK
   ("Tablet della cassa").
3. Se la larghezza è sotto 1024 o l'altezza sotto 600: impostazioni del tablet → **Display → Dimensioni di
   visualizzazione** (o **Dimensione schermo**) → la più piccola, poi riaprire l'app e ripetere il punto 1.
   Se non basta, fermarsi e avvisare: è la domanda aperta 10 della spec, non un difetto da correggere sul
   tablet.

Le azioni principali stanno lontane dal bordo inferiore (le barre di Android tolgono 50–70 punti): se la
barra di navigazione copre un pulsante, annotarlo con una foto senza dati di clienti.

## 6. Lettore USB e formato dell'uid

Il lettore "batte" l'uid della card come una tastiera e chiude con Invio; l'app ascolta i tasti in rapida
sequenza senza un campo sempre attivo. I lettori non usano tutti lo stesso formato: esadecimale o decimale,
a volte con i byte invertiti. Il formato si sceglie una volta per tutti i tablet in **Impostazioni →
LETTORE CARD**, visibile **solo sul tablet con un amministratore alla cassa**.

**Preparazione**: una card di prova associata dal **telefono Android** a un cliente di prova (Nuovo
cliente o Associa card con Web NFC, che legge l'uid nel formato giusto): così si sa quale cliente deve
aprirsi.

1. Collegare il lettore (con l'adattatore OTG se serve). Android lo vede come una tastiera fisica e
   **nasconde la tastiera a schermo**: prima di proseguire, §7.
2. Prova fuori dall'app (facoltativa): in un'app di note, appoggiare la card sul lettore. Compaiono
   caratteri e si va a capo. Lettere `A`–`F` tra le cifre → formato esadecimale; solo cifre (spesso 10–17)
   → decimale. Non annotare il codice; cancellare la nota.
3. Nell'app: "Chi è alla cassa?" → un **amministratore** → PIN → **Impostazioni → LETTORE CARD** → scegliere
   "Esadecimale" (il valore iniziale), "Esadecimale, byte invertiti", "Decimale" o "Decimale, byte
   invertiti" → **Salva**. Vale dalla lettura successiva.
4. Tornare alla home (Cerca), **senza toccare il campo di ricerca**, e appoggiare la card di prova sul
   lettore:
   - si apre **Registra spesa** del cliente di prova → formato giusto, fatto (uscire con "Indietro" senza
     confermare);
   - si apre **Nuovo cliente** con la card → il codice è stato letto ma come un'altra card (byte invertiti
     o decimale letto come esadecimale): **non salvare**, "Indietro", provare il formato successivo dal
     punto 3;
   - sotto il riquadro compare **"Codice non riconosciuto: controlla il formato del lettore in
     Impostazioni"** → il codice non è valido in quel formato: provare il formato successivo dal punto 3.
5. Con il formato giusto, provare anche una card di prova **nuova**: dalla home si apre Nuovo cliente con la
   card già associata. Il lettore USB non scrive: il link ai punti della card resta "non scritto" e si
   scrive poi da un telefono Android (Modifica cliente → "Scrivi il link").
6. Su `/cassa` la card non deve fare nulla: appoggiarla mentre si inserisce il PIN non cambia schermata e
   non aggiunge cifre.

Una card letta con un campo di testo attivo (per esempio la ricerca dopo aver scritto un nome) finisce nel
campo e cerca un codice: toccare fuori dal campo e ripassare la card (domanda aperta 13 della spec).

## 7. "Mostra tastiera virtuale" di Android

Con il lettore USB collegato, Android crede che ci sia una tastiera fisica e non mostra più la tastiera a
schermo: senza, non si può cercare un cliente per nome né scrivere il nome di un cliente nuovo.

Impostazioni del tablet → **Sistema → Lingue e immissione → Tastiera fisica** (in alcune versioni
**Tastiera fisica e virtuale** o **Gestisci tastiere**) → attivare **Mostra tastiera virtuale**. Si fa una
volta; controllare che resti attiva dopo aver scollegato e ricollegato il lettore.

## 8. Uso alla cassa

- **Cambio operatore**: in alto "Alla cassa: <nome> · Cambia" → `/cassa` → il proprio nome → PIN. Ciò
  che non era stato confermato si perde, come con "Indietro".
- **Turno**: dura al massimo **12 ore** dallo sblocco, poi `/cassa` con "Turno scaduto: inserisci di nuovo
  il PIN". Chi si allontana tocca "Cambia": altrimenti chiunque registra a suo nome.
- **PIN errati**: dopo **5 errori** di fila (su qualunque nome) il cambio si blocca per **5 minuti**, anche
  ricaricando l'app; durante il blocco il PIN non viene verificato. Si aspetta il conto alla rovescia.
- **Impostazioni** sul tablet: il riquadro mostra chi è alla cassa; "Esci" chiude il turno e torna a
  `/cassa` senza scollegare il tablet. Con un amministratore alla cassa c'è anche **"Disconnetti il
  tablet"**: per riaccedere servono email e password dell'account del bar.
- I ruoli sono quelli di chi è alla cassa: un amministratore vede le Impostazioni complete e annulla i
  movimenti; un operatore annulla solo la propria spesa o il proprio riscatto entro 10 secondi.

## 9. Se qualcosa non va

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| Dopo l'accesso si apre la home e non `/cassa` | Account personale, non del bar | "Esci", accedere con l'account del bar (§3) |
| "Account non abilitato" all'accesso | Account non collegato con `add_device` o utente cancellato | `docs/setup-accounts.md` §4, "Tablet della cassa" |
| Un nome è disabilitato con "PIN da impostare dal telefono" | Quella persona non ha il PIN | §4, dal suo telefono |
| "Troppi tentativi: riprova tra m:ss" | 5 PIN errati | Aspettare la fine del conto alla rovescia |
| La card apre Nuovo cliente per un cliente che ha già la card | Formato del lettore sbagliato | §6 |
| "Codice non riconosciuto…" | Formato del lettore sbagliato | §6 |
| La card non fa nulla in home | Campo di testo attivo, oppure si è su `/cassa` | Toccare fuori dal campo; inserire il PIN |
| Nessuna tastiera per scrivere un nome | Lettore USB collegato | §7 |
| Tutto in una colonna, come sul telefono | Densità dello schermo | §5 |
| "Connessione assente. Riprova." | Wi-Fi | Controllare la rete del bar; il PIN va reinserito |

Altre trappole e la tabella delle prove: RUNBOOK, "Tablet della cassa".
