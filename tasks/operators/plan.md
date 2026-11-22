# Implementation Plan: operators

Source spec: [SPEC-operators.md](../../docs/specs/SPEC-operators.md) (approvata il 2026-11-22; le Open
Questions usano i default adottati, da rivedere con il titolare: 7 e 11 "da chiedere")

## Overview

Un amministratore aggiunge dall'app un altro amministratore o un operatore (nome, email, ruolo) dalla nuova
schermata **Operatori** (`/impostazioni/operatori`, prima riga di GESTIONE), senza aprire Supabase. La persona
riceve l'email d'invito da `info@enjoygaeta.it` e sceglie da sola la password su `/imposta-password` (versione
"invito"). Dalla stessa schermata l'amministratore vede chi lavora al bar, cambia il ruolo, disattiva e
riattiva un account, rimanda o annulla un invito non ancora accettato. Il bar non resta mai senza un
amministratore attivo. Lato server: colonne nuove in `app.operators`, prenotazioni d'invito in
`private.operator_invites`, RPC per elenco, ruolo e attivazione, e la **prima Edge Function** del progetto
(`supabase/functions/operator-invites`), unico punto che usa la chiave segreta. Lato client: servizio
`operatorsService` con finto e provider, schermata telefono 390×844 e layout tablet 1280×800 (colonna 480 px,
niente amministratori dal tablet), `Dialog` condiviso estratto da `ConfirmDialog`, `AdminsOnly` condiviso,
controllo dell'identità a ogni cambio di rotta anche per gli account operatore.

## Architecture Decisions

- **Database prima di tutto** (rischio più alto: un disattivato che legge ancora, un non amministratore che
  invita, il bar senza amministratori). Una sola migrazione `*_operators.sql` creata con
  `npx supabase migration new operators` (dopo `*_tablet_kiosk_pin_lock_order.sql`), completata in place nei
  task 1–4 e applicata con `npm run db:reset` (mai pubblicata da qui). Prima di scriverla, `grep` di
  `app.operators` in tutte le migrazioni per trovare ogni punto che considera "collegato" = "attivo" (spec,
  "Helper ridefiniti").
- **Disattivazione = una RPC atomica nel database**, non un ban di Auth (Open Questions 3). La garanzia è
  negli helper ridefiniti con `create or replace` e stessa firma (`current_operator_id()`,
  `valid_cashier_id()`, `get_session_identity()`, `list_cashiers()`, `unlock_cashier()`, `add_operator()`):
  dalla transazione successiva il token ancora valido non legge nulla. I pgTAP esistenti restano verdi senza
  modifiche (prova di non regressione).
- **Ultimo amministratore senza corse**: `set_operator_role` e `set_operator_active` bloccano in un'unica
  `select … order by id for update` il bersaglio e tutti gli amministratori attivi, poi nell'istruzione
  successiva controllano `is_admin()`, sé stessi (`EO002`), `removed` (`EO003`), dispositivo → admin
  (`EO005`) e la regola `EO001` (conta solo chi ha l'invito accettato: email confermata **e** password).
  Prova della corsa in un test di integrazione con due connessioni.
- **Autorizzazione tutta nelle RPC**: la funzione non decide nulla sul ruolo. Il client del chiamante (chiave
  pubblicabile + `Authorization` ricevuto) chiama le RPC `*_begin`, dove PostgREST verifica il token e
  `is_admin()` il ruolo (`verify_jwt` accetta anche la chiave `anon`, quindi non basta). Le RPC `*_finish`,
  `_fail`, `_orphan`, `_resend_finish`, `_cancel_check` sono eseguibili **solo** da `service_role`
  (`function_privileges.test.sql` esteso).
- **Chiave segreta isolata**: solo `supabase/functions/operator-invites/index.ts` legge l'ambiente
  (`SUPABASE_SECRET_KEYS.default`, in mancanza `SUPABASE_SERVICE_ROLE_KEY`) e crea i due client;
  `handler.ts` riceve i client iniettati, non usa globali di Deno e si prova con Vitest. Il controllo dei
  criteri verifica che nessuna chiave segreta compaia in `src/`, `dist/` o nel repo e la guardia del confine
  che `src/` non nomini `service_role`, `SUPABASE_SECRET_KEYS` né `auth.admin`.
- **Idempotenza dell'invito** con `operation_id` generato dall'app e prenotazione in
  `private.operator_invites` (indici unici parziali `pending` su email e nome): due inviti allo stesso
  indirizzo o nome non arrivano mai insieme ad Auth. Compensazione (`deleteUser`) solo se l'utente è nuovo
  **e** `operator_invite_orphan` lo conferma rileggendo il database.
- **Origine e CORS**: risposta solo a `Origin` in `APP_ORIGINS` (+ modello `APP_PREVIEW_ORIGIN`), `redirectTo`
  = `<Origin>/imposta-password`, mai dal corpo; `Access-Control-Allow-Headers` da `corsHeaders` di
  `@supabase/supabase-js/cors`, mai `Allow-Origin: *`. La funzione risponde da sé a `OPTIONS` (in locale lo fa
  Kong: il preflight si prova solo nel test di unità).
- **Strumenti per la funzione**: `supabase/functions/**/*.test.ts` in `test.include` di `vite.config.ts`;
  `tsconfig.functions.json` (handler e test) richiamato da `npm run typecheck`; `index.ts` fuori da tsc e lint
  (`deno check` facoltativo in CI). Import map `deno.json` fissata a `@supabase/supabase-js@2.119.0`, la
  versione dell'app.
- **Integrazione con la funzione servita in locale**: `npx supabase functions serve` (legge
  `supabase/functions/.env`, ignorato da git; modello `.env.example` con `APP_ORIGINS` e nessuna chiave) e
  Mailpit per l'email; in CI un passo avvia `functions serve` in background dopo `supabase start` e
  `scripts/reload-auth-templates.sh`, aspettando che `/functions/v1/operator-invites` risponda. Mai
  `functions deploy`, mai `--linked`/`--remote`: il deploy lo fa l'orchestratore.
- **Servizio iniettato come gli altri moduli**: `src/features/operators/types.ts` (risultati come unioni
  discriminate, spec "Code Style"), `supabaseOperatorsService.ts` (unico file che nomina `list_operators`,
  `set_operator_role`, `set_operator_active` e `operator-invites`; `serverFaultFor` di
  `src/lib/serverFault.ts` per primo), `OperatorsServiceProvider`/`useOperatorsService()` in `main.tsx` e
  `renderApp` (parametro facoltativo in coda), `src/test/fakeOperatorsService.ts` (stati, regole del server,
  rete giù, registro delle chiamate). Guardia `scripts/operatorsBoundary.test.ts`: le pagine non chiamano
  `getSupabase()`, niente `console.*`, `localStorage`, email nei log o nell'URL. I ref letti dai gestori usano
  `src/lib/useLatest.ts`.
- **Componenti condivisi, nessuno nuovo oltre a quelli della spec**: `src/shared/ui/Dialog.tsx` (guscio
  estratto da `ConfirmDialog`, che si ricostruisce sopra con test invariati, mostrato in `/dev/ui`) e
  `src/shared/ui/AdminsOnly.tsx` (spostato da `RewardsCatalogPage.tsx`, stesso aspetto e test).
- **Riga in Impostazioni**: `operators` esporta `OperatorsSettingsRow`; `RewardsSettingsSection` (di `rewards`,
  proprietaria di GESTIONE) la mostra come primo `<li>`. `cross-review.md` §1 voce 4 si aggiorna.
- **Versione "invito" di `/imposta-password`**: testi dal frammento letto con `URLSearchParams`; errore solo
  con le chiavi `error`/`error_code` (oggi `hash.includes('error')` fa scadere un invito per "Terrore"), in
  entrambe le versioni della pagina; `verifyOtp({ type: 'invite' })` nel servizio di identity;
  `RootLayout` inoltra anche `/?token_hash=…&type=invite` conservando query e frammento.
- **Layout tablet = varianti della stessa pagina** con `useTabletLayout()` e `TabletColumns` di
  `tablet-kiosk`; nel layout tablet il radio "Amministratore" è disabilitato con la nota (il server rifiuta
  comunque con `EO005`). Enjoy Display: titoli e pulsanti nuovi passano da `scripts/displayGlyphs.test.ts`.
- **Seed ed E2E** (`fullyParallel`): account riservati `disattiva@example.com` "Disattiva Prova",
  `ruolo@example.com` "Ruolo Prova" (operatori), `admin-operatori@example.com` "Admin Operatori" (admin) e il
  tablet `cassa-operatori@example.com` (RUNBOOK trappola 47); invitati con nome ed email casuali per
  esecuzione; ogni E2E ripristina lo stato iniziale. Solo `@example.com`.
- **Revisione `security-and-hardening` obbligatoria** al Checkpoint A (helper, ultimo amministratore,
  privilegi, prenotazioni), al Checkpoint B (isolamento della chiave segreta, origine/CORS, compensazione,
  log senza email) e al Checkpoint D (sessioni disattivate nel client, tablet).
- **Pubblicazione esclusa da questo piano**: migrazione remota, template incollato, `secrets set`,
  `functions deploy` e prova reale sullo staging li fa l'orchestratore seguendo le "Note di deploy" della
  spec. La PR va su `main` (nessun ramo in catena).

## Dependency Graph

```
migrazione operators
  colonne + helper ridefiniti + seed (1)
    └── list_operators, set_operator_role, set_operator_active (2)
          └── operator_invites + invite_begin/finish/fail/orphan (3) ── resend + cancel (4)
                └── integrazione: corse (5)
                      │
                      ├── handler: confine, CORS, input + strumenti (6) ── index.ts + functions serve (7)
                      │       └── invito nel handler (8) ── reinvio e annullamento (9)
                      │               └── template + integrazione reale + CI (10) ── reinvio/annullamento reali (11)
                      │
                      └── OperatorsService + confine (12) ── finto + provider (13)
                              ├── Dialog + ConfirmDialog (14) ── AdminsOnly + riga GESTIONE + rotta (15)
                              │       └── elenco (16) ── Disattiva/Riattiva (17) ── dialogo persona (18) ── Invita (19)
                              └── /imposta-password invito (20) ── inoltro, nota, controllo a ogni rotta (21)
                                      └── E2E telefono (22)
                                              └── layout tablet (23) ── E2E tablet (24)
                                                      └── documentazione (25) ── criteri e PR (26)
```

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Database (rischio più alto)
- [x] Task 1: Colonne di `app.operators`, helper ridefiniti (disattivato = nessun accesso), `add_operator` che riattiva, seed riservato; pgTAP
- [x] Task 2: `list_operators`, `set_operator_role`, `set_operator_active` (ultimo admin, sé stessi, `removed`, `EO005`, turni chiusi); pgTAP
- [x] Task 3: `private.operator_invites`, `operator_invite_begin`/`_finish`/`_fail`/`_orphan`; privilegi solo `service_role`; pgTAP
- [x] Task 4: `operator_resend_begin`/`_finish`, `operator_cancel_begin`/`_check`; pgTAP
- [x] Task 5: Integrazione con due connessioni: corsa tra due admin, disattivazione durante `unlock_cashier`, due inviti in parallelo

### Checkpoint A: `db:test` e `test:integration` verdi; pgTAP esistenti invariati; revisione `security-and-hardening` del database

### Fase 2: Edge Function `operator-invites`
- [x] Task 6: `handler.ts`: origine, CORS, `OPTIONS`, metodo, corpo, 401; strumenti (test.include, `tsconfig.functions.json`, typecheck)
- [x] Task 7: `index.ts`, `deno.json`, `config.toml`, `functions/.env.example`; servita in locale (anon → nessun effetto, operatore → 403)
- [x] Task 8: Invito nel handler: begin → metadati → invito/recupero → finish → compensazione; mappa degli esiti HTTP; log
- [x] Task 9: Reinvio e annullamento nel handler
- [x] Task 10: Template `invite.html`, `reload-auth-templates.sh`, integrazione reale con Mailpit (una email, idempotenza), passo CI (CI da confermare sulla PR)
- [x] Task 11: Integrazione reale di reinvio, token verificato senza password, annullamento e ricollegamento (criterio "token verificato senza password" aperto: vedi todo.md)

### Checkpoint B: unità e integrazione della funzione verdi in locale e in CI; revisione `security-and-hardening` (chiave segreta, origine, compensazione, log)

### Fase 3: Servizio e componenti condivisi
- [x] Task 12: `OperatorsService`, `supabaseOperatorsService`, guardia del confine
- [x] Task 13: `fakeOperatorsService`, `OperatorsServiceProvider`, `main.tsx` e `renderApp`
- [x] Task 14: `Dialog` (guscio) estratto da `ConfirmDialog`, test invariati, `/dev/ui`
- [ ] Task 15: `AdminsOnly` condiviso, `OperatorsSettingsRow` prima di "Catalogo premi", rotta `/impostazioni/operatori`

### Checkpoint C: quality bar completa verde; test di rewards e `ConfirmDialog` invariati; revisione con l'utente prima della schermata

### Fase 4: Schermata Operatori (telefono)
- [ ] Task 16: Elenco: stati, ordine, "(tu)" senza azioni, caricamento/errore, regione dei messaggi, `AdminsOnly`
- [ ] Task 17: "Disattiva" e "Riattiva" con conferma; `EO001` e altri errori; elenco ricaricato
- [ ] Task 18: Dialogo persona: ruolo con seconda conferma, "Reinvia invito", "Annulla invito"
- [ ] Task 19: "Invita operatore": validazioni, `operation_id` stabile, errori del punto 6, esito

### Fase 5: Invito accettato e sessioni
- [ ] Task 20: `/imposta-password` versione invito: frammento, testi, `error`/`error_code`, `verifyInvite`, link scaduto
- [ ] Task 21: Inoltro di `type=invite` in `RootLayout`, nota di `/accedi`, identità ricontrollata a ogni cambio di rotta per gli operatori
- [ ] Task 22: E2E telefono: invito → Mailpit → password → home; cambio ruolo e ritorno; disattivazione con seconda sessione e riattivazione

### Checkpoint D: criteri 1–9 e 11 verdi in E2E; detector Impeccable pulito; confronto con i wireframe; revisione `security-and-hardening` del client

### Fase 6: Tablet 1280×800
- [ ] Task 23: Layout tablet: colonna "Invita operatore" 480 px, stati con PIN, radio "Amministratore" disabilitato con le note, sottotitolo della riga
- [ ] Task 24: E2E tablet (`cassa-operatori@example.com`): colonne, nessuno scorrimento, target ≥ 48 px, "(tu)" sul cassiere, cassiere disattivato → `/cassa`

### Checkpoint E: Impeccable pulito sul layout tablet; confronto con "Tablet: operatori"; E2E `phone` invariati

### Fase 7: Chiusura
- [ ] Task 25: `docs/setup-accounts.md` §4, RUNBOOK (procedura, trappola dei template di Kong), `contract.md`, `CLAUDE.md`, `cross-review.md`, `brain/MAP.md`
- [ ] Task 26: Verifica dei criteri di successo (`scripts/operatorsCriteria.test.ts`) e PR su `main`

### Checkpoint F: criteri 1–12 verificati (12: la parte di deploy è dell'orchestratore); quality bar completa verde; PR pronta per `code-review-and-quality`

## Copertura dei criteri di successo

| Criterio (docs/specs/SPEC-operators.md) | Task |
|---|---|
| 1. Admin sul telefono invita con nome, email e ruolo; arriva **una** email; nell'elenco "… · invito inviato" | 3, 8, 10, 16, 19, 22 |
| 2. Dal link "Ciao, {nome}" e "{chi} ti ha invitato come {ruolo}…", password, ingresso col ruolo scelto, poi "attivo"; nessuna dashboard | 1, 2, 10, 20, 21, 22 |
| 3. Doppio tocco e reinvio dopo errore di rete con lo stesso `operation_id`: una email, un profilo (anche in parallelo) | 3, 5, 8, 10, 19 |
| 4. Nome usato, email di un account, email del tablet rifiutati col testo del punto 6, nessuna email; 429 → "Troppe email inviate…" | 3, 8, 10, 19 |
| 5. Operatore, dispositivo senza cassiere o con cassiere operatore, chiave `anon`: niente elenco, inviti, modifiche; chiave segreta mai in `dist/`, `src/`, repo | 2, 3, 4, 6, 7, 10, 12, 26 |
| 6. Cambio di ruolo vale subito sul server; la persona vede le impostazioni del nuovo ruolo al cambio di rotta | 2, 18, 21, 22 |
| 7. Disattivare: token senza letture né scritture, telefono su `/accedi` al cambio di rotta o in primo piano, turno sul tablet finito, movimenti identici; riattivare restituisce l'accesso | 1, 2, 5, 17, 21, 22, 24 |
| 8. Mai senza un amministratore attivo: nessuna azione su sé stessi, `EO001`, corsa tra due admin | 2, 5, 16, 17 |
| 9. "Reinvia invito" solo per chi non ha accettato; link precedente `otp_expired` | 4, 9, 11, 18 |
| 10. Tablet con cassiere admin: elenco + colonna 480 px, stati con PIN, "(tu)"; nessuno scorrimento, target ≥ 48 px; niente admin dal tablet (`EO005`) | 2, 3, 23, 24 |
| 11. Schermate conformi ai wireframe a 390×844 con le deviazioni dichiarate; Impeccable pulito; nota di `/accedi` | 14–21, 23 |
| 12. CI verde con pgTAP, unità, integrazione con la funzione servita, E2E telefono e tablet; deploy e prova sullo staging documentati (eseguiti dall'orchestratore) | ogni task; 10, 25, 26 |

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Chiave segreta che finisce nell'app, in Vercel, nei log o nel repo | Alto | Letta solo in `index.ts` dall'ambiente; guardia del confine su `src/`; controllo dei criteri su `src/`, `dist/` e file tracciati; `.env` delle funzioni ignorato, `.env.example` senza chiavi |
| Non amministratore (o chiave `anon`, o dispositivo senza cassiere) che invita tramite la funzione | Alto | Nessuna decisione nella funzione: le RPC `*_begin` col token del chiamante controllano `is_admin()`; `*_finish` solo `service_role`; pgTAP + integrazione con anon, operatore e dispositivo |
| Profilo disattivato che legge ancora (un helper o una RPC che usa `user_id is not null` come "attivo") | Alto | `grep` di `app.operators` nelle migrazioni prima di scrivere; matrice pgTAP: 0 righe da ogni tabella `app`, RPC di scrittura rifiutate, `get_session_identity()` null |
| Bar senza amministratori per una corsa | Alto | Blocco ordinato di bersaglio e admin attivi, controlli nell'istruzione successiva; integrazione con due connessioni |
| Deadlock tra disattivazione e `unlock_cashier` | Medio | Ordine dei blocchi `operators` → `devices`; nessun blocco nuovo in `unlock_cashier`; integrazione della corsa |
| Due inviti alla stessa email: il secondo invalida il token del primo, la compensazione cancella l'utente del vincitore | Alto | Indici unici parziali `pending` su email e nome → `in_progress`; `_orphan` rilegge il database prima di ogni `deleteUser` |
| Amministratore permanente ottenuto da un tablet sbloccato | Alto | `EO005` su invito admin e promozione da un dispositivo; radio disabilitato; pgTAP + componente (Open Questions 11, da confermare col titolare) |
| Preflight CORS rotto online (in locale risponde Kong) | Medio | Test di unità su `OPTIONS` con `corsHeaders`; prova reale sullo staging dell'orchestratore |
| Template d'invito non ricaricato o servito vecchio da Kong (nuovo inode) | Medio | `reload-auth-templates.sh` aspetta anche `invite`; trappola nel RUNBOOK; `docker restart supabase_kong_enjoy-card-app` |
| Account del seed nuovi che cambiano altri test (elenco cassieri, conteggi) | Medio | Account riservati con nomi distinti; tutta la suite E2E e pgTAP rieseguita al task 1 |
| `functions serve` non pronto in CI o in locale: integrazione instabile | Medio | Attesa attiva della risposta di `/functions/v1/operator-invites` prima dei test; messaggio chiaro se manca |
| Nome con "error" nel frammento che fa scadere un invito valido | Basso | Lettura con `URLSearchParams`, solo le chiavi `error`/`error_code`; test con "Terrore" |
| Limite di email di Auth (429) online | Basso | `rate_limited` con il testo del punto 6; test di unità e di componente |

## Open Questions

Nessuna bloccante: le Open Questions 1–11 della spec usano i default adottati. Da segnalare all'utente
durante l'implementazione, senza fermare il lavoro:

- **Open Questions 11** (niente amministratori dal tablet) e **7** (link d'invito di un'ora): marcate "da
  chiedere al titolare"; il piano implementa il default.
- **Open Questions 8** (invito con iscrizioni chiuse sui progetti online): verificato solo in locale; la prova
  è nelle note di deploy dell'orchestratore, con il ripiego `createUser` + `inviteUserByEmail` già descritto.
