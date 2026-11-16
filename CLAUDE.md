# CLAUDE.md — Enjoy Fidelity Card

Istruzioni per gli agenti che lavorano su questo repository.

## Il progetto

**Enjoy Fidelity Card** è un'applicazione per **tablet** installata **all'interno del locale Enjoy**.
Serve a gestire la fidelity card dei clienti (iscrizione, raccolta punti/timbri, premi).

> ⚠️ Fase iniziale: requisiti, stack e architettura **non sono ancora definiti**.
> Le sezioni marcate `TBD` vanno completate prima di scrivere codice applicativo.
> Non inventare requisiti: se manca un'informazione, chiedi (skill `interview-me`).

### Contesto d'uso (vincoli già noti)
- Dispositivo: tablet fisso nel locale, uso in modalità kiosk / a schermo intero.
- Utenti: staff del locale e/o clienti al banco → interfaccia touch-first, utilizzabile in piedi e di fretta.
- Target touch minimi 48×48 px, testi leggibili a distanza di un braccio, alto contrasto (luce del locale variabile).
- Connettività potenzialmente instabile → valutare il funzionamento offline e la sincronizzazione.
- Dati personali dei clienti (nome, telefono/email, storico) → GDPR: consenso esplicito, minimizzazione dei dati, nessun dato sensibile in log o nel repo.

### Requisiti funzionali — TBD
- [ ] Chi usa il tablet: solo staff, solo clienti, entrambi?
- [ ] Identificazione cliente: QR, numero di telefono, tessera fisica/NFC?
- [ ] Meccanica: punti, timbri, livelli? Regole di accumulo e riscatto premi.
- [ ] Area admin: gestione premi, statistiche, export.
- [ ] Un solo locale o più sedi?

### Stack — TBD
Da decidere con la skill `spec-driven-development` e documentare con un ADR in `docs/adr/`.
Opzioni da valutare: PWA (web app installabile in kiosk) vs app nativa/cross-platform; backend e database.

## Lingua
- Comunicazione con l'utente e UI dell'app: **italiano**.
- Codice, nomi di variabili, commit e commenti tecnici: **inglese**.

## Workflow con le skill

Le skill sono installate a livello di progetto in `.claude/skills/` (tracciate in `skills-lock.json`).

### Ingegneria — [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
Ciclo standard per ogni funzionalità:
1. `interview-me` / `idea-refine` → chiarire i requisiti.
2. `spec-driven-development` → spec scritta prima del codice (in `docs/specs/`).
3. `planning-and-task-breakdown` → task piccoli e verificabili.
4. `incremental-implementation` + `test-driven-development` → implementazione a piccoli passi, test prima.
5. `code-review-and-quality` → review prima del merge.
6. `security-and-hardening` → obbligatoria per tutto ciò che tocca dati dei clienti o autenticazione.

Altre skill da usare quando pertinenti: `frontend-ui-engineering`, `api-and-interface-design`,
`debugging-and-error-recovery`, `performance-optimization`, `documentation-and-adrs`,
`git-workflow-and-versioning`, `ci-cd-and-automation`, `shipping-and-launch`.
Indice completo: skill `using-agent-skills`.

### Design — [Impeccable](https://github.com/pbakaus/impeccable)
- Prima di qualsiasi lavoro di UI: `/impeccable init` per creare il contesto di design del progetto.
- Usa i comandi Impeccable (critique, audit, polish…) per rivedere ogni schermata.
- Subagent disponibili in `.claude/agents/`: `impeccable-finish-reviewer`, `impeccable-documenter`,
  `impeccable-asset-producer`, `impeccable-manual-edit-applier`.
- L'hook in `.claude/settings.json` esegue il detector di Impeccable dopo ogni Edit/Write sui file UI:
  i problemi segnalati vanno risolti, non ignorati. Eventuali eccezioni (es. font del brand) si
  registrano con `npx impeccable ignores add-value …` motivandole.

### Test E2E — [anthropics/skills · webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing)
- Usa `webapp-testing` per verificare l'app in un browser reale con Playwright (Python):
  screenshot, log della console, flussi completi.
- Testa sempre con viewport da tablet (es. 1024×768 e 1366×1024, orizzontale e verticale) e input touch.
- Lo script `.claude/skills/webapp-testing/scripts/with_server.py` avvia il dev server prima dei test.

## Regole di lavoro
- Branch dedicato per ogni modifica; mai commit diretti su `main` senza richiesta esplicita.
- Commit piccoli e atomici, messaggi in stile Conventional Commits (`feat:`, `fix:`, `chore:`…).
- Nessun segreto nel repo: usa `.env` (ignorato) e mantieni aggiornato `.env.example`.
- Il repo è **pubblico**: niente dati reali di clienti, nemmeno nei fixture di test.
- Aggiornare questo file quando vengono prese decisioni su stack, architettura o comandi.

## Comandi — TBD
Da compilare quando lo stack è scelto (install, dev, test, lint, build, deploy).

## Struttura del repository
```
.claude/
  skills/        # skill di progetto (Addy Osmani + Impeccable)
  agents/        # subagent Impeccable
  (webapp-testing in skills/: test E2E con Playwright)
  settings.json  # hook condivisi (detector Impeccable)
docs/            # (da creare) specs/ e adr/
skills-lock.json # versioni delle skill installate
```

## Memoria di progetto — [project-brain](https://github.com/Ethan-YS/project-brain)
Plugin installato a livello di progetto (`.claude/settings.json`). Comandi in linguaggio naturale:
- "set up project brain" → crea la cartella `brain/` (PROJECT, MAP, STATUS, DECISIONS, HANDOFF).
- "resume this project" → a inizio sessione legge `brain/MAP.md`, `brain/STATUS.md` e `brain/HANDOFF.md`.
- "hand off" → prima di chiudere una sessione o quando il contesto è pieno, scrive `brain/HANDOFF.md`.
- "update the project brain" → propone aggiornamenti, da approvare uno per uno.
