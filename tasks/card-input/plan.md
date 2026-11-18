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
- [ ] Task 6: `CardReaderSession` in `RequireAuth`; `main.tsx` e `renderApp`
- [ ] Task 7: Adattatore finto (lettura) solo con `VITE_E2E=1`; Playwright con `VITE_E2E`
- [ ] Task 8: `check:bundle` in CI e nel `buildCommand` di Vercel

### Checkpoint B: quality bar completa verde; `check:bundle` fallisce a mano con `VITE_E2E=1`; test esistenti invariati

### Fase 3: Scrittura del link
- [ ] Task 9: `writeUrl`: precondizioni, card riconosciuta, `write()` e sessione esclusiva
- [ ] Task 10: `writeUrl`: verifica, tempi, card rovinata e card scambiata
- [ ] Task 11: `useCardWriter` e `canWrite` nello stato
- [ ] Task 12: Scrittura finta per gli E2E (`__enjoyFakeCardWrites`, `__enjoyFakeCardControl`)

### Checkpoint C: tutti i casi di scrittura della spec con test di unità; revisione `security-and-hardening` (mai `makeReadOnly`, URL mai fuori dal modulo)

### Fase 4: Riquadro e home
- [ ] Task 13: `CardReadPanel` in ogni stato, varianti `usb` e `compact`, `/dev/ui`
- [ ] Task 14: Riquadro nella home ed E2E di `card-input`

### Checkpoint D: Impeccable pulito; confronto con i wireframe Cerca cliente, Lettura card: primo avvio, Lettura card spenta e Ricerca senza risultati a 390×844

### Fase 5: Chiusura
- [ ] Task 15: Guardia del confine, procedura manuale nel RUNBOOK, memoria di progetto
- [ ] Task 16: Verifica dei criteri di successo e PR

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
