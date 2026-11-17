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
2. **Exposed schemas**: aggiungi `app` (lascia `public`) e salva.

Senza questo passo l'accesso fallisce anche con email e password giuste e la rete funzionante: l'app
dice "Connessione assente: controlla la rete e riprova." perché non riesce a leggere il profilo.

## 4. Operatori e amministratori

Nella V1 gli account si creano a mano dal pannello di Supabase: niente inviti dall'app. Le email di
Supabase Auth partono da `info@enjoygaeta.it` (configurato dal titolare su entrambi i progetti), ma la
procedura qui sotto non ne manda nessuna. Usa sempre email e nomi veri solo nella dashboard, mai in questo
repository.

### Registrare un operatore (anche il primo amministratore)

1. **Authentication → Users → Add user → Create new user**: email e password della persona, con
   **Auto Confirm User** attivo (così l'account è subito utilizzabile e non parte nessuna email).
   Comunica la password di persona, non per messaggio.
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

Finché non arriva "Password dimenticata" nell'app (spec aggiuntiva dopo la V1): cancella l'utente,
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

## 6. Fatto? Avvisa

Mandami l'URL dell'anteprima di una PR: verifico console pulita, intestazioni di sicurezza, Lighthouse
(PWA installabile, Accessibilità ≥ 95, Best Practices ≥ 95) e l'installazione su Android.
