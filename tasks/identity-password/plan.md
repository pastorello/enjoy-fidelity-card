# Implementation Plan: identity-password

Source spec: [SPEC-identity-password.md](../../SPEC-identity-password.md) (approvata il 2026-11-17; le Open
Questions usano i default adottati)

## Overview

Chi ha dimenticato la password ne sceglie una nuova da solo: da `/accedi` tocca "Password dimenticata?",
scrive l'email, riceve un link (da `info@enjoygaeta.it` nei progetti remoti, da Mailpit in locale), apre
`/imposta-password`, scrive la nuova password ed entra nell'app. Chi è collegato arriva allo stesso flusso
dalla sezione ACCOUNT delle Impostazioni ("Cambia password"). Nessuna tabella nuova: tutto avviene in
Supabase Auth. È la prima volta che l'app manda email: E2E e CI passano a usare anche Mailpit.

## Architecture Decisions

- **Flusso `token_hash` + `verifyOtp` al tocco di "Salva e accedi"** (né PKCE né implicito): funziona su
  qualsiasi dispositivo, il token non si consuma con le anteprime delle caselle email e non finisce
  nessun token di sessione nell'URL (spec, "Scelta del flusso"). Il client `src/lib/supabase.ts` non cambia.
- **Prima l'infrastruttura email, poi la UI.** Il rischio maggiore non sono le pagine ma la catena
  config → template → Mailpit → link con `token_hash` verso `http://localhost:4173/imposta-password`, e il
  rifiuto lato server di una password di 7 caratteri. Il task 1 la prova con un test di integrazione e
  porta Mailpit nella CI prima di scrivere una riga di UI.
- **Contratto del servizio prima delle pagine.** `AuthService` si estende con `currentEmail`,
  `requestPasswordReset`, `verifyRecovery`, `updatePassword`, `signOutOtherDevices`; la mappatura degli
  errori di Supabase (ogni risposta HTTP di `resetPasswordForEmail` → `sent`, solo l'assenza di risposta →
  `network`; `isAuthRetryableFetchError` non basta perché è vero anche per 502/503/504) si fissa con test
  unitari. Il fake segue lo stesso contratto e conta le chiamate (doppio tocco, reinvio senza nuova verifica).
- **Le pagine parlano solo con `useAuth()`.** `AuthProvider` aggiunge `completeRecovery(tokenHash, password)`
  (passi a-d, ricorda se la verifica è già riuscita), `abandonRecovery()` e `currentEmail()`.
- **Account del seed riservato.** `recupero@example.com` ("Recupero Prova", operator) serve solo all'unico
  E2E che cambia la password; nessun altro test accede con quell'account (`fullyParallel` attivo). Il test di
  integrazione crea e toglie un utente suo, come in `tests/integration/identity.test.ts`.
- **Limiti di invio alzati solo in locale** (`[auth.rate_limit] email_sent`), mai nei progetti remoti.
- **Configurazione remota fuori dal codice.** Site URL, Redirect URLs, template e minimo 8 caratteri dei
  progetti remoti vanno in `docs/setup-accounts.md` come procedura per il titolare; mai `supabase config
  push`. La pubblicazione su staging e produzione la fa l'orchestratore e non è un task di questo piano.
- **Revisione di sicurezza obbligatoria** (`security-and-hardening`) al Checkpoint B: enumerazione degli
  account, token nella query, sessione del link abbandonata, log senza email/password/token.

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Fondamenta (alto rischio)
- [x] Task 1: Config di Auth locale, template `recovery`, helper Mailpit, test di integrazione e Mailpit in CI
- [x] Task 2: `AuthService` esteso: tipi, mappatura degli errori in `supabaseAuthService`, fake esteso
- [x] Task 3: `AuthProvider`: `completeRecovery`, `abandonRecovery`, `currentEmail`

### Checkpoint A: integrazione con Mailpit verde in locale e in CI; mappatura degli errori coperta

### Fase 2: Pagine
- [x] Task 4: Pagina `/password-dimenticata` (conferma neutra, rete, doppio tocco, precompilazione)
- [ ] Task 5: Pagina `/imposta-password` (validazioni, link non valido, errori, reinvio, avviso collegato)
- [ ] Task 6: Inoltro di riserva `/?token_hash=…&type=recovery` → `/imposta-password` in `RootLayout`
- [ ] Task 7: Ingressi: link "Password dimenticata?" su Accesso e sezione ACCOUNT nelle Impostazioni

### Checkpoint B: componenti verdi; schermate conformi ai wireframe; detector Impeccable pulito; revisione di sicurezza

### Fase 3: Percorso completo e consegna
- [ ] Task 8: Seed `recupero@example.com` ed E2E del percorso completo con Mailpit
- [ ] Task 9: Documentazione: procedura remota, rimandi in SPEC-identity e CAPABILITY-MAP, RUNBOOK, MAP

### Checkpoint C: criteri di successo 1-7 e 9 verificati; procedura remota pronta (criterio 8); PR pronta per `code-review-and-quality`

## Copertura dei criteri di successo

| Criterio (SPEC-identity-password) | Task |
|---|---|
| 1. Link "Password dimenticata?" su `/accedi` → `/password-dimenticata` | 7 (componente), 8 (E2E) |
| 2. Stessa conferma per email esistente e no; email solo per la prima; 429/5xx → stessa conferma | 2 (unità), 4 (componente), 8 (E2E con Mailpit), 1 (Mailpit) |
| 3. Link → `/imposta-password` → nuova password → app; nuova funziona, vecchia no | 3, 5 (componente), 8 (E2E) |
| 4. Link usato o scaduto → errore con "Chiedi un nuovo link"; nessun dato cambia | 2, 5 (componente), 8 (E2E link riaperto) |
| 5. Errore di rete su "Salva e accedi" → nuovo tocco senza nuovo link né seconda verifica | 3 (provider), 5 (componente) |
| 6. "Cambia password" da Impostazioni (admin e operatore) con email precompilata | 4 (precompilazione), 7 (sezione ACCOUNT), 8 (E2E) |
| 7. `config.toml` (minimo 8, template, URL 5173/4173, senza `127.0.0.1:3000`); server rifiuta 7 caratteri; CI con Mailpit verde | 1 |
| 8. Procedura remota documentata (esecuzione su staging e produzione: orchestratore, fuori piano) | 9 |
| 9. Schermate conformi ai wireframe a 390×844, target ≥ 48 px, detector Impeccable pulito | 4, 5, 7, Checkpoint B |

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| `email_sent = 2` l'ora blocca gli invii di E2E e integrazione | Alto | Alzato solo in `supabase/config.toml` (es. 100) nel task 1; nessun cambio remoto |
| Supabase scarta il `redirectTo` (porta 4173 non in lista) e il link punta a `site_url` | Alto | URL 5173 e 4173 in `additional_redirect_urls` (task 1); inoltro di riserva in `RootLayout` (task 6); l'E2E controlla che il link inizi con `http://localhost:4173/imposta-password?token_hash=` |
| Il template non è collegato o usa ancora `{{ .ConfirmationURL }}` | Alto | Test di integrazione del task 1 che legge l'email da Mailpit e controlla l'`href` |
| Mailpit escluso in CI (`-x …,mailpit,…`) | Medio | Tolto dall'elenco nel task 1, insieme al primo test che lo usa |
| Email di esecuzioni precedenti in Mailpit confondono i test | Medio | Filtro per destinatario e per ora di arrivo dopo la richiesta; email inesistente unica per esecuzione |
| E2E paralleli che usano lo stesso account mentre la password cambia | Medio | `recupero@example.com` usato da un solo test; percorso completo e link riaperto in sequenza nello stesso test |
| Un 504 dall'invio lento rivela che l'account esiste | Medio | Ogni risposta HTTP → `sent`; test unitario su 429, 500 e 504 (task 2) |
| `verifyOtp` sostituisce la sessione di un altro operatore: falso "sessione scaduta" o operatore sbagliato a schermo | Medio | Test del provider: nessun `SIGNED_OUT`, profilo ricaricato (task 3); `abandonRecovery` chiude la sessione del link non completata |
| Template remoto ancora predefinito (`#error_code=…` nell'URL) | Basso | Vista "link scaduto" anche con `error` nel frammento (task 5); passo esplicito nella procedura (task 9) |

## Open Questions

Nessuna aperta per l'implementazione: le 9 Open Questions della spec usano i default adottati, da rivedere
con il titolare (`docs/specs/cross-review.md` §3). Lo slug del team Vercel per le Redirect URLs dello
staging (Open Questions 7) resta un segnaposto `<team>` nella procedura del task 9.
