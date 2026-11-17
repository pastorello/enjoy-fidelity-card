# RUNBOOK — Comandi, controlli, dove guardare, trappole

> Cambia lentamente, si aggiunge e non si riscrive. Chi scrive un HANDOFF mette qui procedure e trappole nuove.

---

## 1. Comandi

Prima volta: `npm install`, poi `cp .env.example .env` e incollare in `.env` il `PUBLISHABLE_KEY` locale
mostrato da `npm run db:start` (Docker deve essere acceso).

```bash
npm run dev                                 # app su http://localhost:5173 (vetrina componenti: /dev/ui, solo in sviluppo)
npm run typecheck && npm run lint && npm test && npm run build   # controlli prima di ogni commit
npm run format                              # Prettier
npm run db:start / db:stop                  # Supabase locale (Docker)
npm run db:reset                            # riapplica migrazioni + seed
npm run db:test                             # test pgTAP in supabase/tests/
npm run test:integration                    # Vitest contro lo stack locale (tests/integration/), Supabase acceso
./scripts/reload-auth-templates.sh          # se arriva l'email "Reset your password" (trappola 28)
npx supabase migration new <nome> </dev/null   # nuova migrazione (vedi trappola 5)
npm run tokens                              # rigenera src/styles/tokens.css da design/tokens.json
npm run icons                               # rigenera le icone PWA da design/enjoy-badge-solo-negative.png
npm run e2e                                 # Playwright sulla build, 390×844, contro Supabase locale (deve essere acceso)
npm run dev:https                           # HTTPS sulla rete locale (certificato autofirmato), per il telefono
npx impeccable detect src/                  # scansione design (anche su URL del dev server)
npx skills add <owner>/<repo> --skill <nome> --agent claude-code   # aggiungere una skill di progetto
bash ~/.claude/plugins/cache/sprout-labs/project-brain/*/scripts/doctor.sh .   # controllo di brain/
```

Account finti del seed (solo locale): `admin@example.com` (amministratore "Admin Prova") e
`operatore@example.com` (operatore "Operatore Prova"), password `password-di-prova`.
`recupero@example.com` ("Recupero Prova", operatore) è riservato a `e2e/password.spec.ts`, che ne cambia
la password a ogni esecuzione: non usarlo altrove (`npm run db:reset` lo riporta a `password-di-prova`).

Stack locale minimo per E2E e integrazione (Postgres, Auth, API REST, Mailpit: lo stesso della CI):

```bash
npx supabase start -x studio,imgproxy,storage-api,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta
```

Email locali (recupero password): le cattura **Mailpit**, mai una casella vera. Si leggono su
http://127.0.0.1:54324 (anche dall'app in sviluppo: "Password dimenticata?" → link nell'email di Mailpit);
nei test con `e2e/mailpit.ts` (API `/api/v1/search`).

### Operatori

Registrare, togliere, rimettere un operatore: `docs/setup-accounts.md` §4 (pannello Supabase +
`select private.add_operator('<email>', '<nome>', 'admin' | 'operator');` nello SQL Editor). Nei progetti
online lo schema `app` va esposto nella Data API (§3 della stessa guida). Password dimenticata: la persona
usa "Password dimenticata?" su `/accedi` (o Impostazioni → Cambia password); nei progetti online serve la
procedura del §6 (URL di ritorno, template "Reset password", minimo 8 caratteri), dalla dashboard, prima
staging poi produzione, mai `supabase config push`.

### Pubblicazione

- Vercel pubblica da solo: anteprima per ogni PR (Supabase di staging), produzione da `main`.
- Database: `npx supabase link --project-ref <ref>` e `npx supabase db push`, **a mano**, prima su staging
  e poi su produzione. Procedura completa in `docs/setup-accounts.md`.
- CI: `.github/workflows/ci.yml` (job App ed E2E, job Database con il solo Postgres).

### Provare sul telefono Android

1. **Consigliato**: telefono collegato via USB con il debug USB attivo, `npm run dev`, poi in Chrome sul
   computer `chrome://inspect` → *Port forwarding* `5173 → localhost:5173`. Sul telefono si apre
   `http://localhost:5173`: localhost è un contesto sicuro, quindi Web NFC funziona senza certificati.
2. In alternativa: `npm run dev:https` e sul telefono l'indirizzo `https://<ip>:<porta>` stampato in console,
   accettando l'avviso del certificato autofirmato.
3. Oppure l'anteprima Vercel della PR, già in HTTPS.

## 2. Controllo di salute

`npm run typecheck && npm run lint && npm run format:check && npm test` e, con Supabase acceso,
`npm run db:test && npm run test:integration && npm run e2e`: tutto verde = sano. In CI: i due job di `CI` verdi sulla PR (`gh pr checks <n>`).

## 3. Quando qualcosa non va, guarda qui

| Sintomo | Guarda prima | Poi |
|---|---|---|
| Una skill o un plugin appena installato non compare | Ricaricare Claude Code (nuova sessione) | `claude plugin list` |
| L'app si ferma con "Missing VITE_SUPABASE_…" | `.env` assente o incompleto | `.env.example`, `npx supabase status` |
| `db:start` / `db:reset` scade in attesa di un container | `docker ps` (container non sani) | `npx supabase stop` e di nuovo `db:start` |
| `npm run e2e` si ferma con "Local Supabase is not running" | `npx supabase status` | avviare lo stack (comando sopra) |
| Online: accesso con credenziali giuste dà "Connessione assente" | Schema `app` esposto nella Data API? | `docs/setup-accounts.md` §3 |
| Online: "Account non abilitato" | Profilo collegato? `select * from app.operators;` nello SQL Editor | `private.add_operator` (§4 della guida) |
| In locale l'email di recupero non arriva | Mailpit acceso? http://127.0.0.1:54324 (`npx supabase status`) | riavviare lo stack senza `mailpit` tra gli esclusi (`-x`); dopo modifiche a `config.toml`: `npx supabase stop && npm run db:start` |
| Online: il link dell'email apre "Il link è scaduto o è già stato usato." | Template "Reset password" ancora quello predefinito (`#error_code=…` nell'URL)? | `docs/setup-accounts.md` §6 passo 2; link davvero usato o più vecchio di un'ora |
| Online: il link apre la home e non `/imposta-password` | Redirect URLs del progetto | `docs/setup-accounts.md` §6 passo 1 (l'app inoltra comunque a `/imposta-password`) |

## 4. Trappole (numerate, solo aggiunte)

1. Il programma di Impeccable (`.claude/skills/impeccable/scripts/bin/`) è ignorato da git: il launcher lo
   riscarica alla prima esecuzione. Non committarlo.
2. Web NFC non esiste in Playwright: nei test E2E la lettura card va simulata con un adattatore finto.
3. Il repo è pubblico: niente dati reali di clienti, nemmeno nei fixture; segreti solo in `.env`.
4. Uid delle card: Web NFC dà `04:a1:b2:…`, i lettori USB spesso decimale e a volte byte invertiti.
   Normalizzare sempre in esadecimale maiuscolo senza separatori prima di cercare o salvare.
5. `supabase migration new` legge il contenuto da stdin quando non è in un terminale: lanciato da un agente
   resta appeso. Usare `</dev/null` e poi scrivere il file creato.
6. Lo schema `app` attiva la RLS da solo su ogni nuova tabella (event trigger), ma una tabella senza policy
   resta illeggibile: ogni tabella nuova vuole le sue policy e il suo test pgTAP.
7. `src/styles/tokens.css` è generato: non si modifica a mano e Prettier lo ignora. Si cambia
   `design/tokens.json` (copia del design system "Enjoy Bar") e si lancia `npm run tokens`; un test
   fallisce se il CSS committato non coincide.
8. Il rilevatore Impeccable ha la regola `cream-palette` disattivata (`.impeccable/config.json`): lo sfondo
   `paper` #faf5f1 è imposto dal design system del bar, non una scelta di default.
9. jsdom non implementa `<dialog>`: `src/test/setup.ts` aggiunge `showModal`/`close` minimi. Esc nei test si
   simula con l'evento `cancel` sul dialog, non con il tasto.
10. Testing Library normalizza gli spazi: lo spazio indivisibile di `formatCents`/`formatPoints` nei test
    va cercato con una regex (`/12,50\s+€/`).
11. Le intercettazioni di rete di Playwright (`route`) scavalcano il service worker: per verificare cosa
    mette in cache si controlla `sw.js` generato, non una richiesta simulata.
12. La porta 5173 può essere occupata da altri progetti (un container Docker): Vite passa alla successiva,
    leggere l'indirizzo stampato in console.
13. `glob` e `minimatch` sono forzati con `overrides` in `package.json` (vulnerabilità in workbox-build):
    toglierli quando workbox-build li aggiorna.
14. PR impilate (ognuna con base sulla precedente): unendole, ciascuna finisce nel ramo sotto di lei e non
    in `main` (2026-11-17: su `main` era arrivata solo la #1). Preferire PR con base `main`; se si impilano,
    unire dal basso e cambiare la base della successiva in `main` prima di unirla (GitHub lo fa da solo
    solo se il ramo unito viene eliminato).
15. Il server MCP di Supabase (`.mcp.json`) punta al progetto di **staging** (`kpizaczyrlyywuidqitn`) con
    permessi di scrittura. Non va mai collegato alla produzione senza `read_only=true`: in produzione le
    migrazioni si applicano solo a mano, dopo la prova su staging. Si attiva riaprendo Claude Code e
    autenticandosi con `/mcp`.
16. `.env` punta allo **staging**: E2E e test di integrazione non lo usano. `playwright.config.ts` legge la
    chiave locale da `supabase status` e la passa a Vite (vince su `.env`); un controllo automatico fa
    fallire ogni test che chiama `*.supabase.co`. Il server di anteprima non si riusa mai
    (`reuseExistingServer: false`): potrebbe essere stato costruito contro lo staging.
17. Un accesso con credenziali sbagliate produce in console un `400` su `/auth/v1/token` (lo stampa il
    browser, non l'app): è atteso, e `e2e/fixtures.ts` lo esclude dal controllo "console pulita". Ogni altro
    errore in console fa fallire il test.
18. La CSP di produzione (`vercel.json`) non ammette `http://localhost:54321`: l'origine locale è aggiunta
    a `connect-src` solo nelle intestazioni di `vite preview` (`vite.config.ts`), mai in `vercel.json`.
19. Un utente cancellato in Authentication → Users ha ancora un token valido fino a un'ora: la sicurezza sta
    nella RLS (controlla il profilo collegato, non il token). L'app se ne accorge al ritorno in primo piano.
20. `private.add_operator` è eseguibile solo da `postgres` (SQL Editor): nessun ruolo dell'API la può
    chiamare. Gli account si creano con *Auto Confirm User* attivo, altrimenti Supabase manda un'email di
    conferma (da `info@enjoygaeta.it`).
21. Le modifiche a `supabase/config.toml` (template email, URL di ritorno, limiti di Auth) non le applica
    `db:reset`: serve riavviare lo stack (`npx supabase stop && npm run db:start`).
22. `[auth.rate_limit] email_sent = 100` vale **solo in locale** (con 2 l'ora una sola esecuzione degli E2E
    resterebbe senza email). Per questo e per gli URL `localhost`, `config.toml` non si porta mai nei progetti
    online con `supabase config push`: Auth remota si configura dalla dashboard (`docs/setup-accounts.md` §6).
23. Supabase usa il `redirectTo` della richiesta solo se combacia con una delle Redirect URLs (in locale sono
    indirizzi esatti);
    altrimenti il link punta a `site_url` (`/?token_hash=…&type=recovery`) e `RootLayout` lo inoltra a
    `/imposta-password`. L'E2E controlla che il link inizi con `http://localhost:4173/imposta-password`.
24. Mailpit conserva le email delle esecuzioni precedenti: i test filtrano per destinatario e per ora di
    arrivo dopo la richiesta, e l'email inesistente è unica per esecuzione (`nessuno-<casuale>@example.com`).
25. Un link di recupero già usato produce in console un `403` su `/auth/v1/verify` (lo stampa il browser):
    è atteso come il `400` della trappola 17, ed `e2e/fixtures.ts` lo esclude.
26. `isAuthRetryableFetchError` di supabase-js è vero anche per 502/503/504: non basta a dire "rete assente".
    Per "Password dimenticata" ogni risposta HTTP è "inviato" (un 504 per invio lento esiste solo per gli
    account veri e li rivelerebbe); "rete" solo con `status` 0 o `fetch` fallita.
27. Il token del link si consuma solo con "Salva e accedi" (`verifyOtp` con `token_hash`), mai all'apertura:
    le anteprime e gli antivirus delle caselle email non lo bruciano. Con il template predefinito di
    Supabase (`{{ .ConfirmationURL }}`) succederebbe: il template va sempre incollato nei progetti online.
28. `supabase start` può avviare Auth prima che il gateway (Kong, porta 8088) serva i template delle email:
    Auth registra `templatemailer_template_body_http_error … connection refused` e manda l'email
    predefinita "Reset your password" finché non viene riavviato. Succede in CI (2026-11-17), raramente in
    locale. Rimedio: `scripts/reload-auth-templates.sh` dopo `supabase start` (la CI lo esegue); fallisce se
    il template non si carica.
