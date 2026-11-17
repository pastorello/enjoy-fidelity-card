# Spec: identity — V1

Status: draft (in attesa di approvazione)
Modulo: `identity` ([CAPABILITY-MAP.md](CAPABILITY-MAP.md)) · Dipende da: `platform` ·
Fonti: specifiche (sezioni "Ruoli e account", "Sicurezza e privacy", "Modello dati") e wireframe
Accedi, Imposta password, Password dimenticata, Impostazioni, Impostazioni operatore, Operatori
(link in `brain/MAP.md` §5) · Decisioni: `brain/DECISIONS.md`.

## Objective

Chi lavora al bar entra nell'app con il proprio account, e l'app sa sempre **chi** è e **che ruolo** ha.
Ogni modulo successivo usa questa base: le regole di accesso ai dati (RLS) e l'operatore salvato in ogni
movimento vengono da qui.

**Utenti**:
- **Amministratore** (titolari): invita operatori e altri amministratori, li disattiva.
- **Operatore** (camerieri): accede, esce, cambia la password.
- Il primo amministratore nasce con una procedura una tantum, perché la registrazione libera è spenta.

**Successo**: un titolare invita un cameriere dal telefono; il cameriere apre l'email, sceglie la password
ed è dentro; quando il titolare lo disattiva, quel telefono perde subito l'accesso ai dati.

## Cosa include

1. **Accesso** (`/accedi`, wireframe "Accesso"): email e password, logo Enjoy, link "Password dimenticata?",
   nota "Gli account li crea un amministratore…". Errore unico e generico per credenziali sbagliate
   ("Email o password non corretti"), senza dire quale dei due. Dopo l'accesso si torna alla pagina
   richiesta, altrimenti alla home.
2. **Sessione**:
   - persistente sul telefono (resta aperta finché non si esce);
   - tutte le pagine tranne quelle di accesso richiedono un utente collegato e **attivo**; senza sessione
     si va su `/accedi`;
   - **sessione scaduta o account disattivato**: si torna su `/accedi` con il messaggio "La sessione è
     scaduta: accedi di nuovo" oppure "Il tuo account è stato disattivato. Chiedi a un amministratore.";
   - **Esci** dalle Impostazioni chiude la sessione su questo telefono.
3. **Invito** (`/impostazioni/operatori`, wireframe "Operatori"), solo amministratori:
   - nome, email, ruolo (Operatore predefinito, oppure Amministratore) → "Invia invito";
   - un'Edge Function `invite-operator` (chiave service role solo lì) verifica che chi chiama sia un
     amministratore attivo, crea l'utente con `inviteUserByEmail` e la riga in `app.operators` nella stessa
     operazione logica (se una delle due fallisce non resta nulla a metà);
   - email già presente → errore nel campo: "Esiste già un account con questa email".
4. **Imposta password** (`/imposta-password`, wireframe "Invito: scegli la password"):
   - si arriva dal link dell'invito o del recupero;
   - mostra "Ciao, <nome>" e, per l'invito, "<amministratore> ti ha invitato come <ruolo> dell'Enjoy Card";
   - email in sola lettura, nuova password (almeno 8 caratteri) e conferma; "Salva e accedi";
   - link scaduto o già usato → schermata d'errore con "Chiedi un nuovo link" (porta a Password dimenticata).
5. **Password dimenticata** (`/password-dimenticata`): email → "Invia il link". La risposta è **sempre la
   stessa**, che l'email esista o no ("Se l'email è di un account, ti arriva un link…"), così nessuno può
   scoprire quali account esistono. Link valido un'ora. "Cambia password" nelle Impostazioni usa lo stesso
   flusso, con l'email già compilata.
6. **Impostazioni** (`/impostazioni`, wireframe "Impostazioni" e "Impostazioni operatore"):
   - riquadro account (iniziale, nome, ruolo, "Esci") e "Cambia password", per tutti;
   - per gli amministratori la voce "Operatori";
   - le altre sezioni dei wireframe (punti e controlli, catalogo premi, esportazione) le aggiungono i
     moduli `settings`, `rewards` ed `export`.
   - Il pulsante account dell'`AppShell` (iniziale nel cerchio) porta qui.
7. **Gestione operatori** (`/impostazioni/operatori`), solo amministratori:
   - elenco con nome, ruolo e stato ("attivo", "invito in attesa", "disattivato, movimenti nello storico");
   - **Disattiva** con conferma (azione pericolosa, `ConfirmDialog`). L'utente viene bloccato in Auth, le
     sue sessioni chiuse e la RLS gli nega subito i dati. I suoi movimenti restano;
   - nessuno può disattivare sé stesso ("Giulia (tu)" senza pulsante), né l'**ultimo amministratore attivo**.
8. **Primo amministratore**: funzione `private.bootstrap_first_admin(email, name)`, eseguibile solo dallo
   SQL Editor di Supabase (ruolo `postgres`). Promuove ad amministratore un utente invitato dalla dashboard
   e **si rifiuta se esiste già un amministratore**. La procedura sta in `docs/setup-accounts.md`.
9. **Email in italiano**: modelli per invito e recupero password (`supabase/templates/`, usati in locale da
   `config.toml`; in remoto si copiano nella dashboard, procedura nel RUNBOOK).

### Modello dati e regole di accesso

```sql
-- app.operators: un profilo per ogni utente di Auth che lavora al bar
id            uuid primary key references auth.users(id)
name          text not null check (length(trim(name)) between 1 and 60)
role          text not null check (role in ('admin', 'operator'))
active        boolean not null default true
invited_by    uuid references app.operators(id)
created_at    timestamptz not null default now()
deactivated_at timestamptz, deactivated_by uuid references app.operators(id)
-- L'email resta in auth.users: non si duplica.
-- Il PIN per il tablet arriva con tablet-kiosk (colonna aggiunta da quel modulo).
```

- Funzioni di supporto (`security definer`, in `private`): `is_active_operator()` e `is_admin()`, lette
  dalle policy di **tutti** i moduli. Un account disattivato o senza profilo non vede nulla.
- `app.operators`:
  - **lettura** per gli operatori attivi (servono i nomi nello storico dei movimenti);
  - **scrittura diretta per nessuno**: invito e disattivazione passano dalle Edge Functions (service role),
    sempre con un controllo di ruolo in più.
- Le email degli operatori le vede solo un amministratore, con la funzione `app.list_operators()` che le
  legge da `auth.users`.
- Lo schema `app` viene esposto all'API di Supabase (`[api] schemas`), protetto dalla RLS. In remoto lo si
  imposta nella dashboard (Data API), come documentato.

### Configurazione di Auth

- Registrazione libera spenta. Password minima 8 caratteri.
- Link dell'invito valido 24 ore e link di recupero valido 1 ora, a uso singolo.
- URL di ritorno ammessi: produzione, anteprime Vercel, localhost.
- I limiti di frequenza di Supabase sui tentativi di accesso restano attivi (predefiniti).

## Commands

Nessun comando nuovo per lo sviluppo. In più:

```bash
npm run db:start            # ora con Auth e Mailpit (email locali su http://127.0.0.1:54324)
npx supabase functions serve # Edge Functions in locale
npm run test:integration    # Vitest contro lo stack locale (Auth, Edge Functions, RLS)
```

## Project Structure

```
src/features/identity/      → pagine (Accedi, Imposta password, Password dimenticata, Impostazioni,
                               Operatori), AuthProvider/useSession, RequireAuth/RequireAdmin
supabase/migrations/        → *_identity.sql (operators, funzioni, policy)
supabase/functions/invite-operator/, set-operator-active/   → Edge Functions (Deno)
supabase/templates/         → email di invito e recupero in italiano
supabase/tests/identity.test.sql                            → pgTAP
tests/integration/identity.test.ts                         → Vitest contro lo stack locale
e2e/identity.spec.ts        → invito → password → accesso → disattivazione (Mailpit per le email)
```

## Code Style

Come `platform`. In più: le pagine usano `getSupabase()` solo tramite i hook di `features/identity`
(`useSession`, `useCurrentOperator`), mai direttamente dai componenti.

```tsx
export function RequireAdmin({ children }: { children: ReactNode }) {
  const operator = useCurrentOperator();
  if (operator.status === 'loading') return <StatusView kind="loading" />;
  if (operator.data?.role !== 'admin') return <Navigate to="/impostazioni" replace />;
  return children;
}
```

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP | RLS di `operators`; utente disattivato o senza profilo non legge nulla; `is_admin()`; `bootstrap_first_admin` rifiuta il secondo admin; `list_operators()` nega le email ai non admin |
| Integrazione (Vitest + stack locale) | `invite-operator`: solo admin attivi, email duplicata, rollback se l'invito fallisce; `set-operator-active`: non su sé stessi, non sull'ultimo admin, sessioni revocate |
| Componenti (Vitest) | form e messaggi di errore, guardie di rotta, stati di caricamento |
| E2E (Playwright + Mailpit) | invito → email → password → accesso; password dimenticata; disattivazione con l'operatore espulso al primo caricamento |

La CI avvia lo stack Supabase locale (Auth, Edge Functions, Mailpit) anche per E2E e integrazione.

## Boundaries

- **Always**: ogni controllo di ruolo **sul server** (RLS o Edge Function); l'interfaccia nasconde solo i
  pulsanti; messaggi d'accesso che non rivelano se un account esiste; dati finti nei test (email
  `@example.com`).
- **Ask first**: un servizio email esterno (SMTP); cambiare durata delle sessioni o regole delle password;
  nuovi ruoli.
- **Never**: chiave service role fuori dalle Edge Functions; password o token nei log; disattivare l'ultimo
  amministratore; cancellare un operatore (si disattiva soltanto).

## Success Criteria

1. Un amministratore invita "Operatore Prova" (email finta): arriva l'email in italiano, il link porta a
   Imposta password, dopo il salvataggio l'operatore è dentro e vede la home (E2E).
2. Un operatore non vede la voce "Operatori"; se apre l'indirizzo a mano viene rimandato alle Impostazioni.
   Una chiamata diretta all'Edge Function o all'API con il suo token viene rifiutata (integrazione + pgTAP).
3. Dopo la disattivazione l'operatore non legge più alcun dato con il token che ha ancora in mano; al
   successivo caricamento finisce su `/accedi` con il messaggio di account disattivato.
4. Non si può disattivare sé stessi né l'ultimo amministratore attivo, né dall'interfaccia né chiamando
   l'API.
5. "Password dimenticata" risponde allo stesso modo per email esistenti e inesistenti.
6. `bootstrap_first_admin` funziona una sola volta ed è eseguibile solo da `postgres`.
7. Tutte le nuove schermate a 390×844 sono conformi ai wireframe; detector Impeccable pulito;
   Accessibilità Lighthouse ≥ 95 sulla pagina di accesso.
8. CI verde con pgTAP, integrazione ed E2E sullo stack locale.

## Out of Scope (Deferred)

- PIN, account di dispositivo e cambio operatore sul tablet: modulo `tablet-kiosk`.
- Cambio di ruolo di un account esistente: per ora si disattiva e si reinvita (vedi Open Questions).
- Accesso con Google o altri provider, autenticazione a due fattori: non richiesti.
- Registro delle attività degli amministratori oltre ai campi `invited_by` e `deactivated_by`.

## Open Questions

1. **Servizio email (blocca la produzione, non lo sviluppo)**: l'email predefinita di Supabase manda
   messaggi solo agli indirizzi del team del progetto, con pochi invii all'ora. Per invitare i camerieri
   serve un SMTP esterno. Propongo **Brevo** (azienda francese, server UE, piano gratuito da 300 email al
   giorno). L'account lo crei tu, come per Supabase. Va bene, o preferisci un altro servizio?
2. **Nomi degli operatori visibili a tutto lo staff**: lo storico movimenti mostra chi ha registrato cosa
   ("10:42 · Giulia"), quindi ogni operatore legge i nomi dei colleghi. Le email restano visibili solo agli
   amministratori. Confermi?
3. **Riattivare un operatore disattivato**: i wireframe non lo prevedono. Propongo un pulsante "Riattiva"
   per gli amministratori, invece di dover creare un nuovo account. Sì o no?
4. **Invito scaduto o perso**: propongo "Invia di nuovo" accanto agli inviti in attesa. Sì o no?
5. **Cambio di ruolo** (operatore ↔ amministratore): lo lascio fuori dalla V1 (si disattiva e si reinvita)
   o lo includo?
