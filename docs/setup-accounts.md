# Configurare Supabase e Vercel

Guida per chi crea gli account (il titolare del progetto). Nessun segreto va scritto in questo repository:
le chiavi si incollano solo nelle schermate di Supabase e Vercel o nel file `.env` locale.

Servono due progetti Supabase (decisione del 2026-11-16 in `brain/DECISIONS.md`):

| Progetto | A cosa serve | Usato da |
|---|---|---|
| `enjoy-card-prod` | Dati veri del bar | Vercel, ambiente Production (ramo `main`) |
| `enjoy-card-staging` | Prove, dati finti | Vercel, anteprime delle PR |

## 1. Supabase: i due progetti

1. Accedi a https://supabase.com e crea un'organizzazione (piano Free).
2. **New project** → nome `enjoy-card-prod`, regione **Central EU (Frankfurt)**, una password del database
   lunga e generata a caso: salvala nel tuo gestore di password, non serve all'app.
3. Ripeti per `enjoy-card-staging`, stessa regione.
4. In **entrambi** i progetti: **Authentication → Sign In / Providers** → disattiva **Allow new users to sign
   up**. Gli account li crea solo un amministratore (sezione 4).
5. In ciascun progetto, **Project Settings → API Keys**: annota **Project URL** e **Publishable key**
   (`sb_publishable_…`). La **Secret key** non va mai nell'app né su Vercel.

Nota: sul piano Free un progetto senza attività per una settimana va in pausa. Per la produzione, usata
ogni giorno, non è un problema; lo staging si riattiva dalla dashboard.

## 2. Applicare lo schema del database

Dal computer, nella cartella del progetto:

```bash
npx supabase login                                   # apre il browser
npx supabase link --project-ref <ref-di-staging>     # il ref è nell'URL: https://<ref>.supabase.co
npx supabase db push                                 # applica supabase/migrations/
```

Poi, nello **SQL Editor** del progetto, controlla che la RLS automatica sia attiva:

```sql
select evtname, evtenabled from pg_event_trigger where evtname = 'enable_rls_on_new_app_tables';
```

Deve restituire una riga. Se `db push` fallisce sull'event trigger, fermati e avvisa: è il rischio noto
del piano `platform` (serve un'alternativa).

Solo dopo che lo staging funziona, ripeti `link` e `db push` con il ref di produzione. Ogni `db push` in
produzione si fa a mano e solo dopo una verifica su staging (RUNBOOK).

## 3. Esporre lo schema `app` (Data API)

Le tabelle dell'app stanno nello schema `app`, protetto dalla RLS. In locale lo espone `supabase/config.toml`;
nei progetti online va aggiunto a mano, in **entrambi** i progetti, dopo il primo `db push`:

1. **Project Settings → Data API** (o **Integrations → Data API → Settings**, secondo la versione della dashboard).
2. **Exposed schemas**: aggiungi `app` (lascia `public`) e salva. Il menu elenca `app` solo dopo che le
   migrazioni sono state applicate al progetto (`npx supabase db push`, sezione 2): se non c'è, manca il push.
3. Subito dopo il salvataggio, per qualche secondo l'API può rispondere con l'errore `PGRST002` mentre
   ricarica lo schema: è normale, basta attendere e riprovare.

Senza questo passo l'accesso fallisce anche con email e password giuste e la rete funzionante: l'app
dice "Servizio non configurato: chiedi a un amministratore." perché non riesce a leggere il profilo. Un
"Servizio momentaneamente non disponibile: riprova tra poco." subito dopo il salvataggio è invece il
`PGRST002` del punto 3.

## 4. Operatori e amministratori

Dal 2026-11-22 (`docs/specs/SPEC-operators.md`) gli account si creano **dall'app**: un amministratore invita
la persona dalla schermata Operatori e lei sceglie da sola la password dal link dell'email. La dashboard di
Supabase e lo SQL Editor servono solo per il **primo amministratore** (che nessuno può invitare) e come
**riserva** se l'invito dall'app non è disponibile. Le email di Supabase Auth partono da `info@enjoygaeta.it`
(configurato dal titolare su entrambi i progetti). Email e nomi veri si scrivono solo nell'app o nella
dashboard, mai in questo repository.

**Prima volta su un progetto online.** Prima che la schermata funzioni servono la migrazione
`*_operators.sql`, la Edge Function `operator-invites` e il template **Invite user** (oggetto "Enjoy Card: il
tuo invito", corpo di `supabase/templates/invite.html`): li prepara chi pubblica, seguendo le "Note di
deploy" di `docs/specs/SPEC-operators.md`, prima sullo staging e poi sulla produzione. Finché non ci sono,
l'invito risponde con un errore e si usa la riserva qui sotto.

### Il primo amministratore (e la riserva)

1. **Authentication → Users → Add user → Create new user**: email e password della persona, con
   **Auto Confirm User** attivo (così l'account è subito utilizzabile e non parte nessuna email).
   Comunica la password di persona, non per messaggio; oppure usa una password lunga e casuale che non
   comunichi a nessuno e, dopo il passo 2, scegli **Send password recovery** dalla riga dell'utente: la
   persona riceve la mail e sceglie da sola la password su `/imposta-password`.
   Non usare "Send magic link" né "Invite user" della dashboard: non collegano il profilo dell'app e, con le
   iscrizioni chiuse, la dashboard può rispondere "Signups not allowed for this instance" (l'invito dall'app
   passa dalla Edge Function; che funzioni anche online con le iscrizioni chiuse si conferma nella prova
   sullo staging delle "Note di deploy", passo 6).
2. **SQL Editor**, con una nuova query:

   ```sql
   select private.add_operator('<email>', '<nome>', 'admin');     -- titolare
   select private.add_operator('<email>', '<nome>', 'operator');  -- cameriere (solo come riserva)
   ```

   Il nome è quello che compare nell'app e nello storico dei movimenti: deve essere unico (per gli
   omonimi aggiungi un dettaglio, es. "Marco B."). La funzione restituisce l'id del profilo; se l'email non
   esiste o è già collegata a un altro profilo, si ferma con un errore che lo spiega. Ricollegando un
   profilo disattivato lo riattiva.
3. La persona accede dal telefono su `/accedi` con email e password.

Da qui in poi gli altri account li crea questo amministratore dall'app.

### Invitare un operatore o un amministratore (dall'app)

1. Sul telefono, da amministratore: **Impostazioni → GESTIONE → Operatori** (`/impostazioni/operatori`).
2. In fondo, nella sezione **Invita operatore**: **Nome** (unico, come sopra), **Email**, **Ruolo**
   ("Operatore", già scelto, oppure "Amministratore"), poi **Invia invito**. Sopra l'elenco compare "Invito
   inviato a {nome}." e la riga della persona dice "… · invito inviato".
3. La persona riceve l'email "Enjoy Card: il tuo invito" (se non arriva, guardi nello spam), tocca il
   pulsante e su `/imposta-password` vede "Ciao, {nome}", sceglie la password (almeno 8 caratteri) e tocca
   **Salva e accedi**: entra nell'app con il ruolo scelto e nell'elenco la riga diventa "attivo".
4. Il link vale **un'ora** ed è usabile una volta. Scaduto o perso: tocca il nome della persona
   nell'elenco → **Reinvia invito** (il link precedente smette di funzionare).
5. Email sbagliata: tocca il nome → **Annulla invito** → conferma; poi invita di nuovo con lo stesso nome e
   l'email giusta.

Errori che la schermata spiega da sé: nome già usato, email che ha già un account (o di una persona
disattivata: va riattivata), email dell'account del tablet, troppe email in poco tempo ("Riprova tra qualche
minuto"). Un doppio tocco o un nuovo tocco dopo un errore di rete non mandano due inviti.

### Cambiare ruolo

**Impostazioni → GESTIONE → Operatori** → tocca il nome della persona → nel dialogo scegli il **Ruolo** →
**Salva ruolo** → conferma con **Rendi amministratore** o **Rendi operatore**. Vale subito sul server; la
persona vede le impostazioni del nuovo ruolo alla schermata successiva. Il ruolo di una persona disattivata
si cambia dopo averla riattivata.

### Togliere e rimettere un operatore

- **Togliere**: nella riga della persona **Disattiva** → conferma **Disattiva**. Da subito il suo accesso
  non legge né scrive nulla, il suo telefono torna su `/accedi` con "Account non abilitato" al cambio di
  schermata o al ritorno in primo piano, e il suo turno sul tablet finisce. I movimenti restano nello
  storico con il suo nome; il profilo non si cancella mai.
- **Rimettere**: nella riga **Riattiva** → conferma **Riattiva**. La persona accede con la sua password di
  prima.

Regole controllate dal server: nessuno cambia o disattiva il proprio account dalla schermata (la propria
riga, "(tu)", non ha azioni) e resta sempre **almeno un amministratore attivo** ("Serve almeno un
amministratore attivo: prima rendi amministratore un'altra persona.").

Un utente cancellato dalla dashboard (**Authentication → Users → Delete user**, procedura della V1) resta
nell'elenco come disattivato, senza azioni: per rimetterlo lo si invita di nuovo con **lo stesso nome** di
prima, e il profilo viene ricollegato con il suo storico (come `private.add_operator`).

### Dal tablet della cassa

Con un amministratore alla cassa, **Impostazioni → GESTIONE → Operatori** mostra la stessa schermata (con
lo stato del PIN di ognuno) e la colonna **Invita operatore** a destra. Dal tablet però **non si invita né
si promuove un amministratore**: "Amministratore" è disabilitato con la nota "Un amministratore si invita
dal telefono." (lo rifiuta anche il server). Il resto (inviti di operatori, retrocessioni, Disattiva,
Riattiva, Reinvia invito, Annulla invito) si fa anche da lì. Il PIN ognuno lo imposta dal proprio telefono
(`docs/setup-tablet.md` §4).

### Password dimenticata

La persona se la reimposta da sola dall'app: su `/accedi` tocca **"Password dimenticata?"**, riceve un link
via email e sceglie una password nuova (chi è collegato usa **Impostazioni → ACCOUNT → Cambia password**,
stesso link). Serve che la sezione 6 sia stata eseguita sul progetto in uso.

Se l'email non arriva (sezione 6 non ancora fatta, casella sbagliata): come riserva, cancella l'utente,
ricrealo con una password nuova e richiama `private.add_operator` con lo stesso nome (sezione "Il primo
amministratore (e la riserva)").

### Tablet della cassa (account di dispositivo)

Il tablet condiviso della cassa (fase 3, `docs/specs/SPEC-tablet-kiosk.md` punto 1) accede **una volta** con
un account suo, l'**account del bar**, che non è di nessun operatore: chi sta alla cassa si alterna poi con
il proprio PIN di 4 cifre. Serve che la migrazione `*_tablet_kiosk.sql` sia già sul progetto (`npx supabase
db push`, sezione 2). Installazione del tablet, prova del lettore e PIN: `docs/setup-tablet.md`.

Un account Auth è **o** di un operatore **o** di un dispositivo, mai tutti e due: `private.add_device`
rifiuta un utente già collegato a un operatore e `private.add_operator` rifiuta un utente collegato a un
dispositivo. Per questo il tablet non usa mai l'account del titolare.

**Creare il dispositivo**

1. **Authentication → Users → Add user → Create new user**: un'email solo per il tablet (del tipo
   `cassa@…`, su una casella che il titolare legge: lì arriva "Password dimenticata?" dell'account del
   bar), una password lunga e casuale salvata nel gestore di password, **Auto Confirm User** attivo.
2. **SQL Editor**, con una nuova query:

   ```sql
   select private.add_device('<email>', '<nome del tablet>');   -- es. 'Tablet cassa'
   ```

   Il nome serve solo a riconoscere il dispositivo (unico, senza distinzione di maiuscole). La funzione
   restituisce l'id del dispositivo; si ferma con un errore se l'email non esiste, se l'account è di un
   operatore o se è già collegato a un altro dispositivo. Come `add_operator`, la esegue solo `postgres`
   dallo SQL Editor: nessun ruolo dell'API la può chiamare.
3. Sul tablet si accede su `/accedi` con questa email e questa password: l'app apre `/cassa` ("Chi è alla
   cassa?"). Più tablet sono ammessi, ognuno con un account e un nome suoi.

**Controllare i dispositivi** (SQL Editor; la tabella non è esposta dall'API e il PIN non c'è):

```sql
select name, user_id is not null as collegato, cashier_operator_id is not null as turno_aperto,
       locked_until
from app.devices order by name;
```

**Togliere un dispositivo** (tablet perso, rubato o sostituito): **Authentication → Users** → menu della
riga dell'account del tablet → **Delete user**. La riga del dispositivo resta, scollegata (`collegato` =
false): da subito nessuno può più agire come suo cassiere e il tablet non legge né scrive più nulla (la
sicurezza sta nella RLS, trappola 19 del RUNBOOK); l'app torna su `/accedi` alla lettura successiva
dell'identità (cambio di schermata o ritorno in primo piano). Se il tablet è stato perso, cambia anche il PIN di chi lo usava (ognuno dal
proprio telefono, `docs/setup-tablet.md` §4).

**Rimettere un dispositivo**: ricrea l'utente (passo 1) e richiama `private.add_device` con
**lo stesso nome** di prima: il dispositivo viene ricollegato.

**Cambiare la password dell'account del bar**: "Password dimenticata?" su `/accedi` del tablet (l'email
arriva alla casella del passo 1), oppure cancella e ricrea l'utente come sopra. Dal tablet non c'è "Cambia
password": in una sessione di dispositivo cambierebbe la password del bar, non quella del cassiere.

Gli operatori del tablet sono quelli di questa sezione, con il loro ruolo: non serve registrarli di nuovo.
Il PIN non si imposta qui né dallo SQL Editor (si salva solo come hash in `private.operator_pins`).

## 5. Vercel

> **Da decidere prima**: il piano gratuito *Hobby* di Vercel è riservato all'uso personale e non commerciale.
> L'app di un bar è un uso commerciale: serve il piano *Pro* (a pagamento, per utente) oppure un altro
> hosting statico che consenta l'uso commerciale gratis. Verifica le condizioni attuali su vercel.com/pricing.

1. Accedi a https://vercel.com con il tuo account GitHub.
2. **Add New → Project** → importa `pastorello/enjoy-fidelity-card`. Framework: Vite (letto da `vercel.json`).
3. **Settings → Environment Variables**:

   | Nome | Production | Preview |
   |---|---|---|
   | `VITE_SUPABASE_URL` | Project URL di prod | Project URL di staging |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key di prod | Publishable key di staging |

4. **Settings → Git**: ramo di produzione `main`. Ogni PR riceve un'anteprima con i dati di staging.
5. Ridistribuisci (Redeploy) dopo aver inserito le variabili.

## 6. Email di Auth: link per scegliere una nuova password

Serve a "Password dimenticata" e "Cambia password" (`docs/specs/SPEC-identity-password.md`, "Configurazione di Auth").
Le email partono già da `info@enjoygaeta.it` (SMTP configurato dal titolare in entrambi i progetti); qui si
impostano gli indirizzi di ritorno, il testo dell'email e le regole della password.

Si fa **dalla dashboard**, **prima sullo staging** (`enjoy-card-staging`) e, solo quando la prova del passo 5
riesce, sulla produzione (`enjoy-card-prod`). **Mai** `npx supabase config push`: porterebbe nei progetti
online i valori di `supabase/config.toml`, pensati per il computer (indirizzi `localhost`, limite di 100
email l'ora per i test).

`<team>` è lo slug del team Vercel: si legge su vercel.com nell'indirizzo del team
(`vercel.com/<team>`) o nell'URL di un'anteprima di una PR, che finisce con `-<team>.vercel.app`.
Per questo progetto il team è `lucapastorello23-2780s-projects`: nello staging l'indirizzo delle anteprime da
aggiungere è quindi
`https://enjoy-fidelity-card-*-lucapastorello23-2780s-projects.vercel.app/imposta-password`.

| Voce | Staging | Produzione |
|---|---|---|
| Site URL | `http://localhost:5173` | `https://enjoy-fidelity-card.vercel.app` |
| Redirect URLs | `http://localhost:5173/imposta-password` e `https://enjoy-fidelity-card-*-<team>.vercel.app/imposta-password` | `https://enjoy-fidelity-card.vercel.app/imposta-password` |
| Lunghezza minima della password | 8 | 8 |
| Scadenza del link (Email OTP Expiration) | 3600 secondi | 3600 secondi |

> **Lo staging non riceve mai l'URL di produzione** (né come Site URL né tra le Redirect URLs): un link di
> prova non deve portare ai dati veri. L'asterisco delle anteprime accetterebbe anche un progetto Vercel
> altrui con lo stesso nome: per questo gli account dello staging non usano mai le password della
> produzione.

Per ciascun progetto, in quest'ordine:

1. **Authentication → URL Configuration**:
   - **Site URL**: il valore della tabella, poi **Save changes**;
   - **Redirect URLs** → **Add URL**: aggiungi uno per uno gli indirizzi della tabella e salva. Se nell'elenco
     c'è altro (per esempio un indirizzo di prova), toglilo: devono restare solo quelli della tabella.
2. **Authentication → Emails** → scheda **Templates** → **Reset password**:
   - **Subject heading**: `Enjoy Card: scegli una nuova password`;
   - **Message body**: incolla tutto il contenuto di `supabase/templates/recovery.html` (dal file nel
     computer, oppure su GitHub aprendo il file e toccando *Raw*) al posto del testo predefinito, poi
     **Save changes**. Controlla che il pulsante contenga `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`
     e non più `{{ .ConfirmationURL }}`: con il testo predefinito i link si aprono come "link scaduto".
   - Nella scheda **SMTP Settings** della stessa pagina controlla che l'SMTP personalizzato sia attivo con
     mittente `info@enjoygaeta.it`: senza SMTP personalizzato Supabase non consente di cambiare i template
     e limita gli invii a pochi indirizzi.
3. **Authentication → Sign In / Providers** → riga **Email** (si apre un pannello):
   - **Minimum password length**: `8`;
   - **Email OTP Expiration**: `3600` (secondi, un'ora);
   - **Save**. Nelle versioni più vecchie della dashboard la pagina si chiama **Authentication → Providers →
     Email** e la lunghezza minima può stare in **Authentication → Policies** o **Attack Protection**.
4. **Authentication → Rate Limits**: non cambiare nulla. Il limite di email l'ora dei progetti online resta
   quello attuale (alzarlo va chiesto prima, vedi la spec).
5. **Prova reale**, con un tuo account (non uno dei camerieri), dall'ambiente del progetto appena configurato:
   - staging: apri l'anteprima di una PR (`https://enjoy-fidelity-card-…-<team>.vercel.app/accedi`),
     **Password dimenticata?**, scrivi la tua email, **Invia il link**;
   - produzione (solo dopo la prova riuscita sullo staging): la stessa cosa da
     `https://enjoy-fidelity-card.vercel.app/accedi`;
   - controlla che l'email arrivi da `info@enjoygaeta.it` con oggetto "Enjoy Card: scegli una nuova
     password" (se non arriva, guarda nello spam), che **Scegli la password** apra `/imposta-password` **sullo
     stesso ambiente** da cui l'hai chiesta, e che dopo **Salva e accedi** si entri nell'app; esci e accedi
     con la password nuova.
   - Se il link apre la home (`/?token_hash=…`) invece di `/imposta-password`, l'app inoltra lo stesso, ma
     l'indirizzo non è tra le Redirect URLs: ricontrolla il passo 1.

Se l'hosting cambia (vedi sezione 5), si aggiornano Site URL e Redirect URLs in entrambi i progetti.

## 7. Fatto? Avvisa

Mandami l'URL dell'anteprima di una PR: verifico console pulita, intestazioni di sicurezza, Lighthouse
(PWA installabile, Accessibilità ≥ 95, Best Practices ≥ 95) e l'installazione su Android.
