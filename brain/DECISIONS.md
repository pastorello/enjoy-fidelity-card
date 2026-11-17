# DECISIONS — Registro delle decisioni

> **A cosa risponde**: "Perché abbiamo fatto X? Perché non Y?"
> Solo aggiunte, mai modificare le voci storiche (una decisione ribaltata = nuova voce che la sostituisce).
> Dalla più recente alla più vecchia. Ogni voce: decisione, perché, alternative scartate, ambito, contesto.
> Le decisioni già presenti nelle specifiche (PWA, Supabase, regole di dominio) vivono lì e in `CLAUDE.md`;
> qui si registrano quelle prese dopo.

---

## Registro (più recenti in alto)

### 2026-11-17 — identity V1: solo accesso, account creati a mano in Supabase

- **Decisione**: in V1 il modulo `identity` copre solo accesso, sessione e uscita. Gli account si creano e
  si tolgono dal pannello di Supabase (utente già confermato) e si registrano come operatori con una
  funzione SQL. Niente servizio email, niente inviti, niente "Password dimenticata", niente schermata
  Operatori, niente cambio di ruolo dall'app. Per togliere qualcuno si cancella l'utente; per rimetterlo
  lo si ricrea. Visibilità di nomi ed email tra colleghi: nessuna restrizione particolare, lo staff si
  conosce. Basta anche un solo utente.
- **Perché**: il bar non ha un dominio internet, e senza dominio un servizio email (Brevo) non può
  spedire inviti affidabili; all'utente in V1 interessa solo poter entrare nell'app.
- **Alternative scartate (Rejected alternatives)**:
  - Brevo con un dominio da comprare: costo e configurazione DNS non giustificati per la V1.
  - Brevo con mittente Gmail: Brevo sostituisce il mittente, le email rischiano lo spam.
  - Email predefinita di Supabase: scrive solo agli indirizzi del team, con pochi invii all'ora.
- **Ambito**: modulo `identity`; si discosta dalle specifiche (inviti via email). Da riprendere se arriva
  un dominio.
- **Contesto**: revisione delle Open Questions di `SPEC-identity.md`.

### 2026-11-17 — Oxlint al posto di ESLint, TypeScript 7

- **Decisione**: linting con Oxlint (regole TypeScript, React, react-hooks, jsx-a11y) e controllo basato sui
  tipi con `oxlint-tsgolint`, costruito su TypeScript 7; si resta su TypeScript 7. Prettier per la formattazione.
- **Perché**: typescript-eslint supporta TypeScript solo fino a 6.0 e eslint-plugin-jsx-a11y solo ESLint fino
  a 9; Oxlint copre le stesse regole in un solo strumento compatibile con TS 7.
- **Alternative scartate (Rejected alternatives)**:
  - TypeScript 6.0 + ESLint 9: tutto compatibile, ma rinuncia a TS 7.
  - TS 7 + ESLint 10 forzando le dipendenze: plugin fuori dal range supportato, errori silenziosi possibili.
  - Due versioni di TypeScript (7 per compilare, 6 per il lint): più complesso da mantenere.
  - Biome: controllo con i tipi più limitato.
- **Ambito**: modulo `platform`, strumenti di qualità del codice.
- **Contesto**: task 1 del piano `platform`, verifica delle dipendenze.

### 2026-11-16 — Staging separato e account creati dall'utente

- **Decisione**: due progetti Supabase gratuiti in UE, produzione e staging; le anteprime Vercel usano
  staging. Gli account Supabase e Vercel li crea l'utente con il proprio account; l'agente prepara
  configurazione e istruzioni.
- **Perché**: le prove sulle anteprime non devono mai toccare i dati veri dei clienti; gli account e la
  fatturazione restano in mano al titolare del progetto.
- **Alternative scartate (Rejected alternatives)**:
  - Un solo progetto Supabase: le anteprime scriverebbero sul database di produzione.
  - Account creati dall'agente: l'agente non gestisce credenziali né accetta termini di servizio.
- **Ambito**: modulo `platform` (deploy, ambienti).
- **Contesto**: approvazione di `SPEC-platform.md`.

### 2026-11-16 — Configurazione iniziale dai valori di esempio delle specifiche

- **Decisione**: al primo avvio rapporto 1 punto ogni 1 € (100 centesimi per punto); catalogo premi,
  rapporto e amministratori si impostano dall'app.
- **Perché**: sono dati di gestione, non requisiti: l'app ha già le schermate per cambiarli.
- **Alternative scartate (Rejected alternatives)**:
  - Chiedere ora i valori al titolare: non blocca lo sviluppo e li può cambiare in ogni momento.
- **Ambito**: seed del database, schermata Impostazioni.
- **Contesto**: `interview-me`.

### 2026-11-16 — Aggiunte al modello dati

- **Decisione**: oltre a quanto nelle specifiche: `configurazione` con soglia di conferma importo e formato
  del lettore USB; `movimenti` con identificativo dell'operazione generato dall'app (unico) e descrizione
  del premio libero; account di dispositivo per il tablet distinto dagli operatori.
- **Perché**: i wireframe e la sezione sicurezza li usano, ma il modello dati delle specifiche non li elenca.
- **Alternative scartate (Rejected alternatives)**:
  - Soglia di conferma fissa nel codice: i wireframe la mettono nelle Impostazioni.
  - Idempotenza basata su importo + cliente + ora: due spese uguali e legittime verrebbero fuse.
- **Ambito**: schema Supabase, RLS, flussi spesa/riscatto, login tablet.
- **Contesto**: confronto specifiche ↔ wireframe prima di `interview-me`.

### 2026-11-16 — Importi in centesimi interi ovunque

- **Decisione**: tutti gli importi (anche in `movimenti`) sono interi in centesimi; mai decimali in euro.
- **Perché**: le specifiche dicevano "importo in euro" nel modello dati e "centesimi interi" nel calcolo
  punti; i centesimi evitano errori di arrotondamento.
- **Alternative scartate (Rejected alternatives)**:
  - Decimali in euro (`numeric`): corretto in Postgres ma facile da sbagliare in JavaScript.
- **Ambito**: schema, calcolo punti, tastierino, export CSV (convertire solo in uscita).
- **Contesto**: contraddizione emersa rileggendo le specifiche.

### 2026-11-16 — Hosting su Vercel, dati Supabase in UE

- **Decisione**: frontend su Vercel; progetto Supabase in una regione europea.
- **Perché**: regione UE per il GDPR (dati personali dei clienti). Vercel e Netlify sono equivalenti per
  una PWA statica; serviva sceglierne uno.
- **Alternative scartate (Rejected alternatives)**:
  - Netlify: equivalente, nessun motivo forte contro; scartato solo per scegliere.
  - Regione Supabase USA (predefinita in alcuni casi): trasferimento dati extra-UE da evitare.
- **Ambito**: deploy, configurazione ambienti, informativa privacy.
- **Contesto**: punti aperti chiusi in `interview-me`; l'utente ha confermato.

### 2026-11-16 — Lettore NFC USB generico con formato configurabile

- **Decisione**: un lettore economico da 13,56 MHz in emulazione tastiera, compatibile NTAG215; il formato
  dell'uid (decimale/esadecimale, ordine dei byte) è un'impostazione dell'amministratore; l'app normalizza
  sempre in esadecimale maiuscolo senza separatori.
- **Perché**: il lettore non è ancora scelto; i lettori economici inviano l'uid in formati diversi.
- **Alternative scartate (Rejected alternatives)**:
  - Legarsi a un modello preciso: se cambia il prodotto o si rompe, l'app andrebbe modificata.
  - Lettori PC/SC (es. con driver): non emulano la tastiera, servirebbe un'app nativa sul tablet.
- **Ambito**: ingresso lettura card (unico punto per Web NFC e lettore USB), Impostazioni.
- **Contesto**: `interview-me`; l'utente ha accettato la proposta.

### 2026-11-16 — Niente modalità offline

- **Decisione**: nessuna coda di operazioni senza rete; solo il reinvio idempotente dopo un errore,
  già previsto dalle specifiche.
- **Perché**: l'utente l'ha escluso esplicitamente.
- **Alternative scartate (Rejected alternatives)**:
  - Coda offline con sincronizzazione: complessa e rischiosa per il vincolo "saldo mai sotto zero",
    controllato sul server.
- **Ambito**: flusso spesa/riscatto, gestione errori di rete.
- **Contesto**: `interview-me`.

### 2026-11-16 — Perimetro: consegna completa delle tre fasi

- **Decisione**: si consegna tutto ciò che le specifiche prevedono: prima versione su telefono, lancio
  delle 50 card, fase tablet con lettore USB e cambio operatore con PIN. Il tempo non è un vincolo.
- **Perché**: risposta esplicita dell'utente ("facciamo tutto quello che ci siamo predisposti… e
  consegniamo", "consegnamo tutto").
- **Alternative scartate (Rejected alternatives)**:
  - MVP come sola prova tecnica delle card NFC: proposta iniziale dell'utente, poi superata.
  - Pilota ridotto (lettura, nuovo cliente, spesa, saldo): scartato con la stessa correzione.
  - Solo telefono, con il tablet solo predisposto: l'utente vuole consegnare anche il tablet.
- **Ambito**: tutto il progetto; pianificazione.
- **Contesto**: `interview-me`, intento confermato (vedi `PROJECT.md`).

### 2026-11-16 — Adozione di project-brain

- **Decisione**: memoria di progetto nella cartella `brain/` (PROJECT, MAP, STATUS, DECISIONS, HANDOFF +
  topics/), con `CLAUDE.md` come punto d'ingresso.
- **Perché**: progetto lungo, su più sessioni; serve che ogni nuova sessione riparta da stato e decisioni.
- **Alternative scartate (Rejected alternatives)**:
  - Solo CLAUDE.md: mescolerebbe regole stabili con stato che cambia ogni sessione.
  - Organizzare la documentazione più avanti: rifarla dopo costa di più.
- **Ambito**: organizzazione della documentazione del progetto.
- **Contesto**: avvio del progetto, dopo `interview-me`.
