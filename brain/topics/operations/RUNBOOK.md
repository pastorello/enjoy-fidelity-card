# RUNBOOK — Comandi, controlli, dove guardare, trappole

> Cambia lentamente, si aggiunge e non si riscrive. Chi scrive un HANDOFF mette qui procedure e trappole nuove.

---

## 1. Comandi

Prima volta: `npm install`, poi `cp .env.example .env` e incollare in `.env` il `PUBLISHABLE_KEY` locale
mostrato da `npm run db:start` (Docker deve essere acceso).

```bash
npm run dev                                 # app su http://localhost:5173 (vetrina componenti: /dev/ui, solo in sviluppo)
npm run typecheck && npm run lint && npm test && npm run build   # controlli prima di ogni commit
npm run format                              # Prettier
npm run db:start / db:stop                  # Supabase locale (Docker)
npm run db:reset                            # riapplica migrazioni + seed
npm run db:test                             # test pgTAP in supabase/tests/
npm run test:integration                    # Vitest contro lo stack locale (tests/integration/), Supabase acceso
./scripts/reload-auth-templates.sh          # se arriva l'email "Reset your password" o "You've been invited" (trappole 28 e 53)
cp supabase/functions/.env.example supabase/functions/.env   # una volta: APP_ORIGINS della Edge Function, nessuna chiave
npx supabase functions serve                # Edge Function operator-invites in locale (serve a integrazione ed E2E degli inviti)
npx supabase migration new <nome> </dev/null   # nuova migrazione (vedi trappola 5)
npm run tokens                              # rigenera src/styles/tokens.css da design/tokens.json
npm run icons                               # rigenera le icone PWA da design/enjoy-badge-solo-negative.png
npm run e2e                                 # Playwright sulla build: telefono 390×844 e tablet 1280×800, contro Supabase locale (deve essere acceso)
npm run dev:https                           # HTTPS sulla rete locale (certificato autofirmato), per il telefono
npx impeccable detect src/                  # scansione design (anche su URL del dev server)
npx skills add <owner>/<repo> --skill <nome> --agent claude-code   # aggiungere una skill di progetto
bash ~/.claude/plugins/cache/sprout-labs/project-brain/*/scripts/doctor.sh .   # controllo di brain/
```

Account finti del seed (solo locale): `admin@example.com` (amministratore "Admin Prova") e
`operatore@example.com` (operatore "Operatore Prova"), password `password-di-prova`.
`recupero@example.com` ("Recupero Prova", operatore) è riservato a `e2e/password.spec.ts`, che ne cambia
la password a ogni esecuzione: non usarlo altrove (`npm run db:reset` lo riporta a `password-di-prova`).
Tablet della cassa (`tablet-kiosk`, stessa password): `cassa@example.com` ("Tablet cassa", il dispositivo
di `e2e/tablet.spec.ts`), `cassa-blocco@example.com` ("Tablet blocco", riservato al test dei 5 PIN errati) e
`cassa-pin@example.com` ("Tablet cambio PIN", riservato a `e2e/tablet-pin.spec.ts`) e
`cassa-layout@example.com` ("Tablet layout", riservato a `e2e/tablet-layout.spec.ts`); `pin@example.com`
("Pin Prova", operatore senza PIN, riservato allo stesso test). PIN finti del seed: Admin Prova `2468`,
Operatore Prova `1357`, Recupero Prova `8024`.
Operatori (`operators`, stessa password): `admin-operatori@example.com` ("Admin Operatori", amministratore),
`disattiva@example.com` ("Disattiva Prova") e `ruolo@example.com` ("Ruolo Prova"), riservati a
`e2e/operators.spec.ts`; `cassa-operatori@example.com` ("Tablet operatori") con `turno@example.com` ("Turno
Prova", PIN `8642`) e `nuovo@example.com` ("Nuovo Prova", senza PIN), riservati a
`e2e/tablet-operators.spec.ts` (trappola 47). PIN finti: Disattiva Prova `3579`, Ruolo Prova `4680`, Admin
Operatori `9753`. Gli invitati dei test hanno nomi ed email casuali
(`invito-<casuale>@example.com`).

Stack locale minimo per E2E e integrazione (Postgres, Auth, API REST, Mailpit: lo stesso della CI):

```bash
npx supabase start -x studio,imgproxy,storage-api,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta
```

Email locali (recupero password): le cattura **Mailpit**, mai una casella vera. Si leggono su
http://127.0.0.1:54324 (anche dall'app in sviluppo: "Password dimenticata?" → link nell'email di Mailpit);
nei test con `e2e/mailpit.ts` (API `/api/v1/search`).

### Operatori

Invitare, cambiare ruolo, disattivare e riattivare: dall'app, **Impostazioni → GESTIONE → Operatori**
(`/impostazioni/operatori`, solo amministratori), procedura in `docs/setup-accounts.md` §4.
Solo il **primo amministratore** (e la riserva, se l'invito non è disponibile) passa dal pannello Supabase +
`select private.add_operator('<email>', '<nome>', 'admin' | 'operator');` nello SQL Editor. Nei progetti
online lo schema `app` va esposto nella Data API (§3 della stessa guida); migrazione, Edge Function e
template "Invite user" li pubblica l'orchestratore ("Note di deploy" di `docs/specs/SPEC-operators.md`).
Sui progetti online (staging e produzione) Auth → **Email OTP Expiration** = `86400` (24 ore, link d'invito e
di recupero: `docs/setup-accounts.md` §6 passo 3; in locale `otp_expiry` di `supabase/config.toml`, che
vale solo dopo `npx supabase stop` e un nuovo `start`). Dal tablet un amministratore si invita, si promuove o
si riattiva solo col PIN del cassiere ripetuto (stesso contatore di `/cassa`); se il tablet resta in
"Troppi tentativi", vale la riga di §3.

Edge Function in locale (`supabase/functions/operator-invites/`):
1. stack acceso (comando sopra, Mailpit compreso) e `./scripts/reload-auth-templates.sh`;
2. la prima volta `cp supabase/functions/.env.example supabase/functions/.env` (solo `APP_ORIGINS`; il file
   è ignorato da git e non ospita mai chiavi: `SUPABASE_URL` e le chiavi le dà l'Edge runtime);
3. `npx supabase functions serve` in un terminale a parte (parte anche con `edge-runtime` escluso da
   `supabase start -x`); pronta quando `curl -s -o /dev/null -w '%{http_code}' -X POST
   http://127.0.0.1:54321/functions/v1/operator-invites -H 'Origin: http://localhost:5173'` dà `401`;
4. ora `npm run test:integration` e `npm run e2e`; l'email d'invito si legge su http://127.0.0.1:54324.
Senza il passo 3 `tests/integration/operators.test.ts` si ferma con "operator-invites is not served". La CI
fa gli stessi passi (`.github/workflows/ci.yml`). La funzione non si pubblica mai da qui. Password dimenticata: la persona
usa "Password dimenticata?" su `/accedi` (o Impostazioni → Cambia password); nei progetti online serve la
procedura del §6 (URL di ritorno, template "Reset password", minimo 8 caratteri), dalla dashboard, prima
staging poi produzione, mai `supabase config push`.

### Pubblicazione

- Vercel pubblica da solo: anteprima per ogni PR (Supabase di staging), produzione da `main`.
- Database: `npx supabase link --project-ref <ref>` e `npx supabase db push`, **a mano**, prima su staging
  e poi su produzione. Procedura completa in `docs/setup-accounts.md`.
- CI: `.github/workflows/ci.yml` (job App ed E2E, job Database con il solo Postgres).
- **Link sulle card** (`cards`): `VITE_CARD_LINK_ORIGIN` si imposta su Vercel **solo** per l'ambiente
  Production, con l'origine definitiva dell'app (`https://…`, senza percorso né `/` finale; default
  `https://enjoy-fidelity-card.vercel.app`, `brain/DECISIONS.md` 2026-11-17). Senza, la build di produzione
  fallisce (`VERCEL_ENV=production`, `vite.config.ts`). In locale e nelle anteprime resta vuota (l'app usa
  il proprio indirizzo). Dopo il lancio **non si cambia**: i link già scritti sulle card smetterebbero di
  funzionare (SPEC-cards, "Ask first").
- Le card dei clienti si scrivono **solo dall'app di produzione**: una card scritta da un'anteprima o in
  locale porta un link al database di staging, che in produzione è un link morto. Per le prove si usano
  solo card di prova, poi riscritte dall'app di produzione se vanno consegnate.

### Provare sul telefono Android

1. **Consigliato**: telefono collegato via USB con il debug USB attivo, `npm run dev`, poi in Chrome sul
   computer `chrome://inspect` → *Port forwarding* `5173 → localhost:5173`. Sul telefono si apre
   `http://localhost:5173`: localhost è un contesto sicuro, quindi Web NFC funziona senza certificati.
2. In alternativa: `npm run dev:https` e sul telefono l'indirizzo `https://<ip>:<porta>` stampato in console,
   accettando l'avviso del certificato autofirmato.
3. Oppure l'anteprima Vercel della PR, già in HTTPS.

### Prova manuale della lettura card (`card-input`, criteri 2, 3 e 10)

Gli E2E simulano Web NFC (trappola 2): queste prove si fanno a mano, una volta per rilascio di `card-input`
o `cards`, con l'utente. Serve: un telefono Android con Chrome aggiornato e l'NFC, l'app in HTTPS (punto 3
sopra, oppure il punto 1), un account del seed o di staging, **un NTAG215 di prova nuovo** (mai una card
già consegnata a un cliente) e, per il criterio 10, un iPhone XS o successivo e un secondo Android. Nei
documenti e nelle note non si scrivono mai l'uid della card né il link scritto (contiene il token del
cliente): basta "card di prova A".

**Prima di `cards`** la home non consuma le letture (`enabled: false`): avvicinando una card in home non
succede nulla e il telefono **non** vibra, ed è corretto. I passi marcati *(con `cards`)* si fanno quando
l'anteprima contiene Registra spesa e Associa card.

**Criterio 2 — primo avvio, permesso, lettura senza tocchi**

1. Chrome → Impostazioni sito → NFC: togliere il permesso dato in passato all'indirizzo dell'app (se c'è).
2. Aprire l'app e accedere. In home, sopra la ricerca, il riquadro mostra "Lettura delle card" e
   "Attiva la lettura". Esito atteso: nessuna richiesta di permesso prima del tocco.
3. Toccare "Attiva la lettura" → Chrome chiede il permesso NFC → Consenti. Il riquadro diventa
   "Avvicina la card".
4. Chiudere la scheda, riaprire l'app: il riquadro arriva a "Avvicina la card" **senza tocchi** (passa al
   massimo da "Avvio della lettura…").
5. *(con `cards`)* Appoggiare la card di prova sul retro del telefono: si apre Registra spesa (card nota) o
   Nuovo cliente con la card (card nuova) e il telefono vibra una volta, breve. Riappoggiarla entro 2 s non
   produce una seconda lettura.
6. Uscire con "Esci": su `/accedi` una card appoggiata non fa nulla nell'app (Android può aprire la pagina
   dei punti nel browser se la card ha il link, vedi criterio 10, passo 5).

**Criterio 3 — NFC spento e ripresa**

1. Con l'app aperta in home, spegnere l'NFC dalle impostazioni del telefono e tornare all'app (o riaprirla):
   il riquadro mostra "Lettura card spenta", "Attiva l'NFC nelle impostazioni del telefono e torna qui…" e
   "Riprova la lettura". La ricerca per nome resta utilizzabile.
2. Andare nelle **impostazioni del telefono**, accendere l'NFC e tornare all'app: il riquadro torna da solo
   ad "Avvicina la card", senza toccare nulla.
3. Spegnere di nuovo l'NFC, poi riaccenderlo dalla **tendina delle notifiche** senza lasciare l'app: il
   riquadro resta spento (la pagina non cambia visibilità); "Riprova la lettura" → "Avvicina la card".
4. Chrome → Impostazioni sito → NFC → Blocca, poi tornare all'app: "Lettura card spenta" con il testo sul
   permesso negato e "Riprova la lettura". Rimettere Consenti e tornare all'app: riparte da sola.
5. Annotare: se al passo 1 Chrome ha dato "spento" subito o solo al primo `scan()`, e se al passo 3 la
   lettura è ripartita comunque da sola.

**Criterio 10 — scrittura del link (*con `cards`*: Associa card / consegna)**

1. NTAG215 nuovo, mai formattato: associarlo a un cliente di prova tenendo la card appoggiata dopo la
   lettura. Esito atteso: scrittura e verifica senza passaggi in più, messaggio di riuscita, una vibrazione.
   Annotare se per la verifica Chrome ha riletto la card da solo o se è servito riavvicinarla.
2. Ripetere allontanando la card **durante** la scrittura: esito "card non scritta" (`io`). Annotare se la
   card resta leggibile o se dà `readingerror` (card illeggibile) e se "Scrivi comunque" la ripara.
3. Ripetere avvicinando una seconda card di prova al posto della prima: nessuna scrittura sulla seconda
   (`wrong-card`).
4. Con l'app aperta in home e la lettura attiva, appoggiare la card scritta: si apre Registra spesa, **non**
   il browser.
5. Con l'app in background (o su `/accedi`): Android apre la pagina dei punti. Annotare se nel browser o
   nell'app installata.
6. Da un **iPhone XS o successivo**, schermo sbloccato e nessuna app: appare la notifica che apre il link
   alla pagina dei punti. Da un Android di un'altra persona: si apre il browser sulla pagina dei punti.
7. Su iPhone (Safari o Chrome) l'app non scrive card (`canWrite` falso) e la ricerca funziona; sul tablet
   (fase 3) il lettore USB legge soltanto.

**Dove annotare l'esito**: una riga nella tabella qui sotto per ogni prova (data, telefono e versione di
Chrome, criterio e passo, esito: ok / diverso, cosa è successo). Un comportamento di Chrome diverso da
quello atteso diventa anche una trappola nuova al §4 e, se cambia un testo, una nota per il modulo `cards`
(SPEC-card-input, domanda aperta 15). Quando i passi di un criterio sono tutti ok, segnarlo come verificato
nella tabella dei criteri di `tasks/card-input/plan.md`.

| Data | Telefono / Chrome | Criterio.passo | Esito | Note |
|---|---|---|---|---|
| — | — | — | — | nessuna prova ancora eseguita |

### Prova manuale del link ai punti (`cards`, criteri 10 e 14)

Stesse condizioni della prova di `card-input` (sopra): anteprima HTTPS della PR, card di prova (mai una
card consegnata), nessun uid, token o link scritto nelle note. Gli E2E provano tutto il resto con la card
finta; qui si prova solo ciò che dipende dal telefono vero.

**Criterio 10 — link scritto e verificato, pagina dei punti (SPEC-cards, punti 8 e 9)**

1. Android, app in home: appoggiare un NTAG215 di prova nuovo → Nuovo cliente con la card (riquadro
   "Card nuova letta") → nome di prova → "Salva cliente" → "Card associata a …" → tenere la card
   appoggiata (o riavvicinarla una volta quando l'app lo chiede): "Link ai punti scritto", nessun altro
   tocco. Poi si apre Registra spesa del nuovo cliente (card letta dalla home); "Indietro" non torna al
   form. Da Associa card (Modifica cliente → card) si torna invece alla scheda (`/clienti/:id`).
2. Da Modifica cliente dello stesso cliente: la card mostra "Link ai punti scritto".
3. Da un **telefono senza accesso all'app** (un secondo Android): avvicinare la card → si apre il browser
   su `/s/…` con "ENJOY YOUR POINTS" e il saldo (`0` per un cliente nuovo); nessun nome, nessun premio,
   nessun movimento.
4. Da un **iPhone XS o successivo** (schermo sbloccato, nessuna app): la notifica apre la stessa pagina.
5. Associa card su un iPhone: l'associazione va a buon fine con "Link non scritto" (criterio 13); da
   Modifica cliente su Android "Scrivi il link" → "Link ai punti scritto".
6. Sostituisci card (card di prova B): il link della card A ora mostra "Card non attiva", quello della B il
   saldo.

**Criterio 14 e domanda aperta 21 — card con il link letta dal telefono del personale**

1. App aperta in home, lettura attiva ("Avvicina la card"), in primo piano: appoggiare la card con il link
   scritto → si apre **Registra spesa** del cliente, **non** il browser; nessuna nuova scrittura sulla card.
2. App in background, schermo sbloccato (o app su `/accedi`): appoggiare la stessa card → Android apre la
   pagina dei punti. Esito accettato (domanda aperta 21: nessun pulsante "Torna all'app"); annotare se si
   apre nel browser o nell'app installata.

**Intestazioni della pagina pubblica sull'anteprima** (`vercel.json` vale solo su Vercel; in locale le
controlla `scripts/vercelHeaders.test.ts`). Con un token inventato di 22 caratteri, mai quello di una card:

```bash
curl -sI https://<anteprima>.vercel.app/s/AAAAAAAAAAAAAAAAAAAAAA | grep -iE 'cache-control|x-robots-tag'
```

Esito atteso: `cache-control: no-store` e `x-robots-tag: noindex, nofollow` (o il valore di `vercel.json`).
Annotare l'esito nella tabella sopra (criterio "cards.10", "cards.14", "cards.curl").

### Prova manuale alla cassa (`ledger`, criteri 3 e 8)

Gli E2E misurano i 10 s con la card finta (`e2e/ledger.spec.ts`); qui si prova il telefono vero, una volta
per rilascio di `ledger`, con l'utente. Stesse condizioni delle prove sopra: **anteprima HTTPS della PR**
(staging, mai produzione), account di prova, una card di prova già associata a un **cliente di prova**
(nome inventato, mai un cliente vero), rapporto di `/impostazioni` a 1 punto ogni 1 € (100 centesimi).
Nessun uid, token, link o nome di cliente vero nelle note.

**Criterio 3 — dalla card alla conferma in meno di 10 s (Android)**

1. Home in "Avvicina la card". Far partire un cronometro nell'istante in cui la card tocca il telefono.
2. Si apre Registra spesa del cliente di prova (una vibrazione breve, quella della lettura).
3. Digitare 1-2-5-0 sul tastierino: "12,50 €" e "+12"; toccare "Conferma +12".
4. Fermare il cronometro su "Spesa registrata". Esito atteso: **meno di 10 s**, una seconda vibrazione
   (circa 0,2 s) all'arrivo della conferma, "+12 punti a …" e il nuovo saldo.
5. Senza toccare nulla: conto alla rovescia "Torno alla lettura delle card tra …" e, dopo 10 s, ritorno
   alla home con la lettura attiva; il cliente compare in "Serviti oggi".
6. Ripetere con 1-5-0-0-1 (con la soglia predefinita di 150,00 €): "Importo insolito", "Conferma 150,01 €".
7. Ripetere 3 volte di seguito; annotare il tempo peggiore e se la vibrazione è mancata (Android con
   vibrazione disattivata nelle impostazioni: nessuna vibrazione, ed è corretto).

**Criterio 8 — annullo dell'operatore e rete**

1. Account **operatore**: registrare una spesa e toccare subito "Annulla la spesa · N s": "Spesa annullata",
   nessun ritorno automatico. Una seconda spesa lasciata scadere: il pulsante sparisce dopo 10 s.
2. Modalità aereo dopo aver digitato l'importo → "Conferma": "Spesa non salvata"; togliere la modalità
   aereo → "Riprova": una sola spesa in Movimenti del cliente.
3. Da operatore, in Movimenti nessun pulsante Annulla; da amministratore sì, con il dialogo di conferma.

**Dove annotare l'esito**: nella tabella della prova di `card-input` (sopra), criterio "ledger.3.passo" o
"ledger.8.passo", con il tempo misurato. Un tempo oltre i 10 s si annota con la causa (lettura lenta,
rete, digitazione) e diventa una nota per il modulo, non una trappola. Quando tutti i passi sono ok,
segnare i criteri come verificati in `tasks/ledger/plan.md`.

### Prova manuale dell'esportazione (`export`, criterio 10)

Gli E2E scaricano e leggono i due file in Chromium desktop (`e2e/export.spec.ts`); qui si prova solo ciò
che dipende dal telefono vero: il download da PWA installata in Chrome Android e l'apertura del file in
Excel o Fogli Google. Una volta per rilascio di `export`, con l'utente. Stesse condizioni delle prove
sopra: **anteprima HTTPS della PR** (staging, mai produzione), account **amministratore** di prova, solo
**clienti di prova** con nomi inventati (mai un cliente vero). Nessun nome, telefono, uid o codice
copiato nelle note.

**Preparazione** (sullo staging, dall'app): almeno un cliente di prova con un nome accentato (per esempio
"Niccolò Àlvarez"), uno con telefono e card attiva, uno con una nota che inizia con `=` (per esempio
`=1+1`), una spesa con centesimi (12,50 €), un riscatto e una spesa annullata dall'amministratore; un
cliente di prova anonimizzato (Modifica cliente → "Cancella i dati del cliente").

**Passi**

1. Android, Chrome, PWA installata e aperta dalla home del telefono (non dal browser). Accedere come
   amministratore → Impostazioni → in fondo "ESPORTA DATI" con "Clienti CSV" e "Movimenti CSV".
2. Toccare "Clienti CSV": "Preparazione del file…", poi "Clienti esportati: N." e Chrome mostra il
   download `enjoy-clienti-AAAA-MM-GG.csv` con la data di oggi. Annotare se il file finisce in Download e
   se compare la notifica di Chrome.
3. Toccare "Movimenti CSV": stesso esito con `enjoy-movimenti-AAAA-MM-GG.csv`.
4. Aprire i due file dal telefono con **Excel** (o **Fogli Google**, importando con separatore `;`), oppure
   inviarli a un computer con Excel in italiano e aprirli con doppio clic.
5. Da un account **operatore** di prova: la sezione "ESPORTA DATI" non c'è.

**Cosa controllare nei file**

- Le colonne sono separate (nessuna riga intera in una sola cella) e le intestazioni sono in italiano,
  nell'ordine di `SPEC-export.md` punto 5.
- Gli **accenti** si leggono giusti ("Niccolò", non "NiccolÃ²"): il BOM UTF-8 funziona.
- **Importo €** "12,50" ed **Euro per punto** "1,00" sono numeri (allineati a destra, sommabili); i
  **punti** negativi del riscatto e della correzione sono numeri con il segno.
- **Telefono** con il "+" e **Card attiva** con gli zeri iniziali, come testo (non in notazione
  scientifica).
- **Date** in `gg/mm/aaaa hh:mm:ss`, nell'ora italiana (confrontare con l'ora della spesa di prova).
- La nota `=1+1` compare come testo `'=1+1` o `=1+1`, **mai** come il risultato `2`.
- Il cliente anonimizzato ha Nome, Telefono, Note e Card attiva vuoti; nei movimenti la sua colonna
  Cliente è vuota, ma codice, saldo e movimenti restano.
- La spesa annullata ha "Annullato da" con il codice della correzione; la correzione ha "Annulla il
  movimento" con il codice della spesa.

**Dove annotare l'esito**: nella tabella della prova di `card-input` (sopra), criterio "export.10.passo"
(per esempio "export.10.2"), con telefono, versione di Chrome e app usata per aprire il file (Excel,
Fogli Google). Un file che non si scarica dalla PWA o che si apre con colonne o accenti sbagliati diventa
una trappola al §4 e una nota per il modulo. Quando tutti i passi sono ok, segnare il criterio 10 come
verificato in `tasks/export/plan.md`. **Dopo la prova**, cancellare i due file dai Download del telefono
(il file Clienti contiene nomi e telefoni: SPEC-export, domanda aperta 10).

### Tablet della cassa (`tablet-kiosk`, fase 3)

Procedura completa per chi prepara il tablet: `docs/setup-tablet.md` (installazione della PWA, accesso con
l'account del bar, PIN dal proprio telefono, densità reale dello schermo, prova del lettore e del formato
dell'uid, "Mostra tastiera virtuale"). Creare, controllare, togliere e rimettere l'account del bar:
`docs/setup-accounts.md` §4, "Tablet della cassa (account di dispositivo)" (**Authentication → Users →
Create new user**, poi nello SQL Editor `select private.add_device('<email>', '<nome del tablet>');`).

Gli E2E (progetti Playwright `tablet` e `tablet-settings`, 1280×800) provano tutto con il lettore USB
simulato da `page.keyboard` e con la card finta; qui si prova solo ciò che dipende dal tablet e dal lettore
veri, una volta all'acquisto del lettore e a ogni rilascio di `tablet-kiosk`, con l'utente. Condizioni:
**anteprima HTTPS della PR** (staging), account del bar di staging, account di prova con il PIN impostato,
card di prova associate a clienti di prova; mai uid, link, PIN o nomi veri nelle note.

1. `docs/setup-tablet.md` §2–§3: installazione e accesso → `/cassa`.
2. §5: densità. Annotare `innerWidth`, `innerHeight`, `devicePixelRatio` e se il layout è quello del tablet.
3. §6: formato del lettore. Annotare modello del lettore e formato scelto (mai il codice letto).
4. §7: "Mostra tastiera virtuale" attiva; la ricerca per nome funziona con il lettore collegato.
5. Criterio 6 della spec: cronometro dalla card appoggiata sul lettore (home) a "Spesa registrata", come
   nella prova alla cassa di `ledger`: meno di 10 s.
6. Card appoggiata su `/cassa` durante l'inserimento del PIN: nessun cambio di schermata, nessuna cifra.

**Dove annotare l'esito**: nella tabella della prova di `card-input` (sopra), criterio "tablet.passo" (per
esempio "tablet.2"), con modello del tablet, versione di Android e di Chrome. Un comportamento diverso
diventa una trappola al §4. Densità sotto 1024×600 o un lettore che non funziona in nessuno dei 4 formati:
fermarsi e avvisare (domanda aperta 10 della spec).

## 2. Controllo di salute

`npm run typecheck && npm run lint && npm run format:check && npm test` e, con Supabase acceso,
`npm run db:test && npm run test:integration && npm run e2e`: tutto verde = sano. In CI: i due job di `CI` verdi sulla PR (`gh pr checks <n>`).

## 3. Quando qualcosa non va, guarda qui

| Sintomo | Guarda prima | Poi |
|---|---|---|
| Una skill o un plugin appena installato non compare | Ricaricare Claude Code (nuova sessione) | `claude plugin list` |
| L'app si ferma con "Missing VITE_SUPABASE_…" | `.env` assente o incompleto | `.env.example`, `npx supabase status` |
| `db:start` / `db:reset` scade in attesa di un container | `docker ps` (container non sani) | `npx supabase stop` e di nuovo `db:start` |
| `npm run e2e` si ferma con "Local Supabase is not running" | `npx supabase status` | avviare lo stack (comando sopra) |
| Online: accesso con credenziali giuste dà "Servizio non configurato" (prima: "Connessione assente") | Schema `app` esposto nella Data API (`PGRST106`)? Permessi sullo schema (`42501`)? | `docs/setup-accounts.md` §3 |
| Online: "Servizio momentaneamente non disponibile" | Data API in ricarica (503 `PGRST002`), di solito dopo aver cambiato gli schemi esposti | attendere un minuto e riprovare |
| Online: "Account non abilitato" | Profilo collegato? `select * from app.operators;` nello SQL Editor | `private.add_operator` (§4 della guida) |
| In locale l'email di recupero non arriva | Mailpit acceso? http://127.0.0.1:54324 (`npx supabase status`) | riavviare lo stack senza `mailpit` tra gli esclusi (`-x`); dopo modifiche a `config.toml`: `npx supabase stop && npm run db:start` |
| Online: il link dell'email apre "Il link è scaduto o è già stato usato." | Template "Reset password" ancora quello predefinito (`#error_code=…` nell'URL)? | `docs/setup-accounts.md` §6 passo 2; link davvero usato o più vecchio di 24 ore (Email OTP Expiration = 86400, §6 passo 3) |
| Online: il link apre la home e non `/imposta-password` | Redirect URLs del progetto | `docs/setup-accounts.md` §6 passo 1 (l'app inoltra comunque a `/imposta-password`) |
| In locale "Invia invito" non riesce, o l'integrazione dice "operator-invites is not served" | `npx supabase functions serve` acceso? `supabase/functions/.env` presente? | RUNBOOK §1 "Operatori", passi 2–3 |
| In locale arriva "You've been invited" invece di "Enjoy Card: il tuo invito", o nessuna email d'invito | `docker logs supabase_auth_enjoy-card-app` (`templatemailer_template_body_http_error`) | trappole 28 e 53 |
| Online: un amministratore non riesce a mettere sé stesso operatore o a disattivare l'ultimo amministratore | è voluto (`EO001`, `EO002`) | prima rendi amministratore un'altra persona (`docs/setup-accounts.md` §4) |
| Tablet: dopo l'accesso si apre la home e non `/cassa` | Si è entrati con un account personale | `docs/setup-tablet.md` §3 |
| Tablet: "Account non abilitato" con l'account del bar | `select name, user_id is not null as collegato from app.devices;` | `private.add_device` (`docs/setup-accounts.md` §4, "Tablet della cassa") |
| Tablet: la card apre Nuovo cliente per un cliente che ha già la card, o "Codice non riconosciuto…" | Formato del lettore (Impostazioni → LETTORE CARD, solo con un amministratore alla cassa) | `docs/setup-tablet.md` §6, trappola 50 |
| Tablet: "Troppi tentativi" e nessuno ricorda il PIN | Aspettare i 5 minuti; chi ha dimenticato il PIN ne sceglie uno nuovo dal telefono | Solo se si è certi che nessuno stia provando PIN a caso, nello SQL Editor: `update app.devices set failed_pin_attempts = 0, locked_until = null where name = '<nome del tablet>';` |
| Tablet: nessuna tastiera a schermo | Lettore USB collegato | "Mostra tastiera virtuale" (`docs/setup-tablet.md` §7) |

## 4. Trappole (numerate, solo aggiunte)

1. Il programma di Impeccable (`.claude/skills/impeccable/scripts/bin/`) è ignorato da git: il launcher lo
   riscarica alla prima esecuzione. Non committarlo.
2. Web NFC non esiste in Playwright: nei test E2E la lettura card va simulata con un adattatore finto.
3. Il repo è pubblico: niente dati reali di clienti, nemmeno nei fixture; segreti solo in `.env`.
4. Uid delle card: Web NFC dà `04:a1:b2:…`, i lettori USB spesso decimale e a volte byte invertiti.
   Normalizzare sempre in esadecimale maiuscolo senza separatori prima di cercare o salvare.
5. `supabase migration new` legge il contenuto da stdin quando non è in un terminale: lanciato da un agente
   resta appeso. Usare `</dev/null` e poi scrivere il file creato.
6. Lo schema `app` attiva la RLS da solo su ogni nuova tabella (event trigger), ma una tabella senza policy
   resta illeggibile: ogni tabella nuova vuole le sue policy e il suo test pgTAP.
7. `src/styles/tokens.css` è generato: non si modifica a mano e Prettier lo ignora. Si cambia
   `design/tokens.json` (copia del design system "Enjoy Bar") e si lancia `npm run tokens`; un test
   fallisce se il CSS committato non coincide.
8. Il rilevatore Impeccable ha la regola `cream-palette` disattivata (`.impeccable/config.json`): lo sfondo
   `paper` #faf5f1 è imposto dal design system del bar, non una scelta di default.
9. jsdom non implementa `<dialog>`: `src/test/setup.ts` aggiunge `showModal`/`close` minimi. Esc nei test si
   simula con l'evento `cancel` sul dialog, non con il tasto.
10. Testing Library normalizza gli spazi: lo spazio indivisibile di `formatCents`/`formatPoints` nei test
    va cercato con una regex (`/12,50\s+€/`).
11. Le intercettazioni di rete di Playwright (`route`) scavalcano il service worker: per verificare cosa
    mette in cache si controlla `sw.js` generato, non una richiesta simulata.
12. La porta 5173 può essere occupata da altri progetti (un container Docker): Vite passa alla successiva,
    leggere l'indirizzo stampato in console.
13. `glob` e `minimatch` sono forzati con `overrides` in `package.json` (vulnerabilità in workbox-build):
    toglierli quando workbox-build li aggiorna.
14. PR impilate (ognuna con base sulla precedente): unendole, ciascuna finisce nel ramo sotto di lei e non
    in `main` (2026-11-17: su `main` era arrivata solo la #1). Preferire PR con base `main`; se si impilano,
    unire dal basso e cambiare la base della successiva in `main` prima di unirla (GitHub lo fa da solo
    solo se il ramo unito viene eliminato).
15. Il server MCP di Supabase (`.mcp.json`) punta al progetto di **staging** (`kpizaczyrlyywuidqitn`) con
    permessi di scrittura. Non va mai collegato alla produzione senza `read_only=true`: in produzione le
    migrazioni si applicano solo a mano, dopo la prova su staging. Si attiva riaprendo Claude Code e
    autenticandosi con `/mcp`.
16. `.env` punta allo **staging**: E2E e test di integrazione non lo usano. `playwright.config.ts` legge la
    chiave locale da `supabase status` e la passa a Vite (vince su `.env`); un controllo automatico fa
    fallire ogni test che chiama `*.supabase.co`. Il server di anteprima non si riusa mai
    (`reuseExistingServer: false`): potrebbe essere stato costruito contro lo staging.
17. Un accesso con credenziali sbagliate produce in console un `400` su `/auth/v1/token` (lo stampa il
    browser, non l'app): è atteso, e `e2e/fixtures.ts` lo esclude dal controllo "console pulita". Ogni altro
    errore in console fa fallire il test.
18. La CSP di produzione (`vercel.json`) non ammette `http://localhost:54321`: l'origine locale è aggiunta
    a `connect-src` solo nelle intestazioni di `vite preview` (`vite.config.ts`), mai in `vercel.json`.
19. Un utente cancellato in Authentication → Users ha ancora un token valido fino a un'ora: la sicurezza sta
    nella RLS (controlla il profilo collegato, non il token). L'app se ne accorge al ritorno in primo piano.
20. `private.add_operator` è eseguibile solo da `postgres` (SQL Editor): nessun ruolo dell'API la può
    chiamare. Gli account si creano con *Auto Confirm User* attivo, altrimenti Supabase manda un'email di
    conferma (da `info@enjoygaeta.it`).
21. Le modifiche a `supabase/config.toml` (template email, URL di ritorno, limiti di Auth) non le applica
    `db:reset`: serve riavviare lo stack (`npx supabase stop && npm run db:start`).
22. `[auth.rate_limit] email_sent = 100` vale **solo in locale** (con 2 l'ora una sola esecuzione degli E2E
    resterebbe senza email). Per questo e per gli URL `localhost`, `config.toml` non si porta mai nei progetti
    online con `supabase config push`: Auth remota si configura dalla dashboard (`docs/setup-accounts.md` §6).
23. Supabase usa il `redirectTo` della richiesta solo se combacia con una delle Redirect URLs (in locale sono
    indirizzi esatti);
    altrimenti il link punta a `site_url` (`/?token_hash=…&type=recovery`) e `RootLayout` lo inoltra a
    `/imposta-password`. L'E2E controlla che il link inizi con `http://localhost:4173/imposta-password`.
24. Mailpit conserva le email delle esecuzioni precedenti: i test filtrano per destinatario e per ora di
    arrivo dopo la richiesta, e l'email inesistente è unica per esecuzione (`nessuno-<casuale>@example.com`).
25. Un link di recupero già usato produce in console un `403` su `/auth/v1/verify` (lo stampa il browser):
    è atteso come il `400` della trappola 17, ed `e2e/fixtures.ts` lo esclude.
26. `isAuthRetryableFetchError` di supabase-js è vero anche per 502/503/504: non basta a dire "rete assente".
    Per "Password dimenticata" ogni risposta HTTP è "inviato" (un 504 per invio lento esiste solo per gli
    account veri e li rivelerebbe); "rete" solo con `status` 0 o `fetch` fallita.
27. Il token del link si consuma solo con "Salva e accedi" (`verifyOtp` con `token_hash`), mai all'apertura:
    le anteprime e gli antivirus delle caselle email non lo bruciano. Con il template predefinito di
    Supabase (`{{ .ConfirmationURL }}`) succederebbe: il template va sempre incollato nei progetti online.
28. `supabase start` può avviare Auth prima che il gateway (Kong, porta 8088) serva i template delle email:
    Auth registra `templatemailer_template_body_http_error … connection refused` e manda l'email
    predefinita "Reset your password" finché non viene riavviato. Succede in CI (2026-11-17), raramente in
    locale. Rimedio: `scripts/reload-auth-templates.sh` dopo `supabase start` (la CI lo esegue); fallisce se
    il template non si carica.
29. `app.settings` è **una riga sola, condivisa** da tutti i test che girano sullo stesso stack. I test pgTAP
    controllano la riga iniziale (100 / 15000 / `'hex'`, `updated_by` null): integrazione ed E2E che la
    cambiano rimettono valori, `updated_at` e `updated_by` come li hanno trovati. Se un'esecuzione si
    interrompe a metà e `db:test` fallisce sulla riga, `npm run db:reset`.
30. Le spec E2E che cambiano la configurazione condivisa (oggi `settings.spec.ts`; domani `ledger.spec.ts`,
    che cambia il rapporto) vanno aggiunte a `SHARED_STATE_SPECS` in `playwright.config.ts`: girano nel
    progetto `phone-settings`, in serie, dopo tutto il progetto `phone` (che è `fullyParallel`). Lasciate
    in `phone` renderebbero instabili gli altri test che leggono il rapporto.
31. Le migrazioni nuove vanno con un timestamp successivo a `20261117230000_function_privileges.sql`, che
    toglie a `public` (e quindi ad `anon`) l'`execute` predefinito sulle funzioni create da lì in poi: la
    migrazione di `settings` è stata spostata a `20261117230100` per questo. Ogni funzione nuova ha i suoi
    `revoke`/`grant` espliciti e un controllo pgTAP sui privilegi di `anon` e `authenticated`.
32. Senza sessione (`anon`) la lettura di `app.settings` dà un errore di privilegio, non un risultato vuoto:
    il servizio lo riporta come `unknown`, non `not-found`. L'app carica la configurazione solo dentro
    `RequireAuth`, con un operatore collegato.
33. Un rifiuto di una RPC (`raise exception` con codice P0001, es. `customer_name_taken`) arriva al browser
    come HTTP 400, e il browser lo stampa in console ("Failed to load resource"): il controllo "console
    pulita" di `e2e/fixtures.ts` farebbe fallire il test. Il test che provoca il rifiuto apposta lo dichiara
    con `test.use({ expectedRefusals: [/\/rest\/v1\/rpc\/<funzione>$/] })` solo nel proprio `describe`
    (vuoto per tutti gli altri), mai allargando il filtro in `fixtures.ts`.
34. Gli E2E dei clienti girano nel progetto `phone` (parallelo) e usano nomi con un suffisso unico per
    esecuzione (`… E2E <suffisso>`): si rieseguono senza `db:reset`, ma lo stack locale accumula clienti di
    prova (anche anonimizzati, che restano come righe). È innocuo; `npm run db:reset` riparte dai 5 clienti
    del seed. Il seed `Giulia Bianchi` serve al test del nome già usato: non rinominarlo.
35. `app.customer_summary` e le firme di `search_customers`, `get_customer`, `customers_served_today` sono
    definitive: `ledger` ne cambia solo i corpi con `create or replace` in una **migrazione nuova** (mai
    modificando `*_customers.sql`, che va su staging con `db push`), mantenendo il controllo `not_operator`
    in testa e ridefinendo `private.acting_operator_id()`, se serve, con il corpo comune parola per parola.
36. `impeccable detect` su file `.ts`/`.tsx`/`.css` usa solo le regole a espressioni regolari; contrasto e
    testo minuscolo richiedono una pagina disegnata, e le schermate dei clienti stanno dietro
    l'accesso. Le misure (≥ 48 px) si provano quindi negli E2E (`e2e/customers.spec.ts`), non col detector.
37. I premi non si cancellano mai, nemmeno nei test: l'E2E di `rewards` aggiunge un premio con suffisso unico
    (`Spremuta E2E <suffisso>`) e lo lascia **disattivato** alla fine, così gli avanzi non compaiono alla cassa;
    lo stack locale ne accumula, innocui (`npm run db:reset` riparte dai 5 del seed). L'integrazione invece
    toglie la propria riga come proprietario del database. I 5 premi del seed non si toccano: li usano
    l'E2E del catalogo (ordine del wireframe) e `ledger`.
38. Un `23505` dalle RPC dei premi è "nome già usato" solo se nomina `rewards_name_key`: un altro vincolo
    (la chiave primaria) è `unknown`. E un `42501` con `permission denied for …` è un privilegio mancante
    (`misconfigured`, `src/lib/serverFault.ts`), non un operatore senza ruolo di amministratore: va
    controllato prima della traduzione in `forbidden`.
39. L'adattatore e lo scrittore finti (`window.__enjoyFakeCard*`) entrano solo nella build con `VITE_E2E=1`
    (quella degli E2E, impostata da `playwright.config.ts`). Una build così non va **mai** pubblicata:
    `npm run build && npm run check:bundle` fallisce se `dist/` li contiene, e gira in CI e nel
    `buildCommand` di Vercel. Dopo un `npm run e2e`, `dist/` è quella di prova: rifare `npm run build` prima
    di controllare o pubblicare a mano.
40. Chromium di Playwright non ha `NDEFReader` né il permesso `nfc`: gli E2E che vogliono vedere il riquadro
    acceso usano `stubWebNfc(page, …)` di `e2e/nfc.ts` (via `addInitScript`, prima del caricamento della
    pagina); le letture e le scritture passano da `window.__enjoyFakeCard(uid)` e `fakeCardWrites(page)`.
41. Il primo `scan()` di Web NFC vuole un tocco dell'operatore (permesso `prompt` → "Attiva la lettura");
    dopo il permesso, la lettura parte da sola a ogni avvio. Accendere l'NFC dalla tendina non cambia la
    visibilità della pagina: la lettura riparte solo con "Riprova la lettura" (dalle impostazioni del
    telefono invece riparte da sola al ritorno).
42. Fino al modulo `cards` la home non consuma letture: una card appoggiata in home non fa nulla e non
    vibra. Non è un guasto.
43. Uid e URL letti o scritti non si stampano mai (`console.*` vietato in `src/features/card-input/`) e le API
    del browser per le card (`NDEFReader`, `navigator.vibrate`, `permissions.query`, `keydown` su
    `document`) restano nel modulo: lo controlla `scripts/cardInputBoundary.test.ts`, che controlla anche
    che `fakeCardAdapter` sia importato solo da `main.tsx` dentro `if (import.meta.env.VITE_E2E === '1')`.
44. Il modulo `cards` non chiama Supabase dai componenti (`getSupabase()` solo in `supabaseCardsService.ts`
    e `public/cardPointsService.ts`), non registra uid, token o link (`console.*`, `localStorage`,
    `sessionStorage`, `location.href` vietati in `src/features/cards/`), non chiama mai `makeReadOnly` e
    chiama `card_points` solo in `POST` (mai `{ get: true }`, che metterebbe il token nell'URL della
    richiesta): lo controlla `scripts/cardsBoundary.test.ts`. I titoli nuovi in Enjoy Display (costanti
    `…TITLE`, `title:` degli avvisi, `CardLinkScreen`) li controlla `scripts/displayGlyphs.test.ts`.
45. Un ref che tiene "l'ultima" callback o l'ultimo valore per un gestore di eventi, una lettura card o la
    risposta di una promessa si aggiorna con `useLatest` (`src/lib/useLatest.ts`, fase di layout), mai in un
    `useEffect`: tra il commit e gli effetti passivi un tocco o una card possono arrivare (telefono lento,
    CI carica) e vedrebbero ancora la schermata precedente. Successo davvero: "Salva cliente" subito dopo
    "Card letta" creava il cliente senza card (test instabile di `NewCustomerCardSection`, CI 44321492570).
    I test lo provano con `renderHookThenFire` (`src/test/fireAfterCommit.tsx`), che chiama nello stesso
    commit, prima di `useEffect`. Restano in `useEffect` solo i ref del segnalatore `not_operator`, la cui
    identità cambia senza cambiare comportamento. Vale anche per chi riceve le letture: `useCardRead` mette e
    toglie il consumatore in `useLayoutEffect`, così una card passata subito dopo che «Riprova» è apparso
    (lettura riaccesa) non va persa e una passata appena parte il salvataggio (lettura spenta) non arriva.
46. `app.devices` e `private.operator_pins` non sono leggibili né scrivibili da nessun ruolo dell'API
    (nemmeno con il token del tablet): i test che devono vedere il cassiere salvato o azzerare il blocco lo
    fanno con `psql` dentro il container del database locale (`e2e/db.ts`, come
    `tests/integration/localSupabase.ts`), mai contro un progetto online. Nello SQL Editor online si
    leggono come `postgres`; il PIN in chiaro non esiste da nessuna parte (solo l'hash bcrypt).
47. Il cassiere sta sulla riga del dispositivo: due test che sbloccano lo stesso tablet in parallelo si
    sostituiscono il cassiere a vicenda. Per questo il seed ha cinque tablet: `cassa@example.com`
    (`e2e/tablet.spec.ts`), `cassa-blocco@example.com` (i 5 PIN errati: il test ne azzera prima il blocco
    con `e2e/db.ts`, così si riesegue entro i 5 minuti), `cassa-pin@example.com` (`e2e/tablet-pin.spec.ts`)
    e `cassa-layout@example.com` (`e2e/tablet-layout.spec.ts`); il quinto, `cassa-operatori@example.com`, è di
    `e2e/tablet-operators.spec.ts`, con le persone riservate `turno@example.com` (disattivata alla cassa e
    riattivata) e `nuovo@example.com` (senza PIN).
    Un E2E tablet nuovo che sblocca un cassiere usa un dispositivo suo nel seed, o uno di questi in serie.
48. Progetti Playwright: `tablet` (1280×800, touch, `tablet*.spec.ts`; il progetto `phone` li ignora) e
    `tablet-settings` (`tablet-settings.spec.ts`, cambia `usb_uid_format` nella riga condivisa di
    `app.settings`: in serie, dopo `phone-settings`, e rimette `'hex'`). `phone-settings` dipende anche da
    `tablet`, perché le spese del tablet contano i punti con il rapporto iniziale. Una spec tablet che
    cambia `app.settings` va in `TABLET_SHARED_STATE_SPECS` (come la trappola 30).
49. Su un tablet a turno finito (12 ore, "Cambia", PIN cambiato dal telefono, cassiere senza account) le
    letture restituiscono **0 righe, non un errore** (RLS): una lista vuota non vuol dire "nessun dato". Il
    client rilegge `get_session_identity()` a ogni cambio di rotta, al ritorno in primo piano e a ogni
    rifiuto "nessun operatore", e torna a `/cassa`; `reportNotEnabled()` in una sessione di dispositivo
    porta a `/cassa`, non ad `/accedi`.
50. Formato del lettore sbagliato: un uid esadecimale fatto di sole cifre è anche un decimale valido (e
    ogni decimale è un esadecimale valido), e i byte invertiti danno un altro uid valido. L'errore quindi non
    sempre dà "Codice non riconosciuto": spesso apre **Nuovo cliente** con una card "nuova". Durante la prova
    del formato non si salva mai quel cliente (`docs/setup-tablet.md` §6).
51. Con un lettore USB collegato Android nasconde la tastiera a schermo (lo vede come tastiera fisica): sul
    tablet va attivata "Mostra tastiera virtuale" (Sistema → Lingue e immissione → Tastiera fisica),
    altrimenti non si cerca per nome. Va ricontrollata dopo aver ricollegato il lettore.
52. Il layout del tablet dipende dalla finestra in punti CSS (almeno 1024×600, `useTabletLayout`), non
    dall'account né dai pixel fisici: con la densità di Android un 1280×800 fisico può dare il layout del
    telefono. Si misura sul tablet vero (`docs/setup-tablet.md` §5); negli E2E vale il viewport del progetto.
53. Kong monta **un singolo file** per ogni template delle email (`recovery.html`, `invite.html`): se un
    editor salva sostituendo il file (nuovo inode), il gateway continua a servire quello vecchio, cancellato,
    e Auth riceve 404 (`templatemailer_template_body_http_error … status code 404`) e manda l'email
    predefinita. Con due template il rischio raddoppia. Rimedio: `docker restart supabase_kong_enjoy-card-app`,
    poi `scripts/reload-auth-templates.sh` (aspetta "reloaded template type: recovery" e "… invite").
54. In locale il gateway Kong aggiunge `Access-Control-Allow-Origin: *` a ogni risposta delle funzioni: i
    test d'integrazione non controllano quell'intestazione (lo fanno i test di `handler.test.ts`, dove la
    funzione non manda mai `*`). Online decide solo la funzione.
55. GoTrue, verificando il token d'invito (`verifyOtp` con `type: 'invite'`), conferma l'email e dà a chi non
    ha password una **password temporanea casuale** nella stessa transazione: in `auth.users` chi ha solo
    aperto il link e chi ha scelto la password sono indistinguibili. Per questo lo stato "invito inviato" /
    "attivo" si legge da `app.operators.invite_accepted_at` (trigger su `auth.users` al primo cambio di
    password con l'email confermata, migrazione `*_operators_invite_accepted.sql`), mai da
    `email_confirmed_at` (SPEC-operators, Open Questions 12).
56. `private.operator_invites` conserva le prenotazioni di ogni invito vero (integrazione, E2E): un test che
    ne conta le righe parte da una tabella vuota dentro la propria transazione (`operators_invites.test.sql`).
    L'idempotenza vale per `operation_id`: due inviti con id diversi alla stessa email o allo stesso nome
    entro 2 minuti danno `in_progress`; una prenotazione `pending` più vecchia passa a `failed` al primo invito
    successivo con la stessa email o lo stesso nome.
57. `npm run e2e` lanciato subito dopo `npx supabase db reset` può fallire nei primi test (accesso con
    "Servizio momentaneamente non disponibile: riprova tra poco.", pagina dei punti con "Non riesco a caricare
    i punti."): Auth e Data API stanno ancora ripartendo. Non è un difetto dell'app: attendere qualche
    secondo (o rieseguire) prima degli E2E; dopo un reset rieseguire anche `./scripts/reload-auth-templates.sh`.
58. `otp_expiry` di `supabase/config.toml` (86400 dal 2026-11-23) entra in Auth solo alla creazione del
    container: dopo averlo cambiato servono `npx supabase stop` e di nuovo `npx supabase start -x …` (poi
    `./scripts/reload-auth-templates.sh` e `npx supabase functions serve`, che lo `stop` ferma); `docker
    inspect supabase_auth_enjoy-card-app` mostra `GOTRUE_MAILER_OTP_EXP`. Sui progetti online la voce è Auth →
    Email OTP Expiration e vale anche per il link di recupero.
