# Implementation Plan: card-input

Source spec: [SPEC-card-input.md](../../docs/specs/SPEC-card-input.md) (approvata il 2026-11-17; le Open Questions
usano i default adottati)

## Overview

Un unico ingresso per la lettura delle card in tutta l'app. Web NFC sul telefono, lettore USB a emulazione
tastiera e adattatore finto dei test consegnano lo stesso evento `CardRead` con l'uid già normalizzato
(`04A1B2C3D4E5F6`), e lo consegnano solo al consumatore in cima alla pila. Il modulo offre anche l'unica via
per scrivere una card: `useCardWriter().writeUrl` scrive un solo record URL sulla card riconosciuta e lo
dichiara scritto solo dopo averlo riletto uguale. Le schermate vedono lo stato della lettura nel riquadro
`CardReadPanel`, che il modulo inserisce nella home "Cerca cliente" con il consumatore spento: lo accende
`cards`. Nessuna tabella, nessuna RPC: il solo contatto con il database è `app.settings.usb_uid_format`, già
creato da `settings`.

## Architecture Decisions

- **Prima la logica pura, poi i collegamenti, poi la UI.** I rischi maggiori stanno nelle macchine a stati
  (pila dei consumatori, anti-ripetizione, raffiche USB, stati Web NFC, scrittura con verifica) e
  nell'infrastruttura di prova (build E2E con `VITE_E2E=1` e nessuna traccia del finto nella build normale).
  Si fissano con test di unità con timer finti e con `check:bundle` prima di ogni riga di UI.
- **Nessuna migrazione.** Il vincolo `usb_uid_format` esiste già (`20261117230100_settings.sql`).
  `USB_UID_FORMATS` e `UsbUidFormat` si spostano da `src/features/settings/types.ts` a
  `src/features/card-input/normalizeUid.ts` (spec, punto 1); `settings/types.ts` li riesporta, così il codice
  di `settings` resta invariato. `usbFormats.test.ts` legge la CHECK della migrazione di `settings` e la
  confronta con la lista.
- **Servizio unico, adattatori dietro interfacce.** `createCardReader({ webNfc, keyboardTarget, now,
  vibrate })` vive in `cardReader.ts`; `WebNfcApi` (`webNfcAdapter.ts`) e il target della tastiera si
  iniettano, i tempi passano da `now()`. Nei test di unità e di componente si usa `src/test/fakeWebNfc.ts`;
  i componenti non toccano mai `NDEFReader`, `navigator` o `document` (guardia
  `scripts/cardInputBoundary.test.ts`, come `customersBoundary.test.ts` e `rewardsBoundary.test.ts`).
- **Iniettato come gli altri servizi, acceso solo con un operatore.** Il servizio si crea in `main.tsx` e
  passa a `CardReaderProvider`, che avvolge `RouterProvider` (in `renderApp` un quinto parametro facoltativo
  con adattatori finti: i test esistenti restano invariati). `CardReaderSession`, montato da `RequireAuth`
  dentro `SettingsProvider`, chiama `activate()`/`deactivate()` e `setUsbFormat()` dallo stato di
  `useSettings()`: niente `scan()` né ascolto dei tasti su `/accedi` o dopo "Esci".
- **Adattatore finto solo nella build E2E.** `fakeCardAdapter.ts` si importa con `import()` dentro
  `if (import.meta.env.VITE_E2E === '1')` in `main.tsx`; `playwright.config.ts` aggiunge `VITE_E2E: '1'`
  all'ambiente del `webServer`. `scripts/check-bundle.ts` (`npm run check:bundle`) fallisce se `dist/`
  contiene `__enjoyFakeCard` o il chunk `fakeCardAdapter`; entra nella CI (passo `npm run build && npm run
  check:bundle` prima di "E2E", quindi sulla build normale) e nel `buildCommand` di `vercel.json`. La sua
  logica di ricerca ha un test di unità; la prova con `VITE_E2E=1` (deve fallire) si fa una volta a mano.
- **Scrittura in due task.** Il task 9 copre precondizioni, riconoscimento della card (`IN_FIELD_MS`),
  `write()` e i suoi esiti; il task 10 la verifica, i tempi, `readingerror`/`allowUnreadable` e le card
  scambiate. Durante una scrittura il servizio passa le letture solo allo scrittore (sessione esclusiva,
  senza anti-ripetizione) e poi ridà la pila com'era. Gli URL letti restano dentro il modulo: mai in
  `CardRead`, mai nei log.
- **UI dai componenti del design system.** `CardReadPanel` usa `Button` (56 px), `Icon name="nfc"`, token e
  una regione `aria-live="polite"`; tre forme: completa (telefono), `mode="usb"` (tablet, la usa solo
  `tablet-kiosk`), `variant="compact"` (wireframe "Ricerca senza risultati"). Il titolo è in Enjoy Display:
  `CardReadPanel: ['title']` entra in `scripts/displayGlyphs.test.ts` (nessun `… « » @ # * × →` nei titoli;
  "Avvio della lettura…" è testo, non titolo).
- **La home non consuma letture.** Il riquadro va in `src/features/customers/HomePage.tsx` al posto del
  commento segnaposto, sopra la ricerca; `useCardRead(…, { enabled: false })` finché `cards` non collega la
  navigazione. Mentre la home mostra una ricerca, il riquadro passa alla variante compatta (cross-review,
  "Ricerca senza risultati").
- **E2E nel progetto `phone`** (parallelo, nessuno stato condiviso): `e2e/nfc.ts` con `stubWebNfc(page, …)`
  via `page.addInitScript` (sostituisce `NDEFReader` e `navigator.permissions.query` per `nfc`) e
  `fakeCardWrites(page)`. La consegna di una lettura a una schermata vera e la scrittura del link dalla UI le
  provano gli E2E di `cards`.
- **Verifiche manuali su Android**: la procedura va nel RUNBOOK (task 15); la prova sul telefono richiede
  HTTPS e si fa con l'utente sull'anteprima pubblicata dall'orchestratore. Fino ad allora i criteri 2, 3 e
  10 restano aperti per la sola parte manuale.
- **Pubblicazione esclusa da questo piano:** nessuna migrazione da pubblicare; l'anteprima e la produzione
  le gestisce l'orchestratore. La PR va su `main` e si unisce dopo #18 (`feat/rewards`).

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Logica pura (rischio più alto)
- [x] Task 1: `normalizeUid` esaustivo e `USB_UID_FORMATS` allineato alla CHECK di `settings`
- [x] Task 2: Servizio di lettura: pila dei consumatori, anti-ripetizione, vibrazione, attivazione
- [x] Task 3: Lettore USB a emulazione tastiera (`keyboardWedge`) collegato al servizio
- [x] Task 4: Adattatore Web NFC: stati, permesso, "torna qui", riavvio

### Checkpoint A: unità verdi con timer finti; revisione `security-and-hardening` (nessun uid nei log, niente lettura senza operatore)

### Fase 2: Collegamento all'app e infrastruttura di prova
- [x] Task 5: `CardReaderProvider`, `useCardRead`, `useCardReaderState`
- [x] Task 6: `CardReaderSession` in `RequireAuth`; `main.tsx` e `renderApp`
- [x] Task 7: Adattatore finto (lettura) solo con `VITE_E2E=1`; Playwright con `VITE_E2E`
- [x] Task 8: `check:bundle` in CI e nel `buildCommand` di Vercel

### Checkpoint B: quality bar completa verde; `check:bundle` fallisce a mano con `VITE_E2E=1`; test esistenti invariati

### Fase 3: Scrittura del link
- [x] Task 9: `writeUrl`: precondizioni, card riconosciuta, `write()` e sessione esclusiva
- [x] Task 10: `writeUrl`: verifica, tempi, card rovinata e card scambiata
- [x] Task 11: `useCardWriter` e `canWrite` nello stato
- [x] Task 12: Scrittura finta per gli E2E (`__enjoyFakeCardWrites`, `__enjoyFakeCardControl`)

### Checkpoint C: tutti i casi di scrittura della spec con test di unità; revisione `security-and-hardening` (mai `makeReadOnly`, URL mai fuori dal modulo)

### Fase 4: Riquadro e home
- [x] Task 13: `CardReadPanel` in ogni stato, varianti `usb` e `compact`, `/dev/ui`
- [x] Task 14: Riquadro nella home ed E2E di `card-input`

### Checkpoint D: Impeccable pulito; confronto con i wireframe Cerca cliente, Lettura card: primo avvio, Lettura card spenta e Ricerca senza risultati a 390×844

### Fase 5: Chiusura
- [x] Task 15: Guardia del confine, procedura manuale nel RUNBOOK, memoria di progetto
- [x] Task 16: Verifica dei criteri di successo e PR

### Checkpoint E: i 10 criteri verificati (la parte manuale su Android con l'utente); quality bar completa verde; PR su `main` pronta per `code-review-and-quality`, da unire dopo #18

## Copertura dei criteri di successo

| Criterio (docs/specs/SPEC-card-input.md) | Task |
|---|---|
| 1. `normalizeUid` dà `04A1B2C3D4E5F6` da hex, dec, dec-reversed, hex-reversed; ogni input non valido → `null` | 1 |
| 2. Android: "Attiva la lettura" al primo avvio, poi lettura senza tocchi; card al consumatore con vibrazione | 2, 4, 6, 13, 14, 15 (manuale) |
| 3. NFC spento → "Lettura card spenta"; ritorno all'app → riparte da sola; dalla tendina → "Riprova la lettura" | 4, 13, 14, 15 (manuale) |
| 4. iPhone: riquadro che dice che le card non si leggono, senza pulsante; ricerca funzionante | 4, 13, 14 |
| 5. Due consumatori: riceve solo l'ultimo attivato; stessa card entro 2 s → una lettura | 2, 5, 6 |
| 6. Raffica < 50 ms + Invio → una lettura senza attivare il pulsante col focus; digitazione umana e nei campi → nulla | 3, 6, 14 |
| 7. Su `/accedi` e dopo "Esci" nessuna `scan()` e nessun tasto intercettato | 2, 6 |
| 8. `build && check:bundle` verde in CI e su Vercel; fallisce con `VITE_E2E=1`; negli E2E `__enjoyFakeCard` esiste | 7, 8, 12, 14 |
| 9. Typecheck, lint, Vitest, E2E verdi; Impeccable pulito su `CardReadPanel`; pulsanti ≥ 48 px | ogni task; 13, 14, 16 |
| 10. `writeUrl`: un solo record URL, solo su `expectedUid`, riuscito solo dopo la rilettura, mai `makeReadOnly`; `canWrite` falso su iPhone, NFC spento e tablet; link aperto da iPhone (manuale) | 9, 10, 11, 12, 15 (manuale) |

## Verifica dei criteri di successo

Verifica finale del task 16 (2026-11-18), con la quality bar completa verde in locale. Ogni prova è scritta
come `file › titolo del test` (per i test con `it.each` il titolo con i segnaposto, come nel file);
`scripts/cardInputCriteria.test.ts` controlla che ogni criterio ne abbia almeno una e che ognuna esista
davvero nel file indicato.

| Criterio (docs/specs/SPEC-card-input.md) | Test che lo prova |
|---|---|
| 1. `normalizeUid` dà `04A1B2C3D4E5F6` da hex, dec, dec-reversed, hex-reversed; ogni input non valido → `null` | `src/features/card-input/normalizeUid.test.ts › %s (%s) → 04A1B2C3D4E5F6`, `src/features/card-input/normalizeUid.test.ts › rejects an unknown format`, `src/features/card-input/normalizeUid.test.ts › always returns the canonical form of app.cards.uid or null` |
| 2. Android: "Attiva la lettura" al primo avvio, poi lettura senza tocchi; card al consumatore con vibrazione | `src/features/card-input/webNfcAdapter.test.ts › with the permission granted starts scanning at once, without a tap`, `src/features/card-input/webNfcAdapter.test.ts › calls scan() synchronously on start(), inside the tap (user activation)`, `src/features/card-input/webNfcAdapter.test.ts › hands the serial number to the service in hex, which delivers the canonical uid`, `src/features/card-input/cardReader.test.ts › vibrates 80 ms when a read is delivered`, `src/features/card-input/CardReadPanel.test.tsx › granted: active with the consumer text, no tap and no button (criterion 2)`, `src/features/card-input/CardReadPanel.test.tsx › prompt: "Attiva la lettura" starts the scan on tap, then active (criterion 2)`, `e2e/card-input.spec.ts › first start: "Attiva la lettura" turns reading on, above the search` |
| 3. NFC spento → "Lettura card spenta"; ritorno all'app → riparte da sola; dalla tendina → "Riprova la lettura" | `src/features/card-input/webNfcAdapter.test.ts › NFC off in the phone settings → off; back on the page with granted → new scan and active`, `src/features/card-input/webNfcAdapter.test.ts › NFC turned on from the quick settings (no visibility change): "Riprova" restarts`, `src/features/card-input/CardReadPanel.test.tsx › NotReadableError: "Lettura card spenta", back to active on return with granted (criterion 3)`, `src/features/card-input/CardReadPanel.test.tsx › off: "Riprova la lettura" calls start() again (NFC turned on from the shade)`, `e2e/card-input.spec.ts › NFC off: "Lettura card spenta" with "Riprova la lettura", and the search still works` |
| 4. iPhone: riquadro che dice che le card non si leggono, senza pulsante; ricerca funzionante | `src/features/card-input/webNfcAdapter.test.ts › without NDEFReader (iPhone) is unsupported and never scans, not even on start()`, `src/features/card-input/CardReadPanel.test.tsx › unsupported (iPhone): the off text and no button (criterion 4)`, `e2e/card-input.spec.ts › iPhone (no NDEFReader): reading off without a button, and the search still works` |
| 5. Due consumatori: riceve solo l'ultimo attivato; stessa card entro 2 s → una lettura | `src/features/card-input/cardReader.test.ts › delivers only to the most recently pushed consumer`, `src/features/card-input/cardReader.test.ts › gives the reads back to the previous consumer when the top one is released`, `src/features/card-input/cardReader.test.ts › ignores the same uid read again 1999 ms later`, `src/features/card-input/cardReader.test.ts › still ignores the same uid exactly 2000 ms later ("within 2000 ms")`, `src/features/card-input/cardReader.test.ts › delivers the same uid read again 2001 ms later`, `src/features/card-input/CardReaderProvider.test.tsx › a panel mounted in StrictMode (double effects) still ends up on top, once`, `src/features/card-input/CardReaderSession.test.tsx › gives a USB read in the saved format only to the consumer on top (criteria 5 and 6)` |
| 6. Raffica < 50 ms + Invio → una lettura senza attivare il pulsante col focus; digitazione umana e nei campi → nulla | `src/features/card-input/keyboardWedge.test.ts › delivers a fast burst closed by Enter and stops the Enter`, `src/features/card-input/keyboardWedge.test.ts › reads nothing when the keys are more than 50 ms apart, and lets the Enter through`, `src/features/card-input/keyboardWedge.test.ts › reads nothing from %s and does not stop the Enter`, `src/features/card-input/keyboardWedge.test.ts › listens in the capture phase`, `e2e/card-input.spec.ts › a burst closed by Enter is a read: the focused "Nuovo cliente" is not followed`, `e2e/card-input.spec.ts › typing at a human pace in the search stays in the field` |
| 7. Su `/accedi` e dopo "Esci" nessuna `scan()` e nessun tasto intercettato | `src/features/card-input/CardReaderSession.test.tsx › reads nothing on the sign-in page (criterion 7)`, `src/features/card-input/CardReaderSession.test.tsx › stops reading after "Esci" (criterion 7)`, `src/features/card-input/CardReaderProvider.test.tsx › does not start anything by itself: no activate(), no scan()`, `src/features/card-input/cardReader.test.ts › starts nothing and reads nothing before activate()`, `src/features/card-input/keyboardWedge.test.ts › deactivate() removes the listener` |
| 8. `build && check:bundle` verde in CI e su Vercel; fallisce con `VITE_E2E=1`; negli E2E `__enjoyFakeCard` esiste | `scripts/checkBundle.test.ts › finds the fake reader global inside a JS chunk`, `scripts/checkBundle.test.ts › finds the fake adapter chunk in the service worker precache manifest`, `scripts/checkBundle.test.ts › finds a chunk named after the fake adapter even when its content is clean`, `scripts/cardInputBoundary.test.ts › loads the fake adapter only from main.tsx behind VITE_E2E`, `scripts/cardInputBoundary.test.ts › names window.__enjoyFakeCard only in fakeCardAdapter.ts`, `e2e/card-input.spec.ts › the E2E build exposes the fake card reader once an operator is signed in`, `e2e/card-input.spec.ts › the E2E build exposes the fake writer: an empty write log and the test controls` |
| 9. Typecheck, lint, Vitest, E2E verdi; Impeccable pulito su `CardReadPanel`; pulsanti ≥ 48 px | `scripts/cardInputBoundary.test.ts › keeps NDEFReader, navigator.vibrate, permissions.query and document keydown in card-input`, `e2e/card-input.spec.ts › first start: "Attiva la lettura" turns reading on, above the search`, `e2e/card-input.spec.ts › NFC off: "Lettura card spenta" with "Riprova la lettura", and the search still works` |
| 10. `writeUrl`: un solo record URL, solo su `expectedUid`, riuscito solo dopo la rilettura, mai `makeReadOnly`; `canWrite` falso su iPhone, NFC spento e tablet | `src/features/card-input/webNfcWriter.test.ts › a card read less than IN_FIELD_MS ago is written at once, with one url record and overwrite`, `src/features/card-input/webNfcWriter.test.ts › another uid read while waiting ends with wrong-card and nothing written`, `src/features/card-input/webNfcWriter.test.ts › another uid while write() runs → abort() and wrong-card with its uid`, `src/features/card-input/webNfcWriter.test.ts › ok only once a read of the expected card reports exactly the url; then it vibrates`, `src/features/card-input/webNfcWriter.test.ts › the expected card with another url → verify-failed, no vibration`, `scripts/cardInputBoundary.test.ts › never logs nor calls makeReadOnly inside card-input`, `src/features/card-input/cardReader.test.ts › is true only with Web NFC active and a writer that can write`, `src/features/card-input/cardReader.test.ts › is false with only the USB reader (tablet): the USB reader never writes`, `src/features/card-input/useCardWriter.test.tsx › has canWrite false where Web NFC is unsupported (iPhone, tablet)`, `src/features/card-input/useCardWriter.test.tsx › refuses with cannot-write and touches no card when canWrite is false` |

Parti manuali, ancora da fare sul telefono con l'utente sull'anteprima HTTPS (procedura nel RUNBOOK): criteri
2 e 3 su un Android reale con un NTAG215 di prova (permesso al primo avvio, lettura senza tocchi agli avvii
successivi, vibrazione, NFC spento e riacceso dalle impostazioni e dalla tendina); criterio 10, il link scritto
che apre la pagina dei punti anche da un iPhone XS o successivo. Note sul criterio 3: `canWrite` falso con NFC
spento segue da `is true only with Web NFC active and a writer that can write`. Note sul criterio 8: il
fallimento di `check:bundle` con una build `VITE_E2E=1` è provato a mano (una volta, task 8) e dai tre test di
`checkBundle.test.ts` su chunk finti; `buildCommand` di Vercel e il job di CI eseguono
`npm run build && npm run check:bundle`. Note sul criterio 9: il detector Impeccable non è un test;
`impeccable detect src/features/card-input` non segnala nulla; i 48 px dei pulsanti "Attiva la lettura" e
"Riprova la lettura" sono provati dagli E2E nel progetto Playwright `phone` (390×844); i comandi della quality
bar sono stati eseguiti tutti.

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| L'adattatore o lo scrittore finto finiscono nella build pubblicata | Alto | `import()` dentro la condizione su `VITE_E2E`; `check:bundle` in CI e nel `buildCommand` di Vercel; prova a mano che fallisce con `VITE_E2E=1` |
| Il link scritto sulla card di un altro cliente | Alto | Scrittura solo con l'ultima lettura = `expectedUid` da meno di 1500 ms; `wrong-card` con `otherUid` durante `write()` e in verifica; test di unità per ogni ramo |
| Card bloccata per sempre in sola lettura | Alto | `makeReadOnly` mai chiamato (spia nei test, guardia del confine che cerca `makeReadOnly` in `src/`) |
| Uid o URL con il token del cliente nei log | Alto | Nessun `console.*` nel modulo (guardia); URL letti mai in `CardRead` (tipo e test) |
| Lettura attiva senza operatore (su `/accedi`, dopo "Esci") | Medio | Servizio acceso solo da `CardReaderSession` dentro `RequireAuth`; test di componente con `renderApp('/accedi')` e dopo "Esci" |
| L'Invio del lettore USB attiva il pulsante con il focus | Medio | `preventDefault` + `stopPropagation` in fase di cattura; E2E con il focus su "Nuovo cliente" |
| Digitazione nella ricerca scambiata per una card | Medio | Bersagli modificabili esclusi; soglia 50 ms; E2E con `delay: 120` |
| Due `scan()` contemporanee o `scan()` senza tocco (Chrome la rifiuta) | Medio | `abort()` prima di ogni nuova `scan()`; `scan()` da sola solo con permesso `granted`; test con `fakeWebNfc` |
| `StrictMode` che inverte la pila dei consumatori | Medio | Rimozione per identità; test di componente in `StrictMode` |
| Formato USB indovinato prima delle impostazioni | Basso | Adattatore USB spento finché lo stato non è `ready`; test |
| Comportamento reale di Chrome (rilettura dopo `write()`, `readingerror`) diverso dalle ipotesi | Medio | Procedura manuale nel RUNBOOK con l'utente su Android; testi aggiustati poi in `cards` (OQ 15) |
| Template email dopo `supabase start` | Basso | `scripts/reload-auth-templates.sh` dopo l'avvio dello stack (RUNBOOK) |

## Open Questions

Nessuna bloccante. Le Open Questions della spec usano i default adottati (vibrazione 80 ms a ogni lettura
consegnata, anti-ripetizione 2 s, permesso negato con "Riprova la lettura", iPhone senza pulsante, stato di
avvio, raffiche USB non intercettate nei campi, soglie 50 ms / 4 caratteri / Invio, lettura USB non valida in
`usb.lastInvalidAt`, nessun rilevamento del lettore, completamento a 4/7/10 byte, lettore USB attivo su ogni
dispositivo, letture senza consumatore scartate, `VITE_E2E` e `check:bundle` aggiunti qui, home senza
consumatore fino a `cards`, verifica fino a 15 s, card riconosciuta entro 1,5 s, `unreadable` con
`allowUnreadable`), da rivedere con il titolare (`docs/specs/cross-review.md` §3). Le verifiche su un Android
reale (criteri 2, 3 e 10) servono l'anteprima HTTPS pubblicata dall'orchestratore.
