# Spec: identity — Password dimenticata e Cambia password

Status: approvata (2026-11-17) su delega dell'utente — le Open Questions adottano i default proposti, da rivedere con il titolare (`docs/specs/cross-review.md` §3)
Modulo: `identity` ([CAPABILITY-MAP.md](../../CAPABILITY-MAP.md)) · Dipende da: `identity` V1 ([SPEC-identity.md](SPEC-identity.md)) ·
Fonti: specifiche ("Ruoli e account"), wireframe Accesso, Password dimenticata, Invito: scegli la password,
Impostazioni (operatore) · Decisione: `brain/DECISIONS.md`, 2026-11-17 "Email di Auth attive; Password
dimenticata subito dopo la V1".

> **Differenza da SPEC-identity.md**: la V1 escludeva link "Password dimenticata?", email di Auth e URL di
> ritorno. Ora le email partono da `info@enjoygaeta.it` (SMTP già configurato dall'utente su staging e
> produzione): questa spec sostituisce i punti 1 (solo il link mancante), 6 e "Configurazione di Auth" della V1.
> **Inviti e schermata Operatori restano fuori.**

## Objective

Chi ha dimenticato la password se ne sceglie una nuova da solo, con un link via email, senza che qualcuno
cancelli e ricrei il suo utente in Supabase. Chi è collegato cambia la password dalle Impostazioni con lo
stesso link. Utenti: amministratori e operatori, identici per questa funzione.

**Successo**: da `/accedi` → "Password dimenticata?" → email → link → nuova password → si entra nell'app,
sul telefono, in meno di 2 minuti; la vecchia password non funziona più.

## Cosa include

1. **Accesso** (`/accedi`, wireframe "Accesso"): sotto il pulsante "Accedi" il link **"Password dimenticata?"**
   → `/password-dimenticata` (target ≥ 48 px). La nota resta quella della V1 ("Gli account li crea un
   amministratore: se non riesci ad accedere, rivolgiti a chi gestisce l'app."): il testo del wireframe cita
   gli inviti, fuori perimetro.
2. **Password dimenticata** (`/password-dimenticata`, pagina pubblica, wireframe "Password dimenticata"):
   - `AppShell` con titolo "Password dimenticata" e Indietro (→ `/accedi`; → `/impostazioni` se collegato);
   - testo "Scrivi l'email del tuo account: ti mandiamo un link per sceglierne una nuova.", campo Email
     (`autoComplete="email"`, placeholder `nome@esempio.it`), pulsante **"Invia il link"**, nota "Il link vale
     un'ora. Se non arriva, controlla lo spam o chiedi a un amministratore.";
   - validazione locale: vuota → "Inserisci l'email"; senza forma `x@y` → "Email non valida";
   - invio: `resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/imposta-password' })`,
     pulsante `busy` (un doppio tocco non manda due richieste);
   - **stessa risposta che l'email esista o no**: per **ogni risposta HTTP** del server (200, 429, altri 4xx,
     500, 502/503/504) la pagina mostra la stessa conferma "Se l'email è di un account dell'Enjoy Card, ti
     abbiamo mandato un link. Il link vale un'ora: se non arriva, controlla lo spam o chiedi a un
     amministratore." con "Torna all'accesso" (o "Torna alle impostazioni"). Solo la richiesta che non riceve
     alcuna risposta HTTP (`fetch` fallita, `status` 0) mostra "Connessione assente: controlla la rete e
     riprova." e lascia il modulo compilato. Attenzione: `isAuthRetryableFetchError` è vero anche per
     502/503/504, quindi da solo **non** basta a distinguere la rete (un 504 dovuto all'invio lento dell'email
     esiste solo per gli account veri). Il nuovo invio è sicuro: al massimo arriva un'altra email e vale
     l'ultima ricevuta (ogni richiesta sostituisce il token precedente); entro 60 s Supabase risponde 429 e
     non manda nulla, e resta valido il link già spedito;
   - collegato: la pagina funziona lo stesso ed è precompilata con l'email della sessione (vedi punto 4);
     l'email resta modificabile.
3. **Imposta password** (`/imposta-password?token_hash=…&type=recovery`, pagina pubblica, wireframe
   "Invito: scegli la password" adattato al recupero: logo "Bar Enjoy Gaeta" in alto, nessuna barra con
   Indietro, come nel wireframe; al posto di "Ciao, Marco / Andrea ti ha invitato…" titolo e testo del recupero,
   vedi Open Questions 4):
   - titolo "Scegli una nuova password" e testo "Scegli la password per accedere all'Enjoy Card."; campi
     **"Nuova password"** (aiuto "Almeno 8 caratteri.", `autoComplete="new-password"`) e **"Ripeti la
     password"** (`autoComplete="new-password"`); pulsante **"Salva e accedi"** con stato `busy` (un doppio
     tocco non manda due richieste);
   - niente campo Email (il wireframe lo mostra in sola lettura): con il link a `token_hash` l'email si conosce
     solo dopo la verifica;
   - validazione locale: < 8 caratteri → "Almeno 8 caratteri."; oltre **72 byte** in UTF-8 (`new
     TextEncoder().encode(p).length > 72`, limite di bcrypt in Supabase, che conta byte e non caratteri: una
     "è" vale 2) → "Password troppo lunga."; diverse → "Le password non coincidono.";
   - "Salva e accedi": (a) `verifyOtp({ type: 'recovery', token_hash })` → sessione; (b) `updateUser({ password })`;
     (c) `signOut({ scope: 'others' })` (gli altri dispositivi escono al prossimo rinnovo del token, al più entro
     un'ora; nessun evento `SIGNED_OUT` su questo telefono; errore ignorato); (d) ricarica del
     profilo operatore come al login; (e) `navigate('/', { replace: true })`;
   - **link scaduto, già usato o non valido** (`otp_expired`/403, `token_hash` mancante, `type` ≠ `recovery`,
     oppure `#error_code=…` nell'URL, che arriva solo se il template remoto è ancora quello predefinito): vista di errore "Il link è scaduto o è già stato usato." con
     **"Chiedi un nuovo link"** → `/password-dimenticata`. Per `token_hash` mancante l'errore appare subito;
     per un link scaduto dopo il tocco su "Salva e accedi" (vedi "Scelta del flusso");
   - errori di `updateUser`: `same_password` → "La nuova password deve essere diversa da quella attuale.";
     `weak_password` → "Almeno 8 caratteri."; rete → "Connessione assente: la password non è stata salvata.
     Riprova."; ogni altro errore (`unknown`) → "Password non salvata. Riprova tra poco." Il nuovo tocco **non
     ripete la verifica** (la sessione di recupero c'è già) e rimanda solo `updateUser`; se dopo un errore di
     rete il server risponde `same_password`, la prima richiesta era arrivata: si tratta come successo
     (reinvio idempotente: in entrambi i casi la password è quella scritta);
   - errori di `verifyOtp`: rete → "Connessione assente: riprova." (il nuovo tocco ripete la verifica; se la
     prima era arrivata il link risulta usato e si mostra la vista "link scaduto"); 429 o altro (`unknown`) →
     "Non è stato possibile verificare il link. Riprova tra poco.";
   - **verifica riuscita ma password non salvata** e si lascia la pagina (Indietro, altro link): la sessione
     del link si chiude su questo telefono (`signOut` locale) e lo stato diventa "non collegato", così l'app
     non mostra mai un operatore diverso da quello della sessione e il link di recupero non vale come accesso
     senza password nuova (proposta, Open Questions 8). Se l'app viene chiusa di colpo la sessione resta
     salvata e alla riapertura vale la regola V1 (profilo caricato al ripristino);
   - account senza profilo operatore collegato: la password cambia, poi come in V1 → `/accedi` con "Account
     non abilitato: chiedi a un amministratore.";
   - **utente già collegato** su questo telefono: avviso "Sei collegato come {nome}: salvando, accederai con
     l'account del link." La sessione corrente resta finché non si tocca "Salva e accedi"; dopo la verifica
     vale quella del link (anche se è un altro account: `verifyOtp` la sostituisce senza emettere
     `SIGNED_OUT`, quindi nessun falso "sessione scaduta"). Un utente collegato che apre `/imposta-password` senza link vede l'errore
     "link scaduto" e resta collegato.
4. **Cambia password** (`/impostazioni`, wireframe "Impostazioni (operatore)"): sezione **ACCOUNT**
   (titolo di sezione come "PUNTI" nel wireframe) con `ListRow` "Cambia password" / "Ricevi un link via email"
   → `/password-dimenticata`. Posizione secondo l'ordine unico delle sezioni di `/impostazioni` (fissato in `CROSS-REVIEW.md`): riquadro account (`identity`) · PUNTI E CONTROLLI / PUNTI (`settings`) · ACCOUNT (`identity-password`, più "PIN della cassa" di `tablet-kiosk`) · GESTIONE (`rewards`, solo admin) · LETTORE CARD (`tablet-kiosk`, solo tablet con cassiere admin) · ESPORTA DATI (`export`, solo admin) · nota finale (`settings`, solo operatore). Finché `settings` non c'è la sezione va subito dopo il riquadro account; il modulo `settings` inserirà
   "PUNTI" tra i due, come nel wireframe. L'email non viaggia nella navigazione né nella query: con un utente
   collegato `/password-dimenticata` la legge dalla sessione salvata (`currentEmail()`, senza rete), così
   niente email in URL e cronologia. Stesso flusso dei punti 2-3. Visibile ad **amministratori e operatori**.
   Gli altri elementi del wireframe (sezione "PUNTI", nota "Operatori, premi, esportazioni e annullamenti…")
   sono del modulo `settings`, fuori da questa spec.
5. **Instradamento di riserva**: se Supabase scarta il `redirectTo` (non in lista) il link punta a
   `site_url` (`/?token_hash=…&type=recovery`). `RootLayout` inoltra quella URL a `/imposta-password`
   mantenendo la query, prima di `RequireAuth`.

### Scelta del flusso: `token_hash` + `verifyOtp` (né PKCE né implicito)

- **Implicito** (template predefinito, `{{ .ConfirmationURL }}`): il link passa da `/auth/v1/verify`, che
  consuma il token alla prima GET: i controlli antivirus/anteprime delle caselle email lo "usano" prima
  dell'utente; poi `access_token` e `refresh_token` finiscono nel frammento dell'URL e nella cronologia.
- **PKCE**: il `code_verifier` resta nel `localStorage` del browser che ha chiesto il link; se l'email si
  apre su un altro dispositivo o browser (link chiesto dal telefono, aperto sul PC; Gmail che apre un altro
  browser) lo scambio fallisce.
- **Scelta**: template con `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` e
  `verifyOtp` chiamato **solo al tocco di "Salva e accedi"**: funziona su qualsiasi dispositivo, il token si
  consuma solo con un gesto dell'utente, nessun token di sessione nell'URL, e una sessione già aperta non
  viene sostituita finché non si salva. Il client (`src/lib/supabase.ts`) non cambia: `verifyOtp` con
  `token_hash` non dipende da `flowType`. `Referrer-Policy: no-referrer` (già in `vercel.json`) evita che
  la query esca verso altri siti. Costo: un link scaduto si scopre dopo aver scritto la password.

### Modello dati e regole di accesso

Nessuna tabella, funzione o policy nuova: tutto avviene in Supabase Auth. Le regole di `app.operators` e le
funzioni `private.*` della V1 restano invariate. Seed: un account finto in più, `recupero@example.com`
("Recupero Prova", operator), riservato agli E2E di questa spec perché ne cambiano la password.

`AuthService` (`src/features/identity/types.ts`) si estende; `createFakeAuthService` lo segue:

```ts
export type ResetRequestResult = 'sent' | 'network'; // every server answer is 'sent'
export type VerifyRecoveryResult = 'ok' | 'invalid-link' | 'network' | 'unknown';
export type UpdatePasswordResult = 'ok' | 'same-password' | 'weak' | 'network' | 'unknown';
// AuthService additions:
currentEmail(): Promise<string | null>;
requestPasswordReset(email: string, redirectTo: string): Promise<ResetRequestResult>;
verifyRecovery(tokenHash: string): Promise<VerifyRecoveryResult>;
updatePassword(password: string): Promise<UpdatePasswordResult>;
signOutOtherDevices(): Promise<void>;
```

Mappatura in `supabaseAuthService`: `requestPasswordReset` → `'network'` solo se non arriva una risposta HTTP
(eccezione o `status` 0), ogni risposta HTTP → `'sent'`; `verifyRecovery` → `otp_expired` o 403 →
`'invalid-link'`, nessuna risposta → `'network'`, altro → `'unknown'`; `updatePassword` → `same_password` →
`'same-password'`, `weak_password` → `'weak'`, nessuna risposta → `'network'`, altro → `'unknown'`.
`currentEmail()` legge `getSession()` (nessuna chiamata di rete se il token è valido). Nessun log con email,
password o token.

`AuthProvider` aggiunge `completeRecovery(tokenHash, password)`, che esegue i passi (a)-(d) del punto 3 e
ricorda se la verifica è già riuscita (per il reinvio), `abandonRecovery()` (chiude la sessione del link se la
verifica è riuscita e il salvataggio no, vedi punto 3) e `currentEmail()`. Le pagine non chiamano mai il
servizio direttamente.

### Configurazione di Auth

| Voce | Locale (`supabase/config.toml`) | Staging | Produzione |
|---|---|---|---|
| `minimum_password_length` | **8** (oggi 6: da correggere) | 8 | 8 |
| Scadenza link (`otp_expiry`) | 3600 (già) | 3600 | 3600 |
| `site_url` | `http://localhost:5173` (già) | `http://localhost:5173` | `https://enjoy-fidelity-card.vercel.app` |
| `additional_redirect_urls` | `http://localhost:5173/imposta-password`, `http://localhost:4173/imposta-password` (togliere `https://127.0.0.1:3000`) | `http://localhost:5173/imposta-password`, `https://enjoy-fidelity-card-*-<team>.vercel.app/imposta-password` | `https://enjoy-fidelity-card.vercel.app/imposta-password` |
| Template "Reset password" | `[auth.email.template.recovery]` → `supabase/templates/recovery.html` | incollato a mano | incollato a mano |
| SMTP | Mailpit locale (`[local_smtp]`, porta 54324) | `info@enjoygaeta.it` (già) | `info@enjoygaeta.it` (già) |

Lo staging non ha mai l'URL di produzione: un link di prova non porta ai dati veri. Il glob delle anteprime
accetta in teoria qualunque dominio `enjoy-fidelity-card-…-<team>.vercel.app`, anche un progetto Vercel altrui
con quel nome: per questo gli account dello staging non usano mai le password della produzione (Open
Questions 7). Se cambia l'hosting
(Vercel Hobby non consente l'uso commerciale, vedi STATUS) si aggiornano `site_url` e liste.

**Template** `supabase/templates/recovery.html` (oggetto "Enjoy Card: scegli una nuova password"), HTML
semplice in italiano, senza immagini esterne: "Hai chiesto di scegliere una nuova password per l'Enjoy Card.
Tocca il pulsante: il link vale un'ora e si usa una volta sola." · pulsante "Scegli la password"
(`href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery"`) · "Se non l'hai chiesto tu, ignora
questa email: la password resta quella di prima." Nessun dato oltre a quelli del template.

**Procedura remota** (in `docs/setup-accounts.md`, per **staging e poi produzione**, dalla dashboard; mai
`supabase config push`, che porterebbe in remoto i valori locali):
1. Authentication → URL Configuration: Site URL e Redirect URLs della tabella (`<team>` = slug del team Vercel).
2. Authentication → Emails → Templates → Reset Password: oggetto e corpo di `supabase/templates/recovery.html`.
3. Authentication → Providers → Email: lunghezza minima password 8; scadenza OTP email 3600 s.
4. Prova reale: richiesta da un'anteprima (staging) e dalla produzione con un account dell'utente; l'email
   arriva da `info@enjoygaeta.it`, il link apre `/imposta-password` sullo stesso ambiente.

## Commands

Nessun comando nuovo. Email locali: Mailpit su http://localhost:54324 (avviato da `npm run db:start`).

## Project Structure

```
src/features/identity/ForgotPasswordPage.tsx (+ .module.css, .test.tsx)   → /password-dimenticata
src/features/identity/ResetPasswordPage.tsx (+ .module.css, .test.tsx)    → /imposta-password
src/features/identity/LoginPage.tsx, SettingsPage.tsx                     → link e sezione ACCOUNT
src/features/identity/types.ts, supabaseAuthService.ts, AuthProvider.tsx  → servizio esteso
src/app/routes.tsx, RootLayout.tsx                                        → rotte pubbliche e inoltro
src/test/fakeAuthService.ts                                               → fake esteso
supabase/templates/recovery.html, supabase/config.toml, supabase/seed.sql
e2e/password.spec.ts, e2e/mailpit.ts                                      → E2E e lettura di Mailpit
.github/workflows/ci.yml                                                  → Mailpit nello stack E2E
docs/setup-accounts.md, SPEC-identity.md, CAPABILITY-MAP.md              → procedura e rimandi
```

## Code Style

Come la V1: le pagine parlano solo con `useAuth()`, mai con `getSupabase()`; i messaggi stanno in mappe
`Record<Result, string>` come in `LoginPage`; il `redirectTo` si costruisce da `window.location.origin`,
mai da input dell'utente.

```ts
const params = new URLSearchParams(location.search);
const tokenHash = params.get('type') === 'recovery' ? params.get('token_hash') : null;
if (!tokenHash || location.hash.includes('error')) return <InvalidLinkView />;
```

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP | nessun oggetto SQL nuovo: la suite esistente (`identity.test.sql`, `rls_default.test.sql`) resta verde con il seed esteso |
| Componenti (Vitest + Testing Library, `createFakeAuthService`) | link su `/accedi`; validazioni; stessa conferma per `sent` qualunque email; errore di rete e reinvio; doppio tocco = una sola richiesta (su entrambe le pagine); precompilazione da sessione e Indietro corretto (collegato e no); link mancante/scaduto → "Chiedi un nuovo link"; password diverse/corte/oltre 72 byte (anche 40 "è" = 80 byte); `same-password`; `unknown`; rete su `updatePassword` → reinvio senza nuova verifica (il fake conta le chiamate a `verifyRecovery`); `same-password` dopo rete = successo; avviso "Sei collegato come…"; profilo assente → `/accedi` "Account non abilitato"; verifica riuscita + uscita dalla pagina → stato "non collegato"; sezione ACCOUNT per admin e operatore; inoltro di `/?token_hash` (query conservata, pagina non protetta) |
| Unità (Vitest) | mappatura degli errori di Supabase in `supabaseAuthService`: `otp_expired`/403 → `invalid-link`; `same_password`; `weak_password`; `fetch` fallita → `network`; 429, 500 **e 504** su `requestPasswordReset` → `sent`; 429 su verifica → `unknown` |
| E2E (Playwright, 390×844, stack Supabase locale con Mailpit) | percorso completo con `recupero@example.com`: richiesta → email letta dall'API di Mailpit (`/api/v1/search`) → link → nuova password casuale → home → esci → accesso con la nuova; vecchia password rifiutata; email inesistente → stessa conferma e nessuna email in Mailpit; link riaperto dopo l'uso → "Chiedi un nuovo link"; Cambia password da Impostazioni con email precompilata |

Niente lettore card in questa spec (adattatore finto non necessario). **CI**: il job E2E oggi avvia Supabase
con `-x …,mailpit,…`: va tolto `mailpit` dall'elenco. `[auth.rate_limit] email_sent` vale 2 l'ora in
`config.toml`: se il limite si applica anche con Mailpit, una sola esecuzione degli E2E lo supera; lo si alza
**solo in locale** (es. 100), mai nei progetti remoti.

**Regole per gli E2E** (`fullyParallel` è attivo):
- un solo test cambia la password di `recupero@example.com` (percorso completo + link riaperto dopo l'uso, in
  sequenza nello stesso test); nessun altro test accede con quell'account;
- l'email si legge da Mailpit filtrando per destinatario e prendendo il messaggio arrivato dopo la richiesta
  (le email delle esecuzioni precedenti restano); il link si estrae dall'`href` del pulsante e deve iniziare
  con `http://localhost:4173/imposta-password?token_hash=`;
- l'email inesistente è unica per esecuzione (`nessuno-<casuale>@example.com`), così "nessuna email" non
  dipende dalla storia di Mailpit;
- Cambia password da Impostazioni accede come `operatore@example.com`, controlla l'email precompilata e la
  conferma, senza aprire il link (la sua password non cambia);
- una nuova esecuzione senza `db:reset` resta verde: la nuova password è casuale e la "vecchia" rifiutata è
  quella del seed.

## Boundaries

- **Always**: stessa risposta per email esistenti e no; token solo nella query e consumato solo con
  "Salva e accedi"; controllo della password anche sul server (minimo 8); procedura remota prima su staging;
  solo account `@example.com` nei test e nel seed.
- **Ask first**: email di notifica "password cambiata"; inviti; cambio di durata del link o del minimo di
  caratteri; cambio di dominio o di hosting; aumento dei limiti di invio email nei progetti remoti.
- **Never**: email, password o token nei log o nella query di Cambia password; `redirectTo` preso da input o
  dalla query; `supabase config push` sui progetti remoti; chiave service role nell'app; URL di produzione
  nella lista dello staging; account reali o email reali nei test e nel seed.

## Success Criteria

1. Su `/accedi` c'è "Password dimenticata?" e porta a `/password-dimenticata`.
2. Email esistente e inesistente danno la stessa conferma; solo la prima produce un'email (Mailpit); un 429
   o un 5xx del server danno la stessa conferma (test unitario).
3. Il link apre `/imposta-password`, accetta una password ≥ 8 caratteri ripetuta uguale, entra nell'app;
   dopo l'uscita la nuova password funziona e la vecchia no.
4. Un link già usato o scaduto mostra l'errore con "Chiedi un nuovo link"; nessun dato cambia.
5. Dopo un errore di rete su "Salva e accedi" il nuovo tocco completa l'operazione senza un nuovo link e
   senza una seconda verifica.
6. Da Impostazioni (admin e operatore) "Cambia password" apre la richiesta con l'email precompilata.
7. `config.toml`: minimo 8, template `recovery` collegato, URL di ritorno locali (5173 e 4173), senza
   `https://127.0.0.1:3000`; il server rifiuta una password di 7 caratteri (`weak_password`); CI con Mailpit
   verde.
8. Procedura remota documentata ed eseguita su staging e produzione; prova reale da `info@enjoygaeta.it`.
9. Schermate conformi ai wireframe a 390×844, target ≥ 48 px, detector Impeccable pulito.

## Out of Scope

(Aggiornamento 2026-11-22: inviti, schermata Operatori, versione "invito" di `/imposta-password` e nota di
Accesso sono ora in [SPEC-operators.md](SPEC-operators.md).)

Inviti via email e schermata Operatori (decisione del 2026-11-17), quindi anche la versione "invito" del
wireframe Imposta password ("Ciao, Marco", "Andrea ti ha invitato…", Email in sola lettura) e la frase sugli
inviti della nota di Accesso; cambio email dell'account; email di notifica "password cambiata"; criteri di
complessità oltre gli 8 caratteri; sezione "PUNTI" e nota finale del wireframe Impostazioni (operatore)
(modulo `settings`); PIN del tablet (`tablet-kiosk`).

## Open Questions

1. Proposta: anche gli amministratori vedono "Cambia password" (il wireframe Impostazioni admin non ha la
   sezione ACCOUNT) — default adottato.
2. Proposta: dopo il cambio password gli altri dispositivi dello stesso account escono (`scope: 'others'`) —
   default adottato.
3. Proposta: niente email "password cambiata" (le fonti non la chiedono) — default adottato.
4. Proposta: niente campo Email in Imposta password (con `token_hash` l'email è nota solo dopo la verifica);
   titolo "Scegli una nuova password" e testo "Scegli la password per accedere all'Enjoy Card." al posto del
   saluto dell'invito — default adottato.
5. Proposta: anche 429 ed errori del server mostrano la conferma neutra (un errore diverso rivelerebbe che
   l'account esiste); solo la rete assente mostra un errore — default adottato.
6. Proposta: verifica del link al tocco di "Salva e accedi", non all'apertura (protegge da anteprime e
   antivirus delle email; un link scaduto si scopre dopo aver scritto la password) — default adottato.
7. Slug del team Vercel per l'URL delle anteprime nella lista dello staging: da leggere su Vercel. Il glob
   `enjoy-fidelity-card-*-<team>.vercel.app` potrebbe combaciare con un progetto altrui: default adottato,
   glob solo sullo staging e account dello staging con password diverse dalla produzione (alternativa: nessuna
   anteprima nella lista e prova reale solo da `localhost`).
8. Proposta: se la verifica riesce ma la password non viene salvata e si lascia la pagina, la sessione del
   link si chiude su questo telefono (il link di recupero non vale come accesso) — default adottato.
9. Proposta: testi della conferma ("Se l'email è di un account…", "Torna all'accesso"/"Torna alle
   impostazioni") e dei nuovi errori (vista "link scaduto", "Password troppo lunga.", errori `unknown`): il
   wireframe non mostra questi stati; seguono «Stati, errori e conferme» del design system — default adottato.
