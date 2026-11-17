# STATUS — Stato attuale

> Stato istantaneo, sovrascrivibile. Limite indicativo: ~80 righe / ~6.000 caratteri.
> Prima di sovrascrivere, spostare ciò che vale in `MAP.md` o `DECISIONS.md`.

---

## Cosa stiamo facendo

Spec-driven development: capability map e `SPEC-platform.md` approvate (2026-11-16). Piano `platform`
approvato; task 1-11 fatti e in `main` (PR #7, 2026-11-17; rami vecchi eliminati). Manca il
Checkpoint C: scelta dell'hosting, account Supabase, anteprima, Lighthouse e prova su Android. Poi la spec
del modulo `identity`.

## Come verificarlo

- `npm run typecheck && npm run lint && npm test && npm run build`; `npm run db:start && npm run db:test`.
- `git log --oneline` e `git status -sb` per lo stato del repo.

## Prossimi passi

1. **Checkpoint C di `platform`**: app pubblicata su https://enjoy-fidelity-card.vercel.app (2026-11-17);
   Lighthouse mobile: Accessibilità 100, Best Practices 100, Prestazioni 71 (JS iniziale, da migliorare
   più avanti). Mancano: scelta del piano di hosting (Hobby vieta l'uso commerciale), account Supabase
   (`docs/setup-accounts.md`) con `db push` su staging e verifica dell'event trigger, installazione su
   Android.
2. **Sviluppo autonomo** (richiesta dell'utente 2026-11-17): `identity` V1 completo (PR #13, CI verde,
   migrazioni applicate allo staging). Specifiche di tutti i moduli in repo (`SPEC-*.md`, `docs/specs/`),
   approvate per delega con i default. Rami in catena, ognuno con PR verso `main` (unire in ordine):
   `feat/identity` → `feat/identity-password` → un ramo per modulo nell'ordine di `CAPABILITY-MAP.md`.
3. Ancora aperto: monitoraggio errori prima del lancio.

## Bloccanti / da confermare

- **Servizio di invio email** (da `info@enjoygaeta.it`): chiedere all'utente quale provider SMTP usa, da
  citare nell'informativa privacy.
- **Testo dell'informativa e del consenso privacy**: da far verificare al consulente del bar (blocca il
  lancio, non lo sviluppo).
- **Lettore NFC USB**: da scegliere e acquistare (blocca la fase tablet); verificare il formato dell'uid.
- **Amministratori iniziali** (nomi/email): servono al primo deploy.
- **Account Supabase creati** (2026-11-17): staging `kpizaczyrlyywuidqitn` (usato da `.env` locale e dalle
  anteprime), prod `mxylhfwvwwspepzevccf` (solo Vercel Production). Variabili Vercel `VITE_SUPABASE_*`: Production = prod,
  Preview/Development = staging (2026-11-17). Manca `db push`. Rimosse le 16 variabili aggiunte
  dall'integrazione Supabase di Vercel (chiavi segrete incluse); l'integrazione resta da disinstallare.
- **Vercel Hobby vieta l'uso commerciale**: decidere tra Vercel Pro o un altro hosting prima del deploy.

## Modifiche non pubblicate

- Nessuna: tutto in `main`.

## Ultima sessione

- Repo creato (pubblico) e skill installate: Addy Osmani, Impeccable, webapp-testing, project-brain.
- CLAUDE.md riscritto in base a specifiche e wireframe.
- `interview-me` completata: perimetro = tutte e tre le fasi; decisioni in `DECISIONS.md`.
- `brain/` creato e compilato.
