# Todo: card-input

Fonte: [plan.md](plan.md) · Spec: [SPEC-card-input.md](../../docs/specs/SPEC-card-input.md). Ogni task chiude con
`npm run typecheck && npm run lint && npm run format:check && npm test && npm run db:test &&
npm run test:integration && npm run e2e` verdi e un commit Conventional Commits sul branch
`feat/card-input`. Test prima del codice (`test-driven-development`). Solo lo stack Supabase locale
(`npm run db:start`, poi `scripts/reload-auth-templates.sh`); mai i progetti remoti. Solo uid e URL
inventati (es. `04A1B2C3D4E5F6`, `https://example.test/s/…`), mai codici di card reali.

## Task 1: Normalizzazione dell'uid e formati del lettore USB
**Descrizione:** `src/features/card-input/normalizeUid.ts`: `normalizeUid(raw, format)` per `'hex'`,
`'hex-reversed'`, `'dec'` (con `BigInt`, completamento a 4/7/10 byte), `'dec-reversed'`; `null` per ogni
input non valido (spec, punto 1). `USB_UID_FORMATS` e `UsbUidFormat` si spostano qui da
`src/features/settings/types.ts`, che li riesporta (il codice di `settings` non cambia). `usbFormats.test.ts`
legge `supabase/migrations/20261117230100_settings.sql` e confronta la lista della CHECK su
`usb_uid_format` con `USB_UID_FORMATS`.
**Accettazione:**
- [x] Unità (criterio 1): `('04:a1:b2:c3:d4:e5:f6','hex')`, `('1303689068602870','dec')`,
      `('69495546249912580','dec-reversed')`, `('F6E5D4C3B2A104','hex-reversed')` → `04A1B2C3D4E5F6`;
      separatori `-` e spazio, cifre consecutive, 4/7/10 byte, `('0012345678','dec')` → `00BC614E`
- [x] Unità: `null` per vuoto, solo spazi, `"04:a1:b"`, `"4:a1:b2:c3"`, `"0g"`, cifre dispari, 3 e 11 byte,
      tutto zero, decimale con segno o punto, decimale oltre 10 byte, formato sconosciuto
- [x] `usbFormats.test.ts` fallisce se la CHECK e `USB_UID_FORMATS` differiscono; test di `settings` invariati
**Verifica:** `npm test -- card-input settings`
**Dipendenze:** nessuna · **File:** src/features/card-input/normalizeUid.ts (+ .test.ts),
src/features/card-input/usbFormats.test.ts, src/features/settings/types.ts · **Dimensione:** M

## Task 2: Servizio di lettura
**Descrizione:** `cardReader.ts`: `createCardReader({ now, vibrate, adapters })` con `activate({ usbFormat })`,
`deactivate()`, `setUsbFormat()`, `pushConsumer(fn)` che restituisce la funzione di rilascio, `deliver(raw,
format, source)` interno per gli adattatori. Pila dei consumatori con rimozione per identità; anti-ripetizione
`REPEAT_WINDOW_MS = 2000` per uid (consegnata o no); `vibrate?.(80)` solo alla consegna, protetta da
`try/catch`; uid non valido o nessun consumatore → scartato senza vibrazione; servizio non attivato → nessuna
lettura. Tipi `CardRead`, `NfcStatus`, `CardReaderState` come nella spec (punto 5).
**Accettazione:**
- [x] Unità (criterio 5): riceve l'ultimo attivato; togliere un consumatore non in cima non cambia chi
      riceve; al rilascio di quello in cima torna il precedente; stesso uid a 1999 ms ignorato, a 2001 ms
      consegnato; uid diverso subito
- [x] Unità: nessun consumatore → niente vibrazione; `vibrate` assente o che lancia non rompe nulla; uid non
      valido scartato; prima di `activate()` e dopo `deactivate()` nessuna lettura e adattatori fermi (criterio 7)
- [x] Nessun `console.*` nel file
**Verifica:** `npm test -- cardReader`
**Dipendenze:** 1 · **File:** src/features/card-input/cardReader.ts (+ .test.ts) · **Dimensione:** S

## Task 3: Lettore USB a emulazione tastiera
**Descrizione:** `keyboardWedge.ts`: stato puro (buffer, ultimo tasto) e listener `keydown` in cattura sul
target iniettato (`document` in produzione). Caratteri ammessi dal formato, `MAX_KEY_GAP_MS = 50`, azzerano:
intervallo lungo, carattere non ammesso, Ctrl/Alt/Meta, `event.repeat`; `Shift`/`CapsLock` ignorati senza
azzerare. `Enter` con ≥ 4 caratteri entro 50 ms → al servizio con il formato, `preventDefault` +
`stopPropagation`. Bersaglio modificabile → nulla. Il servizio lo accende solo con un formato non `null` e
aggiorna `usb.lastReadAt` / `usb.lastInvalidAt`.
**Accettazione:**
- [x] Unità con timer finti (criterio 6): raffica + Invio → lettura e Invio fermato; lettere maiuscole con
      `Shift` fra i caratteri → lettura; intervallo > 50 ms → niente; Ctrl e ripetizione azzerano
- [x] Unità: bersaglio `input`/`textarea`/`select`/`contenteditable` → niente e Invio non fermato; `dec`
      rifiuta le lettere; lettura non valida → `lastInvalidAt`, nessuna consegna
- [x] Unità: formato `null` → listener assente; arriva il formato → acceso; cambio di formato vale dalla
      lettura successiva; `deactivate()` toglie il listener
**Verifica:** `npm test -- keyboardWedge cardReader`
**Dipendenze:** 2 · **File:** src/features/card-input/keyboardWedge.ts (+ .test.ts),
src/features/card-input/cardReader.ts (+ .test.ts) · **Dimensione:** M

## Task 4: Adattatore Web NFC
**Descrizione:** `web-nfc.d.ts` (tipi minimi di `NDEFReader`, `scan`, `write`, `NDEFMessage`, eventi);
`webNfcAdapter.ts` dietro `WebNfcApi`: `unsupported` senza `NDEFReader`; permesso `granted` → `scan()`
subito, `prompt` o query assente → `needs-permission`, `denied` → `denied`; esiti di `scan()` (`active`,
`NotAllowedError` → `denied`, `NotSupportedError` → `unsupported`, altri → `off`); `reading` →
`serialNumber` al servizio in `'hex'`; `readingerror` ignorato; `start()` interrompe la scansione attiva
prima di avviarne un'altra; "torna qui" su `visibilitychange` solo con permesso `granted`. Il servizio
espone lo stato `nfc` e lo notifica agli abbonati. `src/test/fakeWebNfc.ts` per unità e componenti.
**Accettazione:**
- [x] Unità (criteri 2 e 4): `granted` → `active` senza tocco; `prompt` → `needs-permission`, `start()` →
      `active`; senza `NDEFReader` → `unsupported` e nessuna `scan()`
- [x] Unità (criterio 3): `NotReadableError` → `off`; `visibilitychange` con `granted` → nuova `scan()` e
      `active`; con `prompt` nessuna `scan()` e `needs-permission`; con `denied` resta `denied`
- [x] Unità: `start()` due volte → la prima scansione interrotta (`abort()`); `deactivate()` → `abort()` e
      listener di visibilità tolto (criterio 7)
**Verifica:** `npm test -- webNfcAdapter cardReader`
**Dipendenze:** 2 · **File:** src/features/card-input/webNfcAdapter.ts (+ .test.ts),
src/features/card-input/web-nfc.d.ts, src/test/fakeWebNfc.ts, src/features/card-input/cardReader.ts ·
**Dimensione:** M

## Checkpoint A
- [ ] `npm test` verde; nessun test esistente cambiato
- [ ] Revisione `security-and-hardening`: nessun uid nei log, nessuna `scan()` senza tocco la prima volta,
      niente lettura prima di `activate()`
- [ ] Revisione con l'utente prima dei collegamenti

## Task 5: Provider e hook dei consumatori
**Descrizione:** `CardReaderProvider` (riceve il servizio, nessun avvio da solo) e `useCardReader()`;
`useCardRead(onRead, { enabled })` con il callback più recente in un ref (spec, "Code Style");
`useCardReaderState()` con `useSyncExternalStore` sullo stato del servizio più `start()`.
**Accettazione:**
- [x] Componente (criterio 5): due consumatori annidati → riceve solo quello in cima; smontare quello in cima
      ridà le letture all'altro; `enabled: false` → `true` lo rimette in cima; ordine invariato in `StrictMode`
- [x] Componente: il callback cambiato fra un render e l'altro riceve la lettura senza risottoscrivere;
      montare il provider non chiama `activate()`
- [x] `useCardReaderState` si aggiorna quando cambia lo stato `nfc`
**Verifica:** `npm test -- CardReaderProvider`
**Dipendenze:** 2, 4 · **File:** src/features/card-input/CardReaderProvider.tsx (+ .test.tsx),
src/features/card-input/useCardRead.ts · **Dimensione:** S

## Task 6: Lettura accesa solo con un operatore
**Descrizione:** `CardReaderSession` (dentro `SettingsProvider` in `RequireAuth`): `activate()` al montaggio,
`deactivate()` allo smontaggio, `setUsbFormat(settings.usbUidFormat)` solo con stato `ready`, altrimenti
`null`. `main.tsx` crea il servizio con gli adattatori veri e lo passa a `CardReaderProvider` intorno a
`RouterProvider`; `renderApp` accetta un quinto parametro facoltativo (servizio con `fakeWebNfc` e target
della tastiera di jsdom), i test esistenti restano invariati.
**Accettazione:**
- [x] Componente (criterio 7): `renderApp('/accedi')` → nessuna attivazione e nessuna `scan()`; dopo "Esci"
      servizio disattivato, `abort()` chiamato, un `keydown` non viene fermato
- [x] Componente (criteri 5 e 6): pagina finta con due consumatori annidati e formato `dec` nelle impostazioni
      finte, eventi `keydown` reali → solo quello in cima riceve `04A1B2C3D4E5F6`
- [x] Componente: impostazioni in caricamento o in errore → lettore USB spento; arrivano → acceso
**Verifica:** `npm test` (tutta la suite: `renderApp` cambia)
**Dipendenze:** 3, 5 · **File:** src/features/card-input/CardReaderSession.tsx (+ .test.tsx),
src/features/identity/RequireAuth.tsx, src/main.tsx, src/test/renderApp.tsx · **Dimensione:** M

## Task 7: Adattatore finto (lettura) nella sola build E2E
**Descrizione:** `fakeCardAdapter.ts`: `window.__enjoyFakeCard(uid)` manda `uid` al servizio come sorgente
`'fake'` in formato `'hex'`, con le stesse regole, qualunque sia lo stato Web NFC ma solo con il servizio
attivo. `main.tsx` lo installa con `import()` dentro `if (import.meta.env.VITE_E2E === '1')`;
`vite-env.d.ts` dichiara `VITE_E2E?: string`; `playwright.config.ts` aggiunge `VITE_E2E: '1'` all'ambiente
del `webServer`. Primo test di `e2e/card-input.spec.ts`.
**Accettazione:**
- [x] E2E (criterio 8): dopo l'accesso `typeof window.__enjoyFakeCard === 'function'`
- [x] Le suite E2E esistenti restano verdi con la build `VITE_E2E=1`
- [x] `npm run build` senza `VITE_E2E`: nessun `__enjoyFakeCard` in `dist/` (controllo a mano con `grep`,
      automatizzato nel task 8)
**Verifica:** `npm run e2e`
**Dipendenze:** 6 · **File:** src/features/card-input/fakeCardAdapter.ts, src/main.tsx, src/vite-env.d.ts,
playwright.config.ts, e2e/card-input.spec.ts · **Dimensione:** M

## Task 8: Controllo del bundle in CI e su Vercel
**Descrizione:** `scripts/check-bundle.ts` (`npm run check:bundle`): cerca `__enjoyFakeCard` e il nome del
chunk `fakeCardAdapter` nei file JS di `dist/` e nella precache del service worker; esce con errore e
l'elenco dei file. Logica di ricerca in una funzione con test di unità. In `.github/workflows/ci.yml` il passo
`npm run build && npm run check:bundle` prima di "E2E"; in `vercel.json` `"buildCommand": "npm run build &&
npm run check:bundle"`.
**Accettazione:**
- [x] Unità: trova l'occorrenza in un chunk e nel manifesto di precache; nessuna occorrenza → esito pulito;
      `dist/` assente → errore
- [x] Criterio 8: `npm run build && npm run check:bundle` verde; con `VITE_E2E=1 npm run build` fallisce
      (provato una volta a mano, annotato nel commit)
- [ ] CI verde sulla PR con il nuovo passo; il resto di `vercel.json` invariato (passo aggiunto e
      `vercel.json` cambiato solo nel `buildCommand`; manca la CI della PR, non ancora aperta)
**Verifica:** `npm run build && npm run check:bundle`; `npm test -- checkBundle`
**Dipendenze:** 7 · **File:** scripts/check-bundle.ts, scripts/checkBundle.test.ts, package.json,
.github/workflows/ci.yml, vercel.json · **Dimensione:** M

## Checkpoint B
- [ ] Quality bar completa verde in locale; test esistenti invariati
- [ ] `check:bundle` fallisce sulla build con `VITE_E2E=1` (prova a mano)
- [ ] Revisione con l'utente prima della scrittura

## Task 9: Scrittura: precondizioni, card riconosciuta, `write()`
**Descrizione:** `webNfcWriter.ts` dietro `WebNfcApi`: precondizioni (`canWrite` falso → `cannot-write`;
scrittura in corso → `busy`; URL non assoluto, non `https:` o oltre `MAX_URL_LENGTH = 200`, oppure
`expectedUid` non valido → `TypeError`). Passo `waiting-card`: si scrive subito solo se l'ultima lettura è
`expectedUid`, da meno di `IN_FIELD_MS = 1500`, senza altre letture dopo; altrimenti si aspetta (un altro uid →
`wrong-card` senza `write()`). Passo `writing`: `write({ records: [{ recordType: 'url', data: url }] },
{ overwrite: true, signal })`; esiti `not-allowed`, `io` (`NetworkError`, `NotReadableError`,
`NotSupportedError`), `aborted`. Il servizio apre una sessione esclusiva: letture solo allo scrittore,
senza anti-ripetizione, pila ripristinata alla fine. `fakeWebNfc` impara `write()`.
**Accettazione:**
- [x] Unità (criterio 10): card letta da < 1500 ms → `write()` subito con un solo record `url` e
      `overwrite: true`; lettura più vecchia o un altro uid dopo → attesa; un altro uid → `wrong-card` senza
      `write()`; `makeReadOnly` mai chiamato (spia)
- [x] Unità: `NotAllowedError` → `not-allowed`; `NetworkError` → `io`; `signal` del chiamante → `aborted`;
      `canWrite` falso → `cannot-write` senza `write()`; seconda scrittura → `busy`; URL `http:`, relativo o
      di 201 caratteri → `TypeError`
- [x] Unità: durante la scrittura i consumatori non ricevono letture; alla fine sì, con la pila di prima
**Verifica:** `npm test -- webNfcWriter cardReader`
**Dipendenze:** 4, 5 · **File:** src/features/card-input/webNfcWriter.ts (+ .test.ts),
src/features/card-input/cardReader.ts, src/features/card-input/web-nfc.d.ts, src/test/fakeWebNfc.ts ·
**Dimensione:** M

## Task 10: Scrittura: verifica, tempi, card rovinata e card scambiata
**Descrizione:** l'adattatore Web NFC inoltra al servizio gli URL dei record `url` (decodificati con
`TextDecoder`) e le `readingerror`, solo verso lo scrittore. Passo `verifying`: riuscita solo se una lettura di
`expectedUid` riporta esattamente `url`; stesso uid con altro contenuto → `verify-failed`; altro uid con `url`
→ `wrong-card` con `otherUid`, senza → ignorato; `readingerror` ignorato. Un altro uid durante `write()` →
`abort()` e `wrong-card` con `otherUid`. `readingerror` in attesa → `unreadable`, con `allowUnreadable` vale
come la card attesa. `WRITE_TIMEOUT_MS` e `VERIFY_TIMEOUT_MS` (15 000) → `abort()` e `timeout`. Successo →
`vibrate?.(80)`. `start()` durante una scrittura → `aborted`.
**Accettazione:**
- [x] Unità (criterio 10): lettura con lo stesso URL → `ok` solo dopo la verifica; URL diverso →
      `verify-failed`; nessuna verifica in 15 s → `timeout` e `abort()`
- [x] Unità: altro uid durante `write()` → `abort()` e `wrong-card` con `otherUid`; altro uid con lo stesso
      URL in verifica → `wrong-card` con `otherUid`, senza → ignorato; `readingerror` in attesa →
      `unreadable` senza `write()`, con `allowUnreadable` → `write()`
- [x] Unità: fuori da una scrittura gli URL letti e le `readingerror` non arrivano ai consumatori; nessun URL
      in un `CardRead` né in console
**Verifica:** `npm test -- webNfcWriter webNfcAdapter`
**Dipendenze:** 9 · **File:** src/features/card-input/webNfcWriter.ts (+ .test.ts),
src/features/card-input/webNfcAdapter.ts (+ .test.ts) · **Dimensione:** M

## Task 11: `useCardWriter` e `canWrite`
**Descrizione:** lo stato del servizio calcola `canWrite` (`nfc === 'active'` e `NDEFReader` con `write`, o lo
scrittore finto della build E2E); il lettore USB non scrive mai. `useCardWriter()` restituisce `{ canWrite,
writeUrl }` dal servizio del provider.
**Accettazione:**
- [ ] Unità (criterio 10): `canWrite` falso con stato `off`, `denied`, `unsupported` e con il solo lettore USB;
      vero con `active` e `write` disponibile
- [ ] Componente: in una pagina finta `onStep` riceve `waiting-card` → `writing` → `verifying`, e una lettura
      durante la scrittura non arriva al consumatore della pagina
**Verifica:** `npm test -- useCardWriter cardReader`
**Dipendenze:** 10 · **File:** src/features/card-input/useCardWriter.ts (+ .test.tsx),
src/features/card-input/cardReader.ts (+ .test.ts) · **Dimensione:** S

## Task 12: Scrittura finta per gli E2E
**Descrizione:** nello stesso `fakeCardAdapter.ts`: memoria dei tag `uid → url`; `__enjoyFakeCard(uid)` è la
card appoggiata (consegna la lettura con l'URL in memoria e completa una scrittura in attesa); card appoggiata
da meno di `IN_FIELD_MS` → scrittura subito e verifica sulla memoria senza un nuovo tocco;
`window.__enjoyFakeCardWrites` registra ogni scrittura riuscita; `window.__enjoyFakeCardControl` con
`failNextWrite(reason)` (`'io'` lascia il tag rovinato: `unreadable` finché non si riscrive) e
`setCanWrite(value)`. `e2e/nfc.ts` con l'helper `fakeCardWrites(page)`.
**Accettazione:**
- [ ] Unità: scrittura con la card appena appoggiata → `ok` e una voce nel registro; ogni `failNextWrite`
      dà l'esito corrispondente; dopo `'io'` la card rovinata dà `unreadable` e si ripara con
      `allowUnreadable`; `setCanWrite(false)` → `canWrite` falso
- [ ] E2E (criterio 8): `Array.isArray(window.__enjoyFakeCardWrites)` e `__enjoyFakeCardControl` presente
- [ ] Tutti i nomi iniziano con `__enjoyFakeCard`; `check:bundle` verde sulla build normale
**Verifica:** `npm test -- fakeCardAdapter && npm run build && npm run check:bundle && npm run e2e`
**Dipendenze:** 8, 11 · **File:** src/features/card-input/fakeCardAdapter.ts (+ .test.ts), e2e/nfc.ts,
e2e/card-input.spec.ts · **Dimensione:** M

## Checkpoint C
- [ ] Tutti i casi di `webNfcWriter` elencati nella Testing Strategy della spec coperti da test di unità
- [ ] Revisione `security-and-hardening`: mai `makeReadOnly`, scrittura solo sulla card riconosciuta, URL mai
      fuori dal modulo né nei log, nessun ritentativo automatico
- [ ] Revisione con l'utente prima della UI

## Task 13: Riquadro "Lettura card"
**Descrizione:** `CardReadPanel` (`<section aria-label="Lettura card">`) con i testi della spec (punto 6) per
`checking`/`starting`, `active` (titolo e testo dal consumatore), `needs-permission` ("Attiva la lettura"),
`off` e `denied` ("Riprova la lettura"), `unsupported` (nessun pulsante); `mode="usb"` (ignora Web NFC);
`variant="compact"` (una riga "Lettura attiva: puoi anche avvicinare la card", solo in `active`). `Button`
del design system, `Icon name="nfc"`, token, regione `aria-live="polite"`. Tutti gli stati in `/dev/ui`.
`CardReadPanel: ['title']` in `scripts/displayGlyphs.test.ts`.
**Accettazione:**
- [ ] Componente (criteri 2, 3 e 4): con `fakeWebNfc` in ogni stato testi giusti, pulsante presente o
      assente, `start()` al tocco; `prompt` → "Attiva la lettura" → attivo; `NotReadableError` → "Lettura
      card spenta" e ritorno ad attivo su `visibilitychange` con `granted`; `unsupported` senza pulsante
- [ ] Componente: regione live che annuncia il cambio; variante `usb` con i testi del consumatore e senza
      stati di permesso; `compact` vuota fuori da `active`
- [ ] Impeccable pulito su `src/features/card-input`; pulsanti ≥ 48 px (56 px); `displayGlyphs` verde
**Verifica:** `npm test -- CardReadPanel displayGlyphs`; `/dev/ui` a 390×844
**Dipendenze:** 5, 11 · **File:** src/features/card-input/CardReadPanel.tsx (+ .module.css, .test.tsx),
src/app/dev/UiGallery.tsx, scripts/displayGlyphs.test.ts · **Dimensione:** M

## Task 14: Riquadro nella home ed E2E
**Descrizione:** in `src/features/customers/HomePage.tsx`, al posto del commento segnaposto, `CardReadPanel`
sopra la ricerca con i testi del wireframe Cerca cliente ("Avvicina la card" / "Lettura attiva: appoggia la
card sul retro del telefono. Una card nuova apre la registrazione del cliente."); variante compatta mentre la
home mostra una ricerca; `useCardRead(…, { enabled: false })`. `e2e/nfc.ts` aggiunge `stubWebNfc(page, …)`
(via `page.addInitScript`, sostituisce `NDEFReader` e `navigator.permissions.query` per `nfc`).
**Accettazione:**
- [ ] Componente: riquadro sopra "Cerca per nome o telefono"; con una ricerca la riga compatta; una lettura
      finta non naviga e non vibra
- [ ] E2E (criteri 2, 3, 4): permesso `prompt` → "Attiva la lettura" → riquadro attivo; `NotReadableError` →
      "Lettura card spenta" con "Riprova la lettura" e la ricerca usabile; senza `NDEFReader` → riquadro
      spento senza pulsante
- [ ] E2E (criterio 6): raffica con `delay: 0` + Invio con il focus su "Nuovo cliente" → nessuna
      navigazione; digitazione con `delay: 120` nella ricerca → il testo resta nel campo; screenshot 390×844
      confrontato con i wireframe Main, NFC-permesso, NFC-spento e Ricerca-vuota
**Verifica:** `npm test -- HomePage && npm run e2e`
**Dipendenze:** 6, 12, 13 · **File:** src/features/customers/HomePage.tsx, HomePage.test.tsx, e2e/nfc.ts,
e2e/card-input.spec.ts · **Dimensione:** M

## Checkpoint D
- [ ] Impeccable pulito; confronto con i wireframe a 390×844
- [ ] Quality bar completa verde
- [ ] Revisione con l'utente

## Task 15: Guardia del confine, RUNBOOK e memoria di progetto
**Descrizione:** `scripts/cardInputBoundary.test.ts`: fuori da `src/features/card-input/` nessun file usa
`NDEFReader`, `navigator.vibrate`, `permissions.query` o listener `keydown` su `document`; nel modulo nessun
`console.*` e nessun `makeReadOnly`; `__enjoyFakeCard` compare solo in `fakeCardAdapter.ts` e nella condizione
di `main.tsx`. RUNBOOK: procedura manuale su Android con un NTAG215 di prova (spec, Testing Strategy,
"Manuale") e trappole trovate; `CLAUDE.md` (`npm run check:bundle`); `brain/MAP.md` e `brain/STATUS.md`.
**Accettazione:**
- [ ] La guardia fallisce se un componente chiama `NDEFReader` o se nel modulo compare un `console.log`
- [ ] La procedura manuale copre i criteri 2, 3 e 10 passo per passo, con dove annotare l'esito
- [ ] Nessun segreto, uid o URL reale nei documenti
**Verifica:** `npm test -- cardInputBoundary`; rilettura
**Dipendenze:** 14 · **File:** scripts/cardInputBoundary.test.ts, brain/topics/operations/RUNBOOK.md,
CLAUDE.md, brain/MAP.md, brain/STATUS.md · **Dimensione:** M

## Task 16: Verifica dei criteri di successo e PR
**Descrizione:** sezione "Verifica dei criteri di successo" in `plan.md` con, per ognuno dei 10 criteri, i
test che lo provano (`file › titolo`); `scripts/cardInputCriteria.test.ts` (come `rewardsCriteria.test.ts`)
controlla che ogni criterio ne abbia almeno uno e che ogni test esista nel file indicato. Le parti manuali
(criteri 2, 3 e 10 su Android, criterio 8 con `VITE_E2E=1`) restano annotate come tali. PR su `main`, da unire
dopo #18.
**Accettazione:**
- [ ] `cardInputCriteria.test.ts` verde con 10 criteri
- [ ] Quality bar completa verde; `npm run build && npm run check:bundle` verde
- [ ] PR aperta con base `main`, descrizione con le verifiche manuali ancora da fare sul telefono
**Verifica:** `npm test -- cardInputCriteria`; CI della PR
**Dipendenze:** 15 · **File:** tasks/card-input/plan.md, tasks/card-input/todo.md,
scripts/cardInputCriteria.test.ts · **Dimensione:** S

## Checkpoint E
- [ ] I 10 criteri di successo di SPEC-card-input verificati (la parte manuale su Android con l'utente,
      sull'anteprima pubblicata dall'orchestratore)
- [ ] PR pronta per `code-review-and-quality`
