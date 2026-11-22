# Spec: operators — Schermata Operatori e inviti via email

Status: bozza (2026-11-22) — le Open Questions adottano un default conservativo; da chiamare con il titolare
solo quelle che lo richiedono
Modulo: `operators` ([CAPABILITY-MAP.md](../../CAPABILITY-MAP.md)) · Dipende da: `identity`
([SPEC-identity.md](SPEC-identity.md)), `identity-password` ([SPEC-identity-password.md](SPEC-identity-password.md):
`/imposta-password`, template e SMTP), `tablet-kiosk` ([SPEC-tablet-kiosk.md](SPEC-tablet-kiosk.md): helper estesi al
cassiere, PIN) · Fonti: specifiche ufficiali, sezione "Ruoli e account" e modello dati "operatori: id, nome, email,
ruolo, PIN (hash), attivo, data creazione"; wireframe "Operatori" (390×844), "Tablet: operatori" (1280×800, colonna
480 px), "Impostazioni (amministratore)" (GESTIONE → "Operatori · Account, ruoli e inviti"), "Tablet: impostazioni"
("Account, ruoli, inviti e PIN"), "Invito: scegli la password", "Accesso"; note n3, n5, n6 della tela ·
Decisione: `brain/DECISIONS.md`, 2026-11-22 "Schermata Operatori nell'app, con invito via email".

> **Differenza da `SPEC-identity.md`**: la V1 rinviava inviti, schermata Operatori e cambio di ruolo dall'app
> (account a mano in Supabase). Questa spec li porta nell'app. `private.add_operator` resta per il **primo
> amministratore** e come riserva (`docs/setup-accounts.md` §4).
>
> **Differenza da `SPEC-identity-password.md`**: quella spec escludeva la versione "invito" di `/imposta-password`
> e la frase sugli inviti della nota di Accesso; qui si aggiungono.
>
> **Differenza da `SPEC-tablet-kiosk.md`** (punto 13 e Out of Scope): la schermata Operatori ora esiste anche sul
> tablet, con un cassiere amministratore; dal tablet però non si invita né si promuove un **amministratore**
> (punti 3, 5, 7; Open Questions 11).
>
> **Differenza da `contract.md`**: una rotta nuova, `/impostazioni/operatori`; colonne nuove in `app.operators`;
> la prima Edge Function del progetto (`supabase/functions/operator-invites`); codici d'errore `EO001`–`EO004`.
> Nessuna tabella, RPC o rotta esistente cambia nome. `contract.md` e `CLAUDE.md` si aggiornano con
> l'implementazione (Note di deploy, passo 7).

## Objective

Un amministratore aggiunge dall'app un altro amministratore o un operatore (nome, email, ruolo), senza toccare
il database né il pannello di Supabase. La persona riceve un'email da `info@enjoygaeta.it` e **sceglie da sola la
password** su `/imposta-password`: nessuno, oltre a lei, la conosce. Dalla stessa schermata l'amministratore vede
chi lavora al bar, cambia il ruolo, disattiva e riattiva un account e rimanda l'invito a chi non è ancora entrato.

**Utenti**: amministratori (titolari), dal telefono o dal tablet della cassa con un cassiere amministratore (dal
tablet senza poter nominare amministratori, Open Questions 11). Gli operatori non vedono la schermata. La persona invitata usa solo l'email e `/imposta-password`.

**Successo**: dal telefono, Impostazioni → Operatori → Nome, Email, Ruolo "Amministratore" → "Invia invito"; la
persona apre l'email, sceglie la password ed entra nell'app come amministratore, in meno di 3 minuti, senza che
nessuno abbia aperto Supabase. Il bar non resta mai senza un amministratore attivo.

## Cosa include

1. **Riga in Impostazioni** (`/impostazioni`, sezione GESTIONE di `rewards`, solo amministratori): prima riga
   della sezione, sopra "Catalogo premi", come nel wireframe: `ListRow` "Operatori" / "Account, ruoli e inviti"
   (telefono) oppure "Account, ruoli, inviti e PIN" (layout tablet) → `/impostazioni/operatori`. Meccanismo:
   `operators` esporta `OperatorsSettingsRow` e `RewardsSettingsSection` (di `rewards`, proprietaria della
   sezione GESTIONE) la mostra come primo `<li>`, prima di "Catalogo premi"; il commento del componente che
   dice "riga Operatori rinviata" si aggiorna. L'ordine delle sezioni di `cross-review.md` §1 non cambia; la
   voce 4 diventa "GESTIONE (solo admin): riga Operatori di `operators`, poi Catalogo premi di `rewards`".

2. **Operatori** (`/impostazioni/operatori`, wireframe "Operatori"): `AppShell` con titolo "Operatori" e
   Indietro → `/impostazioni`. Un operatore (o un dispositivo con cassiere operatore) che apre la rotta vede la
   stessa vista "solo amministratori" di Catalogo premi (`AdminsOnly`); il server rifiuta comunque (`42501`).
   `AdminsOnly` oggi è una funzione privata di `RewardsCatalogPage.tsx`: si sposta in un componente condiviso
   (`src/shared/ui/AdminsOnly.tsx`) usato da `rewards` e da `operators`, con lo stesso aspetto e gli stessi test.
   - **Elenco** (`<ul>`, righe alte ≥ 64 px come nel wireframe): iniziale nel cerchio (tratteggiata e testo
     grigio per chi è disattivato), nome, e sotto ruolo · stato. Ordine: alfabetico senza distinzione di
     maiuscole (`lower(name)`, poi `id`), disattivati in fondo (Open Questions 5). Solo profili di persone: i
     dispositivi (`app.devices`) non compaiono.
   - **Stati** (calcolati sul server, vedi `app.list_operators`):

     | Stato | Quando | Testo sotto il nome |
     |---|---|---|
     | `active` | account collegato, non disattivato, invito accettato (email confermata **e** password impostata **e** `invite_accepted_at`: la password l'ha scelta la persona) | "Amministratore · attivo" |
     | `invited` | account collegato, non disattivato, invito non completato: `email_confirmed_at` nullo **oppure** `encrypted_password` nullo o vuoto **oppure** `invite_accepted_at` nullo | "Operatore · invito inviato" |
     | `deactivated` | `deactivated_at` impostato | "Operatore · disattivato, movimenti nello storico" |
     | `removed` | utente di Auth cancellato dal pannello (`user_id` nullo, regola V1) | come `deactivated` |

     Perché anche la password: `verifyOtp({ type: 'invite' })` (punto 4, passo a) imposta già
     `email_confirmed_at`, prima che `updateUser({ password })` (passo b) salvi la password. Chi chiude la
     pagina tra i due passi (salvataggio fallito, `abandonRecovery` all'uscita) ha l'email confermata e nessuna
     password scelta da lei: resta `invited` e gli si può rimandare l'invito. In realtà GoTrue, alla verifica
     del token d'invito di un utente senza password, gli dà una **password temporanea casuale** (prima di
     confermare l'email, nella stessa transazione): email confermata e password non bastano, quindi conta
     `app.operators.invite_accepted_at` (Open Questions 12), impostato da un trigger su `auth.users` quando la
     password cambia su un utente con l'email **già** confermata (`updateUser` dopo il link d'invito o di
     recupero). Vale anche per l'utente creato dalla dashboard con una password (punto 5, passo 2: la funzione
     la sostituisce con una casuale prima che il profilo esista): resta `invited` finché non sceglie la sua.
     La stessa regola vale ovunque serva "invito accettato": `list_operators`, `operator_resend_begin`,
     `operator_cancel_begin`, `operator_cancel_check` e il conteggio degli amministratori della regola `EO001`
     (punto 7).

     Nel layout tablet si aggiunge " · PIN impostato" / " · PIN da impostare" per `active` e `invited`
     (wireframe "Tablet: operatori").
   - **"(tu)"**: dopo il nome della persona che agisce (`acting_operator_id()`: sul telefono l'account, sul
     tablet il cassiere). Sulla propria riga **nessuna azione** (nessun pulsante, riga non toccabile).
   - **Azioni di riga** (target ≥ 48 px; il wireframe disegna "Disattiva" alto 44 px: si porta a 48):
     - `active` e `invited`: pulsante "Disattiva" (stile pericoloso del wireframe) → `ConfirmDialog`
       `tone="danger"`: titolo "Disattivare {nome}?", descrizione "Non potrà più accedere all'app. I suoi
       movimenti restano nello storico; puoi riattivarlo quando vuoi.", conferma "Disattiva".
     - `deactivated`: pulsante "Riattiva" (stile secondario; **non nel wireframe**, Open Questions 2) →
       `ConfirmDialog` `tone="primary"`: "Riattivare {nome}?" / "Potrà di nuovo accedere con la sua
       password." / "Riattiva". Dal tablet (layout tablet o account di dispositivo) un amministratore
       disattivato non ha "Riattiva": sotto lo stato la nota "Un amministratore si riattiva dal telefono."
       (anche nel dialogo della persona; punto 7, `EO005`, con lo stesso testo nel dialogo se il server
       rifiuta).
     - `removed`: nessuna azione (non esiste più un account da riattivare); per rimetterlo si invita di nuovo
       con lo **stesso nome** (punto 3, ricollegamento come `add_operator`).
     - **Gestione della persona** (deviazione: il wireframe non mostra come si cambia ruolo né come si
       rimanda l'invito; Open Questions 1): nome e stato della riga (`active`, `invited`, `deactivated`)
       sono un pulsante con chevron, come `ListRow`, che apre il dialogo **"{nome}"**. `ConfirmDialog` oggi
       non ha un guscio riutilizzabile (titolo `<h2>`, descrizione dentro un `<p>`, un solo pulsante di
       conferma e uno di annullamento): da esso si estrae in `src/shared/ui/Dialog.tsx` un guscio generico
       (`showModal`, focus restituito a chi l'ha aperto, Esc, titolo, `children`, azione "Chiudi"), mostrato
       in `/dev/ui`; `ConfirmDialog` si ricostruisce sopra il guscio con comportamento e test invariati.
       Stesso aspetto di `ConfirmDialog`, nessun altro componente nuovo. Contenuto del dialogo:
       - riga di testo con l'email dell'account (sola lettura) e lo stato;
       - `fieldset` "Ruolo" con i radio "Operatore" / "Amministratore" (gli stessi del modulo d'invito) e
         pulsante "Salva ruolo", attivo solo se il ruolo scelto è diverso. Promuovere chiede una seconda
         conferma nello stesso dialogo: "Rendere {nome} amministratore? Potrà gestire operatori, premi,
         punti ed esportazioni e annullare i movimenti." / "Rendi amministratore". Retrocedere: "Rendere
         {nome} operatore? Non vedrà più le impostazioni da amministratore." / "Rendi operatore".
         **Nel layout tablet** (dispositivo con cassiere) il radio "Amministratore" è disabilitato per chi è
         operatore, con la nota "Un amministratore si nomina dal telefono." (il server rifiuta comunque,
         punto 7; Open Questions 11);
       - solo per `invited`: "Reinvia invito" (secondario) con la nota "Il link precedente smette di
         funzionare." (verificato: un nuovo invito invalida il token precedente, `otp_expired`);
       - solo per `invited`: "Annulla invito" (stile pericoloso; **non nel wireframe**, deviazione dichiarata)
         → seconda conferma nello stesso dialogo: "Annullare l'invito a {nome}? Il link già inviato smette di
         funzionare." / "Annulla invito". Serve soprattutto per un invito partito verso l'email sbagliata
         (punto 5, `action: "cancel"`); esito "Invito a {nome} annullato.";
       - per `deactivated`: solo l'email e lo stato; il ruolo si cambia dopo la riattivazione (Open
         Questions 1).
   - **Messaggi**: esito in una regione `aria-live="polite"` sopra l'elenco: "Invito inviato a {nome}.",
     "Invito inviato di nuovo a {nome}.", "{nome} è ora amministratore.", "{nome} è ora operatore.",
     "{nome} è disattivato.", "{nome} è di nuovo attivo.", "Invito a {nome} annullato." Gli errori restano nel dialogo o nel modulo che li ha
     prodotti (tabella al punto 6).
   - **Caricamento, errore, vuoto**: `StatusView` di caricamento; errore con "Riprova" (testi di identity per
     rete e server); l'elenco non è mai vuoto (c'è almeno chi lo guarda).
   - Dopo ogni azione riuscita l'elenco si ricarica dal server (nessun aggiornamento solo locale).

3. **Invita operatore** (sezione in fondo al telefono, `aria-labelledby`, sfondo del wireframe; sul tablet
   `<aside aria-label="Invita operatore">` a destra, 480 px): titolo "Invita operatore" (vale anche per gli
   amministratori, come nel wireframe), campi **Nome** (placeholder "Es. Marco", `autoComplete="off"`),
   **Email** (`type="email"`, `autoComplete="off"`, `inputMode="email"`, placeholder `nome@esempio.it`),
   `fieldset` **Ruolo** (radio "Operatore" scelto di default, "Amministratore"), pulsante primario **"Invia
   invito"** con stato `busy`, nota "Riceverà un'email per scegliere la password." (tablet: "…; il PIN per il
   tablet lo imposta dal proprio telefono.").
   - **Nel layout tablet** il radio "Amministratore" è disabilitato, con la nota "Un amministratore si invita
     dal telefono." (il server rifiuta comunque l'invito di un amministratore da un dispositivo, punto 5;
     Open Questions 11).
   - Validazione locale: nome vuoto → "Inserisci il nome"; oltre 60 caratteri → "Al massimo 60 caratteri";
     email vuota → "Inserisci l'email"; email senza forma `x@y.z` o oltre 254 caratteri → "Email non valida".
     Il nome si pulisce come sul server (`private.clean_name`: spazi Unicode compressi e tolti ai bordi).
   - **Idempotenza**: all'apertura della pagina e dopo ogni invito riuscito l'app genera un `operation_id`
     (`crypto.randomUUID()`); un doppio tocco non parte (`busy`) e un nuovo tocco dopo un errore di rete
     riusa **lo stesso** `operation_id` finché nome, email e ruolo non cambiano (se cambiano, ne genera uno
     nuovo). Il server non manda due inviti né crea due profili per lo stesso `operation_id` (punto 5).
   - Riuscito: modulo svuotato (ruolo torna "Operatore"), messaggio "Invito inviato a {nome}.", elenco
     ricaricato con la nuova riga `invited`.
   - **Stesso nome di un profilo `removed`**: il profilo viene ricollegato al nuovo account (stessa regola di
     `add_operator`: la persona ritrova il suo storico); messaggio uguale. Open Questions 4.

4. **Imposta password, versione invito** (`/imposta-password?token_hash=…&type=invite#nome=…&da=…&ruolo=…`,
   pagina pubblica di `identity-password`, wireframe "Invito: scegli la password"):
   - Testi: titolo **"Ciao, {nome}"** e sotto "**{da}** ti ha invitato come **{ruolo}** dell'Enjoy Card.
     Scegli la password per accedere." I tre valori arrivano nel **frammento** dell'URL (dopo `#`), che il
     browser non manda al server (niente nomi nei log di Vercel) e che `Referrer-Policy: no-referrer` già
     protegge. Sono solo testo da mostrare: si accettano `ruolo` ∈ {`operatore`, `amministratore`} e nomi di
     1–60 caratteri; se manca o non è valido anche uno solo, titolo "Scegli la password" e testo "Sei stato
     invitato all'Enjoy Card. Scegli la password per accedere." React li mostra come testo (mai HTML).
   - **Lettura del frammento**: con `new URLSearchParams(hash.slice(1))`, sia per i testi sia per riconoscere
     un errore. Oggi `recoveryToken` di `ResetPasswordPage` scarta ogni frammento che *contiene* `error`
     (`hash.includes('error')`): con i nomi nel frammento un invito valido per "Terrore" risulterebbe scaduto.
     Diventa: errore solo se c'è la chiave `error` o `error_code` (quelle del template predefinito di
     Supabase), in entrambe le versioni della pagina. Test di componente con un nome che contiene "error".
   - Niente campo Email in sola lettura (**deviazione dichiarata** dal wireframe, che mostra
     `marco@esempio.it`; come nel recupero: l'email si conosce solo dopo la verifica e non viaggia nell'URL;
     Open Questions 9). Campi, validazioni (≥ 8 caratteri, ≤ 72 byte, uguali), pulsante "Salva e accedi",
     errori di `updatePassword` e reinvio senza nuova verifica: **identici** al recupero (SPEC-identity-password
     punto 3).
   - "Salva e accedi": (a) `verifyOtp({ type: 'invite', token_hash })` (verificato sullo stack locale: 200 con
     sessione; imposta `email_confirmed_at` e `last_sign_in_at`); (b) `updateUser({ password })`; (c) ricarica
     dell'identità come al login; (d) `/`. Nessun `signOut({ scope: 'others' })` (una persona appena invitata
     non ha altre sessioni).
   - Link scaduto, già usato o sostituito da un nuovo invito (`otp_expired`/403): vista "Il link è scaduto o è
     già stato usato." con il testo "Chiedi a chi ti ha invitato di mandarti un nuovo invito." e il pulsante
     "Vai all'accesso" (non "Chiedi un nuovo link": `/password-dimenticata` non funziona per un invito mai
     accettato, Open Questions 7).
   - Account invitato ma disattivato prima dell'accettazione: la password si salva, poi come in V1 →
     `/accedi` con "Account non abilitato: chiedi a un amministratore."
   - **Instradamento di riserva** (`RootLayout`): oltre a `type=recovery` inoltra anche `/?token_hash=…&type=invite`
     a `/imposta-password`, query **e frammento** conservati.

5. **Edge Function `operator-invites`** (unico punto che usa la chiave segreta, mai l'app né Vercel):
   - `POST /functions/v1/operator-invites` con `Authorization: Bearer <token della sessione>` (lo aggiunge
     `supabase.functions.invoke`), corpo JSON:
     `{ "action": "invite", "operation_id": uuid, "name": string, "email": string, "role": "admin" | "operator" }`
     oppure `{ "action": "resend" | "cancel", "operator_id": uuid }`. Corpo oltre 4 KB, JSON non valido o campi sbagliati
     → 400 `invalid_input`. Solo `POST` e `OPTIONS`.
   - **Chi chiama**: la funzione non decide nulla da sola sul ruolo. Crea un client con la chiave pubblicabile
     e l'`Authorization` del chiamante e chiama le RPC `app.operator_invite_begin` /
     `app.operator_resend_begin`: è PostgREST a verificare il token (401 se non valido o scaduto) e la RPC a
     controllare `private.is_admin()` (amministratore attivo sul telefono, oppure dispositivo con cassiere
     amministratore e turno valido: estensione di `tablet-kiosk`). Verificato sullo stack locale: con
     `verify_jwt` attivo il gateway accetta anche la chiave `anon` (è un JWT valido) e rifiuta solo un token
     malformato o assente; quindi `verify_jwt` **non** basta e l'autorizzazione sta tutta nelle RPC.
   - **Niente amministratori dal tablet**: `operator_invite_begin` con `role = 'admin'` solleva `EO005` se
     `private.current_device_id() is not null` (dispositivo, anche con cassiere amministratore). Codice proprio
     e non `42501`, perché per l'app `42501` vuol dire "ruolo perso" (`reportNotEnabled()`), mentre il
     cassiere amministratore resta tale. Motivo: il
     turno dura 12 ore senza chiusura per inattività e il PIN è di 4 cifre (SPEC-tablet-kiosk, Open Questions
     1 e 2); chi trova il tablet sbloccato da un titolare, o ne indovina il PIN, otterrebbe altrimenti un
     account amministratore permanente con la propria email, da remoto e oltre la fine del turno. Stessa
     regola in `set_operator_role(…, 'admin')` (punto 7). Open Questions 11.
   - **Chiavi**: dall'ambiente dell'Edge runtime, mai dal repo. Verificato con `supabase functions serve`
     (edge-runtime 1.79.1, Deno 2.1.4, CLI 3.2.0): sono già presenti `SUPABASE_URL`,
     `SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS` (dizionari JSON con la chiave `default`),
     `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS`, `SUPABASE_DB_URL`. La funzione usa
     `SUPABASE_SECRET_KEYS.default` (in mancanza `SUPABASE_SERVICE_ROLE_KEY`) solo per il client
     amministrativo (`auth: { persistSession: false, autoRefreshToken: false }`) e
     `SUPABASE_PUBLISHABLE_KEYS.default` (in mancanza `SUPABASE_ANON_KEY`) per il client del chiamante.
     Unica variabile del progetto: `APP_ORIGINS` (non segreta, vedi sotto).
   - **Origine e `redirectTo`**: la funzione risponde solo a richieste con `Origin` nell'elenco `APP_ORIGINS`
     (separati da virgola; sullo staging anche il modello delle anteprime, `APP_PREVIEW_ORIGIN` =
     `https://enjoy-fidelity-card-*-<team>.vercel.app`), altrimenti 403 `forbidden_origin`. `redirectTo` =
     `<Origin>/imposta-password`, mai preso dal corpo. Auth applica comunque la sua lista (Redirect URLs): un
     indirizzo non in lista ricade su `site_url` (verificato), e l'instradamento di riserva del punto 4 lo
     porta a `/imposta-password`. CORS: `Access-Control-Allow-Origin` = l'origine ammessa, riflessa solo se è
     in `APP_ORIGINS` (mai `*`); `Access-Control-Allow-Headers` preso da `corsHeaders` di
     `@supabase/supabase-js/cors` (2.119.0: anche `x-retry-count`, `traceparent`, `tracestate`, `baggage`,
     che una lista scritta a mano dimenticherebbe), mai il suo `Allow-Origin: *`; `Allow-Methods: POST,
     OPTIONS`; `Vary: Origin`. La funzione risponde da sé a `OPTIONS` (in locale lo fa già il gateway Kong,
     verificato; sui progetti online no), quindi un preflight rotto non si vede in locale: lo copre il test
     di unità sull'`OPTIONS`.
   - **Invito** (`action: "invite"`), in quest'ordine:
     1. `app.operator_invite_begin(operation_id, name, email, role)` con il token del chiamante. Risposte
        `jsonb` (non eccezioni, così la prenotazione resta scritta):
        `proceed` (con `invited_by_name`; con `existing_user_id` se l'email ha già un utente di Auth non
        collegato né a un operatore né a un dispositivo; in quel caso anche `existing_confirmed` e
        `existing_has_password`), `done` (operazione già completata: restituisce lo stesso profilo,
        **nessuna nuova email**), `in_progress` (stesso `operation_id` prenotato da meno di 2 minuti, oppure
        un'**altra** operazione `pending` recente con la stessa email o lo stesso nome), `name_taken`,
        `email_taken` (con `deactivated: true` se l'email è di una persona disattivata), `email_is_device`.
        Eccezioni: `42501` non amministratore, `EO005` dispositivo con `role = 'admin'`, `22023` input non valido o
        stesso `operation_id` con nome, email o ruolo diversi.
     2. Se `existing_user_id`: `auth.admin.updateUserById(id, { user_metadata })` (verificato: un nuovo invito a
        un utente non confermato **non** aggiorna i metadati, li lascia quelli del primo). Se
        `existing_has_password`, nella stessa chiamata anche `password` = 32 byte casuali (mai salvati né
        registrati), così una password scelta prima (da chi ha creato l'utente dalla dashboard, o
        dall'invitato di un invito poi fallito) non vale più.
     3. Utente nuovo o non confermato: `auth.admin.inviteUserByEmail(email, { redirectTo, data: { name, invited_by, role_label } })` con
        `role_label` = `operatore` | `amministratore`. Verificato sullo stack locale (GoTrue v2.198.0) con
        `enable_signup = false`: **funziona** (200), crea l'utente non confermato e manda l'email; ripetuto
        sullo stesso utente non confermato rimanda l'email con un token nuovo e invalida il vecchio; su un
        utente già confermato risponde 422 `email_exists`; un'email non valida 400 `validation_failed`.
        Utente già **confermato** (`existing_confirmed`: un invito fallito dopo che la persona aveva aperto il
        link, oppure un account creato dalla dashboard in V1 e mai collegato con `add_operator`):
        `inviteUserByEmail` risponderebbe 422, quindi la funzione manda invece un link di recupero
        (`resetPasswordForEmail(email, { redirectTo })`, stesso `redirectTo`): la persona riceve l'email di
        recupero (non quella d'invito: deviazione accettata per un caso raro) e sceglie la password su
        `/imposta-password`. Senza questo caso l'email resterebbe bloccata per sempre su "Questa email ha già
        un account" e si sbloccherebbe solo dallo SQL Editor.
     4. `app.operator_invite_finish(operation_id, user_id)` con la chiave segreta (RPC eseguibile **solo** da
        `service_role`): in una transazione blocca la riga dell'utente in `auth.users` (`for update`, come
        `add_operator`), controlla che `auth.users.email` di `user_id` sia l'email prenotata, ricontrolla che
        chi ha chiesto l'invito sia ancora un amministratore attivo, che l'email non sia di un dispositivo o
        di un altro profilo e che il nome sia libero, poi crea il profilo (o ricollega quello `removed` con lo
        stesso nome, togliendo `deactivated_at` e cancellando il PIN del vecchio account: la nuova persona
        imposta il suo; `add_operator` fa lo stesso quando ricollega un profilo `removed`), imposta `invited_by`, `invited_at` e segna l'operazione
        `done`. **Idempotente**: se l'operazione è già `done` con lo stesso `user_id` risponde `done` con lo
        stesso profilo. Risposte `done` | `name_taken` | `email_taken` | `email_is_device` | `forbidden`.
     5. **Compensazione**: se 3 fallisce, `app.operator_invite_fail(operation_id)` (solo `service_role`) segna
        l'operazione `failed`; passa **solo** da `pending` a `failed` (un'operazione già `done` non cambia),
        così un nuovo tocco riparte subito. Se 4 non risponde `done` e l'utente è stato creato da questa
        operazione (`existing_user_id` nullo), la funzione chiede a `app.operator_invite_orphan(operation_id,
        user_id)` (solo `service_role`, rilegge il database: utente non confermato, non collegato a un
        operatore né a un dispositivo) se può cancellarlo, e solo con `true` chiama `auth.admin.deleteUser`,
        poi `operator_invite_fail`. Il "posso cancellare" non si deduce mai dalla risposta di `finish`. Se
        anche la compensazione fallisce, o l'invitato apre il link prima della cancellazione, resta un utente
        di Auth senza profilo: non può usare l'app (senza profilo "Account non abilitato") e un invito
        successivo alla stessa email lo riusa (`existing_user_id`, con il link di recupero se è già
        confermato). Nessun caso lascia un profilo senza account.
   - **Reinvio** (`action: "resend"`): `app.operator_resend_begin(operator_id)` con il token del chiamante
     (`42501` non admin; `EO002` se è il chiamante stesso; `P0002` profilo inesistente; `EO004` se la persona non
     è `invited`, cioè è attiva, disattivata o `removed`; `invited` secondo la regola del punto 2, quindi
     anche chi ha confermato l'email senza salvare la password) → `{ user_id, email, name, role_label,
     invited_by_name, email_confirmed, requested_by }` (`requested_by` = `acting_operator_id()` del chiamante)
     → `updateUserById` (metadati con chi rimanda l'invito) → `inviteUserByEmail` se `email_confirmed` è
     falso, altrimenti `resetPasswordForEmail(email, { redirectTo })` (Auth risponderebbe 422 a un invito) →
     `app.operator_resend_finish(p_operator_id uuid, p_requested_by uuid)` (solo `service_role`: ricontrolla
     che `p_requested_by` sia ancora un amministratore attivo, come `operator_invite_finish`, poi aggiorna
     `invited_by = p_requested_by` e `invited_at`). Niente idempotenza: un secondo reinvio manda un'altra
     email e vale l'ultima (il pulsante è `busy`; il limite di frequenza di Auth fa il resto).
   - **Annullamento** (`action: "cancel"`, solo per `invited`): rimedio a un invito partito verso l'email
     sbagliata. Disattivare non basta: il link già spedito resta valido per un'ora, chi lo apre sceglie la
     password e basta poi un "Riattiva" o un "Reinvia invito" (che riparte verso lo stesso indirizzo) perché
     un estraneo entri; e il profilo occuperebbe il nome. Passi: `app.operator_cancel_begin(operator_id)` con
     il token del chiamante (`42501`, `EO002`, `P0002`, `EO004` come il reinvio) → `{ user_id,
     requested_by }` → `app.operator_cancel_check(p_operator_id uuid, p_user_id uuid, p_requested_by uuid)`
     (solo `service_role`: blocca la riga di `auth.users` e, nella stessa transazione, controlla che la
     persona sia ancora `invited`, che il profilo sia ancora collegato a quell'utente e che `p_requested_by`
     sia ancora un amministratore attivo; risponde `true`/`false`) → con `true`, `auth.admin.deleteUser`:
     il link smette di funzionare e il profilo diventa `removed` (`on delete set null` di `user_id`, regola
     V1); nessuna riga di `app.operators` è cancellata. Con `false` → 409 `not_invited`. Se l'invitato
     completa l'invito proprio tra il controllo e la cancellazione, l'account sparisce comunque: è ciò che
     l'amministratore ha chiesto. Il nome resta del profilo `removed` e un nuovo invito con lo stesso nome e
     l'email giusta lo ricollega (punto 3). Risposta 200 `cancelled`.
   - **Risposte HTTP** della funzione (corpo `{ "status": … }` oppure `{ "error": <codice> }`, mai messaggi
     interni di Auth né email nei log):

     | Esito | HTTP | Codice |
     |---|---|---|
     | invito inviato o già fatto | 200 | `invited` (con `operator: {id, name, role}`) / `resent` / `cancelled` |
     | operazione in corso | 409 | `in_progress` |
     | nome già usato | 409 | `name_taken` |
     | email già di un account | 409 | `email_taken` (+ `deactivated`) |
     | email del tablet | 409 | `email_is_device` |
     | persona non in attesa d'invito | 409 | `not_invited` |
     | non amministratore, sé stessi, origine non ammessa | 403 | `forbidden` / `self` / `forbidden_origin` |
     | amministratore invitato da un dispositivo (`EO005`) | 403 | `admin_from_device` |
     | token assente o non valido | 401 | `unauthorized` |
     | input non valido | 400 | `invalid_input` |
     | limite di email di Auth (`429`, `over_email_send_rate_limit`) | 429 | `rate_limited` |
     | qualsiasi altro errore di Auth o del database | 502 | `upstream` |

   - Codice: `supabase/functions/operator-invites/index.ts` (solo `Deno.serve`, lettura dell'ambiente e
     creazione dei client) e `handler.ts` (tutta la logica, con i client iniettati e senza globali di Deno,
     così si prova con Vitest). `handler.ts` importa con specificatori nudi (`@supabase/supabase-js`,
     `@supabase/supabase-js/cors`): in Node li risolve il pacchetto dell'app, in Deno l'import map
     `supabase/functions/operator-invites/deno.json` (`"@supabase/supabase-js": "npm:@supabase/supabase-js@2.119.0"`,
     più la voce `/cors`), fissata alla stessa versione dell'app. Solo `index.ts` usa globali di Deno.
     Log: solo `operation_id`, azione ed esito.

6. **Errori mostrati nell'app** (servizio `operatorsService`, mappe `Record<Result, string>` come in identity):

   | Risultato | Dove | Testo |
   |---|---|---|
   | `name_taken` | sotto Nome | "Nome già usato: per gli omonimi aggiungi un dettaglio (es. Marco B.)." |
   | `email_taken` | sotto Email | "Questa email ha già un account." (se `deactivated`: "Questa email è di una persona disattivata: riattivala dall'elenco.") |
   | `email_is_device` | sotto Email | "Questa è l'email dell'account del tablet: usane un'altra." |
   | `rate_limited` | sotto il pulsante | "Troppe email inviate in poco tempo: l'invito non è partito. Riprova tra qualche minuto." |
   | `in_progress` | sotto il pulsante | "L'invito è ancora in corso: riprova tra qualche secondo." |
   | rete (nessuna risposta) | sotto il pulsante | "Connessione assente: l'invito potrebbe non essere partito. Riprova." (stesso `operation_id`) |
   | `forbidden` / `42501` | — | `reportNotEnabled()` (ruolo perso o account disattivato), poi vista "solo amministratori" |
   | `last_admin` (`EO001`) | nel dialogo | "Serve almeno un amministratore attivo: prima rendi amministratore un'altra persona." |
   | `self` (`EO002`) | nel dialogo | "Non puoi cambiare il tuo account da qui." (non dovrebbe accadere: nessuna azione su "(tu)") |
   | `not_invited` (`EO004`) | nel dialogo | "{nome} ha già accettato l'invito o non è attivo: ricarica l'elenco." |
   | `admin_from_device` (`EO005`) | sotto Ruolo / nel dialogo | "Un amministratore si nomina dal telefono." (non dovrebbe accadere: il radio è disabilitato sul tablet) |
   | `upstream`, altro | dove è partita l'azione | "Operazione non riuscita. Riprova tra poco." |

   Il limite di email: in locale `email_sent = 100` l'ora (`config.toml`); sui progetti online è quello della
   dashboard (Authentication → Rate Limits; con l'SMTP personalizzato già attivo è configurabile, con quello
   predefinito di Supabase sono 2 email l'ora, documentazione ufficiale "Rate limits"). Quando Auth risponde
   429 la funzione restituisce `rate_limited` e l'app mostra il testo sopra: niente crash e niente
   eccezione non gestita.

7. **Cambio ruolo, disattivazione, riattivazione** (RPC, senza la funzione: non servono le API di Auth):
   - `app.set_operator_role(p_operator_id, p_role)` e `app.set_operator_active(p_operator_id, p_active)`,
     `security definer`, `set search_path = ''`, `revoke execute from public, anon`, `grant execute to
     authenticated`. Ordine dentro ciascuna (sicuro anche con due amministratori in contemporanea):
     1. `select … from app.operators where id = p_operator_id or (role = 'admin' and deactivated_at is null
        and user_id is not null) order by id for update` (blocca il bersaglio e tutti gli amministratori
        attivi, sempre nello stesso ordine);
     2. **istruzione successiva** (in `read committed` vede ciò che altre transazioni hanno appena confermato):
        `private.is_admin()` altrimenti `42501`; bersaglio inesistente `P0002`; bersaglio =
        `acting_operator_id()` → `EO002`; bersaglio `removed` (senza account) → `EO003`;
        `set_operator_role(…, 'admin')` da un dispositivo (`private.current_device_id() is not null`, anche con
        cassiere amministratore) → `EO005`, come l'invito di un amministratore (punto 5): `EO002` blocca solo
        il cassiere stesso, non un operatore che gli sta accanto e promuove il proprio profilo; per lo stesso
        motivo `set_operator_active(…, true)` su un amministratore disattivato da un dispositivo → `EO005`
        (riattivarlo ridarebbe un account amministratore permanente con la sua password); un operatore
        disattivato si riattiva anche dal tablet;
     3. regola dell'ultimo amministratore: se l'operazione toglie a un amministratore attivo il ruolo o
        l'accesso, deve restare almeno un **altro** amministratore attivo con l'invito accettato secondo la
        regola del punto 2 (`email_confirmed_at` non nullo **e** password impostata **e** `invite_accepted_at`),
        altrimenti `EO001`. Con "nessuna azione su sé stessi" scatta solo
        nelle corse (A retrocede B mentre B retrocede A: la seconda transazione aspetta il blocco, poi non è
        più amministratore e riceve `42501`), ma resta come difesa;
     4. scrittura; stesso valore di prima → nessuna modifica, risposta uguale (idempotente). Restituiscono il
        profilo con lo stato aggiornato (stessa forma di `list_operators`).
   - **Disattivare** imposta `deactivated_at = now()` e `deactivated_by = acting_operator_id()`; nella stessa
     transazione chiude i turni di cassa di quella persona su tutti i tablet (`update app.devices set
     cashier_operator_id = null, cashier_since = null where cashier_operator_id = p_operator_id`). Ordine dei
     blocchi: righe di `operators`, poi righe di `devices`; `unlock_cashier` blocca il dispositivo e legge
     l'operatore senza bloccarlo (blocca in `for share` solo la riga del PIN), quindi nessun ciclo. Il PIN resta
     (serve alla riattivazione).
     **La garanzia non è la chiusura del turno**, ma `valid_cashier_id()`, che a ogni richiesta controlla
     `deactivated_at is null`. Corsa: se uno sblocco dello stesso operatore parte prima della disattivazione,
     l'`update app.devices … where cashier_operator_id = p_operator_id` non vede ancora quel turno (la versione
     confermata della riga non coincide), lo salta senza aspettare e conferma; poi lo sblocco scrive
     `cashier_operator_id`. Resta un turno scritto con un cassiere disattivato, che non dà nulla: il dispositivo
     non legge né scrive e `get_session_identity()` dà cassiere nullo. **Non** si aggiunge un blocco
     sull'operatore in `unlock_cashier`: con l'operatore già cassiere di quel tablet (dispositivo poi
     operatore, contro operatore poi dispositivo) darebbe un deadlock.
   - **Riattivare** azzera `deactivated_at` e `deactivated_by`: la persona rientra con la sua password (o, se
     non aveva mai accettato, torna `invited` e le si può rimandare l'invito).
   - **Effetto immediato**: `current_operator_id()` e `valid_cashier_id()` ignorano i profili disattivati,
     quindi dalla transazione successiva il token ancora valido della persona (fino a 1 ora, `jwt_expiry`) non
     legge nulla (RLS) e ogni RPC la rifiuta come "nessun operatore" (codici esistenti). Il ruolo cambiato vale
     subito nelle RPC (`is_admin()`).
   - **Nell'app della persona**: nota n6 "operatore disattivato mentre è collegato (torna all'accesso con un
     messaggio)". `AuthProvider` ricontrolla l'identità già al ritorno in primo piano e a ogni rifiuto
     (`reportNotEnabled`); qui si aggiunge il controllo a **ogni cambio di rotta anche per gli account
     operatore** (oggi solo per i dispositivi, `RequireCashier`), senza bloccare la schermata. Risposta nulla
     → `/accedi` con "Account non abilitato: chiedi a un amministratore." (testo V1, Open Questions 6). Un
     ruolo cambiato aggiorna la sessione (Impostazioni ridotte o complete). Sul tablet un cassiere disattivato
     → `/cassa` con "Turno scaduto: inserisci di nuovo il PIN" e non compare più in "Chi è alla cassa?".
   - **Movimenti mai toccati**: nessuna di queste operazioni scrive o cancella `movements`, `customers`,
     `cards` o `rewards`; i nomi nello storico e nell'export restano.

8. **Template dell'email d'invito** (`supabase/templates/invite.html`, oggetto **"Enjoy Card: il tuo
   invito"**), HTML semplice in italiano con i colori di `recovery.html`, senza immagini esterne:
   "Ciao {{ .Data.name }}," · "{{ .Data.invited_by }} ti ha invitato come {{ .Data.role_label }} dell'Enjoy
   Card, la fidelity card dell'Enjoy Bar. Tocca il pulsante per scegliere la password: il link vale un'ora e si
   usa una volta sola." · pulsante "Scegli la password" con
   `href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite#nome={{ .Data.name }}&da={{ .Data.invited_by }}&ruolo={{ .Data.role_label }}"`
   · "Se il link è scaduto, chiedi a chi ti ha invitato di mandarne un altro. Se non lavori all'Enjoy Bar,
   ignora questa email." Mittente `info@enjoygaeta.it` (SMTP già configurato, come il recupero).
   - Verificato sullo stack locale: i template di GoTrue fanno l'escape secondo il contesto (Go
     `html/template`): nel testo `Zoë & <b>Co</b>` diventa `Zoë &amp; &lt;b&gt;Co&lt;/b&gt;`, nel frammento
     dell'`href` `Zo%c3%ab%20%26%20%3cb%3eCo%3c%2fb%3e`. Un nome non può quindi iniettare HTML nell'email né
     rompere il link.
   - Verificato: il link d'invito scade con `otp_expiry` (3600 s, lo stesso del recupero: un token d'invito
     vecchio di 61 minuti risponde `otp_expired`).
   - `user_metadata` è modificabile dall'utente: serve **solo** ai testi dell'email e della pagina, mai a
     un'autorizzazione (ruolo e nome veri stanno in `app.operators`).

9. **Accesso** (`/accedi`, di `identity`): la nota torna quella del wireframe: "Gli account li crea un
   amministratore. Se hai ricevuto un invito, apri il link nell'email per scegliere la password."

### Modello dati e regole di accesso

```sql
-- app.operators (identity), colonne nuove; nessuna cancellazione di profili, mai
deactivated_at  timestamptz null                          -- null = attivo ("attivo" delle specifiche)
deactivated_by  uuid null references app.operators (id)
invited_at      timestamptz null                          -- ultimo invito mandato dall'app
invited_by      uuid null references app.operators (id)
check ((deactivated_at is null) = (deactivated_by is null))
-- L'email resta in auth.users (come in V1): letta solo dalle funzioni security definer.

-- private.operator_invites: prenotazioni d'invito (idempotenza); nessun privilegio per anon/authenticated
operation_id    uuid primary key
requested_by    uuid not null references app.operators (id)
name            text not null
email           text not null                             -- minuscola, senza spazi
role            text not null check (role in ('admin', 'operator'))
status          text not null check (status in ('pending', 'done', 'failed'))
existing_user   boolean not null                          -- l'utente di Auth c'era già (niente compensazione)
operator_id     uuid null references app.operators (id)   -- impostato a 'done'
updated_at      timestamptz not null default now()
-- un solo invito in corso per email e per nome, qualunque sia l'operation_id
create unique index on private.operator_invites (lower(email)) where status = 'pending';
create unique index on private.operator_invites (lower(name)) where status = 'pending';
```

- **Helper ridefiniti** (`create or replace`, stessa firma e stessi privilegi, migrazione dopo quelle di
  `tablet-kiosk`): `private.current_operator_id()` → solo profili con `deactivated_at is null`;
  `private.valid_cashier_id()` → cassiere non disattivato; `app.get_session_identity()` → `null` per un account
  operatore disattivato (stesso effetto di "profilo scollegato"); `app.list_cashiers()` e
  `app.unlock_cashier()` → ignorano i disattivati (`no_pin` per un disattivato, come per un operatore senza
  account); `private.add_operator()` → ricollegando un profilo ne azzera anche `deactivated_at`/`_by` (la
  procedura "rimettere un operatore" di `docs/setup-accounts.md`). `is_active_operator()`, `is_admin()` e
  `acting_operator_id()` seguono da sole (si basano su `current_operator_id()` e `valid_cashier_id()`). Prima
  di scrivere la migrazione, `grep` di `app.operators` in tutte le migrazioni per trovare ogni altro punto che
  considera "collegato" = "attivo".
- **RPC nuove** (`security definer`, `set search_path = ''`, privilegi espliciti come in
  `20261117230000_function_privileges.sql`):
  - `app.list_operators()` (solo `is_admin()`, altrimenti `42501`) → `id, name, role, status ('active' |
    'invited' | 'deactivated' | 'removed'), email (null per 'removed'), has_pin, is_me` ordinati come al punto
    2. Mai l'hash del PIN, mai token.
  - `app.set_operator_role(uuid, text)`, `app.set_operator_active(uuid, boolean)`: punto 7; `authenticated`.
  - `app.operator_invite_begin(uuid, text, text, text)`, `app.operator_resend_begin(uuid)`,
    `app.operator_cancel_begin(uuid)`: punto 5; `authenticated` (con `is_admin()` dentro).
  - `app.operator_invite_finish(uuid, uuid)`, `app.operator_invite_fail(uuid)`,
    `app.operator_invite_orphan(uuid, uuid)`, `app.operator_resend_finish(p_operator_id uuid, p_requested_by
    uuid)`, `app.operator_cancel_check(uuid, uuid, uuid)`: `revoke execute from public, anon, authenticated`,
    `grant execute to service_role` soltanto.
  - Prenotazione in `operator_invite_begin`: prima le prenotazioni `pending` di **altre** operazioni con la
    stessa email o lo stesso nome e più vecchie di 2 minuti passano a `failed` (funzione caduta a metà);
    poi `insert … on conflict (operation_id) do nothing`; se l'insert viola uno degli indici unici parziali
    (`23505`: un'altra operazione recente sulla stessa email o sullo stesso nome, per esempio due
    amministratori insieme o un ritocco ai campi) → `in_progress`, così due inviti allo stesso indirizzo o
    nome non arrivano mai insieme ad Auth (il secondo `inviteUserByEmail` invaliderebbe il primo token e la
    compensazione del perdente potrebbe cancellare l'utente del vincitore). Poi lettura `for update` della
    riga: `done` → `done`; `pending` aggiornata da meno di 2 minuti → `in_progress`; `failed` o `pending` più
    vecchia → torna `pending` con `updated_at = now()` e `proceed`. Nome, email e ruolo diversi da quelli
    prenotati → `22023`.
  - Codici d'errore del modulo: `EO001` ultimo amministratore, `EO002` sé stessi, `EO003` profilo senza
    account, `EO004` non in attesa d'invito, `EO005` amministratore da un dispositivo; più `42501`, `22023`,
    `P0002` standard.
- `app.operators` resta in sola lettura dall'API (nessun `insert/update/delete` per `authenticated`); la
  policy di lettura non cambia.
- **Unicità**: nome unico senza distinzione di maiuscole (indice esistente `operators_name_key`); email unica
  perché un utente di Auth ha una sola email e `user_id` è unico; un utente di Auth è **o** operatore **o**
  dispositivo (regola di `tablet-kiosk`, applicata anche da `operator_invite_begin` e `_finish`).

### Configurazione

| Voce | Locale | Staging | Produzione |
|---|---|---|---|
| `[auth.email.template.invite]` | `subject = "Enjoy Card: il tuo invito"`, `content_path = "./supabase/templates/invite.html"` | incollato a mano | incollato a mano |
| Redirect URLs | già `…/imposta-password` (5173, 4173) | già (anteprime + 5173) | già |
| `[functions.operator-invites]` | `verify_jwt = true` | idem (dal deploy) | idem |
| `APP_ORIGINS` | `supabase/functions/.env` (ignorato da git; modello `supabase/functions/.env.example`): `http://localhost:5173,http://localhost:4173` | `http://localhost:5173` + `APP_PREVIEW_ORIGIN` delle anteprime | `https://enjoy-fidelity-card.vercel.app` |
| Limite email l'ora | 100 (solo locale) | dashboard, invariato | dashboard, invariato |

- Verificato: `supabase functions serve` carica da solo `supabase/functions/.env`, già ignorato da `.env`/`.env.*`
  di `.gitignore` (controllato con `git check-ignore`); `supabase/functions/.env.example` si committa
  (`!.env.example`). Lo stesso file non deve mai ospitare chiavi, anche se `APP_ORIGINS` non è segreto.
- **Test e controlli di tipo della funzione** (oggi non li vedrebbe nessuno: `test.include` di
  `vite.config.ts` copre solo `src/**` e `scripts/**`, `tsconfig.app.json` solo `src`, `tsconfig.node.json`
  non `supabase/functions`): aggiungere `supabase/functions/**/*.test.ts` a `test.include`; un
  `tsconfig.functions.json` (richiamato da `npm run typecheck`) che include `handler.ts` e `handler.test.ts`
  di `supabase/functions/operator-invites/`, con i tipi di `@supabase/supabase-js` dell'app; `index.ts` (unico
  file con globali di Deno) fuori da tsc ed ESLint/Oxlint, controllato in CI con `deno check index.ts`
  (facoltativo).
- `scripts/reload-auth-templates.sh` aspetta anche "reloaded template type: invite".
- Trappola trovata scrivendo la spec (2026-11-22, da aggiungere al RUNBOOK): Kong monta **un singolo file**
  per template; se un editor salva sostituendo il file (nuovo inode) il gateway continua a servire quello
  vecchio, cancellato, e Auth riceve 404 (`templatemailer_template_body_http_error … status code 404`). Con due
  template il rischio raddoppia. Rimedio: `docker restart supabase_kong_enjoy-card-app`, poi
  `scripts/reload-auth-templates.sh`.

### Note di deploy (per l'orchestratore; prima staging, poi produzione)

1. Migrazione: `npx supabase db push` sullo staging (progetto collegato), poi sulla produzione. Una
   migrazione (`*_operators_invite_accepted.sql`) crea il trigger `operators_mark_invite_accepted` su
   `auth.users` (Open Questions 12): dopo il push, controllare che esista (`select tgname from pg_trigger
   where tgrelid = 'auth.users'::regclass`) e che un invito accettato sullo staging risulti "attivo".
2. Template: Authentication → Emails → Templates → **Invite user**: oggetto e corpo di
   `supabase/templates/invite.html` (controllare che il pulsante contenga `?token_hash={{ .TokenHash }}&type=invite`
   e non `{{ .ConfirmationURL }}`). Mai `supabase config push`.
3. Funzione (CLI 3.2.0, target con `--remote`, non `--project-ref`): `npx supabase secrets set
   APP_ORIGINS=… [APP_PREVIEW_ORIGIN=…] --remote=<ref>`; `npx supabase functions deploy operator-invites
   --remote=<ref>` (con `--use-api` se Docker non c'è). Le variabili `SUPABASE_*` le fornisce la piattaforma:
   non si impostano a mano e la chiave segreta non va mai su Vercel né nel repo. Su Vercel non cambia nulla
   (l'app ricava l'URL della funzione da `VITE_SUPABASE_URL`).
4. Se il progetto online usa le nuove chiavi di firma JWT asimmetriche e il controllo `verify_jwt` della
   piattaforma rifiuta i token validi, si ridistribuisce con `--no-verify-jwt`: la sicurezza non cambia, perché
   ogni azione passa dalle RPC, dove PostgREST verifica il token e `is_admin()` il ruolo.
5. Redirect URLs: nessuna voce nuova (`/imposta-password` c'è già); lo staging non riceve mai l'URL di
   produzione. Rate Limits: non cambiare (Ask first).
6. Prova reale sullo staging (prima della produzione): da un'anteprima, come amministratore, invitare un
   **secondo indirizzo dell'utente** (mai un collega vero sullo staging), aprire l'email (mittente
   `info@enjoygaeta.it`), scegliere la password, entrare; poi disattivare e riattivare quell'account. In
   questa prova si conferma anche che l'invito con le iscrizioni chiuse funziona **online** come in locale
   (`docs/setup-accounts.md` §4 oggi dice il contrario per "Invite user" della dashboard, senza prova: va
   corretto dopo la verifica; Open Questions 8).
7. Aggiornare `docs/setup-accounts.md` §4 (inviti dall'app; `add_operator` solo per il primo amministratore e
   come riserva), il RUNBOOK (procedura e trappola dei template), `docs/specs/contract.md` (rotta
   `/impostazioni/operatori`, colonne nuove di `app.operators`, `supabase/functions/operator-invites`, codici
   `EO001`–`EO005`) e `CLAUDE.md` (Ruoli: account creati dalla schermata Operatori con invito via email;
   `add_operator` solo per il primo amministratore e come riserva; niente amministratori dal tablet).

## Commands

```bash
npm run db:start && ./scripts/reload-auth-templates.sh   # stack locale con Mailpit (http://localhost:54324)
npx supabase functions serve                             # Edge Function in locale (legge supabase/functions/.env)
npm run db:test && npm run test:integration && npm run e2e
```

CI (`.github/workflows/ci.yml`): dopo `supabase start` e il ricaricamento dei template, copia
`supabase/functions/.env.example` in `supabase/functions/.env` e avvia `npx supabase functions serve` in
background, aspettando che `/functions/v1/operator-invites` risponda (verificato: `functions serve` avvia il
proprio contenitore anche con `edge-runtime` escluso da `supabase start -x`).

## Project Structure

```
src/features/operators/        → OperatorsPage (/impostazioni/operatori), OperatorRow, OperatorDialog,
                                 InviteForm, OperatorsSettingsRow (riga in GESTIONE), types.ts,
                                 supabaseOperatorsService.ts, OperatorsServiceProvider
src/features/identity/         → ResetPasswordPage in modalità invito, verifyInvite nel servizio,
                                 controllo dell'identità a ogni cambio di rotta, nota di LoginPage
src/app/routes.tsx, RootLayout.tsx → rotta e inoltro di type=invite
src/test/fakeOperatorsService.ts → fake in memoria
supabase/functions/operator-invites/ → index.ts, handler.ts (+ handler.test.ts con Vitest), deno.json (import map); .env.example a livello di functions/
src/shared/ui/Dialog.tsx       → guscio generico estratto da ConfirmDialog (ricostruito sopra, test invariati), in /dev/ui
src/shared/ui/AdminsOnly.tsx   → spostato da RewardsCatalogPage.tsx, usato da rewards e operators
src/features/rewards/RewardsSettingsSection.tsx → mostra OperatorsSettingsRow come primo <li> di GESTIONE
vite.config.ts (test.include), tsconfig.functions.json, package.json (typecheck)
supabase/migrations/*_operators.sql; supabase/templates/invite.html; supabase/config.toml; supabase/seed.sql
supabase/tests/operators.test.sql; tests/integration/operators.test.ts
e2e/operators.spec.ts, e2e/tablet-operators.spec.ts (progetto tablet)
scripts/operatorsCriteria.test.ts → un test per criterio, come gli altri moduli
docs/setup-accounts.md, brain/topics/operations/RUNBOOK.md, docs/specs/contract.md, CLAUDE.md
```

## Code Style

Come `identity` e `tablet-kiosk`: le pagine parlano solo con il servizio del modulo, mai con `getSupabase()`;
risultati come unioni discriminate; nessuna email, token o password nei log.

```ts
export type InviteResult =
  | { status: 'invited'; operator: Operator }
  | { status: 'name-taken' | 'email-is-device' | 'in-progress' | 'rate-limited' | 'forbidden' | 'admin-from-device' }
  | { status: 'email-taken'; deactivated: boolean }
  | { status: 'network' | 'unknown' };
```

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP (`operators.test.sql`) | `list_operators` solo admin (operatore, dispositivo senza cassiere e con cassiere operatore → `42501`; cassiere admin → ok), stati `active`/`invited`/`deactivated`/`removed`, `is_me` del cassiere; `set_operator_role`/`set_operator_active`: non admin `42501`, sé stessi `EO002`, `removed` `EO003`, ultimo amministratore `EO001`, idempotenza; disattivato: 0 righe da ogni tabella `app`, RPC di scrittura rifiutate, `get_session_identity()` null, turno di cassa chiuso, assente da `list_cashiers`, `unlock_cashier` → `no_pin`; riattivato: tutto torna; movimenti invariati (conteggio e somma prima/dopo); `operator_invite_begin`: `proceed`/`done`/`in_progress`/`name_taken`/`email_taken`/`email_is_device`, `22023` per payload diverso; stato `invited` anche con email confermata e password vuota (token verificato, salvataggio saltato): `list_operators` lo mostra `invited`, `operator_resend_begin` lo accetta con `email_confirmed: true`, non conta per `EO001`; `operator_invite_begin` con un'altra operazione `pending` recente sulla stessa email o sullo stesso nome → `in_progress`, con una più vecchia di 2 minuti → `proceed`; utente di Auth confermato e non collegato → `proceed` con `existing_confirmed`; `_finish` idempotente (`done` due volte, stesso profilo) e con email di `user_id` diversa da quella prenotata rifiutato; `_fail` su un'operazione `done` non la cambia; `_orphan` falso per un utente confermato o collegato; cassiere amministratore: invito con ruolo `admin` e `set_operator_role(…, 'admin')` → `EO005`, invito `operator` ok; `operator_cancel_begin` solo per `invited` (`EO004` altrimenti); `_cancel_check` falso se nel frattempo la persona ha accettato; `_finish`/`_fail`/`_orphan`/`_resend_finish`/`_cancel_check` non eseguibili da `authenticated`; `private.operator_invites` illeggibile da `authenticated`; `add_operator` riattiva |
| Concorrenza (integrazione, due connessioni) | A retrocede B mentre B retrocede A → una riesce, l'altra `42501`; disattivazione durante `unlock_cashier` dello stesso operatore → nessun deadlock e, dopo la corsa, il dispositivo non legge nulla e `get_session_identity()` dà cassiere nullo (si verifica questo, non che `cashier_operator_id` sia null: punto 7); due inviti alla stessa email con `operation_id` diversi in parallelo → uno `proceed`, l'altro `in_progress`, una sola email |
| Unità (Vitest su `handler.ts` con client finti) | origine non ammessa → 403 senza chiamate; `OPTIONS`: `Allow-Headers` uguale a quello di `corsHeaders` di `@supabase/supabase-js/cors`, `Allow-Origin` = origine ammessa e mai `*`; ordine begin → metadati → invito → finish; `done` → nessun invito; 429 di Auth → `rate_limited` e `operator_invite_fail`; 422 `email_exists` → `email_taken`; finish `name_taken` → compensazione `deleteUser` solo se l'utente è nuovo **e** `operator_invite_orphan` risponde `true`; `existing_confirmed` → nessun `inviteUserByEmail`, `resetPasswordForEmail` con lo stesso `redirectTo`, password casuale solo se `existing_has_password`; reinvio: `operator_resend_finish` riceve `requested_by` restituito da `operator_resend_begin`, link di recupero se `email_confirmed`; annullamento: `deleteUser` solo con `operator_cancel_check` vero, altrimenti 409 `not_invited`; `redirectTo` dall'`Origin`, mai dal corpo; nessuna email nei log |
| Integrazione (Vitest + stack locale + `functions serve` + Mailpit) | invito reale: una email, un profilo `invited`, metadati corretti; stesso `operation_id` due volte (anche in parallelo) → una sola email e un solo profilo; reinvio → token vecchio `otp_expired`; token d'invito verificato senza salvare la password → la persona resta `invited` e il reinvio le manda un link che funziona; annullamento → il link già spedito non funziona più e il profilo è `removed`, un nuovo invito con lo stesso nome lo ricollega; operatore → 403; email di un dispositivo → `email_is_device`; token `anon` → 401/403 senza effetti |
| Componenti (Vitest + fake) | elenco, stati, "(tu)" senza azioni, PIN solo nel layout tablet; dialoghi di conferma; dialogo persona (ruolo, reinvio solo `invited`); modulo: validazioni, `busy`, reinvio con lo stesso `operation_id` dopo rete e nuovo id se i campi cambiano; ogni errore della tabella del punto 6; `AdminsOnly` per l'operatore; `ResetPasswordPage` invito: testi dal frammento, valori non validi → testi generici, un nome che contiene "error" (es. "Terrore") non fa scadere il link, chiave `error`/`error_code` sì, link scaduto → "Vai all'accesso"; `Dialog` (guscio) e `ConfirmDialog` ricostruito, test esistenti invariati; `AdminsOnly` condiviso; layout tablet: radio "Amministratore" disabilitato con la nota; "Annulla invito" solo per `invited`; inoltro di `/?type=invite` con frammento; controllo dell'identità al cambio di rotta per un operatore |
| E2E (Playwright, 390×844 e 1280×800) | admin invita `invito-<casuale>@example.com` → email da Mailpit → link → "Ciao, …" → password → home con il ruolo scelto; cambio ruolo e ritorno; disattivazione di `disattiva@example.com` con una seconda sessione aperta che al cambio di rotta torna su `/accedi` con il messaggio, poi riattivazione e nuovo accesso; tablet con cassiere admin: elenco con "PIN impostato/da impostare" e colonna 480 px |

Regole E2E (`fullyParallel`): account del seed riservati (`disattiva@example.com` "Disattiva Prova",
`ruolo@example.com` "Ruolo Prova", operatori; `admin-operatori@example.com` "Admin Operatori", admin), nessun
altro test li usa; i nomi e le email degli invitati sono casuali per esecuzione; gli E2E che cambiano questi
account ripristinano lo stato iniziale; il tablet usa un dispositivo del seed riservato (`cassa-operatori@example.com`,
RUNBOOK trappola 47). Solo `@example.com`.

## Boundaries

- **Always**: ogni controllo di ruolo e ogni regola (ultimo admin, sé stessi, unicità, dispositivo) sul server;
  chiave segreta solo nell'ambiente dell'Edge runtime; `redirectTo` dall'origine ammessa; prova sullo staging
  prima della produzione; solo `@example.com` nei test e nel seed; profili mai cancellati.
- **Ask first**: durata del link d'invito diversa da un'ora (cambia anche il recupero); alzare il limite di
  email online; bloccare (`ban`) gli utenti di Auth alla disattivazione; gestione dei dispositivi dall'app;
  cambio email di un account; nuovi ruoli.
- **Never**: chiave segreta o `service_role` nell'app, in Vercel, nei log o nel repo; autorizzazioni basate su
  `user_metadata`; email nell'URL dell'invito o nei log; cancellare o modificare movimenti; azioni di un
  amministratore su sé stesso dalla schermata; `supabase config push`; dati veri nei fixture.

## Success Criteria

1. Un amministratore sul telefono invita una persona con nome, email e ruolo; arriva **una** email (Mailpit in
   locale, `info@enjoygaeta.it` sullo staging) e nell'elenco compare "… · invito inviato".
2. Dal link la persona vede "Ciao, {nome}" e "{chi} ti ha invitato come {ruolo}…", sceglie la password, entra
   con il ruolo scelto; nell'elenco passa ad "attivo". Nessuno ha usato la dashboard di Supabase o lo SQL Editor.
3. Doppio tocco e reinvio dopo un errore di rete con lo stesso `operation_id` producono una sola email e un solo
   profilo (integrazione, anche con due richieste in parallelo).
4. Nome già usato, email già di un account, email del tablet: rifiutati con il testo del punto 6, nessuna
   email partita; un 429 di Auth mostra "Troppe email inviate…" senza errori non gestiti (unità + componente).
5. Un operatore, un dispositivo senza cassiere o con cassiere operatore, e una chiamata con la chiave `anon` non
   ottengono né elenco né inviti né modifiche (pgTAP + integrazione); la chiave segreta non compare in `dist/`,
   in `src/` né nel repo (controllo nello script dei criteri).
6. Cambio di ruolo dall'app vale subito sul server; la persona collegata vede le impostazioni del nuovo ruolo al
   cambio di rotta successivo.
7. Disattivare: dalla transazione successiva il token della persona non legge nulla e ogni scrittura è
   rifiutata; il suo telefono torna su `/accedi` con il messaggio al cambio di rotta o al ritorno in primo piano;
   il suo turno sul tablet finisce; i movimenti restano identici. Riattivare restituisce l'accesso con la stessa
   password.
8. Il bar non resta mai senza un amministratore attivo: nessuna azione su sé stessi, `EO001` sull'ultimo, corsa
   tra due amministratori risolta senza restare a zero (integrazione).
9. "Reinvia invito" solo per chi non ha accettato; il link precedente diventa `otp_expired`.
10. Sul tablet (1280×800) con cassiere amministratore la schermata ha elenco e colonna "Invita operatore" da
    480 px, stati con PIN e "(tu)" sul cassiere; nessuno scorrimento orizzontale, target ≥ 48 px; un
    amministratore non si invita né si promuove da lì (`EO005`, pgTAP + componente).
11. Schermate conformi ai wireframe a 390×844 con le deviazioni dichiarate (dialogo persona, "Riattiva",
    "Reinvia invito", "Annulla invito", stato "invito inviato", niente campo Email in `/imposta-password` (come
    nel recupero), radio "Amministratore" disabilitato nel layout tablet); detector Impeccable pulito; nota di `/accedi` del wireframe.
12. CI verde con pgTAP, unità, integrazione con la funzione servita in locale, E2E telefono e tablet; deploy e
    prova reale sullo staging documentati ed eseguiti prima della produzione.

## Out of Scope (Deferred)

- Cambio dell'email di un account: non richiesto. Un invito non ancora accettato partito verso l'indirizzo
  sbagliato si annulla ("Annulla invito", punto 5) e si rimanda con lo stesso nome; per un account già attivo
  resta la dashboard.
- Gestione dei dispositivi (tablet) dall'app: resta `private.add_device` (`tablet-kiosk`).
- Blocco (`ban`) dell'utente in Auth e chiusura delle sue sessioni alla disattivazione: vedi Open Questions 3.
- Email di notifica "sei stato disattivato" o "il tuo ruolo è cambiato": l'app non manda email oltre a invito e
  recupero.
- Amministratore che imposta il PIN di altri (regola di `tablet-kiosk`).

## Open Questions

Ognuna ha un default già adottato; serve il titolare solo dove indicato.

1. **Comando "cambia ruolo", "reinvia invito" e "annulla invito"** (il wireframe non li mostra), e campo Email
   di `/imposta-password` (il wireframe lo mostra in sola lettura). Default: nome e stato della riga aprono un
   dialogo con ruolo, "Reinvia invito" e "Annulla invito" (questi due solo per `invited`); niente campo Email,
   perché l'email si conosce solo dopo la verifica del token e non viaggia mai nell'URL; promozione e retrocessione chiedono conferma; il ruolo di
   una persona disattivata si cambia solo dopo averla riattivata. Deviazione dichiarata.
2. **"Riattiva"** (il wireframe mostra Sara disattivata senza azioni). Default: pulsante "Riattiva" sulla riga,
   con conferma, come chiesto dal titolare il 2026-11-22.
3. **Bloccare anche l'account in Auth alla disattivazione** (`ban_duration` con la chiave segreta, sblocco alla
   riattivazione). Default: **no** — la disattivazione resta una RPC atomica e immediata nel database, che già
   toglie ogni lettura e scrittura; il ban passerebbe dalla funzione, con due sistemi da tenere allineati e un
   caso di errore in più. Conseguenza: la persona disattivata può ancora fare l'accesso a Supabase (e cambiare
   la password) ma l'app la rimanda subito su `/accedi` e il server non le dà nulla. Da chiedere solo se il
   titolare vuole che una persona disattivata non possa nemmeno entrare.
4. **Invito con il nome di un profilo `removed`** (account cancellato dal pannello). Default: ricollega il
   profilo, come `add_operator` (la persona ritrova storico e nome). Alternativa: rifiutare con "Nome già usato".
5. **Ordine dell'elenco** (il wireframe mostra Giulia, Andrea, Marco, Sara senza regola). Default: alfabetico,
   disattivati in fondo.
6. **Messaggio per chi viene disattivato mentre è collegato** (nota n6). Default: il testo V1 "Account non
   abilitato: chiedi a un amministratore." (nessun nuovo stato in `get_session_identity`). Alternativa: "Il tuo
   account è stato disattivato: chiedi a un amministratore." distinguendo i due casi sul server.
7. **Invito scaduto**. Il link vale un'ora (`otp_expiry` 3600, condiviso con il recupero; verificato). Default:
   un'ora; la persona chiede un nuovo invito e l'amministratore usa "Reinvia invito"; "Password dimenticata"
   non serve a chi non ha mai accettato. Allungarlo (massimo 24 ore) cambierebbe anche il link di recupero:
   **da chiedere al titolare** se un'ora è troppo poco per i camerieri.
8. **Invito con le iscrizioni chiuse sui progetti online**. Verificato in locale (GoTrue v2.198.0): funziona.
   `docs/setup-accounts.md` §4 dice che "Invite user" della dashboard risponde "Signups not allowed", senza
   prova registrata. Default: si verifica nella prova sullo staging (note di deploy, passo 6); se online fosse
   rifiutato, ripiego nella funzione: `auth.admin.createUser({ email, email_confirm: false, user_metadata })`
   seguito da `inviteUserByEmail` sull'utente già creato (stessa email, stesso template), da verificare allora.
9. **Testi non presenti nei wireframe** (conferme, errori, messaggi d'esito, testi generici di
   `/imposta-password` senza il campo Email del wireframe, oggetto e corpo dell'email). Default: quelli di questa spec, nello stile «Stati, errori e
   conferme» del design system; si rivedono con gli altri prima del lancio (`cross-review.md` §3, punto 2).
10. **Ruolo nel testo dell'invito dopo un cambio di ruolo** di una persona `invited`. Default: l'email già
    partita resta col ruolo vecchio; vale quello del server all'accesso; "Reinvia invito" manda il testo
    aggiornato.
11. **Amministratori dal tablet** (il wireframe "Tablet: operatori" mostra la schermata completa, con il ruolo
    "Amministratore" nel modulo). Default: **no** — da un dispositivo, anche con cassiere amministratore, non si
    invita un amministratore, né si promuove qualcuno ad amministratore, né si riattiva un amministratore
    disattivato (`EO005`, radio disabilitato o "Riattiva" assente, con la nota). Motivo: turno di 12 ore senza chiusura per inattività e PIN di 4 cifre indovinabile in pochi giorni
    (SPEC-tablet-kiosk, Open Questions 1 e 2); senza questa regola chi trova il tablet sbloccato da un titolare
    otterrebbe un accesso amministratore permanente e da remoto (dati dei clienti, export, annullamenti).
    Restano sul tablet elenco, inviti di operatori, retrocessioni, disattivazioni, riattivazioni di operatori,
    reinvii e annullamenti. Rischio residuo da conoscere: un invito come **operatore** con la propria email dà comunque
    accesso da remoto da operatore. Alternative: chiedere di nuovo il PIN dentro la RPC (stesso contatore di
    blocco di `unlock_cashier`), oppure nessun invito dal tablet. **Da chiedere al titolare.**
12. **Quando un invito è accettato** (emerso dai test sullo stack reale: GoTrue dà una password temporanea
    casuale a chi verifica il token d'invito, quindi "email confermata e password" del punto 2 leggeva
    `active` chi aveva solo aperto il link, e chi aveva un utente creato dalla dashboard con una password).
    Default: colonna `app.operators.invite_accepted_at`, impostata da un trigger su `auth.users` al primo
    cambio di password con l'email già confermata (la password scelta dalla persona); `operator_invite_finish`
    collega con `null`, `add_operator` (account fatti a mano, V1) la imposta se l'utente ha già email
    confermata e password; i profili esistenti la ricevono dalla migrazione. Effetti: chi ha solo aperto il
    link resta "invito inviato", "Reinvia invito" gli manda il link di recupero e "Annulla invito" resta
    possibile; non conta per `EO001`. Una password impostata da un amministratore dalla dashboard su un
    invitato conta come accettazione. Alternativa: una RPC chiamata dall'app dopo `updatePassword` (dipende
    dal client; se fallisce dopo il salvataggio la persona resta `invited`).
