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
   up**. Gli account li crea solo un amministratore.
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

## 3. Vercel

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

## 4. Fatto? Avvisa

Mandami l'URL dell'anteprima di una PR: verifico console pulita, intestazioni di sicurezza, Lighthouse
(PWA installabile, Accessibilità ≥ 95, Best Practices ≥ 95) e l'installazione su Android.
