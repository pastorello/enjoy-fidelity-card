# Spec: identity — V1

Status: approvata (2026-11-17) — perimetro ridotto al solo accesso
Modulo: `identity` ([CAPABILITY-MAP.md](CAPABILITY-MAP.md)) · Dipende da: `platform` ·
Fonti: specifiche (sezioni "Ruoli e account", "Sicurezza e privacy", "Modello dati") e wireframe
Accedi, Impostazioni, Impostazioni operatore (link in `brain/MAP.md` §5) · Decisioni: `brain/DECISIONS.md`.

> **Differenza dalle specifiche**: le specifiche prevedono inviti via email e gestione degli operatori
> dall'app. Il bar non ha un dominio internet, quindi niente servizio email: in V1 gli account si creano a
> mano dal pannello di Supabase. Decisione del 2026-11-17 in `brain/DECISIONS.md`.

## Objective

Chi lavora al bar entra nell'app con il proprio account, e l'app sa sempre **chi** è e **che ruolo** ha.
Ogni modulo successivo usa questa base: le regole di accesso ai dati (RLS) e l'operatore salvato in ogni
movimento vengono da qui.

**Utenti**:
- **Amministratore** (titolari) e **Operatore** (camerieri): accedono ed escono. Il ruolo serve ai moduli
  successivi (per esempio solo un amministratore cambia il rapporto euro/punto).
- Gli account li crea e li toglie chi gestisce Supabase, dal pannello di controllo, con la procedura in
  `docs/setup-accounts.md`. L'app non ha schermate per gestirli.

**Successo**: si crea un utente nel pannello di Supabase, lo si registra come operatore, e quella persona
entra nell'app dal telefono con email e password. Basta anche un solo utente.

## Cosa include

1. **Accesso** (`/accedi`, wireframe "Accesso"): email e password, logo Enjoy, nota "Gli account li crea un
   amministratore…". Nessun link "Password dimenticata?" (aggiunto poi da
   [SPEC-identity-password.md](SPEC-identity-password.md)). Errore unico e generico per credenziali sbagliate
   ("Email o password non corretti"), senza dire quale dei due. Dopo l'accesso si torna alla pagina
   richiesta, altrimenti alla home.
2. **Sessione**:
   - persistente sul telefono (resta aperta finché non si esce);
   - tutte le pagine tranne `/accedi` richiedono un utente collegato e **registrato come operatore**;
     senza sessione si va su `/accedi`;
   - sessione scaduta: si torna su `/accedi` con il messaggio "La sessione è scaduta: accedi di nuovo";
   - utente senza profilo collegato (account tolto o non ancora registrato con `private.add_operator`): si
     torna su `/accedi` con "Account non abilitato: chiedi a un amministratore." (deciso il 2026-11-17);
   - **Esci** chiude la sessione su questo telefono.
3. **Impostazioni** (`/impostazioni`, wireframe "Impostazioni" e "Impostazioni operatore"): riquadro account
   (iniziale, nome, ruolo, "Esci"). Il pulsante account dell'`AppShell` (iniziale nel cerchio) porta qui.
   Le altre sezioni dei wireframe le aggiungono i moduli `settings`, `rewards` ed `export`.
4. **Registrare un operatore** (procedura manuale, in `docs/setup-accounts.md`):
   1. Supabase → Authentication → Users → **Add user → Create new user**: email, password, *Auto Confirm
      User* attivo (così non parte nessuna email);
   2. SQL Editor: `select private.add_operator('<email>', '<nome>', 'admin' | 'operator');` collega
      l'utente a un profilo con nome e ruolo.
5. **Togliere un operatore**: si cancella l'utente in Authentication → Users. Il profilo resta, scollegato,
   perché il suo nome serve nello storico dei movimenti; da quel momento il token che ha ancora in mano non
   legge più nulla. Per **rimetterlo** si ricrea l'utente e si richiama `private.add_operator` con lo stesso
   nome: il profilo viene ricollegato.
6. **Password dimenticata**: niente email, quindi la si reimposta dal pannello di Supabase (cancella e
   ricrea l'utente, poi `private.add_operator`), come al punto 5. **Sostituito** da
   [SPEC-identity-password.md](SPEC-identity-password.md): link "Password dimenticata?" su `/accedi`, link via
   email e "Cambia password" nelle Impostazioni; procedura remota in `docs/setup-accounts.md` §6.

### Modello dati e regole di accesso

```sql
-- app.operators: un profilo per ogni persona che lavora al bar
id          uuid primary key default gen_random_uuid()  -- usato dai movimenti, non cambia mai
user_id     uuid unique references auth.users(id) on delete set null  -- null = account tolto
name        text not null unique check (length(trim(name)) between 1 and 60)
role        text not null check (role in ('admin', 'operator'))
created_at  timestamptz not null default now()
-- L'email resta in auth.users: non si duplica.
-- Il PIN per il tablet arriva con tablet-kiosk (colonna aggiunta da quel modulo).
```

- Il profilo ha un `id` suo, separato dall'utente di Auth: così cancellare l'utente dal pannello non è
  bloccato dai movimenti che lo citano e non cancella il nome dallo storico.
- `private.add_operator(email, name, role)` (`security definer`, eseguibile solo da `postgres`, cioè dallo
  SQL Editor): trova l'utente per email; se esiste un profilo con quel nome lo ricollega e ne aggiorna il
  ruolo, altrimenti lo crea. Errore chiaro se l'email non esiste o è già collegata a un altro profilo.
- Funzioni di supporto (`security definer`, in `private`): `current_operator_id()`, `is_active_operator()`
  e `is_admin()`, lette dalle policy di **tutti** i moduli. Un utente senza profilo collegato non vede nulla.
- `app.operators`: **lettura** per gli operatori attivi (nomi e ruoli dei colleghi); **scrittura** solo
  tramite `private.add_operator`.
- Lo schema `app` viene esposto all'API di Supabase (`[api] schemas`), protetto dalla RLS. In remoto lo si
  imposta nella dashboard (Data API), come documentato.

### Configurazione di Auth

> Le ultime tre voci non valgono più: email di Auth, URL di ritorno e template di recupero sono in
> [SPEC-identity-password.md](SPEC-identity-password.md) ("Configurazione di Auth").

- Registrazione libera spenta. Password minima 8 caratteri.
- Nessun SMTP esterno: Auth non manda email (utenti creati già confermati).
- URL di ritorno: non servono (nessun link via email).
- I limiti di frequenza di Supabase sui tentativi di accesso restano attivi (predefiniti).

## Commands

Nessun comando nuovo per lo sviluppo. In più:

```bash
npm run test:integration    # Vitest contro lo stack locale (Auth, RLS)
```

## Project Structure

```
src/features/identity/      → pagine (Accedi, Impostazioni), AuthProvider/useSession,
                               useCurrentOperator, RequireAuth
supabase/migrations/        → *_identity.sql (operators, funzioni, policy)
supabase/seed.sql           → utenti finti per lo sviluppo locale (email @example.com)
supabase/tests/identity.test.sql                            → pgTAP
tests/integration/identity.test.ts                         → Vitest contro lo stack locale
e2e/identity.spec.ts        → accesso → home → esci; credenziali sbagliate; account tolto
docs/setup-accounts.md      → procedura: creare, togliere, rimettere un operatore
```

## Code Style

Come `platform`. In più: le pagine usano `getSupabase()` solo tramite i hook di `features/identity`
(`useSession`, `useCurrentOperator`), mai direttamente dai componenti.

```tsx
export function RequireAuth({ children }: { children: ReactNode }) {
  const operator = useCurrentOperator();
  const location = useLocation();
  if (operator.status === 'loading') return <StatusView kind="loading" />;
  if (!operator.data) return <Navigate to="/accedi" state={{ from: location }} replace />;
  return children;
}
```

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP | RLS di `operators`; utente senza profilo o con profilo scollegato non legge nulla; `is_admin()`; `add_operator` crea, ricollega, rifiuta email inesistente o già collegata, è eseguibile solo da `postgres`; cancellare l'utente lascia il profilo con `user_id` null |
| Integrazione (Vitest + stack locale) | accesso con le credenziali del seed; dopo la cancellazione dell'utente il vecchio token non legge `operators` |
| Componenti (Vitest) | form e messaggio di errore, guardia di rotta, stati di caricamento |
| E2E (Playwright) | accesso → home → Impostazioni → Esci; credenziali sbagliate; pagina protetta senza sessione → `/accedi` e ritorno alla pagina richiesta |

La CI avvia lo stack Supabase locale anche per E2E e integrazione.

## Boundaries

- **Always**: ogni controllo di ruolo **sul server** (RLS o funzioni); l'interfaccia nasconde solo i
  pulsanti; messaggi d'accesso che non rivelano se un account esiste; dati finti nei test e nel seed
  (email `@example.com`).
- **Ask first**: aggiungere un servizio email; cambiare durata delle sessioni o regole delle password;
  nuovi ruoli.
- **Never**: chiave service role nell'app; password o token nei log; cancellare un profilo operatore (si
  scollega soltanto).

## Success Criteria

1. Un utente creato nel pannello e registrato con `private.add_operator` accede dal telefono e vede la home.
2. Credenziali sbagliate: un solo messaggio generico, nessun indizio su quale campo è errato.
3. Senza sessione ogni pagina porta a `/accedi`; dopo l'accesso si torna alla pagina richiesta.
4. Dopo la cancellazione dell'utente il suo token non legge più alcun dato; al caricamento successivo
   finisce su `/accedi`. Il profilo resta e si ricollega ricreando l'utente.
5. Un utente di Auth senza profilo non legge nulla e non supera la guardia di rotta.
6. `private.add_operator` è eseguibile solo da `postgres`.
7. Le schermate a 390×844 sono conformi ai wireframe; detector Impeccable pulito; Accessibilità Lighthouse
   ≥ 95 sulla pagina di accesso.
8. CI verde con pgTAP, integrazione ed E2E sullo stack locale.

## Out of Scope (Deferred)

Rinviati dopo la V1 (decisione del 2026-11-17). Le email di Auth ora funzionano (`info@enjoygaeta.it`):
"Password dimenticata" e "Cambia password" si aggiungono subito dopo la V1 con una spec aggiuntiva; il resto
resta rinviato:
- inviti via email, scelta della password dal link, "Password dimenticata";
- schermata "Operatori" nell'app (elenco, disattiva, riattiva, reinvia l'invito);
- cambio di ruolo dall'app (si fa con `private.add_operator`);
- "Cambia password" dalle Impostazioni.

"Password dimenticata", scelta della password dal link e "Cambia password" sono specificati in
[SPEC-identity-password.md](SPEC-identity-password.md); inviti e schermata "Operatori" restano rinviati.

Fuori anche:
- PIN, account di dispositivo e cambio operatore sul tablet: modulo `tablet-kiosk`.
- Accesso con Google o altri provider, autenticazione a due fattori: non richiesti.

## Open Questions

Nessuna. Le risposte dell'utente del 2026-11-17 sono in `brain/DECISIONS.md`.
