# CLAUDE.md — Enjoy Fidelity Card

Istruzioni per gli agenti che lavorano su questo repository.

## Primi 30 secondi di una nuova sessione

Leggi `brain/MAP.md` e `brain/STATUS.md`; se `brain/HANDOFF.md` contiene un rapporto, leggilo.
Poi riferisci in breve: progetto riconosciuto, a che punto siamo, ultimo bloccante. Non iniziare a
lavorare in silenzio: conferma prima di aver capito.
- Perimetro in dubbio → `brain/PROJECT.md` (non-obiettivi). Perché di una scelta → `brain/DECISIONS.md`.
- `brain/` si aggiorna per la sessione successiva: STATUS, HANDOFF, registrazioni in MAP e RUNBOOK si
  scrivono quando il lavoro avviene; DECISIONS e PROJECT solo per ciò che l'utente ha deciso (nel dubbio,
  chiedi "questo è deciso?").

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
- Flusso a senso unico alla cassa: il cliente consegna la card all'operatore e lì non vede nulla. Il proprio
  **saldo** lo vede da solo avvicinando la card al suo telefono (pagina pubblica dal link sulla card).
- L'app **non contatta i clienti**: niente messaggi, offerte o campagne. Il telefono del cliente è facoltativo.
- Clienti nell'ordine delle centinaia; più operatori in contemporanea su un archivio condiviso online.
- Obiettivo di usabilità: **dalla card alla conferma della spesa in meno di 10 secondi**.

## Architettura (decisa)
- **App**: PWA in Chrome per Android. Lettura card con **Web NFC** (solo Chrome Android, solo HTTPS).
- **Backend**: **Supabase** (Postgres, Auth, Row Level Security), piano gratuito.
- **Hosting frontend**: statico con HTTPS (Vercel o Netlify, da scegliere).
- **Card**: adesivi NTAG215. La cassa legge solo l'uid; alla consegna l'app scrive sulla card **solo un link ai
  punti** con un token segreto e casuale (mai l'uid), senza bloccarla in sola lettura. Uid salvato in un solo formato:
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
- Account creati solo da un amministratore, **dall'app** (`operators`, `docs/specs/SPEC-operators.md`,
  `brain/DECISIONS.md` 2026-11-22): schermata Operatori `/impostazioni/operatori` (Impostazioni → GESTIONE),
  invito via email con nome, email e ruolo; la persona sceglie la password su `/imposta-password` (versione
  invito). Dalla stessa schermata: cambio di ruolo, Disattiva/Riattiva (profili mai cancellati), Reinvia e
  Annulla invito; mai azioni su sé stessi, sempre almeno un amministratore attivo (`EO001`). Gli inviti
  passano dalla Edge Function `supabase/functions/operator-invites`, l'unico posto con la chiave segreta
  (mai nell'app, su Vercel o nel repo). `private.add_operator` (pannello di Supabase + SQL Editor,
  `docs/setup-accounts.md` §4) resta solo per il **primo amministratore** e come riserva. **Dal tablet**, con
  un cassiere amministratore, un amministratore si invita, si promuove o si riattiva solo dopo il **PIN del
  cassiere inserito di nuovo**, verificato nella stessa RPC con il contatore e il blocco di `/cassa`
  (`EO005` senza PIN; `brain/DECISIONS.md` 2026-11-23). Il link d'invito e quello di recupero valgono **24
  ore** (`otp_expiry` 86400; online Auth "Email OTP Expiration"). Le email
  di Auth (invito e recupero) partono da `info@enjoygaeta.it`; "Password dimenticata" e "Cambia password":
  `docs/specs/SPEC-identity-password.md`.
  Sessione persistente sul telefono; sul tablet condiviso: account di dispositivo + cambio operatore con
  PIN di 4 cifre verificato sul server (blocco temporaneo dopo 5 errori).
- **Tablet della cassa** (`tablet-kiosk`, `docs/specs/SPEC-tablet-kiosk.md`): account del bar creato con
  `private.add_device` (`docs/setup-accounts.md` §4), mai collegato a un operatore; rotta `/cassa` ("Chi è
  alla cassa?") e, sul telefono, `/impostazioni/pin`, dove ognuno imposta il proprio PIN (rotta in più
  rispetto a `docs/specs/contract.md`). Il PIN è solo un hash bcrypt in `private.operator_pins`, non una
  colonna di `app.operators` come diceva `SPEC-identity.md`. `acting_operator_id()` e `is_admin()` valgono
  per il cassiere con turno valido (12 ore); senza cassiere il dispositivo non legge né scrive nulla.
  Stesse rotte del telefono con layout tablet da 1024×600 punti. Preparazione del tablet:
  `docs/setup-tablet.md`.

## Privacy (GDPR)
- Consenso privacy obbligatorio alla registrazione; testi da far verificare al consulente del bar.
- Cancellazione su richiesta: nome e telefono anonimizzati, movimenti conservati senza dati personali.
- RLS: solo utenti autenticati leggono e scrivono.
- Il repo è **pubblico**: niente dati reali di clienti, nemmeno nei fixture di test; nessun segreto nel repo.

## Fasi
1. **Prima versione** (telefono): account e ruoli, clienti, ricerca, spese, riscatti, configurazione, Web NFC.
2. **Lancio**: consegna delle prime 50 Enjoy Card.
3. **Tablet**: solo con lettore NFC USB; lettura da lettore e cambio operatore con PIN.

## Decisioni successive alle specifiche
Registrate in `brain/DECISIONS.md` (intervista del 2026-11-16): consegna completa delle tre fasi, niente
modalità offline, Supabase in UE, hosting Vercel, importi in centesimi ovunque, campi aggiunti al modello
dati, lettore USB generico con formato dell'uid configurabile.

## Lingua
- Comunicazione con l'utente e UI dell'app: **italiano**.
- Codice, nomi di variabili, commit e commenti tecnici: **inglese**.

## Workflow con le skill

Skill di progetto in `.claude/skills/` (versioni in `skills-lock.json`).

### Ingegneria — [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
1. `interview-me` → chiudere i punti aperti.
2. `spec-driven-development` → una specifica per modulo (`docs/specs/SPEC-<id>.md`), indice in `CAPABILITY-MAP.md`.
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
- Tablet: progetto `tablet` (1280×800, touch, solo `e2e/tablet*.spec.ts`, ignorati da `phone`) e
  `tablet-settings` (spec tablet che cambiano `app.settings`, in serie dopo `phone-settings`); lettore USB
  simulato con `page.keyboard`. Ogni test che sblocca un cassiere usa un dispositivo del seed riservato
  (RUNBOOK §4, trappola 47).
- Le spec che cambiano la configurazione condivisa (`app.settings`) stanno nel progetto `phone-settings`
  (`SHARED_STATE_SPECS` in `playwright.config.ts`): in serie, dopo gli altri, e ripristinano i valori iniziali.

## Regole di lavoro
- Branch dedicato per ogni modifica; mai commit diretti su `main` senza richiesta esplicita.
- Commit piccoli, in stile Conventional Commits (`feat:`, `fix:`, `chore:`…).
- Segreti solo in `.env` (ignorato); mantenere aggiornato `.env.example`.
- Aggiornare questo file quando cambiano decisioni, architettura o comandi.

## Comandi
```bash
npm install                 # dipendenze (Node 24, vedi .nvmrc)
npm run dev                 # app in sviluppo; vetrina componenti su /dev/ui
npm run dev:https           # HTTPS sulla rete locale, per il telefono
npm run typecheck && npm run lint && npm run format:check && npm test   # controlli prima di ogni commit
npm run format              # Prettier
npm run e2e                 # Playwright sulla build (390×844 e tablet 1280×800), contro Supabase locale
npm run build               # build di produzione
npm run check:bundle        # dopo build: fallisce se dist/ contiene la card finta degli E2E (__enjoyFakeCard)
npm run db:start / db:stop  # Supabase locale (Docker)
npm run db:reset            # riapplica migrazioni e seed
npm run db:test             # test pgTAP
npm run test:integration    # Vitest contro Supabase locale (tests/integration/)
npx supabase functions serve # Edge Function operator-invites in locale (prima: cp supabase/functions/.env.example supabase/functions/.env)
npm run tokens              # rigenera i token CSS da design/tokens.json
npm run icons               # rigenera le icone PWA
```
Deploy: Vercel da GitHub (anteprime = Supabase staging, `main` = produzione); migrazioni remote a mano con
`npx supabase db push` (vedi `docs/setup-accounts.md` e RUNBOOK); Edge Function, suoi segreti e template "Invite
user" a mano secondo le "Note di deploy" di `docs/specs/SPEC-operators.md`. `npm run test:integration` e
`npm run e2e` vogliono `npx supabase functions serve` acceso (RUNBOOK §1, "Operatori"). Trappole operative:
RUNBOOK §4.

## Struttura del repository
```
.claude/
  skills/        # skill di progetto (Addy Osmani, Impeccable, webapp-testing)
  agents/        # subagent Impeccable
  settings.json  # hook Impeccable + plugin project-brain
brain/           # memoria di progetto (stato, decisioni, passaggi tra sessioni)
CAPABILITY-MAP.md # moduli, dipendenze, ordine di costruzione
docs/            # specs/ (SPEC-<id>.md di ogni modulo, contratti), setup-accounts.md, setup-tablet.md, adr/ da creare
design/          # token e loghi del design system "Enjoy Bar"
src/             # app (app/, shared/ui/, lib/, styles/)
supabase/        # migrazioni, test pgTAP, config locale, templates/ delle email, functions/ (Edge Function operator-invites)
e2e/             # test Playwright
scripts/         # generazione token e icone
tasks/           # piano e task del modulo in corso
skills-lock.json # versioni delle skill installate
```

## Memoria di progetto — [project-brain](https://github.com/Ethan-YS/project-brain)
- `brain/` esiste (PROJECT, MAP, STATUS, DECISIONS, HANDOFF, topics/operations/RUNBOOK).
- "resume this project" → a inizio sessione legge MAP, STATUS e HANDOFF.
- "hand off" → prima di chiudere una sessione o quando il contesto è pieno, scrive `brain/HANDOFF.md`.
- "update the project brain" → propone aggiornamenti, da approvare uno per uno.
