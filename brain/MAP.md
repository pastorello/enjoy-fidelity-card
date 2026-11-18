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
| Premi (`rewards`) | Tabella `app.rewards` (nome unico senza distinzione di maiuscole né spazi esterni, indice `rewards_name_key`; punti 1–99 999; `active`; `created_by`/`updated_by` con `private.acting_operator_id()`), lettura per gli operatori attivi, scrittura solo con RPC per amministratori (`create_reward` idempotente sull'id generato dall'app, `update_reward` per nome e punti, `set_reward_active`); nessuna cancellazione per nessun ruolo e nessun trigger. UI: riga "Catalogo premi" nella sezione GESTIONE di `/impostazioni` (solo admin), `/impostazioni/premi` con elenco ordinato da `sortRewards()`, casella Attivo salvata subito, riquadro Nuovo premio / Modifica premio in basso; l'operatore vede "Solo per gli amministratori". Seed: i 5 premi del wireframe (`Dolce del giorno` inattivo), usati anche da `ledger` | completo (`feat/rewards`, PR verso `main` da unire dopo #16 e #17); migrazioni `*_rewards*.sql` (3) da applicare allo staging con `db push` | `src/features/rewards/` (unico accesso a Supabase: `supabaseRewardsService.ts`, verificato da `scripts/rewardsBoundary.test.ts`, che controlla anche la traduzione di ogni errcode della migrazione), `src/test/fakeRewardsService.ts`, `supabase/migrations/*_rewards*.sql` (tabella e RPC; reinvio concorrente di `create_reward`; spazi Unicode esterni nel nome), `supabase/tests/rewards.test.sql`, `tests/integration/rewards.test.ts`, `e2e/rewards.spec.ts` (progetto `phone`); criteri di successo con i test che li provano in `tasks/rewards/plan.md`, controllati da `scripts/rewardsCriteria.test.ts` |
| Lettura card (`card-input`) | Un solo servizio di lettura per tutta l'app (`createCardReader`): Web NFC (stati `needs-permission`/`active`/`off`/`denied`/`unsupported`, ripresa al ritorno nell'app) e lettore USB a emulazione tastiera (`keyboardWedge`, raffiche ≤ 50 ms chiuse da Invio) come ingressi equivalenti; `normalizeUid` (esadecimale maiuscolo senza separatori, formati USB di `settings`); pila dei consumatori (`useCardRead`, riceve solo l'ultimo attivato), anti-ripetizione 2 s, vibrazione; attivo solo con un operatore collegato (`CardReaderSession` in `RequireAuth`). Scrittura del link (`useCardWriter().writeUrl`): un solo record URL, solo sulla card riconosciuta, riuscita solo dopo la rilettura, mai `makeReadOnly`. Riquadro `CardReadPanel` (completo, `usb`, `compact`) sopra la ricerca della home, che non consuma letture fino a `cards`. Card finta per gli E2E solo con `VITE_E2E=1` | completo (`feat/card-input`, PR verso `main` da unire dopo #18); nessuna migrazione; prova manuale su Android da fare (RUNBOOK, "Prova manuale della lettura card") | `src/features/card-input/` (API del browser per le card solo qui e niente `console.*`, verificato da `scripts/cardInputBoundary.test.ts`), `src/test/fakeWebNfc.ts`, `e2e/nfc.ts` (`stubWebNfc`, `fakeCardWrites`), `e2e/card-input.spec.ts`, `scripts/check-bundle.ts` (`npm run check:bundle`, in CI e nel `buildCommand` di Vercel); piano e criteri in `tasks/card-input/` |
| Card (`cards`) | Tabella `app.cards` (uid esadecimale maiuscolo, una card attiva per cliente con indice unico parziale, un uid legato per sempre a un cliente, mai cancellata), RPC idempotenti `lookup_card`, `associate_card` (associa, sostituisce, riattiva), `deactivate_card`, `create_customer_with_card` (tutto-o-niente sull'`operation_id` di `customers`); l'anonimizzazione disattiva la card. Link ai punti: `issue_card_link` / `confirm_card_link`, token casuale di 128 bit di cui `private.card_links` tiene solo l'impronta sha256 (mai l'uid nel link), valido solo dopo la conferma e cancellato a ogni disattivazione; `public.card_points(text)` unica funzione eseguibile da `anon` (intero o `null`, `Cache-Control: no-store`). UI: card letta in home → Registra spesa (segnaposto fino a `ledger`) o Nuovo cliente con la card, avvisi «Card disattivata»/«Card non più valida»; Associa o sostituisci card (`/clienti/:id/card`), sezione CARD di Modifica cliente (stato del link, «Scrivi il link», Disattiva card), riga card della scheda; `CardLinkWriter` scrive il link con `useCardWriter().writeUrl`; pagina pubblica `/s/:token` (solo «ENJOY YOUR POINTS» e il saldo, niente service worker né installazione, `no-store` e `noindex` in `vercel.json`) | completo (`feat/cards`, PR verso `main` da unire dopo #18 e #19); migrazione `*_cards.sql` da applicare allo staging con `db push`; `VITE_CARD_LINK_ORIGIN` su Vercel Production; prova manuale dei criteri 10 e 14 da fare (RUNBOOK, «Prova manuale del link ai punti») | `src/features/cards/` (unici accessi a Supabase: `supabaseCardsService.ts` e `public/cardPointsService.ts`, verificato da `scripts/cardsBoundary.test.ts`; codici d'errore allineati alla migrazione da `scripts/cardErrorCodes.test.ts`), `src/test/fakeCardsService.ts`, `src/test/fakeLinkWrites.ts`, `supabase/migrations/*_cards.sql`, `supabase/tests/cards.test.sql`, `card_links.test.sql`, `card_points.test.sql`, `tests/integration/cards.test.ts`, `e2e/cards.spec.ts`, `e2e/card-points.spec.ts`; criteri di successo con i test che li provano in `tasks/cards/plan.md`, controllati da `scripts/cardsCriteria.test.ts` |
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
| `tasks/rewards/` | Piano e task del modulo `rewards`; in `plan.md` la verifica dei 9 criteri di successo, test per test | Prima di lavorare su `rewards` o su `ledger` (riscatti dal catalogo) |
| `tasks/card-input/` | Piano e task del modulo `card-input`; in `plan.md` i 10 criteri di successo, con le parti manuali su Android | Prima di lavorare su `card-input` o su `cards` (consumatori delle letture, scrittura del link) |
| `tasks/cards/` | Piano e task del modulo `cards` (con il link ai punti e la pagina pubblica); in `plan.md` la verifica dei 15 criteri di successo, test per test, con le parti manuali nel RUNBOOK | Prima di lavorare su `cards`, su `ledger` (Registra spesa al posto del segnaposto, saldo in `card_points`) o su `tablet-kiosk` (Associa card dal tablet) |
| `tests/integration/` | Test Vitest contro lo stack Supabase locale (`npm run test:integration`, config `vitest.integration.config.ts`) | Quando si tocca Auth, RLS o il seed |
| `e2e/` | Test Playwright; `fixtures.ts` (console pulita, niente Supabase online), `auth.ts` (accesso con gli account del seed), `mailpit.ts` (lettura delle email locali); in `playwright.config.ts` il progetto `phone-settings` raccoglie, in serie e dopo `phone`, le spec che cambiano la configurazione condivisa (`SHARED_STATE_SPECS`) | Prima di scrivere un test E2E |
| `supabase/seed.sql` | Account finti per sviluppo e test (mai dati reali); `recupero@example.com` riservato a `e2e/password.spec.ts`; 5 clienti finti (telefoni `+39333000000x`, uno senza telefono; `Giulia Bianchi` serve a `e2e/customers.spec.ts` per il nome già usato); i 5 premi del wireframe "Catalogo premi" (mai modificati dagli E2E) | Quando servono utenti di prova |
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
