# Implementation Plan: settings

Source spec: [SPEC-settings.md](../../SPEC-settings.md) (approvata il 2026-11-17; le Open Questions usano i
default adottati)

## Overview

Il titolare decide quanti euro valgono un punto e sopra quale importo l'app chiede di confermare una spesa;
i camerieri vedono il rapporto in vigore ma non lo cambiano. Nasce la tabella a riga unica `app.settings`
(100 centesimi per punto, conferma sopra 15000 centesimi, lettore `'hex'`), scrivibile solo con
`app.update_settings` da un amministratore. In `/impostazioni` compare la sezione "PUNTI E CONTROLLI"
(admin) o "PUNTI" (operatore, sola lettura) con la nota finale; gli altri moduli leggono la configurazione
con `useSettings()`. È il primo modulo dopo `identity`: introduce anche `private.acting_operator_id()` e
`reportNotEnabled()` di `AuthProvider`, condivisi con `customers`, `rewards` e i moduli successivi.

## Architecture Decisions

- **Prima il database, poi il servizio, poi la UI.** Il rischio maggiore è nei permessi: riga unica non
  duplicabile né cancellabile, nessuna scrittura diretta da `authenticated`, `update_settings` eseguibile
  solo da admin con `execute` revocato esplicitamente a `public`/`anon` (Postgres lo concede di default, vedi
  `20261117230000_function_privileges.sql`). Si fissa con pgTAP nel task 1, prima di ogni riga di UI.
- **`private.acting_operator_id()` con il corpo comune parola per parola** (`select
  private.current_operator_id()`, `stable`, `security definer`, `set search_path = ''`, `execute` revocato a
  `public`, `anon`, `authenticated`), con `create or replace`: `customers` e `rewards` la ridefiniscono
  identica, `tablet-kiosk` la estende. Verificata attraverso `updated_by` (cross-review §2.1).
- **Formato del lettore USB solo nel database.** Colonna e parametro `p_usb_uid_format` (null = invariato)
  esistono da subito; nessun campo nell'interfaccia (lo aggiunge `tablet-kiosk`). Il telefono non lo invia mai.
- **Un solo punto di accesso a Supabase.** Solo `supabaseSettingsService.ts` interroga `settings` e chiama
  `update_settings`; mappa 42501 → `forbidden`, 22023 → `invalid`, fetch fallita → `network`, nessuna riga →
  `SettingsLoadError('not-found')`. Il finto in memoria (`src/test/fakeSettingsService.ts`) segue lo stesso
  contratto e conta le chiamate (doppio tocco, Riprova).
- **Servizio iniettato come `AuthService`, caricamento solo dentro `RequireAuth`.** `main.tsx` e `renderApp`
  passano il servizio; `SettingsProvider` sta dentro `RequireAuth` (avvolge l'`Outlet`, così più avanti
  avvolgerà anche `CardReaderSession`), carica una volta per sessione, ricarica dopo un salvataggio e su
  `visibilitychange`. Niente Realtime.
- **`reportNotEnabled()` riusa il ricontrollo del profilo già presente in `AuthProvider`** (focus e ritorno
  visibile): profilo assente → `/accedi` con `not-enabled`; profilo presente → operatore e ruolo aggiornati
  nello stato (oggi il ricontrollo ignora un cambio di ruolo: va corretto). Esposto da `useAuth()`.
- **Importi in centesimi interi ovunque**; conversione da/verso testo solo ai bordi con le funzioni pure
  `parseEuroInput` e `centsToEuroInput`. Stessi limiti nel client e nei `check` del database
  (1–10000 per il rapporto, 1–1000000 per la soglia).
- **`TextField` esteso, non duplicato:** prop facoltative `layout="inline"` e `suffix` ("€"), comportamento
  attuale invariato (test esistenti verdi).
- **E2E in un progetto Playwright separato.** La configurazione è unica e condivisa e la suite gira con
  `fullyParallel: true`: `e2e/settings.spec.ts` sta in un progetto `phone-settings` con `dependencies` sul
  progetto `phone` (gira dopo tutti gli altri), in modalità seriale, ripristina 100 / 15000 in `afterAll`.
  Il progetto principale esclude il file. Lo stesso progetto ospiterà il test di `ledger` sul nuovo rapporto.
- **Revisione di sicurezza obbligatoria** (`security-and-hardening`) al Checkpoint A: RLS, privilegi delle
  funzioni, `security definer` con `search_path` vuoto, controllo del ruolo solo sul server.
- **Pubblicazione esclusa da questo piano:** migrazioni su staging e produzione le esegue l'orchestratore.

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Fondamenta (rischio più alto)
- [x] Task 1: Migrazione `settings`: tabella a riga unica, policy, `acting_operator_id()`, `update_settings`; pgTAP
- [x] Task 2: Tipi, `supabaseSettingsService`, servizio finto; test di integrazione contro lo stack locale

### Checkpoint A: db:test e test:integration verdi; revisione di sicurezza su RLS e funzioni

### Fase 2: Infrastruttura condivisa del frontend
- [x] Task 3: `reportNotEnabled()` in `AuthProvider` (profilo assente → `/accedi`, presente → ruolo aggiornato)
- [x] Task 4: `SettingsProvider` e `useSettings()` dentro `RequireAuth`, iniettati in `main.tsx` e `renderApp`
- [x] Task 5: `parseEuroInput` e `centsToEuroInput` (funzioni pure, messaggi italiani)
- [ ] Task 6: `TextField` con `layout="inline"` e `suffix`

### Checkpoint B: suite unità/componenti verde; test esistenti di identity invariati e verdi

### Fase 3: Sezioni di `/impostazioni`
- [ ] Task 7: Vista operatore "PUNTI" (sola lettura), nota finale, stati di caricamento ed errore, ordine delle sezioni
- [ ] Task 8: Vista amministratore "PUNTI E CONTROLLI": campi, validazione, Salva, "Impostazioni salvate."
- [ ] Task 9: Errori del salvataggio (rete, permesso negato, invalid/unknown) e ricarica che non sovrascrive i campi modificati

### Checkpoint C: flusso admin/operatore verde nei test di componente; detector Impeccable pulito; confronto con i wireframe

### Fase 4: E2E e chiusura
- [ ] Task 10: Progetto Playwright `phone-settings` ed `e2e/settings.spec.ts`
- [ ] Task 11: Documentazione e memoria di progetto; verifica finale dei criteri di successo

### Checkpoint D: gli 8 criteri di successo verificati; quality bar completa verde; PR pronta per `code-review-and-quality`

## Copertura dei criteri di successo

| Criterio (SPEC-settings.md) | Task |
|---|---|
| 1. Riga unica 100 / 15000 / `'hex'` dopo `db:reset`; secondo `insert` fallisce | 1 |
| 2. Operatore: "PUNTI" in sola lettura senza campi né Salva; `update_settings` → errore di permesso (pgTAP + integrazione) | 1, 2, 7, 10 |
| 3. Admin salva "2,00" e "200,00", "Impostazioni salvate.", valori dopo il ricaricamento, `updated_by` = suo profilo | 1, 2, 8, 10 |
| 4. Input non validi con il messaggio italiano e nessuna richiesta; "1.50" e "1,5" = 150 | 5, 8, 10 |
| 5. Rete interrotta: errore, valori conservati, nuovo Salva riuscito (componente) | 9 |
| 6. `anon` e utenti senza profilo non leggono né eseguono; nessuna scrittura diretta (pgTAP) | 1 |
| 7. Solo `supabaseSettingsService.ts` accede a `settings`/`update_settings`; componenti solo con `useSettings()` | 2, 4, 11 |
| 8. Testi, ordine delle sezioni e valori iniziali come nei wireframe a 390×844; Impeccable pulito; CI verde | 7, 8, 10, 11 |

Il criterio "la spesa successiva usa il nuovo rapporto, lo storico resta" si verifica in `ledger`
(`e2e/ledger.spec.ts` nel progetto `phone-settings`), non qui.

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| `execute` concesso di default a `public` su `update_settings` o `acting_operator_id` | Alto | `revoke`/`grant` espliciti nella migrazione; pgTAP con `function_privs_are`/`has_function_privilege` per `anon` e `authenticated` |
| E2E di settings che cambiano la configurazione mentre altri test girano in parallelo | Alto | Progetto Playwright separato con `dependencies`, seriale, ripristino in `afterAll`; file escluso dal progetto `phone` |
| Test E2E fallito a metà lascia rapporto/soglia cambiati nello stack locale | Medio | `afterAll` ripristina sempre via admin; `db:reset` prima della suite completa |
| Inserire la sezione PUNTI rompe l'asserzione esistente "account seguito da ACCOUNT" in `SettingsPage.test.tsx` | Basso | Il test si aggiorna all'ordine unico di `cross-review.md` §1 (stesso comportamento, nuova sezione nel mezzo), non si toglie |
| `reportNotEnabled()` cambia `AuthProvider`, condiviso da tutti | Medio | Test prima; i test esistenti di `AuthProvider`, `RequireAuth` e del ritorno in primo piano restano verdi |
| Spazio indivisibile di `formatCents` nei confronti di testo | Basso | Nei test si normalizzano gli spazi (spec, punto 4) |
| Ambiguità "1.250" (migliaia italiane) | Medio | Rifiutato con "Usa al massimo due decimali" (Open Question 3), test unitario dedicato |
| Template email "Reset your password" dopo `supabase start` | Basso | `scripts/reload-auth-templates.sh` dopo l'avvio dello stack (RUNBOOK, trappola 28) |

## Open Questions

Nessuna bloccante: le Open Questions della spec usano i default adottati (limiti, separatore decimale,
soglia "strettamente sopra", soglia nascosta all'operatore, ultimo salvataggio vince, testi dei messaggi),
da rivedere con il titolare insieme agli altri testi (`docs/specs/cross-review.md` §3).
