# RUNBOOK — Comandi, controlli, dove guardare, trappole

> Cambia lentamente, si aggiunge e non si riscrive. Chi scrive un HANDOFF mette qui procedure e trappole nuove.

---

## 1. Comandi

Prima volta: `npm install`, poi `cp .env.example .env` e incollare in `.env` il `PUBLISHABLE_KEY` locale
mostrato da `npm run db:start` (Docker deve essere acceso).

```bash
npm run dev                                 # app su http://localhost:5173
npm run typecheck && npm run lint && npm test && npm run build   # controlli prima di ogni commit
npm run format                              # Prettier
npm run db:start / db:stop                  # Supabase locale (Docker)
npm run db:reset                            # riapplica migrazioni + seed
npm run db:test                             # test pgTAP in supabase/tests/
npx supabase migration new <nome> </dev/null   # nuova migrazione (vedi trappola 5)
npx impeccable detect src/                  # scansione design (anche su URL del dev server)
npx skills add <owner>/<repo> --skill <nome> --agent claude-code   # aggiungere una skill di progetto
bash ~/.claude/plugins/cache/sprout-labs/project-brain/*/scripts/doctor.sh .   # controllo di brain/
```

## 2. Controllo di salute

`npm run typecheck && npm run lint && npm test && npm run build` e, con Supabase acceso, `npm run db:test`:
tutto verde = sano.

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
