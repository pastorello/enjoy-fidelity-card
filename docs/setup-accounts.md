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

Nella V1 gli account si creano a mano dal pannello di Supabase: niente inviti dall'app. Le email di
Supabase Auth partono da `info@enjoygaeta.it` (configurato dal titolare su entrambi i progetti), ma la
procedura qui sotto non ne manda nessuna. Usa sempre email e nomi veri solo nella dashboard, mai in questo
repository.

### Registrare un operatore (anche il primo amministratore)

1. **Authentication → Users → Add user → Create new user**: email e password della persona, con
   **Auto Confirm User** attivo (così l'account è subito utilizzabile e non parte nessuna email).
   Comunica la password di persona, non per messaggio; oppure usa una password lunga e casuale che non
   comunichi a nessuno e, dopo il passo 2, scegli **Send password recovery** dalla riga dell'utente: la
   persona riceve la mail e sceglie da sola la password su `/imposta-password`.
   Non usare "Send magic link" né "Invite user": con le iscrizioni chiuse rispondono "Signups not allowed
   for this instance", ed è giusto così (nessuno deve potersi creare un account da solo).
2. **SQL Editor**, con una nuova query:

   ```sql
   select private.add_operator('<email>', '<nome>', 'admin');     -- titolare
   select private.add_operator('<email>', '<nome>', 'operator');  -- cameriere
   ```

   Il nome è quello che compare nell'app e nello storico dei movimenti: deve essere unico (per gli
   omonimi aggiungi un dettaglio, es. "Marco B."). La funzione restituisce l'id del profilo; se l'email non
   esiste o è già collegata a un altro profilo, si ferma con un errore che lo spiega.
3. La persona accede dal telefono su `/accedi` con email e password.

Per **cambiare ruolo** si richiama `private.add_operator` con la stessa email, lo stesso nome e il ruolo
nuovo.

### Togliere un operatore

**Authentication → Users** → menu della riga → **Delete user**. Il profilo resta, scollegato, perché il
suo nome serve nello storico; da quel momento l'app su quel telefono torna su `/accedi` con "Account non
abilitato" e il suo accesso non legge più nulla. Il profilo non si cancella mai.

### Rimettere un operatore

Ricrea l'utente (passo 1 sopra) e richiama `private.add_operator` con **lo stesso nome** di prima: il
profilo viene ricollegato con il suo storico.

### Password dimenticata

La persona se la reimposta da sola dall'app: su `/accedi` tocca **"Password dimenticata?"**, riceve un link
via email e sceglie una password nuova (chi è collegato usa **Impostazioni → ACCOUNT → Cambia password**,
stesso link). Serve che la sezione 6 sia stata eseguita sul progetto in uso.

Se l'email non arriva (sezione 6 non ancora fatta, casella sbagliata): come prima, cancella l'utente,
ricrealo con una password nuova e richiama `private.add_operator` con lo stesso nome, come per rimettere un
operatore.

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
