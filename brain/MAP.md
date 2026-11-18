# MAP — Mappa del progetto

> **A cosa risponde**: "Com'è fatto il progetto? Dove trovo le informazioni?"
> Granularità a livello di modulo. **Prima cosa da leggere in ogni nuova sessione**, insieme a `STATUS.md`.

---

## 1. Avvio rapido

`npm install`, `npm run db:start`, `npm run dev`. Comandi completi in `CLAUDE.md` e
`topics/operations/RUNBOOK.md`.

## 2. Moduli

| Modulo | Responsabilità | Stato | Posizione |
|---|---|---|---|
| App PWA | Interfaccia per telefono (390×844) e tablet (1280×800); lettura card via Web NFC e lettore USB | base pronta (`platform`) | `src/` |
| Backend Supabase | Postgres, Auth, RLS; transazioni di spesa/riscatto con controllo saldo e idempotenza | base pronta (schema `app`, RLS automatica) | `supabase/` |
| Identità (`identity`) | Accesso email/password, sessione, guardia delle rotte, Impostazioni con Esci; profili `app.operators`, ruoli, `private.add_operator` | in corso (PR #13, `feat/identity`) | `src/features/identity/`, `supabase/migrations/*_identity.sql`, `supabase/tests/identity.test.sql` |
| Recupero password (`identity`, spec aggiuntiva) | "Password dimenticata?" su `/accedi`, `/password-dimenticata`, `/imposta-password` (link `token_hash` + `verifyOtp`), "Cambia password" nelle Impostazioni; email di Auth (Mailpit in locale) | completo (`feat/identity-password`, PR verso `main` dopo #13); procedura remota da eseguire (`docs/setup-accounts.md` §6) | `src/features/identity/` (ForgotPasswordPage, ResetPasswordPage), `supabase/templates/recovery.html`, `e2e/password.spec.ts`, `e2e/mailpit.ts`, `tests/integration/password.test.ts`, `scripts/reload-auth-templates.sh` (riavvio di Auth dopo `supabase start`, RUNBOOK trappola 28) |
| Configurazione (`settings`) | Riga unica `app.settings` (rapporto in centesimi per punto 100, soglia di conferma 15000 centesimi, formato uid USB `'hex'`); scrittura solo con `app.update_settings` (amministratori, limiti e ruolo verificati sul server); `/impostazioni`: "PUNTI E CONTROLLI" (admin) e "PUNTI" in sola lettura (operatore). Introduce le parti condivise `private.acting_operator_id()` (id del profilo che agisce, per `updated_by`/`operator_id`) e `useAuth().reportNotEnabled()` (dopo un 42501: profilo assente → `/accedi`, presente → ruolo aggiornato) | completo (`feat/settings`, PR verso `main`) | `src/features/settings/` (unico accesso a Supabase: `supabaseSettingsService.ts`; componenti solo con `useSettings()`, verificato da `scripts/settingsBoundary.test.ts`), `supabase/migrations/*_settings.sql`, `supabase/tests/settings.test.sql`, `tests/integration/settings.test.ts`, `e2e/settings.spec.ts` (progetto Playwright `phone-settings`) |
| Clienti (`customers`) | Tabella `app.customers` (nome unico tramite `name_key` senza accenti, maiuscole né apostrofi tipografici; telefono E.164 facoltativo; note; consenso privacy con l'ora del server), scrittura solo con RPC idempotenti (`create_customer` con `operation_id`, `update_customer`, `anonymize_customer` solo admin); letture `search_customers` (parole in qualunque ordine o cifre del telefono, 21 righe, sotto 50 ms con 1 000 clienti), `get_customer`, `customers_served_today` (vuota fino a `ledger`, firme già definitive in `app.customer_summary`). UI: home "Cerca cliente" (`/`, `?q=`), Nuovo cliente, scheda, Modifica cliente, DATI DEL CLIENTE (cancellazione dei dati, solo admin) | completo (`feat/customers`, PR verso `main` dopo #15); migrazione da applicare allo staging con `db push` | `src/features/customers/` (unico accesso a Supabase: `supabaseCustomerService.ts`, verificato da `scripts/customersBoundary.test.ts`; codici d'errore in `errorCodes.ts`, allineati alla migrazione da `scripts/customerErrorCodes.test.ts`), `src/test/fakeCustomerService.ts`, `supabase/migrations/*_customers.sql`, `supabase/tests/customers.test.sql`, `tests/integration/customers.test.ts`, `e2e/customers.spec.ts` (progetto `phone`); criteri di successo con i test che li provano in `tasks/customers/plan.md`, controllati da `scripts/customersCriteria.test.ts` |
| Tooling agenti | Skill, subagent e hook di progetto | stabile | `.claude/` |
| Memoria di progetto | Stato, decisioni, passaggi tra sessioni | stabile | `brain/` |

## 3. Dipendenze tra moduli

```
card NFC ──(Web NFC | lettore USB tastiera)──▶ App PWA ──(Supabase Auth + RLS)──▶ Postgres
                                                  │
                                       hosting Vercel (HTTPS, richiesto da Web NFC)
```

La lettura card ha un unico punto d'ingresso nell'app: telefono e lettore USB sono equivalenti.

## 4. I 5 file di continuità (`brain/`)

| File | Risponde a | Quando leggerlo |
|---|---|---|
| `PROJECT.md` | Definizione, intento confermato, non-obiettivi | Primo contatto, perimetro in dubbio |
| `MAP.md` | Struttura, indice dei documenti | Ogni sessione |
| `STATUS.md` | Stato attuale, prossimo passo | Ogni sessione |
| `HANDOFF.md` | Rapporto dell'ultimo turno | Ogni sessione (se compilato) |
| `DECISIONS.md` | Decisioni e alternative scartate | Quando serve il perché di una scelta |

`handoffs/` — archivio dei vecchi HANDOFF.

## 5. Documenti (topics e fonti)

### Fonti di verità esterne (claude.ai, private)
| Documento | Cos'è | Quando leggerlo |
|---|---|---|
| [Specifiche](https://claude.ai/artifact/59XU2sRGx1EoUtxS8mxN6S) | Obiettivo, architettura, ruoli, flussi, modello dati, privacy, fasi | Prima di scrivere spec, schema o flussi |
| [Wireframe](https://claude.ai/artifact/K6PkvCmqMum8jV3cNuHD7n) | 41 schermate telefono + tablet, stati ed errori, note | Prima di ogni lavoro di UI o di flusso |
| [Design system "Enjoy Bar"](https://claude.ai/artifact/GY9B6wF97G5FCLapU8KRUH) | Colori, tipografia, componenti, stati/errori/conferme | Prima di `/impeccable init` e di ogni UI |

### Nel repo
| File | Cos'è | Quando leggerlo |
|---|---|---|
| `CLAUDE.md` | Regole stabili: architettura, invarianti di dominio, ruoli, privacy, workflow skill | Ogni sessione (caricato in automatico) |
| `CAPABILITY-MAP.md` | Moduli, dipendenze, ordine di costruzione, indice delle spec | Prima di scegliere su cosa lavorare |
| `docs/specs/SPEC-platform.md` | Spec del modulo `platform` (approvata) | Prima di lavorare su scheletro, CI, deploy, UI base |
| `docs/specs/SPEC-identity.md` | Spec del modulo `identity` (approvata) | Prima di lavorare su accesso, ruoli, operatori |
| `docs/specs/SPEC-identity-password.md` | Spec aggiuntiva di `identity`: password dimenticata e cambio password via email (approvata) | Prima di toccare recupero password, email di Auth, URL di ritorno |
| `SPEC-<id>.md`, `docs/specs/` | Spec degli altri moduli; contratto comune (`contract.md`) e revisione incrociata (`cross-review.md`, ordine delle sezioni di `/impostazioni`) | Prima di lavorare su un modulo |
| `PRODUCT.md` | Contesto di prodotto per Impeccable (utenti, ambiente, tono "tu", vincoli di marchio) | Prima di ogni lavoro di UI |
| `design/tokens.json` | Copia dei token del design system "Enjoy Bar" (fonte di `src/styles/tokens.css`) | Quando cambiano colori, testo o misure |
| `tasks/plan.md`, `tasks/todo.md` | Piano e task del modulo `platform` | Storico |
| `tasks/identity/` | Piano e task del modulo `identity` | Prima di lavorare su `identity` |
| `tasks/identity-password/` | Piano e task del recupero password | Prima di lavorare sul recupero password |
| `tasks/settings/` | Piano e task del modulo `settings` (con la tabella dei criteri di successo) | Prima di lavorare su `settings` |
| `tasks/customers/` | Piano e task del modulo `customers`; in `plan.md` la verifica degli 8 criteri di successo, test per test | Prima di lavorare su `customers` o su un modulo che ne cambia i corpi delle RPC (`ledger`, `cards`) |
| `tests/integration/` | Test Vitest contro lo stack Supabase locale (`npm run test:integration`, config `vitest.integration.config.ts`) | Quando si tocca Auth, RLS o il seed |
| `e2e/` | Test Playwright; `fixtures.ts` (console pulita, niente Supabase online), `auth.ts` (accesso con gli account del seed), `mailpit.ts` (lettura delle email locali); in `playwright.config.ts` il progetto `phone-settings` raccoglie, in serie e dopo `phone`, le spec che cambiano la configurazione condivisa (`SHARED_STATE_SPECS`) | Prima di scrivere un test E2E |
| `supabase/seed.sql` | Account finti per sviluppo e test (mai dati reali); `recupero@example.com` riservato a `e2e/password.spec.ts`; 5 clienti finti (telefoni `+39333000000x`, uno senza telefono; `Giulia Bianchi` serve a `e2e/customers.spec.ts` per il nome già usato) | Quando servono utenti di prova |
| `supabase/templates/recovery.html` | Email "Reset password" (locale da `config.toml`; nei progetti online si incolla a mano) | Quando cambia il testo dell'email di recupero |
| `docs/setup-accounts.md` | Guida per creare Supabase (prod + staging) e Vercel, applicare le migrazioni, esporre lo schema `app`, gestire operatori; §6 email di Auth (URL di ritorno, template, minimo 8 caratteri) | Prima del primo deploy; quando si aggiunge o toglie un operatore; prima di attivare il recupero password online |
| `docs/adr/` | (da creare) decisioni architetturali dettagliate | Quando una decisione richiede più di una voce in DECISIONS |

### operations/
| File | Cos'è | Quando leggerlo |
|---|---|---|
| `topics/operations/RUNBOOK.md` | Comandi, controlli, dove guardare, trappole numerate | Prima di operare; quando qualcosa si rompe; prima di un HANDOFF |

`topics/systems/`, `topics/planning/`, `topics/feedback/`: vuote per ora; registrare qui ogni file aggiunto.

## 6. Flussi di lavoro e progetti vicini

Progetto a flusso unico (`STATUS.md` / `HANDOFF.md`), nessun progetto vicino. Se nasceranno flussi paralleli
(es. app e operazioni), seguire METHODOLOGY §3.5 di project-brain.

## 7. Auto-calibrazione della MAP

Aggiornare quando: un modulo nasce/cambia stato (§2), cambia una dipendenza (§3), si aggiunge o toglie un
documento (§5), cambiano i comandi di avvio (§1). Su richiesta ("calibra la MAP"): cercare file in `topics/`
non registrati, voci che puntano a file inesistenti, descrizioni non più vere.
