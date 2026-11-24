# Spec: card-input — V1

Status: approvata (2026-11-17) su delega dell'utente — le Open Questions adottano i default proposti, da rivedere con il titolare (`docs/specs/cross-review.md` §3).
Rivista il 2026-11-17 per la decisione del titolare «punti visibili al cliente con la card»: il modulo aggiunge la
**scrittura del link** sulla card (punto 9); la lettura resta com'era.
Modulo: `card-input` ([CAPABILITY-MAP.md](../../CAPABILITY-MAP.md)) · Dipende da: `platform`, `settings` ·
Fonti: specifiche (sezioni "Architettura", "Contesto e vincoli", "Nuovo cliente e consegna della card"),
wireframe Cerca cliente, Lettura card: primo avvio, Lettura card spenta, Associa card, Tablet: cerca cliente,
Tablet: associa card, Tablet: cambio operatore (intestazione "Lettore NFC USB collegato"), Associa-link e
Associa-link-errore (scrittura del link: i testi sono di `cards` punto 8), note `n1`, `n2`, `nt2`, `nt3` ·
Decisioni: `brain/DECISIONS.md` (2026-11-16 "Lettore NFC USB generico con formato configurabile"; 2026-11-17
"Punti visibili al cliente con la card": la card porta un link scritto dall'app, che `cards` genera e
verifica).

## Objective

Un **unico ingresso** per la lettura delle card in tutta l'app: qualunque sia la sorgente (Web NFC sul
telefono, lettore USB a emulazione tastiera sul tablet, adattatore finto nei test), le schermate ricevono lo
stesso evento con l'uid già normalizzato in esadecimale maiuscolo senza separatori. Il modulo non sa nulla di
clienti e card registrate: consegna l'uid a chi lo sta aspettando. Cosa farne (aprire Registra spesa, Nuovo
cliente, associare) lo decidono i moduli `cards`, `customers` e `tablet-kiosk`.

Il modulo offre anche l'**unica via per scrivere una card**: un record NDEF URL (il link ai punti del cliente,
che costruisce `cards`), scritto con Web NFC e verificato rileggendo la card. Scrivere è possibile solo con
Web NFC attivo (telefono Android con Chrome): su iPhone, sul tablet (lettore USB) e con NFC spento il modulo lo
dichiara con `canWrite: false` e chi chiama lascia il link "da scrivere". Il modulo non sa cosa c'è nel link.

**Utenti**: amministratori e operatori, senza differenze di ruolo (tutti leggono card). Solo l'amministratore
sceglie il formato del lettore USB, ma quella schermata è del modulo `tablet-kiosk` (colonna e funzione di
`settings`).

**Successo**: sul telefono Android la card appoggiata al retro arriva alla schermata attiva come
`04A1B2C3D4E5F6` subito (un passo dell'obiettivo "dalla card alla conferma in meno di 10 secondi", nota
`n1`); su iPhone o con NFC spento l'app lo dice e la ricerca resta usabile;
lo stesso uid arriva identico dal lettore USB con il formato configurato; su Android un link chiesto da
`cards` finisce sulla card appoggiata e viene riletto uguale prima di dichiararlo scritto.

## Cosa include

1. **`normalizeUid(raw, format)`** (funzione pura, `src/features/card-input/normalizeUid.ts`):
   restituisce l'uid canonico (`^[0-9A-F]{8,20}$`, numero pari di cifre, 4–10 byte) oppure `null`.
   - `'hex'`: toglie spazi iniziali/finali; accetta byte separati da `:`, `-` o spazio (ogni gruppo di
     esattamente 2 cifre) oppure cifre consecutive in numero pari; maiuscolo. È il formato di Web NFC
     (`serialNumber` = `"04:a1:b2:c3:d4:e5:f6"` → `"04A1B2C3D4E5F6"`).
   - `'hex-reversed'`: come `'hex'`, poi inverte l'ordine dei byte.
   - `'dec'`: solo cifre (zeri iniziali ammessi, niente segno), convertite con `BigInt` (un uid di 7 byte
     supera `Number.MAX_SAFE_INTEGER`); l'esadecimale si completa con zeri a sinistra fino alla più piccola
     lunghezza ISO 14443 che lo contiene: 4, 7 o 10 byte. Oltre 10 byte → `null`.
   - `'dec-reversed'`: come `'dec'`, poi inverte l'ordine dei byte (dopo il completamento).
   - Sempre `null` per: stringa vuota, caratteri non ammessi, gruppi di lunghezza diversa da 2, numero
     dispari di cifre esadecimali, meno di 4 o più di 10 byte, uid composto solo da zeri.
   - `USB_UID_FORMATS = ['hex', 'hex-reversed', 'dec', 'dec-reversed'] as const` e il tipo `UsbUidFormat`
     vivono qui: sono i valori ammessi di `app.settings.usb_uid_format` (vedi "Modello dati").
2. **Servizio di lettura** (`createCardReader`, uno solo per tutta l'app). Come `AuthProvider`, il servizio
   si crea in `main.tsx` e si passa a `CardReaderProvider`, che avvolge `RouterProvider` (e in `renderApp`
   dei test si passa un servizio con adattatori finti). Il provider **non avvia nulla da solo**: gli
   adattatori (scan Web NFC, ascolto della tastiera) partono solo quando `CardReaderSession`, montato nel
   layout di `RequireAuth` (cioè con un operatore collegato), chiama `reader.activate({ usbFormat })`, e si
   fermano (`AbortController.abort()`, rimozione del listener) quando si smonta: niente lettura su `/accedi`
   né dopo "Esci". `CardReaderSession` legge il formato USB con `useSettings()` del modulo `settings`
   (`settings.usbUidFormat`; `SettingsProvider` sta dentro `RequireAuth` e avvolge `CardReaderSession`) e
   lo aggiorna con `reader.setUsbFormat(format | null)` (`null` finché lo stato non è `ready`).
   Il servizio:
   - riceve gli uid grezzi dagli adattatori, li normalizza, scarta quelli non validi e **inoltra solo al
     consumatore attivo** (vedi punto 5);
   - **anti-ripetizione**: lo stesso uid letto di nuovo entro `REPEAT_WINDOW_MS = 2000` dall'ultima lettura
     di quell'uid (consegnata o no) viene ignorato; un uid diverso passa subito;
   - **vibrazione**: quando una lettura viene consegnata a un consumatore, `navigator.vibrate?.(80)` se
     disponibile; se il browser la rifiuta non succede nulla (mai errori in console);
   - una lettura senza consumatore attivo (per esempio su Registra spesa o Movimenti) si scarta in
     silenzio, senza vibrazione.
3. **Adattatore Web NFC** (`webNfcAdapter.ts`, dietro un'interfaccia `WebNfcApi` per poterlo provare):
   - supportato solo se `'NDEFReader' in window` (Chrome Android, solo HTTPS); altrimenti stato
     `unsupported` (iPhone, browser desktop, HTTP);
   - all'avvio legge `navigator.permissions.query({ name: 'nfc' })`: `granted` → avvia subito
     `NDEFReader.scan()`; `prompt` (o query non disponibile) → stato `needs-permission`, perché il primo
     `scan()` deve partire da un tocco dell'utente; `denied` → stato `denied`;
   - `scan()` avviato con un `AbortController`; esito: risolto → `active`; `NotAllowedError` → `denied`;
     `NotSupportedError` → `unsupported`; qualunque altro errore (es. `NotReadableError`, NFC spento nelle
     impostazioni del telefono) → `off`;
   - evento `reading` → `serialNumber` al servizio con formato `'hex'`; `readingerror` (tag non leggibile:
     Chrome lo dà anche quando il messaggio NDEF della card è rovinato, per esempio dopo una scrittura
     interrotta, e in quel caso **non** dà l'uid) si ignora fuori da una scrittura: l'operatore riavvicina la
     card o cerca il cliente per nome; durante una scrittura va allo scrittore (punto 9, `unreadable`);
   - **la scansione attiva tiene l'NFC per l'app**: con `scan()` attiva e la pagina visibile Chrome usa la
     modalità lettore di Android, quindi una card con il link scritto arriva qui e Android **non** apre il
     link nel browser. Senza scansione attiva (stati diversi da `active`, pagina nascosta, fuori da
     `RequireAuth`) Android apre il link da sé (vedi `SPEC-cards.md`, "Card scritta sul telefono del
     personale"). Verifica manuale nel RUNBOOK;
   - **"torna qui"** (testo del wireframe Lettura card spenta): con stato `off` o `denied`, quando la pagina
     torna visibile (`visibilitychange` → `visible`) si rilegge il permesso e, **solo se è `granted`**, si
     ritenta `scan()` da solo; con permesso `prompt` o `denied` non si chiama `scan()` (servirebbe un tocco),
     lo stato diventa `needs-permission` o resta `denied`. Se l'NFC si riattiva dalla tendina
     senza lasciare l'app la pagina non cambia visibilità: per questo resta il pulsante "Riprova la lettura";
   - `start()` con una scansione già attiva la interrompe (`abort()`) prima di avviarne una nuova: mai due
     `scan()` contemporanee;
   - l'adattatore inoltra al servizio, oltre al `serialNumber`, gli **URL dei record NDEF** della lettura
     (`recordType === 'url'`, decodificati con `TextDecoder`): servono solo alla verifica della scrittura
     (punto 9) e non arrivano mai ai consumatori di `useCardRead`;
   - le card si scrivono **solo** con la scrittura del punto 9 (`NDEFReader.write()` di un record URL);
     **mai `makeReadOnly()`**: la card resta riscrivibile (decisione del titolare, il blocco è irreversibile).
4. **Adattatore lettore USB** (`keyboardWedge.ts`, funzione pura di stato + listener su `document`):
   - ascolta `keydown` in fase di cattura su `document`, **senza campi di testo sempre attivi**;
   - accumula i caratteri ammessi dal formato (`hex*`: `0-9A-Fa-f`; `dec*`: `0-9`) se arrivano a non più di
     `MAX_KEY_GAP_MS = 50` l'uno dall'altro; un intervallo più lungo, un carattere non ammesso, un tasto con
     Ctrl/Alt/Meta o un tasto ripetuto (`event.repeat`) azzerano il buffer; i tasti modificatori da soli
     (`Shift`, `CapsLock`) si ignorano senza azzerare, perché molti lettori mandano le lettere maiuscole
     con Shift;
   - `Enter` con almeno 4 caratteri nel buffer, l'ultimo arrivato entro 50 ms: il buffer va al servizio
     con il formato configurato; l'`Enter` viene fermato (`preventDefault` + `stopPropagation`) così non
     attiva il pulsante con il focus;
   - **digitazione normale ignorata**: se il bersaglio è un campo modificabile (`input`, `textarea`,
     `select`, `[contenteditable]`) l'adattatore non accumula e non ferma nulla; la digitazione umana
     (intervalli > 50 ms) non produce letture;
   - il formato viene da `settings.usb_uid_format` (via `CardReaderSession`, punto 2): finché le impostazioni non
     sono caricate, o se il caricamento fallisce, l'adattatore resta **spento** (nessuna lettura con un
     formato indovinato) e si riaccende quando arrivano; un cambio di formato vale dalla lettura successiva;
   - attivo su ogni dispositivo dopo il caricamento delle impostazioni (non è rilevabile se un lettore è
     collegato); espone `usb.lastReadAt` e `usb.lastInvalidAt` per l'intestazione del tablet (`tablet-kiosk`).
5. **API per i consumatori** (`useCardRead`, `useCardReaderState`):
   ```ts
   type CardRead = { uid: string; source: 'web-nfc' | 'usb' | 'fake'; at: number };
   type NfcStatus = 'checking' | 'needs-permission' | 'starting' | 'active'
                  | 'denied' | 'off' | 'unsupported';
   type CardReaderState = { nfc: NfcStatus; canWrite: boolean;
                            usb: { enabled: boolean; format: UsbUidFormat | null;
                            lastReadAt: number | null; lastInvalidAt: number | null } };
   function useCardRead(onRead: (read: CardRead) => void, options?: { enabled?: boolean }): void;
   function useCardReaderState(): CardReaderState & { start(): Promise<void> };
   function useCardWriter(): { canWrite: boolean; writeUrl: WriteUrl };   // punto 9
   ```
   - `canWrite` è `true` solo con `nfc === 'active'` e un `NDEFReader` con `write` (o lo scrittore finto
     delle build E2E, punto 7); il lettore USB non scrive mai, quindi sul tablet è sempre `false`.
   - **un solo consumatore attivo alla volta, a pila**: riceve le letture l'ultimo `useCardRead` attivato
     (montato con `enabled` non `false`, oppure passato da `enabled: false` a `true`, che lo rimette in
     cima); quando si smonta o si disabilita viene **tolto dalla pila per identità** (non "l'ultimo
     inserito"), e riceve di nuovo chi è in cima. Il doppio montaggio di `StrictMode` non cambia l'ordine.
     Le schermate di `/` e `/clienti/:id/card` sono rotte diverse e non si sovrappongono; la pila serve
     quando un pannello o una finestra che legge card si apre sopra una schermata che già legge (per
     esempio una lettura in Modifica cliente, nota `n2`, decisa dal modulo `cards`);
   - `start()` va chiamato dal gestore di un tocco (`onClick`): avvia o riavvia `scan()`;
   - il callback più recente viene sempre usato (ref), senza risottoscrivere a ogni render.
6. **Riquadro "Lettura card"** (`CardReadPanel`, `<section aria-label="Lettura card">`, usato dalle
   schermate che leggono card; contenuto dello stato attivo passato dal consumatore):
   | Stato | Contenuto (wireframe) | Azione |
   |---|---|---|
   | `checking`, `starting` | icona NFC, titolo del consumatore, "Avvio della lettura…" | — |
   | `active` | titolo e testo del consumatore (home: "Avvicina la card" / "Lettura attiva: appoggia la card sul retro del telefono. Una card nuova apre la registrazione del cliente."; Associa card: "Avvicina la card nuova" / "L'app legge il codice della card e ci scrive il link per vedere i punti." — il testo del wireframe "non ci scrive nulla" non vale più dopo la decisione del 2026-11-17) | — |
   | `needs-permission` | "Lettura delle card" / "Serve una volta sola: il telefono chiede il permesso di usare l'NFC." | "Attiva la lettura" → `start()` |
   | `off` | "Lettura card spenta" / "Attiva l'NFC nelle impostazioni del telefono e torna qui. Su iPhone le card non si leggono: cerca il cliente per nome o email." (testo di `SPEC-customers-v2.md`) | "Riprova la lettura" → `start()` |
   | `denied` | "Lettura card spenta" / "Il permesso NFC è negato: consentilo a Enjoy Card nelle impostazioni di Chrome (Impostazioni sito → NFC) e riprova." | "Riprova la lettura" → `start()` |
   | `unsupported` | "Lettura card spenta" / stesso testo di `off` | nessun pulsante (non c'è nulla da riprovare) |
   - variante `mode="usb"` per il tablet: titolo e testo del consumatore (Tablet: cerca cliente "Passa la
     card sul lettore" / "L'app riceve il codice dal lettore da sola, senza bisogno di toccare un campo. Una
     card nuova apre la registrazione del cliente."; Tablet: associa card "Passa la card nuova sul lettore"
     / "L'app legge solo il codice della card: non ci scrive nulla." — sul tablet resta vero, il lettore
     USB non scrive; il link si scrive poi da un telefono, vedi `SPEC-cards.md`); ignora lo stato Web NFC
     (il tablet non ha NFC) e non ha stati di permesso. La usa solo `tablet-kiosk`.
   - variante `variant="compact"` (wireframe Ricerca senza risultati): una sola riga "Lettura attiva: puoi
     anche avvicinare la card" con l'icona NFC, solo nello stato `active`; negli altri stati non mostra nulla
     (il riquadro completo torna quando la ricerca si svuota). La sceglie la home di `customers` mentre
     mostra una ricerca; la lettura resta attiva.
   - Il cambio di stato si annuncia con una regione `aria-live="polite"`; pulsanti `Button` (56 px);
     sotto il riquadro la ricerca resta sempre disponibile (la mette la schermata, non il riquadro).
7. **Adattatore finto per i test** (`fakeCardAdapter.ts`): `window.__enjoyFakeCard(uid: string): void`
   manda `uid` al servizio come sorgente `'fake'` con formato `'hex'` (accetta `"04:a1:…"` e `"04A1…"`),
   con le stesse regole (normalizzazione, anti-ripetizione, consumatore attivo, vibrazione). Funziona
   qualunque sia lo stato Web NFC, ma solo con il servizio attivo (operatore collegato, punto 2).
   **Scrittura finta** (stesso file): nelle build E2E lo scrittore del punto 9 usa, al posto di
   `NDEFReader.write()`, una memoria finta dei tag (`uid → url`). `__enjoyFakeCard(uid)` è "la card
   appoggiata": consegna la lettura con l'URL che quel tag ha in memoria e, se una scrittura è in attesa,
   la completa su quel tag. Come sul telefono, una card appoggiata da meno di `IN_FIELD_MS` (punto 9) è
   "ancora sul telefono": la scrittura parte subito e la verifica rilegge la memoria finta senza un nuovo
   tocco. Ogni scrittura riuscita si aggiunge a `window.__enjoyFakeCardWrites: { uid: string; url: string;
   at: number }[]` (il registro che i test leggono per aprire il link). Controlli per i test:
   `window.__enjoyFakeCardControl = { failNextWrite(reason: 'io' | 'timeout' | 'not-allowed' |
   'verify-failed' | 'unreadable'): void; setCanWrite(value: boolean): void }` (`setCanWrite(false)` simula
   un dispositivo che non scrive, `canWrite` resta comunque `false` se lo stato Web NFC non è `active`;
   `failNextWrite('io')` lascia il tag finto "rovinato", che alla lettura successiva dà `unreadable` finché
   non lo si riscrive). Tutti i nomi
   iniziano con `__enjoyFakeCard`, così il controllo del bundle li copre. Si
   installa **solo** se `import.meta.env.VITE_E2E === '1'`, con un
   `import()` dentro quella condizione in `main.tsx`: nelle build normali Vite sostituisce la costante e il
   codice sparisce dal bundle. `playwright.config.ts` aggiunge `VITE_E2E: '1'` all'ambiente del `webServer`
   (oggi manca: lo aggiunge questo modulo); `vite-env.d.ts` dichiara `VITE_E2E?: string`.
8. **Riquadro nella home**: il modulo inserisce `CardReadPanel` nella home "Cerca cliente" (costruita da
   `customers`, che secondo l'ordine della CAPABILITY-MAP viene prima), sopra "Oppure cerca per nome o
   telefono" come nel wireframe, con i testi dello stato attivo del wireframe Cerca cliente. Finché `cards`
   non collega la navigazione, la home **non registra un consumatore** (`useCardRead` con
   `enabled: false`): il riquadro mostra lo stato, ma una card letta non fa nulla e non vibra. Se `customers`
   non ha ancora sostituito il segnaposto di `HomePage`, il riquadro va nel segnaposto.
9. **Scrittura del link** (`webNfcWriter.ts` dietro `WebNfcApi`, esposta da `useCardWriter()`):
   ```ts
   type CardWriteStep = 'waiting-card' | 'writing' | 'verifying';
   type CardWriteFailure = 'cannot-write' | 'busy' | 'timeout' | 'wrong-card' | 'io'
                         | 'not-allowed' | 'verify-failed' | 'unreadable' | 'aborted';
   type CardWriteResult = { ok: true }
                        | { ok: false; reason: CardWriteFailure; otherUid?: string }; // otherUid: solo wrong-card
   type WriteUrl = (url: string, options: { expectedUid: string; signal?: AbortSignal;
                    allowUnreadable?: boolean;
                    onStep?: (step: CardWriteStep) => void }) => Promise<CardWriteResult>;
   ```
   - **Precondizioni** (rifiuto immediato, nessuna chiamata a Web NFC): `canWrite` falso → `cannot-write`;
     un'altra scrittura in corso → `busy`; `url` non assoluto, non `https:` o più lungo di
     `MAX_URL_LENGTH = 200` caratteri, oppure `expectedUid` che non passa da `normalizeUid(…, 'hex')` →
     errore di programmazione (`TypeError`), non un esito. Spazio: un record URL di 200 caratteri occupa al
     più ~210 byte con l'intestazione NDEF; il link reale (~58 caratteri) circa 60; un NTAG215 ha 504 byte
     utili.
   - **Sessione esclusiva**: dall'inizio alla fine della scrittura le letture vanno solo allo scrittore,
     non ai consumatori di `useCardRead` (nessuna navigazione, nessuna vibrazione da lettura) e senza
     anti-ripetizione; alla fine la pila dei consumatori riprende com'era.
   - **1. La card giusta sul telefono** (`waiting-card`). Web NFC scrive sul primo tag che trova, senza
     scegliere quale: per non scrivere la card di un altro si scrive solo se l'ultima lettura ricevuta è
     `expectedUid`, arrivata da meno di `IN_FIELD_MS = 1500` e senza letture di altri uid dopo di lei
     (la card che l'operatore ha appena letto per associarla, ancora appoggiata). Altrimenti lo scrittore
     aspetta una lettura: `expectedUid` → passo 2; un altro uid → esito `wrong-card`, nulla scritto;
     `readingerror` → esito `unreadable`, nulla scritto, a meno che il chiamante abbia passato
     `allowUnreadable: true` (l'operatore ha confermato che è la card giusta): allora `readingerror` vale come
     la card attesa e si passa al passo 2. È l'unico modo di riparare una card rovinata, che non dà l'uid.
   - **2. Scrittura** (`writing`): `NDEFReader.write({ records: [{ recordType: 'url', data: url }] },
     { overwrite: true, signal })`, sempre e solo un record URL, mai `makeReadOnly()`. Esiti di `write()`:
     risolta → passo 3; `NotAllowedError` → `not-allowed`; `NetworkError` (card allontanata durante la
     scrittura, o card bloccata in sola lettura da altri) o `NotReadableError` → `io`; `NotSupportedError`
     (tag non NDEF) → `io`; `AbortError` → `aborted` se l'ha chiesto il chiamante, `timeout` se è scaduto il
     tempo. Se `write()` non trova la card ancora appoggiata resta in attesa della **prossima** card
     avvicinata, qualunque sia: per questo una lettura di un altro uid mentre `write()` è in corso →
     `abort()` ed esito `wrong-card` con `otherUid` (Chrome può aver già scritto quella card prima di
     segnalarne la lettura). Una scrittura interrotta (card allontanata a metà) può lasciare la card con un
     messaggio NDEF rovinato: l'esito resta `io`, e la card si ripara con `allowUnreadable`.
   - **3. Verifica** (`verifying`): la scrittura è riuscita solo quando una lettura di `expectedUid` riporta
     tra gli URL del messaggio esattamente `url`. Se Chrome non rilegge da solo la card rimasta appoggiata,
     la schermata chiede di allontanarla e riavvicinarla (testo di `cards` punto 8; la tavola "Associa-link"
     mostra il passo `writing`: «Tieni la card appoggiata» · «Scrivo il link per vedere i punti…»). Lettura di un altro uid durante
     la verifica: con `url` tra i suoi URL → `wrong-card` con `otherUid` (il link è finito sulla card
     sbagliata), altrimenti ignorata; stesso uid con contenuto diverso → `verify-failed`; `readingerror` →
     ignorato (si attende un'altra lettura fino al tempo massimo).
   - **Tempi**: `WRITE_TIMEOUT_MS = 15000` per passi 1+2 e `VERIFY_TIMEOUT_MS = 15000` per il passo 3,
     scaduti → `abort()` della `write()` in corso ed esito `timeout`. Il `signal` del chiamante (es. "Più
     tardi", schermata smontata) interrompe in qualsiasi passo → `aborted`.
   - Successo → `navigator.vibrate?.(80)` come una lettura consegnata; mai errori in console.
   - Il modulo **non ritenta da solo**: ogni tentativo parte da un tocco dell'operatore o da `cards` subito
     dopo un'associazione confermata dal server. Non conserva, non registra nei log e non mostra l'URL, né
     quello scritto né quelli letti (gli URL letti contengono il token di un cliente).
   - `start()` (riavvio della scansione) durante una scrittura la interrompe (`aborted`): la verifica ha
     bisogno della scansione attiva.

### Modello dati e regole di accesso

**Nessuna tabella.** Unico contatto con il database: il modulo `settings` crea
`app.settings.usb_uid_format text not null default 'hex'` con
`check (usb_uid_format in ('hex', 'hex-reversed', 'dec', 'dec-reversed'))`, gli stessi valori di
`USB_UID_FORMATS`; lettura per gli operatori attivi, scrittura solo amministratori via
`app.update_settings(...)` (regole del modulo `settings`). Il formato canonico che `card-input` produce è
quello del vincolo di `app.cards.uid` (`^[0-9A-F]{8,20}$`), più stretto (numero pari di cifre). Il modulo
non chiama RPC né scrive dati: nessun controllo di ruolo nuovo; chi legge una card senza essere collegato
non riceve nulla perché il servizio è spento fuori da `RequireAuth`.

Niente intestazioni nuove: Web NFC non ha una voce di `Permissions-Policy`; `usb=()` in `vercel.json`
riguarda WebUSB, non il lettore a emulazione tastiera (HID), che quindi funziona senza modifiche. La
scrittura usa lo stesso permesso `nfc` della lettura: con la scansione attiva il permesso è già concesso,
quindi `write()` non apre richieste. Il modulo non chiama RPC nemmeno per scrivere: il link e il token li
genera e li conferma `cards`.

## Commands

```bash
npm run check:bundle   # node scripts/check-bundle.ts — dopo `npm run build`: fallisce se dist/
                       # (chunk JS e precache del service worker) contiene __enjoyFakeCard o fakeCardAdapter
```
Oggi la CI non ha un passo `build` separato (la build la fa il `webServer` di Playwright, che con questo
modulo usa `VITE_E2E=1`): il modulo aggiunge in `.github/workflows/ci.yml`, prima di "E2E", il passo
`npm run build && npm run check:bundle`. Lo stesso controllo entra in `vercel.json`
(`"buildCommand": "npm run build && npm run check:bundle"`), così nessun deploy (anteprima o produzione)
può pubblicare l'adattatore finto, nemmeno se per errore `VITE_E2E` fosse impostata su Vercel. Attenzione in
locale: dopo `npm run e2e` la cartella `dist/` contiene la build di prova; non si pubblica mai a mano.

## Project Structure

```
src/features/card-input/
  normalizeUid.ts (+ .test.ts)      → formati, USB_UID_FORMATS, UsbUidFormat
  cardReader.ts (+ .test.ts)        → servizio: pila dei consumatori, anti-ripetizione, vibrazione
  webNfcAdapter.ts (+ .test.ts)     → stati Web NFC dietro WebNfcApi
  webNfcWriter.ts (+ .test.ts)      → scrittura del record URL, verifica, tempi (punto 9)
  web-nfc.d.ts                      → tipi minimi di NDEFReader, write() e NDEFMessage (non sono in lib.dom)
  keyboardWedge.ts (+ .test.ts)     → lettore USB a emulazione tastiera
  fakeCardAdapter.ts                → window.__enjoyFakeCard, scrittura finta, __enjoyFakeCardWrites e
                                      __enjoyFakeCardControl (solo build E2E)
  CardReaderProvider.tsx, CardReaderSession.tsx, useCardRead.ts, useCardWriter.ts,
  CardReadPanel.tsx (+ .module.css, .test.tsx)
  usbFormats.test.ts                → la CHECK della migrazione di settings = USB_UID_FORMATS
src/test/fakeWebNfc.ts              → WebNfcApi finta per i test dei componenti (anche write() e letture
                                      con record URL)
scripts/check-bundle.ts             → controllo dell'assenza dell'adattatore finto
e2e/nfc.ts                          → stubWebNfc(page, …) con page.addInitScript; helper fakeCardWrites(page)
e2e/card-input.spec.ts
modificati: src/main.tsx, src/test/renderApp.tsx (CardReaderProvider), RequireAuth (CardReaderSession),
  src/vite-env.d.ts, playwright.config.ts (VITE_E2E), package.json (check:bundle),
  .github/workflows/ci.yml e vercel.json (build + check:bundle)
```
`CardReadPanel` compare anche in `/dev/ui` con tutti gli stati.

## Code Style

Come `platform` e `identity`: i componenti non toccano `NDEFReader`, `navigator` o `document` direttamente,
solo tramite il servizio e gli hook; tempi iniettabili (`now()`) per i test.

```ts
export function useCardRead(onRead: (read: CardRead) => void, { enabled = true } = {}) {
  const reader = useCardReader();
  const latest = useRef(onRead);
  useEffect(() => { latest.current = onRead; });
  useEffect(() => (enabled ? reader.pushConsumer((read) => latest.current(read)) : undefined),
    [reader, enabled]);
}
```

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP | nessuna tabella propria; il vincolo su `usb_uid_format` (valori ammessi e rifiutati) è nei test di `settings`. Qui `usbFormats.test.ts` (Vitest) legge il testo della migrazione di `settings` e verifica che la lista della CHECK sia esattamente `USB_UID_FORMATS`: un formato aggiunto da una parte sola rompe il test |
| Unità (Vitest) | `normalizeUid` **esaustivo**: Web NFC `"04:a1:b2:c3:d4:e5:f6"`, maiuscolo/minuscolo, separatori `-` e spazio, cifre consecutive, 4/7/10 byte, `hex-reversed` (`"F6E5D4C3B2A104"` → `04A1B2C3D4E5F6`); `dec` di un uid di 7 byte oltre 2^53 (`"1303689068602870"` → `04A1B2C3D4E5F6`), `dec-reversed` (`"69495546249912580"` → `04A1B2C3D4E5F6`), zeri iniziali (`"0012345678"` → `00BC614E`), completamento a 4/7/10 byte; invalidi: vuoto, solo spazi, `"04:a1:b"`, `"4:a1:b2:c3"`, `"0g"`, cifre dispari, 3 e 11 byte, tutto zero, decimale con segno o punto, decimale oltre 10 byte, formato sconosciuto. `keyboardWedge` con timer finti: raffica + Invio → lettura e `preventDefault` sull'Invio; raffica di lettere maiuscole con `Shift` fra un carattere e l'altro → lettura; intervallo > 50 ms → niente; bersaglio in `input`/`textarea`/`contenteditable` → niente e Invio non fermato; Ctrl/ripetizione azzerano; formato `dec` rifiuta lettere; adattatore spento senza formato e riacceso quando arriva. `cardReader`: pila (ultimo attivato riceve, togliere un consumatore che non è in cima non cambia chi riceve, al rilascio di quello in cima torna il precedente, `enabled: false` → `true` lo rimette in cima), stesso uid entro 2000 ms ignorato e a 2001 ms consegnato, uid diverso subito, nessun consumatore → scartato senza vibrazione, `vibrate` assente non rompe nulla, uid non valido scartato, servizio non attivato → nessuna lettura e nessuna `scan()`, disattivazione → `abort()` e listener tolto. `webNfcWriter` con `fakeWebNfc` e timer finti: card appena letta (< 1500 ms) → `write()` subito con un solo record `url` e `overwrite: true`, poi lettura con lo stesso URL → `ok`; lettura più vecchia di 1500 ms o lettura di un altro uid dopo → attesa, e un uid diverso → `wrong-card` senza `write()`; `NotAllowedError` → `not-allowed`; `NetworkError` → `io`; nessuna verifica in 15 s → `timeout` e `abort()`; lettura con URL diverso → `verify-failed`; `signal` del chiamante → `aborted`; `canWrite` falso → `cannot-write` senza `write()`; seconda scrittura in corso → `busy`; URL `http:`, relativo o di 201 caratteri → `TypeError`; `readingerror` in attesa → `unreadable` senza `write()`, con `allowUnreadable` → `write()`; lettura di un altro uid durante `write()` → `abort()` e `wrong-card` con `otherUid`; altro uid con lo stesso URL in verifica → `wrong-card` con `otherUid`, senza l'URL → ignorato; durante la scrittura i consumatori non ricevono letture e alla fine sì; `makeReadOnly` mai chiamato (spia); `canWrite` falso con stato `off`, `denied`, `unsupported` e con il solo lettore USB |
| Componenti (Vitest + Testing Library, servizi finti) | `CardReadPanel` con `fakeWebNfc` in ogni stato (testi, pulsante presente o assente, `start()` chiamato al tocco, regione live, variante `usb`); `granted` → `active` senza tocco; `prompt` → "Attiva la lettura" → `active`; `NotAllowedError` → `denied`; `NotReadableError` → `off` e ritorno automatico ad `active` su `visibilitychange` solo con permesso `granted` (con `prompt` nessuna `scan()`); `start()` due volte → la prima scansione interrotta; `unsupported` senza pulsante; pagina finta con due consumatori annidati e lettura dal lettore USB in formato `dec` (eventi `keydown` reali) → solo il consumatore in cima riceve `04A1B2C3D4E5F6`; `renderApp('/accedi')` con il servizio finto → nessuna attivazione; dopo "Esci" → servizio disattivato; `useCardWriter` in una pagina finta: `onStep` riceve `waiting-card` → `writing` → `verifying`, e una lettura durante la scrittura non arriva al consumatore della pagina |
| E2E (Playwright, 390×844, build con `VITE_E2E=1`, Supabase locale) | `stubWebNfc` (via `page.addInitScript`) sostituisce sia `NDEFReader` sia `navigator.permissions.query` per `nfc` (Chromium desktop non li ha). Permesso `prompt` → "Attiva la lettura" → riquadro attivo; scan che rifiuta con `NotReadableError` → "Lettura card spenta" con "Riprova la lettura" e la ricerca resta usabile; senza `NDEFReader` (iPhone) → riquadro spento senza pulsante; la home mostra il riquadro sopra la ricerca; raffica USB con `page.keyboard.type(..., { delay: 0 })` + Invio con il focus su "Nuovo cliente" → nessuna navigazione (Invio fermato); digitazione con `delay: 120` nella ricerca → il testo resta nel campo; `typeof window.__enjoyFakeCard === 'function'` e `Array.isArray(window.__enjoyFakeCardWrites)`. La consegna di una lettura a una schermata vera e la scrittura del link (fake card, registro delle scritture, lettore USB) la provano gli E2E di `cards` |
| Bundle | `npm run check:bundle` sulla build normale in CI e su Vercel: nessuna occorrenza di `__enjoyFakeCard` (prefisso anche di `__enjoyFakeCardWrites` e `__enjoyFakeCardControl`) né del chunk `fakeCardAdapter` |
| Manuale (RUNBOOK) | su un Android con Chrome e un NTAG215 di prova: scrittura del link con la card ancora appoggiata dopo la lettura, verifica (con o senza riavvicinare la card: annotare cosa fa Chrome), card allontanata durante la scrittura → `io` (annotare se la card resta leggibile o dà `readingerror`, e la riparazione con «Scrivi comunque»); con l'app aperta in home e la lettura attiva la card scritta apre Registra spesa e **non** il browser; con l'app in background o su `/accedi` Android apre la pagina dei punti (annotare se nel browser o nell'app installata); un NTAG215 nuovo (non formattato) si scrive senza passaggi in più; poi lo stesso tag letto da un iPhone XS o successivo con lo schermo sbloccato mostra la notifica che apre il link senza app, e da un Android di un'altra persona apre il browser |

## Boundaries

- **Always**: ogni uid passa da `normalizeUid` prima di uscire dal modulo; le card si scrivono solo con
  `writeUrl` (un record URL, su richiesta di `cards`), dopo aver riconosciuto la card appoggiata e con
  verifica rileggendola; `canWrite` falso dove non si può scrivere; `scan()` la prima volta solo da un tocco; il formato USB solo dalle impostazioni salvate; nei test solo uid
  inventati (es. `04A1B2C3D4E5F6`), mai codici di card reali consegnate ai clienti; adattatori accesi solo
  con un operatore collegato (`CardReaderSession` dentro `RequireAuth`).
- **Ask first**: cambiare `REPEAT_WINDOW_MS`, `MAX_KEY_GAP_MS`, `IN_FIELD_MS`, i tempi di scrittura o la
  durata della vibrazione dopo le prove al bar; intercettare le raffiche USB anche dentro i campi di testo;
  aggiungere formati USB; rendere le card di sola lettura (`makeReadOnly()`, irreversibile: il titolare per
  ora l'ha escluso); scrivere record diversi da un singolo URL.
- **Never**: bloccare un tag (`makeReadOnly()`); scrivere senza aver riconosciuto la card appoggiata (unica
  eccezione: `allowUnreadable`, dopo la conferma esplicita dell'operatore) o dichiarare scritto un link non
  verificato; ritentare una scrittura da solo; un campo di testo sempre
  attivo o nascosto per il lettore USB; l'adattatore o lo scrittore finto (o `window.__enjoyFakeCard*`) in
  una build senza `VITE_E2E=1`; salvare o registrare nei log gli uid letti o gli URL letti e scritti
  (contengono il token del cliente); passare gli URL letti ai consumatori; più di un consumatore che riceve
  la stessa lettura.

## Success Criteria

1. `normalizeUid('04:a1:b2:c3:d4:e5:f6', 'hex') === '04A1B2C3D4E5F6'`, e la stessa stringa esce da
   `('1303689068602870', 'dec')`, `('69495546249912580', 'dec-reversed')` e `('F6E5D4C3B2A104',
   'hex-reversed')`; ogni input non valido dei test unitari dà `null`.
2. Su un telefono Android con Chrome, al primo avvio compare "Attiva la lettura"; dopo il permesso, agli
   avvii successivi la lettura parte senza tocchi; una card appoggiata arriva al consumatore e il telefono
   vibra (verifica manuale con un NTAG215 di prova, annotata nel RUNBOOK).
3. Con NFC spento compare "Lettura card spenta"; attivando l'NFC nelle impostazioni e tornando all'app la
   lettura riparte da sola; attivandolo dalla tendina, riparte con "Riprova la lettura" (prova di componente
   + verifica manuale sul telefono).
4. Su iPhone (Safari o Chrome) il riquadro dice che le card non si leggono, senza pulsante, e la ricerca
   funziona.
5. Con due consumatori montati riceve solo l'ultimo attivato; la stessa card appoggiata due volte entro 2 s produce
   una sola lettura.
6. Una raffica di tasti < 50 ms chiusa da Invio produce una lettura e non attiva il pulsante con il focus;
   la digitazione umana e quella nei campi di testo non producono letture (test unitari di `keyboardWedge`
   ed E2E con il focus su "Nuovo cliente").
7. Sulla pagina di accesso e dopo "Esci" nessuna `scan()` è attiva e nessun tasto viene intercettato.
8. `npm run build && npm run check:bundle` è verde in CI e nel `buildCommand` di Vercel, e `dist/` non
   contiene `__enjoyFakeCard`; il controllo fallisce se si costruisce con `VITE_E2E=1` (provato una volta a
   mano); negli E2E `window.__enjoyFakeCard` esiste.
9. Typecheck, lint, Vitest ed E2E verdi in CI; detector Impeccable pulito su `CardReadPanel`; area di tocco
   dei pulsanti ≥ 48 px.
10. `writeUrl` scrive un solo record URL solo sulla card `expectedUid`, lo dichiara riuscito solo dopo
    averlo riletto uguale, non chiama mai `makeReadOnly()` (test unitari); su iPhone, con NFC spento e sul
    tablet `canWrite` è `false`; su un Android reale il link scritto apre la pagina dei punti anche da un
    iPhone XS o successivo (verifica manuale annotata nel RUNBOOK).

## Out of Scope (Deferred)

- Cosa succede dopo la lettura: card nota → Registra spesa, card sconosciuta → Nuovo cliente con la card,
  associa/sostituisci, card già di un altro cliente → modulo `cards`.
- Schermata per scegliere il formato del lettore USB → modulo `tablet-kiosk` (sezione LETTORE CARD); intestazione tablet "Lettore NFC
  USB collegato", schermate 1280×800 e cambio operatore → `tablet-kiosk`.
- Elementi dei wireframe elencati che non sono lettura card: titolo "Cerca cliente", avatar dell'operatore,
  campo "Oppure cerca per nome o email" (`SPEC-customers-v2.md`), "Serviti oggi" e "Nuovo cliente" della home → moduli che
  costruiscono la home (`customers`, `ledger`); in Associa card nome e punti del cliente, avviso "La card
  attuale (…E5F6) verrà disattivata. I punti restano a Maria." e "Annulla" → `cards`; nel tablet "Alla
  cassa: … · Cambia", "Lettore NFC USB collegato", "Chi è alla cassa?" e PIN → `tablet-kiosk`.
- Configurazione del tablet (nota `nt2`: "Mostra tastiera virtuale" con una tastiera USB collegata) e scelta
  del lettore → `tablet-kiosk` e RUNBOOK.
- Vibrazione dopo la conferma della spesa (nota `n1`) → `ledger`.
- Cosa contiene il link, token, pagina pubblica dei punti, stato "link non scritto" e testi della scrittura
  → modulo `cards`.
- Blocco dei tag in sola lettura (`makeReadOnly()`): escluso per ora dal titolare (irreversibile).
- Lettura card dentro l'app su iPhone, scrittura dal lettore USB del tablet, lettori PC/SC, modalità
  offline: non-obiettivi.

## Open Questions

1. **Vibrazione alla lettura**: le fonti la citano solo dopo la conferma della spesa (nota `n1`).
   Proposta: vibrazione di 80 ms a ogni lettura consegnata, se il browser la consente (default adottato).
   Limite tecnico: Chrome vibra solo dopo almeno un tocco sulla pagina; dopo un riavvio dell'app con
   permesso già concesso, la prima lettura può non vibrare finché l'operatore non tocca lo schermo. Nella
   spesa ci sarebbero due vibrazioni (lettura e conferma, nota `n1`).
2. **Anti-ripetizione**: nessuna fonte. Proposta: stesso uid ignorato per 2 s, uid diverso subito (default adottato).
3. **Permesso NFC negato**: nessun wireframe. Proposta: riquadro "Lettura card spenta" con il testo sulle
   impostazioni del sito in Chrome e "Riprova la lettura"; al ritorno nell'app, se il permesso è stato
   concesso, la lettura riparte da sola (default adottato); testo da approvare.
4. **iPhone / browser senza Web NFC**: il wireframe mostra "Riprova la lettura" anche lì. Proposta: stesso
   testo, ma senza pulsante, perché non può funzionare (default adottato).
5. **Stato di avvio** (`checking`/`starting`): nessun wireframe. Proposta: riquadro con "Avvio della
   lettura…" finché lo stato non è noto (default adottato).
6. **Raffiche USB dentro un campo di testo** (es. ricerca con il focus): Proposta: non intercettate, il
   codice finisce nel campo come testo; l'operatore tocca fuori dal campo e ripassa la card (default adottato).
7. **Soglie del lettore USB**: Proposta: ≤ 50 ms tra i tasti, almeno 4 caratteri, chiusura con Invio
   (default adottato); da verificare con il lettore scelto (nota `nt2`).
8. **Lettura USB non valida** (formato sbagliato nelle impostazioni): Proposta: scartata senza messaggio,
   registrata in `usb.lastInvalidAt` perché `tablet-kiosk`/`settings` possano mostrare un suggerimento
   (default adottato).
9. **"Lettore NFC USB collegato"**: un lettore a emulazione tastiera non si può rilevare. Proposta: il
   modulo espone solo `usb.lastReadAt`; testo e logica dell'indicatore li decide `tablet-kiosk` (default adottato).
10. **Uid da lettori decimali**: alcuni lettori economici mandano solo 4 dei 7 byte; nessuna impostazione
    lo corregge. Proposta: completamento a 4/7/10 byte e verifica prima dell'acquisto, come dicono le
    specifiche (default adottato).
11. **Lettore USB anche sul telefono**: Proposta: adattatore attivo su ogni dispositivo dopo il caricamento
    delle impostazioni, perché non rileva nulla con la digitazione normale (default adottato).
12. **Letture fuori dalle schermate che leggono card**: Proposta: scartate in silenzio, senza vibrazione
    (default adottato).
13. **Contratto vs codice** (tecnica, non serve il titolare): `CONTRACT.md` dice che `playwright.config.ts`
    imposta `VITE_E2E=1`, ma oggi non lo fa, e la CI non ha un passo `build` separato. Proposta: questo
    modulo aggiunge la variabile, il passo `build` + `check:bundle` in CI e il controllo nel `buildCommand`
    di Vercel (default adottato).
14. **Home prima di `cards`**: Proposta: il riquadro c'è ma la home non riceve letture (nessuna
    vibrazione) finché `cards` non collega la navigazione (default adottato, tecnica).
15. **Verifica dopo la scrittura** (tecnica): non è documentato se Chrome rilegge da sé una card rimasta
    appoggiata dopo `write()`. Proposta: la verifica aspetta una lettura fino a 15 s e la schermata chiede
    di allontanare e riavvicinare la card; dopo la prova sul telefono (RUNBOOK) il testo si toglie se la
    rilettura è automatica (default adottato).
16. **Card giusta prima di scrivere** (tecnica): Web NFC non permette di scegliere il tag. Proposta: si
    scrive solo se l'ultima lettura è la card attesa, da meno di 1,5 s e senza altre card lette dopo;
    altrimenti si aspetta di rileggerla (default adottato). Se nonostante questo un'altra card riceve il
    link (card scambiata durante `write()`), l'esito `wrong-card` con `otherUid` lo dice; il token in
    attesa non vale finché non è verificato sulla card giusta, quindi nessun saldo finisce sulla card
    sbagliata.
17. **Card con contenuto rovinato** (tecnica): Chrome dà `readingerror` senza uid. Proposta: fuori dalla
    scrittura si ignora (alla cassa si cerca per nome); in scrittura dà `unreadable` e si ripara con
    `allowUnreadable` dopo la conferma dell'operatore (default adottato).
