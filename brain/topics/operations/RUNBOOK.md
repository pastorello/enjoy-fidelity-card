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
npx supabase migration new <nome> </dev/null   # nuova migrazione (vedi trappola 5)
npm run tokens                              # rigenera src/styles/tokens.css da design/tokens.json
npm run icons                               # rigenera le icone PWA da design/enjoy-badge-solo-negative.png
npm run e2e                                 # Playwright sulla build, 390×844, con le intestazioni di vercel.json
npm run dev:https                           # HTTPS sulla rete locale (certificato autofirmato), per il telefono
npx impeccable detect src/                  # scansione design (anche su URL del dev server)
npx skills add <owner>/<repo> --skill <nome> --agent claude-code   # aggiungere una skill di progetto
bash ~/.claude/plugins/cache/sprout-labs/project-brain/*/scripts/doctor.sh .   # controllo di brain/
```

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

`npm run typecheck && npm run lint && npm test && npm run e2e` e, con Supabase acceso, `npm run db:test`:
tutto verde = sano. In CI: i due job di `CI` verdi sulla PR (`gh pr checks <n>`).

## 3. Quando qualcosa non va, guarda qui

| Sintomo | Guarda prima | Poi |
|---|---|---|
| Una skill o un plugin appena installato non compare | Ricaricare Claude Code (nuova sessione) | `claude plugin list` |
| L'app si ferma con "Missing VITE_SUPABASE_…" | `.env` assente o incompleto | `.env.example`, `npx supabase status` |
| `db:start` / `db:reset` scade in attesa di un container | `docker ps` (container non sani) | `npx supabase stop` e di nuovo `db:start` |

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
