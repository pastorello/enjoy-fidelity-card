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

1. **Checkpoint C di `platform`**: l'utente sceglie l'hosting (Vercel Pro o alternativa) e crea gli account
   (`docs/setup-accounts.md`); `db push` su staging con verifica dell'event trigger; anteprima, Lighthouse
   (PWA, Accessibilità ≥ 95, Best Practices ≥ 95) e installazione su Android.
2. Spec del modulo `identity` (`SPEC-identity.md`), poi gli altri nell'ordine di `CAPABILITY-MAP.md`
   (le aggiunte al modello dati vanno nelle spec di settings/ledger/tablet-kiosk).
3. Ancora aperto: monitoraggio errori prima del lancio.

## Bloccanti / da confermare

- **Testo dell'informativa e del consenso privacy**: da far verificare al consulente del bar (blocca il
  lancio, non lo sviluppo).
- **Lettore NFC USB**: da scegliere e acquistare (blocca la fase tablet); verificare il formato dell'uid.
- **Amministratori iniziali** (nomi/email): servono al primo deploy.
- **Account Supabase (prod + staging, UE) e Vercel**: li crea l'utente seguendo `docs/setup-accounts.md`.
- **Vercel Hobby vieta l'uso commerciale**: decidere tra Vercel Pro o un altro hosting prima del deploy.

## Modifiche non pubblicate

- Nessuna: tutto in `main`.

## Ultima sessione

- Repo creato (pubblico) e skill installate: Addy Osmani, Impeccable, webapp-testing, project-brain.
- CLAUDE.md riscritto in base a specifiche e wireframe.
- `interview-me` completata: perimetro = tutte e tre le fasi; decisioni in `DECISIONS.md`.
- `brain/` creato e compilato.
