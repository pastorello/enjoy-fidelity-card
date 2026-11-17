# Spec: card-input — V1

Status: approvata (2026-11-17) su delega dell'utente — le Open Questions adottano i default proposti, da rivedere con il titolare (`docs/specs/cross-review.md` §3)
Modulo: `card-input` ([CAPABILITY-MAP.md](CAPABILITY-MAP.md)) · Dipende da: `platform`, `settings` ·
Fonti: specifiche (sezioni "Architettura", "Contesto e vincoli", "Nuovo cliente e consegna della card"),
wireframe Cerca cliente, Lettura card: primo avvio, Lettura card spenta, Associa card, Tablet: cerca cliente,
Tablet: associa card, Tablet: cambio operatore (intestazione "Lettore NFC USB collegato"), note `n1`, `n2`,
`nt2`, `nt3` ·
Decisioni: `brain/DECISIONS.md` (2026-11-16 "Lettore NFC USB generico con formato configurabile").

## Objective

Un **unico ingresso** per la lettura delle card in tutta l'app: qualunque sia la sorgente (Web NFC sul
telefono, lettore USB a emulazione tastiera sul tablet, adattatore finto nei test), le schermate ricevono lo
stesso evento con l'uid già normalizzato in esadecimale maiuscolo senza separatori. Il modulo non sa nulla di
clienti e card registrate: consegna l'uid a chi lo sta aspettando. Cosa farne (aprire Registra spesa, Nuovo
cliente, associare) lo decidono i moduli `cards`, `customers` e `tablet-kiosk`.

**Utenti**: amministratori e operatori, senza differenze di ruolo (tutti leggono card). Solo l'amministratore
sceglie il formato del lettore USB, ma quella schermata è del modulo `tablet-kiosk` (colonna e funzione di
`settings`).

**Successo**: sul telefono Android la card appoggiata al retro arriva alla schermata attiva come
`04A1B2C3D4E5F6` subito (un passo dell'obiettivo "dalla card alla conferma in meno di 10 secondi", nota
`n1`); su iPhone o con NFC spento l'app lo dice e la ricerca resta usabile;
lo stesso uid arriva identico dal lettore USB con il formato configurato.

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
   - evento `reading` → `serialNumber` al servizio con formato `'hex'`; `readingerror` (tag non leggibile)
     si ignora: l'operatore riavvicina la card;
   - **"torna qui"** (testo del wireframe Lettura card spenta): con stato `off` o `denied`, quando la pagina
     torna visibile (`visibilitychange` → `visible`) si rilegge il permesso e, **solo se è `granted`**, si
     ritenta `scan()` da solo; con permesso `prompt` o `denied` non si chiama `scan()` (servirebbe un tocco),
     lo stato diventa `needs-permission` o resta `denied`. Se l'NFC si riattiva dalla tendina
     senza lasciare l'app la pagina non cambia visibilità: per questo resta il pulsante "Riprova la lettura";
   - `start()` con una scansione già attiva la interrompe (`abort()`) prima di avviarne una nuova: mai due
     `scan()` contemporanee;
   - le card **non si scrivono mai**: nessuna chiamata a `NDEFReader.write()` o `makeReadOnly()`.
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
   type CardReaderState = { nfc: NfcStatus; usb: { enabled: boolean; format: UsbUidFormat | null;
                            lastReadAt: number | null; lastInvalidAt: number | null } };
   function useCardRead(onRead: (read: CardRead) => void, options?: { enabled?: boolean }): void;
   function useCardReaderState(): CardReaderState & { start(): Promise<void> };
   ```
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
   | `active` | titolo e testo del consumatore (home: "Avvicina la card" / "Lettura attiva: appoggia la card sul retro del telefono. Una card nuova apre la registrazione del cliente."; Associa card: "Avvicina la card nuova" / "L'app legge solo il codice della card: non ci scrive nulla.") | — |
   | `needs-permission` | "Lettura delle card" / "Serve una volta sola: il telefono chiede il permesso di usare l'NFC." | "Attiva la lettura" → `start()` |
   | `off` | "Lettura card spenta" / "Attiva l'NFC nelle impostazioni del telefono e torna qui. Su iPhone le card non si leggono: cerca il cliente per nome o telefono." | "Riprova la lettura" → `start()` |
   | `denied` | "Lettura card spenta" / "Il permesso NFC è negato: consentilo a Enjoy Card nelle impostazioni di Chrome (Impostazioni sito → NFC) e riprova." | "Riprova la lettura" → `start()` |
   | `unsupported` | "Lettura card spenta" / stesso testo di `off` | nessun pulsante (non c'è nulla da riprovare) |
   - variante `mode="usb"` per il tablet: titolo e testo del consumatore (Tablet: cerca cliente "Passa la
     card sul lettore" / "L'app riceve il codice dal lettore da sola, senza bisogno di toccare un campo. Una
     card nuova apre la registrazione del cliente."; Tablet: associa card "Passa la card nuova sul lettore"
     / "L'app legge solo il codice della card: non ci scrive nulla."); ignora lo stato Web NFC (il tablet
     non ha NFC) e non ha stati di permesso. La usa solo `tablet-kiosk`.
   - variante `variant="compact"` (wireframe Ricerca senza risultati): una sola riga "Lettura attiva: puoi
     anche avvicinare la card" con l'icona NFC, solo nello stato `active`; negli altri stati non mostra nulla
     (il riquadro completo torna quando la ricerca si svuota). La sceglie la home di `customers` mentre
     mostra una ricerca; la lettura resta attiva.
   - Il cambio di stato si annuncia con una regione `aria-live="polite"`; pulsanti `Button` (56 px);
     sotto il riquadro la ricerca resta sempre disponibile (la mette la schermata, non il riquadro).
7. **Adattatore finto per i test** (`fakeCardAdapter.ts`): `window.__enjoyFakeCard(uid: string): void`
   manda `uid` al servizio come sorgente `'fake'` con formato `'hex'` (accetta `"04:a1:…"` e `"04A1…"`),
   con le stesse regole (normalizzazione, anti-ripetizione, consumatore attivo, vibrazione). Funziona
   qualunque sia lo stato Web NFC, ma solo con il servizio attivo (operatore collegato, punto 2). Si
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
riguarda WebUSB, non il lettore a emulazione tastiera (HID), che quindi funziona senza modifiche.

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
  web-nfc.d.ts                      → tipi minimi di NDEFReader (non sono in lib.dom)
  keyboardWedge.ts (+ .test.ts)     → lettore USB a emulazione tastiera
  fakeCardAdapter.ts                → window.__enjoyFakeCard (solo build E2E)
  CardReaderProvider.tsx, CardReaderSession.tsx, useCardRead.ts, CardReadPanel.tsx (+ .module.css, .test.tsx)
  usbFormats.test.ts                → la CHECK della migrazione di settings = USB_UID_FORMATS
src/test/fakeWebNfc.ts              → WebNfcApi finta per i test dei componenti
scripts/check-bundle.ts             → controllo dell'assenza dell'adattatore finto
e2e/nfc.ts                          → stubWebNfc(page, …) con page.addInitScript
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
| Unità (Vitest) | `normalizeUid` **esaustivo**: Web NFC `"04:a1:b2:c3:d4:e5:f6"`, maiuscolo/minuscolo, separatori `-` e spazio, cifre consecutive, 4/7/10 byte, `hex-reversed` (`"F6E5D4C3B2A104"` → `04A1B2C3D4E5F6`); `dec` di un uid di 7 byte oltre 2^53 (`"1303689068602870"` → `04A1B2C3D4E5F6`), `dec-reversed` (`"69495546249912580"` → `04A1B2C3D4E5F6`), zeri iniziali (`"0012345678"` → `00BC614E`), completamento a 4/7/10 byte; invalidi: vuoto, solo spazi, `"04:a1:b"`, `"4:a1:b2:c3"`, `"0g"`, cifre dispari, 3 e 11 byte, tutto zero, decimale con segno o punto, decimale oltre 10 byte, formato sconosciuto. `keyboardWedge` con timer finti: raffica + Invio → lettura e `preventDefault` sull'Invio; raffica di lettere maiuscole con `Shift` fra un carattere e l'altro → lettura; intervallo > 50 ms → niente; bersaglio in `input`/`textarea`/`contenteditable` → niente e Invio non fermato; Ctrl/ripetizione azzerano; formato `dec` rifiuta lettere; adattatore spento senza formato e riacceso quando arriva. `cardReader`: pila (ultimo attivato riceve, togliere un consumatore che non è in cima non cambia chi riceve, al rilascio di quello in cima torna il precedente, `enabled: false` → `true` lo rimette in cima), stesso uid entro 2000 ms ignorato e a 2001 ms consegnato, uid diverso subito, nessun consumatore → scartato senza vibrazione, `vibrate` assente non rompe nulla, uid non valido scartato, servizio non attivato → nessuna lettura e nessuna `scan()`, disattivazione → `abort()` e listener tolto |
| Componenti (Vitest + Testing Library, servizi finti) | `CardReadPanel` con `fakeWebNfc` in ogni stato (testi, pulsante presente o assente, `start()` chiamato al tocco, regione live, variante `usb`); `granted` → `active` senza tocco; `prompt` → "Attiva la lettura" → `active`; `NotAllowedError` → `denied`; `NotReadableError` → `off` e ritorno automatico ad `active` su `visibilitychange` solo con permesso `granted` (con `prompt` nessuna `scan()`); `start()` due volte → la prima scansione interrotta; `unsupported` senza pulsante; pagina finta con due consumatori annidati e lettura dal lettore USB in formato `dec` (eventi `keydown` reali) → solo il consumatore in cima riceve `04A1B2C3D4E5F6`; `renderApp('/accedi')` con il servizio finto → nessuna attivazione; dopo "Esci" → servizio disattivato |
| E2E (Playwright, 390×844, build con `VITE_E2E=1`, Supabase locale) | `stubWebNfc` (via `page.addInitScript`) sostituisce sia `NDEFReader` sia `navigator.permissions.query` per `nfc` (Chromium desktop non li ha). Permesso `prompt` → "Attiva la lettura" → riquadro attivo; scan che rifiuta con `NotReadableError` → "Lettura card spenta" con "Riprova la lettura" e la ricerca resta usabile; senza `NDEFReader` (iPhone) → riquadro spento senza pulsante; la home mostra il riquadro sopra la ricerca; raffica USB con `page.keyboard.type(..., { delay: 0 })` + Invio con il focus su "Nuovo cliente" → nessuna navigazione (Invio fermato); digitazione con `delay: 120` nella ricerca → il testo resta nel campo; `typeof window.__enjoyFakeCard === 'function'`. La consegna di una lettura a una schermata vera (fake card e lettore USB) la provano gli E2E di `cards` |
| Bundle | `npm run check:bundle` sulla build normale in CI e su Vercel: nessuna occorrenza di `__enjoyFakeCard` né del chunk `fakeCardAdapter` |

## Boundaries

- **Always**: ogni uid passa da `normalizeUid` prima di uscire dal modulo; le card si leggono soltanto;
  `scan()` la prima volta solo da un tocco; il formato USB solo dalle impostazioni salvate; nei test solo uid
  inventati (es. `04A1B2C3D4E5F6`), mai codici di card reali consegnate ai clienti; adattatori accesi solo
  con un operatore collegato (`CardReaderSession` dentro `RequireAuth`).
- **Ask first**: cambiare `REPEAT_WINDOW_MS`, `MAX_KEY_GAP_MS` o la durata della vibrazione dopo le prove
  al bar; intercettare le raffiche USB anche dentro i campi di testo; aggiungere formati USB.
- **Never**: scrivere o bloccare un tag; un campo di testo sempre attivo o nascosto per il lettore USB;
  l'adattatore finto (o `window.__enjoyFakeCard`) in una build senza `VITE_E2E=1`; salvare o registrare nei
  log gli uid letti; più di un consumatore che riceve la stessa lettura.

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

## Out of Scope (Deferred)

- Cosa succede dopo la lettura: card nota → Registra spesa, card sconosciuta → Nuovo cliente con la card,
  associa/sostituisci, card già di un altro cliente → modulo `cards`.
- Schermata per scegliere il formato del lettore USB → modulo `tablet-kiosk` (sezione LETTORE CARD); intestazione tablet "Lettore NFC
  USB collegato", schermate 1280×800 e cambio operatore → `tablet-kiosk`.
- Elementi dei wireframe elencati che non sono lettura card: titolo "Cerca cliente", avatar dell'operatore,
  campo "Oppure cerca per nome o telefono", "Serviti oggi" e "Nuovo cliente" della home → moduli che
  costruiscono la home (`customers`, `ledger`); in Associa card nome e punti del cliente, avviso "La card
  attuale (…E5F6) verrà disattivata. I punti restano a Maria." e "Annulla" → `cards`; nel tablet "Alla
  cassa: … · Cambia", "Lettore NFC USB collegato", "Chi è alla cassa?" e PIN → `tablet-kiosk`.
- Configurazione del tablet (nota `nt2`: "Mostra tastiera virtuale" con una tastiera USB collegata) e scelta
  del lettore → `tablet-kiosk` e RUNBOOK.
- Vibrazione dopo la conferma della spesa (nota `n1`) → `ledger`.
- Scrittura dei tag, lettura su iPhone, lettori PC/SC, modalità offline: non-obiettivi.

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
