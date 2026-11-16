# CLAUDE.md — Enjoy Fidelity Card

Istruzioni per gli agenti che lavorano su questo repository.

## Il progetto

**Enjoy Card** è la fidelity card a punti dell'**Enjoy Bar**. Il cliente accumula punti in base a
quanto spende; il titolare decide quali premi offrire e scala i punti. La card NFC è uno strumento di
marketing e una scorciatoia per riconoscere il cliente alla cassa: tutto funziona anche senza card,
cercando il cliente per nome o telefono.

**Fonti di verità** (in caso di dubbio valgono queste, non questo file):
- Specifiche: https://claude.ai/artifact/59XU2sRGx1EoUtxS8mxN6S
- Wireframe (telefono + tablet): https://claude.ai/artifact/K6PkvCmqMum8jV3cNuHD7n
- Design system "Enjoy Bar": https://claude.ai/artifact/GY9B6wF97G5FCLapU8KRUH

Non inventare requisiti: se un'informazione manca o le fonti si contraddicono, chiedi.

## Contesto d'uso
- **Prima versione: telefono Android** del titolare; altri titolari e camerieri installano la stessa app
  sul proprio telefono. Su iPhone l'app funziona, ma solo con la ricerca (niente lettura card).
- **Tablet della cassa** (BESTTAB A20, 10,1″, 1280×800 punti in orizzontale, senza NFC): fase successiva,
  **solo se si compra un lettore NFC USB**.
- Flusso a senso unico: il cliente consegna la card all'operatore e **non vede nulla**, nemmeno il saldo.
- L'app **non contatta i clienti**: niente messaggi, offerte o campagne. Il telefono del cliente è facoltativo.
- Clienti nell'ordine delle centinaia; più operatori in contemporanea su un archivio condiviso online.
- Obiettivo di usabilità: **dalla card alla conferma della spesa in meno di 10 secondi**.

## Architettura (decisa)
- **App**: PWA in Chrome per Android. Lettura card con **Web NFC** (solo Chrome Android, solo HTTPS).
- **Backend**: **Supabase** (Postgres, Auth, Row Level Security), piano gratuito.
- **Hosting frontend**: statico con HTTPS (Vercel o Netlify, da scegliere).
- **Card**: adesivi NTAG215, **solo lettura** dell'uid, mai scritte. Uid salvato in un solo formato:
  esadecimale maiuscolo senza separatori (Web NFC dà `04:a1:b2:…`; i lettori USB spesso decimale e a
  volte byte invertiti → normalizzare sempre).
- **Lettore USB (tablet)**: emulazione tastiera; l'app ascolta i tasti in rapida sequenza chiusi da Invio,
  senza un campo di testo sempre attivo. Web NFC e lettore USB sono due ingressi equivalenti.
- **Importi**: tastierino numerico interno all'app, inserimento a centesimi come sui POS (1-2-5-0 = 12,50 €).

## Regole di dominio (invarianti)
- Importi in **centesimi interi**; rapporto in **centesimi per punto** (100 = 1 punto ogni 1 €).
  Punti = parte intera di (centesimi ÷ centesimi per punto): **arrotondamento per difetto**.
- Ogni movimento salva importo, punti, rapporto in vigore, operatore, data e ora: cambiare il rapporto
  non altera lo storico.
- **Saldo = somma dei punti di tutti i movimenti** (anche annullati: la correzione di segno opposto li compensa).
- Il saldo **non scende mai sotto zero**: controllo sul server, nella stessa transazione del riscatto.
- I movimenti **non si cancellano**: si annullano con un movimento di correzione. Una spesa non si annulla
  se i suoi punti sono già stati spesi.
- Ogni operazione porta un **identificativo generato dall'app** (idempotenza): doppio tocco o reinvio dopo
  un errore di rete non registrano due volte.
- **Nome del cliente unico** (per gli omonimi si aggiunge un dettaglio). Clienti anche senza card e senza telefono.
- Un cliente ha **al massimo una card attiva**; card persa → la vecchia si disattiva, i punti restano.
- Una card sconosciuta letta dalla schermata principale apre Nuovo cliente con la card già associata.

## Ruoli
- **Amministratore** (titolari): tutto, più operatori, catalogo premi, rapporto euro/punto, soglia di
  conferma importo, export CSV, annullamento movimenti, cancellazione dati cliente.
- **Operatore** (camerieri): cerca e crea clienti, consegna card, registra spese, riscatta premi, annulla
  entro 10 secondi la propria spesa o il proprio riscatto appena registrati.
- Account creati solo da un amministratore (invito via email, l'operatore sceglie la password).
  Sessione persistente sul telefono; sul tablet condiviso: account di dispositivo + cambio operatore con
  PIN di 4 cifre verificato sul server (blocco temporaneo dopo 5 errori).

## Privacy (GDPR)
- Consenso privacy obbligatorio alla registrazione; testi da far verificare al consulente del bar.
- Cancellazione su richiesta: nome e telefono anonimizzati, movimenti conservati senza dati personali.
- RLS: solo utenti autenticati leggono e scrivono.
- Il repo è **pubblico**: niente dati reali di clienti, nemmeno nei fixture di test; nessun segreto nel repo.

## Fasi
1. **Prima versione** (telefono): account e ruoli, clienti, ricerca, spese, riscatti, configurazione, Web NFC.
2. **Lancio**: consegna delle prime 50 Enjoy Card.
3. **Tablet**: solo con lettore NFC USB; lettura da lettore e cambio operatore con PIN.

## Punti aperti (da chiarire con `interview-me`, non decidere da soli)
- Modello dati: mancano soglia di conferma importo, identificativo di idempotenza, descrizione del premio
  libero, account di dispositivo; "importo in euro" vs "centesimi interi".
- Regione dei dati Supabase (UE?), Vercel o Netlify, comportamento offline oltre al reinvio.
- Rapporto euro/punto iniziale, amministratori al lancio, formato del lettore USB.

## Lingua
- Comunicazione con l'utente e UI dell'app: **italiano**.
- Codice, nomi di variabili, commit e commenti tecnici: **inglese**.

## Workflow con le skill

Skill di progetto in `.claude/skills/` (versioni in `skills-lock.json`).

### Ingegneria — [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
1. `interview-me` → chiudere i punti aperti.
2. `spec-driven-development` → specifica nel repo (`docs/specs/`), derivata dalle fonti di verità.
3. `planning-and-task-breakdown` → task piccoli e verificabili.
4. `incremental-implementation` + `test-driven-development` → piccoli passi, test prima.
5. `code-review-and-quality` → review prima del merge.
6. `security-and-hardening` → obbligatoria per auth, RLS e dati dei clienti.

Altre quando pertinenti: `frontend-ui-engineering`, `api-and-interface-design`, `documentation-and-adrs`
(decisioni in `docs/adr/`), `debugging-and-error-recovery`, `performance-optimization`,
`git-workflow-and-versioning`, `ci-cd-and-automation`, `shipping-and-launch`. Indice: `using-agent-skills`.

### Design — [Impeccable](https://github.com/pbakaus/impeccable)
- La direzione visiva parte dai wireframe e dal design system "Enjoy Bar"; `/impeccable init` prima del
  primo lavoro di UI.
- L'hook in `.claude/settings.json` esegue il detector dopo ogni Edit/Write sui file UI: i problemi vanno
  risolti; le eccezioni si registrano con `npx impeccable ignores add-value …` motivandole.
- Subagent in `.claude/agents/`: `impeccable-finish-reviewer`, `impeccable-documenter`,
  `impeccable-asset-producer`, `impeccable-manual-edit-applier`.
- Uso in piedi e di fretta: target touch ≥ 48 px, alto contrasto, azioni principali lontane dal bordo
  inferiore (barre di Android).

### Test E2E — [webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing)
- Viewport principale: **telefono 390×844**; tablet **1280×800** solo per la fase tablet.
- Web NFC non è disponibile in Playwright: simulare la lettura card con un adattatore finto.

## Regole di lavoro
- Branch dedicato per ogni modifica; mai commit diretti su `main` senza richiesta esplicita.
- Commit piccoli, in stile Conventional Commits (`feat:`, `fix:`, `chore:`…).
- Segreti solo in `.env` (ignorato); mantenere aggiornato `.env.example`.
- Aggiornare questo file quando cambiano decisioni, architettura o comandi.

## Comandi — TBD
Da compilare quando il progetto applicativo esiste (install, dev, test, lint, build, deploy).

## Struttura del repository
```
.claude/
  skills/        # skill di progetto (Addy Osmani, Impeccable, webapp-testing)
  agents/        # subagent Impeccable
  settings.json  # hook Impeccable + plugin project-brain
docs/            # (da creare) specs/ e adr/
skills-lock.json # versioni delle skill installate
```

## Memoria di progetto — [project-brain](https://github.com/Ethan-YS/project-brain)
- "set up project brain" → crea `brain/` (PROJECT, MAP, STATUS, DECISIONS, HANDOFF). Previsto dopo l'intervista.
- "resume this project" → a inizio sessione legge MAP, STATUS e HANDOFF.
- "hand off" → prima di chiudere una sessione o quando il contesto è pieno, scrive `brain/HANDOFF.md`.
- "update the project brain" → propone aggiornamenti, da approvare uno per uno.
