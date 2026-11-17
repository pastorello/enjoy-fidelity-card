# Spec: tablet-kiosk — fase 3

Status: approvata (2026-11-17) su delega dell'utente — le Open Questions adottano i default proposti, da rivedere con il titolare (`docs/specs/cross-review.md` §3)
Modulo: `tablet-kiosk` ([CAPABILITY-MAP.md](CAPABILITY-MAP.md)) · Dipende da: `identity`, `card-input`,
`settings`, `customers`, `cards`, `rewards`, `ledger`, `export` · Fonti: specifiche ("Ruoli e account",
"Architettura", "Fasi"), wireframe della pagina "Tablet con lettore USB" (Tablet-* e "Tablet: cambio
operatore") con le note nt1–nt3, `CLAUDE.md`, `brain/DECISIONS.md` (account di dispositivo distinto dagli
operatori; lettore USB generico con formato configurabile), `SPEC-settings.md` (il campo "Formato del
lettore USB" lo aggiunge questo modulo), `SPEC-card-input.md` (adattatore USB, `CardReadPanel mode="usb"`).

> **Differenza da `SPEC-identity.md`**: identity annunciava il PIN come colonna di `app.operators`. Qui
> l'hash del PIN sta in una tabella dello schema `private`, mai esposta dall'API: `app.operators` è
> leggibile da tutti gli operatori attivi e una colonna in più sarebbe esposta per errore.
>
> **Differenza da `CONTRACT.md`**: una rotta nuova anche sul telefono, `/impostazioni/pin` (il contratto
> elenca solo le rotte del telefono già note); nessuna tabella, RPC o rotta del contratto cambia nome.

## Objective

Il tablet della cassa (BESTTAB A20, 1280×800 punti in orizzontale, senza NFC) diventa una postazione
condivisa: accede **una volta** con l'account del bar (account di dispositivo) e chi sta alla cassa si
alterna con il **PIN personale di 4 cifre**. Spese e riscatti fatti dal tablet sono registrati a nome di
chi è alla cassa. Le card si leggono con un lettore NFC USB in emulazione tastiera.

**Utenti**: amministratori e operatori alla cassa; chi gestisce Supabase crea l'account di dispositivo.
**Successo**: dal tablet, "Chi è alla cassa?" → PIN → card sul lettore → spesa confermata in meno di
10 secondi, con l'operatore giusto nel movimento; senza PIN valido il tablet non legge né scrive nulla.

## Cosa include

1. **Account di dispositivo** (procedura manuale, come gli operatori, in `docs/setup-accounts.md`):
   1. Supabase → Authentication → Users → *Create new user* (email del tipo `cassa@…`, password lunga,
      *Auto Confirm User*);
   2. SQL Editor: `select private.add_device('<email>', 'Tablet cassa');`.
   Lo si toglie cancellando l'utente (`user_id` torna null: il dispositivo resta senza account e nessuno
   può più agire come suo cassiere). Un utente Auth è **o** operatore **o** dispositivo: `add_device`
   rifiuta un utente collegato a un operatore e `add_operator` (identity) viene aggiornata per rifiutare un
   utente collegato a un dispositivo. Più dispositivi sono ammessi, ognuno con il proprio cassiere.
2. **Accesso sul tablet** (`/accedi`, wireframe "Tablet: accesso"): stessa pagina di identity con layout
   tablet e la nota "Sul tablet della cassa si accede una volta con l'account del bar; poi ognuno si
   alterna con il proprio PIN." (mostrata solo nel layout tablet). Il link "Password dimenticata?" è quello
   di `identity-password` e vale anche per l'account del bar. Dopo l'accesso con un account di
   dispositivo → `/cassa`; con un account operatore → `/` come oggi.
3. **Chi è alla cassa?** (`/cassa`, wireframe "Tablet: cambio operatore"): intestazione senza cassiere e
   senza pulsante account; a sinistra titolo "Chi è alla cassa?", gruppo `aria-label="Operatori"` a 3
   colonne di pulsanti `aria-pressed` (iniziale nel cerchio, nome, ruolo "Amministratore"/"Operatore") degli
   operatori collegati, e il testo "Sul tablet condiviso si cambia operatore con il PIN personale di 4
   cifre. Spese e riscatti vengono registrati a nome di chi è alla cassa."; a destra (480 px)
   `<aside aria-label="PIN">` con "PIN di <nome>", 4 pallini (`role="img"`, `aria-label` "N cifre su 4
   inserite"), tastierino `aria-label="Tastierino PIN"` 1–9, 0 e "Cancella ultima cifra" con tasti alti
   88 px, nota "Dopo 5 PIN errati il cambio si blocca per qualche minuto."
   - Ordine degli operatori e selezione iniziale: vedi Open Questions 11 (alfabetico; nessuno scelto,
     pannello "Tocca il tuo nome" con tastierino disabilitato). Scegliere un altro nome svuota il PIN.
   - La verifica parte da sola alla quarta cifra. Il PIN si inserisce **solo toccando** il tastierino: su
     questa pagina **ogni** `keydown` si ferma (`preventDefault`) in fase di cattura, così né le cifre né
     l'Invio del lettore USB entrano nel PIN o premono il pulsante a fuoco (il tablet non ha tastiera:
     il lettore è l'unica fonte di tasti).
   - Stati (testi proposti, non nei wireframe: Open Questions 12): *caricamento* (`StatusView`); *nessun
     operatore con PIN* ("Nessuno ha ancora impostato il PIN: ognuno lo imposta dal proprio telefono, in
     Impostazioni"); operatore *senza PIN* mostrato disabilitato con "PIN da impostare dal telefono"
     (dicitura del wireframe "Tablet: operatori"); *PIN errato* (pallini svuotati, "PIN errato. Tentativi
     rimasti: N"); *bloccato* (tastierino disabilitato, "Troppi tentativi: riprova tra m:ss", conto alla
     rovescia dai secondi restanti dati dal server, non dall'orologio del tablet); *errore di rete*
     ("Connessione assente. Riprova.", PIN svuotato, nessun reinvio automatico, nessun dato salvato in
     locale).
   - Su `/cassa` la lettura card è **spenta**: senza cassiere `app.settings` non è leggibile, quindi
     `card-input` tiene spento l'adattatore USB (nessun `CardReaderSession` montato, vedi punto 8).
   - PIN corretto → home `/` del tablet. Un operatore (account personale) che apre `/cassa` va su `/`.
4. **Cassiere nell'intestazione**: nelle schermate del tablet con intestazione (tutte tranne accesso,
   `/cassa`, "Spesa registrata" e "Premio riscattato", che nei wireframe non ce l'hanno) l'header mostra il
   link "Alla cassa: <nome> · Cambia" (iniziale nel cerchio, alto 48 px) e il pulsante account (iniziale,
   `aria-label` "Account e impostazioni: <nome>") che apre Impostazioni. Toccare "Cambia" **chiude il turno
   sul server** (`end_cashier_turn`) e porta a `/cassa`; ciò che non era stato confermato si perde, come con
   "Indietro". Se la chiamata fallisce si va comunque a `/cassa`: il client considera il turno finito e il
   prossimo sblocco sostituisce il cassiere sul server.
5. **Il cassiere sul server**: lo sblocco salva sul dispositivo il cassiere scelto; ogni scrittura fatta
   dall'account di dispositivo lo registra come operatore. Il turno finisce con "Cambia", con un nuovo
   sblocco, quando il cassiere cambia PIN o perde l'account, quando il dispositivo esce, oppure dopo
   **12 ore** dallo sblocco. A turno finito il server non restituisce righe (RLS) e rifiuta ogni scrittura
   con gli errori che i moduli già usano per "nessun operatore" (`42501` in `ledger` e `settings`,
   `not_operator` in `customers`, ecc.: **nessun codice nuovo**).
   - Poiché una lettura a turno finito restituisce 0 righe e non un errore, il client **non** si fida solo
     degli errori: su un dispositivo rilegge `get_session_identity()` a ogni cambio di rotta, al ritorno in
     primo piano (`visibilitychange`) e a ogni rifiuto "nessun operatore"; e programma il ritorno a
     `/cassa` all'ora `turn_expires_at` data dal server. Cassiere assente o scaduto → `/cassa` con "Turno
     scaduto: inserisci di nuovo il PIN"; sessione senza dispositivo né operatore → `/accedi` come in
     identity. In una sessione di dispositivo l'aggancio `reportNotEnabled()` di `AuthProvider` (usato da
     `customers` e dagli altri moduli) segue questa regola invece di portare ad `/accedi`.
6. **Blocco dopo 5 errori**: il contatore è **per dispositivo** (5 PIN errati consecutivi, su qualsiasi
   operatore) → cambio bloccato **5 minuti**; durante il blocco il PIN non viene nemmeno verificato e i
   tentativi non si contano; uno sblocco riuscito azzera il contatore. Tutto deciso sul server.
7. **PIN dal proprio telefono** (proposta: Open Questions 5; fonti: nota nt2 "Il PIN ognuno lo imposta dal
   proprio telefono" e wireframe "Tablet: operatori"): nella sezione **ACCOUNT** di Impostazioni aggiunta da
   `identity-password` (entrambi i ruoli), sotto "Cambia password", riga "PIN della cassa" con stato
   "Impostato" / "Da impostare" → `/impostazioni/pin`: tastierino come quello della cassa, "Scegli il PIN"
   poi "Ripeti il PIN"; se non coincidono "I due PIN sono diversi" e si ricomincia; salvato → "PIN salvato"
   e ritorno a Impostazioni; errore di rete → "Connessione assente. Riprova." con il PIN da reinserire. Non
   serve il PIN vecchio (la sessione del telefono è personale): chi lo dimentica ne sceglie uno nuovo. Il
   nuovo PIN chiude i turni aperti di quella persona su tutti i tablet. Un amministratore non imposta il PIN
   degli altri. In una sessione di dispositivo la riga e la pagina non esistono (`/impostazioni/pin` → `/`),
   e nemmeno "Cambia password" (cambierebbe la password dell'account del bar, non del cassiere).
8. **Lettore USB**: usa il servizio unico di `card-input` con l'adattatore tastiera (tasti in rapida
   sequenza chiusi da Invio, nessun campo sempre attivo, formato da `app.settings.usb_uid_format`, uid
   sempre da `normalizeUid()`), senza modificarlo. In una sessione di dispositivo `CardReaderSession` si
   monta solo con un turno valido (sotto la guardia del cassiere, non su `/cassa`). Lettura dalla home =
   come sul telefono (card nota → Registra spesa, sconosciuta → Nuovo cliente con card); in Nuovo cliente
   e Associa card la card letta si associa. Le schermate usano `CardReadPanel mode="usb"` con i testi dei
   wireframe ("Passa la card sul lettore" / "L'app riceve il codice dal lettore da sola, senza bisogno di
   toccare un campo. Una card nuova apre la registrazione del cliente."; Associa card "Passa la card nuova
   sul lettore"; Nuovo cliente, pannello `aria-label="Card"` "Card (facoltativa)" / "Passa una card nuova
   sul lettore per associarla adesso, oppure fallo più tardi dalla scheda."). Con un campo di testo a fuoco
   vale la regola di `card-input` (Open Question 6 di quel modulo): la raffica non viene intercettata e
   finisce nel campo; vedi Open Questions 13. Indicatore nel riquadro di Cerca: "Lettore USB pronto" invece
   di "Lettore NFC USB collegato" (un lettore in emulazione tastiera non si può rilevare); se
   `usb.lastInvalidAt` è più recente di `usb.lastReadAt` diventa "Codice non riconosciuto: controlla il
   formato del lettore in Impostazioni" (Open Questions 7).
9. **Formato del lettore USB** (delegato da `SPEC-settings.md` punto 8; non nei wireframe: Open Questions
   14): in Impostazioni, **solo in una sessione di dispositivo con cassiere amministratore**, sezione
   "LETTORE CARD" (tra GESTIONE ed ESPORTA DATI, ordine in `CROSS-REVIEW.md`) con una scelta tra "Esadecimale" (`hex`), "Esadecimale, byte invertiti" (`hex-reversed`),
   "Decimale" (`dec`), "Decimale, byte invertiti" (`dec-reversed`) e "Salva"; salva con
   `app.update_settings(p_cents_per_point, p_confirm_threshold_cents, p_usb_uid_format)` passando rapporto
   e soglia appena riletti dal server. Il controllo admin resta quello di `update_settings` (`is_admin()`
   esteso al cassiere). Vale dalla lettura successiva.
10. **Layout 1280×800**: le **stesse rotte** del telefono con layout tablet quando la finestra è almeno
    1024×600 punti (media query, non legata all'account): stessi servizi, stessi stati, stessi test di
    dominio. Unica rotta nuova per il tablet: `/cassa` (più `/impostazioni/pin` sul telefono). Dai
    wireframe:
    - Cerca: colonna "Passa la card sul lettore" (440 px) + ricerca, "Nuovo cliente", SERVITI OGGI;
    - Scheda cliente: saldo e azioni a sinistra (560 px), ultimi movimenti a destra;
    - Registra spesa e Premio libero: importo/punti a sinistra, tastierino a destra (480 px; la spesa ha
      anche "00" come sul telefono);
    - Riscatta premio: catalogo + riepilogo (400 px); Nuovo cliente: form + pannello Card (440 px);
      Catalogo premi: elenco + "Nuovo premio" (480 px); Associa card, Movimenti, Spesa/Premio registrato,
      Impostazioni: una colonna larga.
    Testi, stati e azioni di ogni schermata restano quelli dei moduli che la possiedono; questo modulo
    cambia solo impaginazione e intestazione. Azioni principali lontane dal bordo inferiore (barre di
    Android: 50–70 punti in meno, nota nt1).
11. **Ruoli sul tablet**: valgono quelli del cassiere (`useCurrentOperator()` restituisce il cassiere in una
    sessione di dispositivo, così le schermate esistenti non cambiano). Cassiere amministratore →
    Impostazioni complete (punti e controlli, catalogo premi, esporta), annullamento dei movimenti;
    cassiere operatore → Impostazioni ridotte e annullo solo della propria spesa o riscatto entro 10 s.
    Sul server gli stessi controlli passano da `is_admin()` / `acting_operator_id()` estese.
12. **Impostazioni sul tablet** (wireframe "Tablet: impostazioni"): il riquadro account mostra il
    cassiere; "Esci" chiude il turno e porta a `/cassa` (non scollega il tablet). Solo con un cassiere
    amministratore compare "Disconnetti il tablet" (proposta, non nel wireframe: Open Questions 4;
    `ConfirmDialog` pericoloso: "Per riaccedere servono email e password dell'account del bar"), che fa
    `signOut` e porta ad `/accedi`.
13. **Operatori** (wireframe "Tablet: operatori"): rinviato come sul telefono (decisione identity V1 e
    DECISIONS 2026-11-17). La riga "Operatori" in GESTIONE non c'è; operatori e dispositivi si gestiscono
    in Supabase; lo stato "PIN impostato / da impostare" si vede in "Chi è alla cassa?".
14. **Tastiera virtuale di Android**: con il lettore USB collegato Android nasconde la tastiera a
    schermo; per cercare per nome va attivata "Mostra tastiera virtuale" nelle impostazioni del tablet.
    Va nella procedura `docs/setup-tablet.md` (installazione PWA, accesso, prova del lettore e del
    formato dell'uid, densità reale dello schermo) e nel RUNBOOK.

### Modello dati e regole di accesso

```sql
-- app.devices: account di dispositivo (tablet condivisi); RLS senza policy e
-- revoke all ad authenticated/anon: nessun accesso diretto dall'API
id                   uuid primary key default gen_random_uuid()
user_id              uuid unique references auth.users(id) on delete set null
name                 text not null unique  -- es. 'Tablet cassa'
cashier_operator_id  uuid null references app.operators(id)
cashier_since        timestamptz null
failed_pin_attempts  int not null default 0 check (failed_pin_attempts between 0 and 4)
locked_until         timestamptz null
created_at           timestamptz not null default now()

-- private.operator_pins: mai esposta (schema private, nessun grant ad authenticated)
operator_id  uuid primary key references app.operators(id) on delete cascade
pin_hash     text not null          -- extensions.crypt(pin, extensions.gen_salt('bf', 8)), pgcrypto
updated_at   timestamptz not null default now()
```

- `private.current_device_id()`: il dispositivo collegato a `auth.uid()`, altrimenti null.
- `private.acting_operator_id()` (estesa con `create or replace`, stessa firma): operatore collegato →
  `current_operator_id()`; dispositivo → `cashier_operator_id` solo se il turno è valido (cassiere
  impostato, `cashier_since > now() - interval '12 hours'`, operatore ancora collegato con PIN), altrimenti
  **null**.
- `private.is_active_operator()` e `private.is_admin()` estese allo stesso modo: per un dispositivo
  valgono quelle del cassiere valido; **senza cassiere il dispositivo non legge e non scrive nulla**. Per
  gli account operatore il risultato non cambia (i test pgTAP di identity e degli altri moduli restano
  verdi). Le RPC di scrittura dei moduli non cambiano: rifiutano già quando `acting_operator_id()` è null
  o `is_admin()` è falso, e registrano `acting_operator_id()` in ogni colonna `operator_id` / `*_by`.
- RPC (`security definer`, `set search_path = ''`, `revoke execute from public, anon`, `grant execute to
  authenticated` espliciti come in `20261117230000_function_privileges.sql`):
  - `app.get_session_identity()` → `{kind: 'operator', operator}` | `{kind: 'device', device: {id, name},
    cashier: operator | null, turn_expires_at | null, lock_seconds_left}` | null. Sostituisce la lettura
    diretta del profilo in `AuthService.loadOperator` (oggi una `select` su `app.operators`, che per un
    dispositivo darebbe "Account non abilitato" e chiuderebbe la sessione).
  - `app.list_cashiers()` (solo dispositivi, anche senza cassiere; altrimenti `42501`) → `id, name, role,
    has_pin` degli operatori collegati.
  - `app.unlock_cashier(p_operator_id, p_pin)` (solo dispositivi): blocca la riga del dispositivo
    (`for update`); se bloccato → `{status: 'locked', lock_seconds_left}`; operatore non collegato o senza
    PIN → `{status: 'no_pin'}`; PIN sbagliato → incrementa il contatore (al 5° imposta `locked_until =
    now() + 5 min` e azzera il contatore) → `{status: 'wrong_pin', attempts_left}` o `'locked'`; giusto →
    imposta cassiere e `cashier_since`, azzera → `{status: 'ok', cashier, turn_expires_at}`.
    **Restituisce, non solleva eccezioni**, così l'incremento del contatore non viene annullato dal
    rollback. PIN non di 4 cifre = errore di input (`22023`), non conta come tentativo.
  - `app.end_cashier_turn()` (solo dispositivi): azzera il cassiere; idempotente.
  - `app.set_my_pin(p_pin)` (solo operatori collegati, mai dispositivi: `42501`): `^[0-9]{4}$` (altrimenti
    `22023`), salva l'hash (upsert), chiude i turni di quella persona su tutti i dispositivi; idempotente.
  - `private.add_device(email, name)`: come `add_operator`, `revoke execute` da `public, anon,
    authenticated, service_role`: la esegue solo `postgres` dal SQL Editor.
- `app.operators` non cambia; la policy di lettura resta su `is_active_operator()` (estesa).

## Commands

Nessun comando nuovo. E2E tablet nello stesso `npm run e2e` (progetto Playwright "tablet", 1280×800,
accanto al progetto "phone").

## Project Structure

```
src/features/tablet-kiosk/   → CashierPage (/cassa), CashierChip (header), PinPad, PinSettingsPage
                               (/impostazioni/pin), UsbFormatSection, KioskService (+ supabaseKioskService),
                               RequireCashier, useTabletLayout
src/features/identity/       → AuthState con lo stato "device"; loadOperator → get_session_identity;
                               RequireAuth → /cassa senza cassiere
src/test/fakeKioskService.ts → fake in memoria (PIN, blocco, scadenza)
supabase/migrations/         → *_tablet_kiosk.sql; supabase/seed.sql: cassa@example.com e
                               cassa-blocco@example.com (password di prova del seed) + PIN finti
supabase/tests/tablet_kiosk.test.sql
e2e/tablet.spec.ts; docs/setup-tablet.md
```

## Code Style

Come `identity`. I layout tablet sono varianti CSS/di composizione della stessa pagina, scelte da
`useTabletLayout()`; nessuna logica di dominio duplicata. Il PIN non finisce mai in log, URL o storage.

```ts
export type UnlockResult =
  | { status: 'ok'; cashier: Operator; turnExpiresAt: Date }
  | { status: 'wrong-pin'; attemptsLeft: number }
  | { status: 'locked'; lockSecondsLeft: number }
  | { status: 'no-pin' }
  | { status: 'network' };
```

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP | dispositivo senza cassiere: 0 righe da ogni tabella/vista `app`, `record_purchase`, `create_customer`, `update_settings` e le altre RPC di scrittura rifiutate; `list_cashiers` funziona senza cassiere e rifiuta un operatore; con cassiere il movimento ha `operator_id` del cassiere e `customers.created_by` pure; `is_admin()` segue il ruolo del cassiere (`update_settings` ok con cassiere admin, `42501` con cassiere operatore); per un account operatore `acting_operator_id()`/`is_admin()` invariati; 5 errori → `locked`, poi nessuna verifica (anche con PIN giusto) fino a `locked_until`; contatore persistito dopo un errore (riletto in una nuova transazione); successo azzera; turno oltre 12 h (`cashier_since` spostato indietro) → null; cassiere con utente cancellato → null; `set_my_pin` rifiuta dispositivi e PIN non validi, chiude i turni; hash bcrypt (mai il PIN in chiaro); `operator_pins` e `devices` non leggibili né scrivibili da `authenticated`; `add_device`/`add_operator` si escludono e solo `postgres` li esegue |
| Componenti (Vitest + fake) | `CashierPage` (selezione e cambio nome, auto-invio alla 4ª cifra, `keydown` fermati incluso Invio con un tasto a fuoco, errato, bloccato con conto alla rovescia dai secondi del server, rete, nessun PIN, operatore senza PIN disabilitato); `CashierChip` (anche con `end_cashier_turn` fallito → `/cassa`); `RequireAuth`/`RequireCashier`: device senza cassiere → `/cassa`, turno scaduto al cambio di rotta e all'ora di scadenza → `/cassa` con "Turno scaduto…", `reportNotEnabled()` su dispositivo → `/cassa`, su operatore → `/accedi` (regressione identity); `PinSettingsPage` (ripetizione diversa, salvato, rete; assente su dispositivo); Impostazioni su dispositivo senza "Cambia password" e "PIN della cassa", "Disconnetti il tablet" solo con cassiere admin; `UsbFormatSection` solo con cassiere admin; layout tablet con `matchMedia` finto |
| E2E (Playwright, Supabase locale) | telefono 390×844: impostare il PIN da Impostazioni e, nello stesso test, usarlo sul tablet e vedere chiuso il turno precedente di quella persona; tablet 1280×800: accesso con `cassa@example.com` → `/cassa` → PIN → card letta con `page.keyboard` (sequenza rapida + Invio, adattatore USB reale) e con `__enjoyFakeCard` → spesa → nel movimento c'è il cassiere; "Cambia" → `/cassa`; 5 PIN errati → bloccato (con `cassa-blocco@example.com`, per non bloccare il dispositivo degli altri test); card passata su `/cassa` senza effetti; i test del progetto "phone" invariati |

## Boundaries

- **Always**: ogni controllo (PIN, blocco, turno, ruolo) sul server; PIN solo come hash bcrypt;
  `acting_operator_id()` in ogni scrittura; layout tablet provati a 1280×800; solo account `@example.com`
  e PIN finti nel seed e nei test.
- **Ask first**: cambiare durata del blocco o del turno; PIN più lunghi; inattività che chiude il turno;
  schermate di gestione operatori o dispositivi nell'app; modifiche all'adattatore USB di `card-input`.
- **Never**: PIN in chiaro, nei log o nel `localStorage`; verifica del PIN nel client; scritture o letture
  dell'account di dispositivo senza cassiere; amministratore che imposta il PIN di altri.

## Success Criteria

1. Un dispositivo creato con `private.add_device` accede dal tablet e vede solo `/cassa`; con il suo token
   e nessun cassiere, ogni `select` su tabelle e viste `app` restituisce 0 righe e ogni RPC di scrittura
   fallisce (pgTAP).
2. Dopo il PIN giusto una spesa registrata dal tablet ha `operator_id` = cassiere, e l'header mostra
   "Alla cassa: <nome> · Cambia"; toccarlo azzera il cassiere sul server.
3. 5 PIN errati consecutivi bloccano il cambio per 5 minuti anche ricaricando l'app; il 6° tentativo, pur
   giusto, è rifiutato fino alla scadenza.
4. Un operatore imposta il PIN dal telefono e lo usa subito sul tablet; cambiandolo, il suo turno aperto
   sul tablet finisce e il tablet torna a `/cassa` al cambio di rotta successivo.
5. Card letta col lettore USB dalla home: nota → Registra spesa; sconosciuta → Nuovo cliente con card;
   card passata su `/cassa`: nessun cambio di schermata e nessuna cifra nel PIN.
6. Card → spesa confermata < 10 s sul tablet (E2E cronometrato dalla lettura alla conferma, rete locale).
7. A 1280×800 ogni schermata della pagina tablet dei wireframe ha le colonne e le larghezze indicate al
   punto 10, nessuno scorrimento orizzontale e target ≥ 48 px (verificati in E2E); detector Impeccable
   pulito; nessuna regressione degli E2E a 390×844.
8. CI verde con pgTAP, componenti ed E2E telefono + tablet.

## Out of Scope (Deferred)

- Schermata Operatori (anche tablet: elenco con stato, "Disattiva", "Invita operatore" e invito via email),
  riga "Operatori · Account, ruoli, inviti e PIN" in GESTIONE, gestione dispositivi dall'app: rinviati
  come in identity (DECISIONS 2026-11-17).
- Lettura NFC sul tablet senza lettore USB; lettori PC/SC (scartati in DECISIONS).
- Chiusura del turno per inattività; PIN di lunghezza diversa da 4.
- Intercettare le raffiche del lettore dentro i campi di testo (regola di `card-input`; vedi Open Questions 13).

## Open Questions

1. Durata del blocco. Proposta: 5 minuti, contatore per dispositivo, azzerato dal successo (default
   adottato). Nota: 5 tentativi ogni 5 minuti sono circa 1 440 al giorno su 10 000 PIN possibili: chi ha
   il tablet in mano indovina il PIN di un amministratore in pochi giorni di tentativi continui; in
   alternativa blocchi crescenti (5, 15, 60 minuti).
2. Durata del turno. Proposta: nessun blocco per inattività, turno valido 12 ore dallo sblocco (default
   adottato). Conseguenza: se chi è alla cassa si allontana senza "Cambia", chiunque registra a suo nome.
3. Rotte. Proposta: stesse rotte con layout tablet da 1024×600 punti, più `/cassa` (default adottato).
4. "Esci" in Impostazioni sul tablet. Proposta: chiude il turno; "Disconnetti il tablet" (non nel
   wireframe) solo con cassiere amministratore, con conferma (default adottato).
5. Impostazione del PIN. Proposta: Impostazioni → ACCOUNT → "PIN della cassa" (nessun wireframe del
   telefono la mostra), due inserimenti, nessun PIN vecchio richiesto, nessun divieto di PIN semplici
   (default adottato).
6. Dopo lo sblocco. Proposta: si va alla home, non alla schermata lasciata (default adottato).
7. Indicatore del lettore. Proposta: "Lettore USB pronto" invece di "Lettore NFC USB collegato" (non
   rilevabile), mostrato nel riquadro di Cerca e non nell'intestazione di `/cassa`, dove la lettura è spenta;
   avviso "Codice non riconosciuto…" dopo una lettura non valida (default adottato).
8. Nuovo PIN. Proposta: chiude i turni aperti di quella persona su tutti i tablet (default adottato).
9. Hash del PIN in `private.operator_pins` invece che colonna di `operators` (vedi nota iniziale). Proposta:
   tabella privata (default adottato).
10. Modello e formato del lettore USB e densità reale del tablet: da verificare all'acquisto (bloccante per
    la fase, non per la spec).
11. Ordine e selezione in "Chi è alla cassa?". Il wireframe mostra Giulia, Andrea, Marco con Giulia già
    scelta, senza una regola. Proposta: ordine alfabetico, nessuno scelto all'apertura, pannello "Tocca il
    tuo nome" con tastierino disabilitato (default adottato).
12. Testi degli stati di `/cassa` (PIN errato con tentativi rimasti, bloccato con conto alla rovescia, nessun
    PIN, rete, "Turno scaduto: inserisci di nuovo il PIN"): non nei wireframe. Proposta: quelli del punto 3
    e 5 (default adottato).
13. Card passata con un campo di testo a fuoco (es. la ricerca dopo aver scritto un nome). Con la regola di
    `card-input` il codice finisce nel campo e l'Invio avvia una ricerca senza risultati; l'operatore tocca
    fuori e ripassa la card. Proposta: tenere la regola (default adottato); in alternativa, solo sul tablet,
    intercettare anche nei campi le raffiche < 50 ms chiuse da Invio e togliere dal campo i caratteri
    arrivati (modifica a `card-input`).
14. Formato del lettore nell'interfaccia: nessun wireframe. Proposta: sezione "LETTORE CARD" in
    Impostazioni, visibile solo sul tablet con cassiere amministratore (default adottato).
