# STATUS — Stato attuale

> Stato istantaneo, sovrascrivibile. Limite indicativo: ~80 righe / ~6.000 caratteri.
> Prima di sovrascrivere, spostare ciò che vale in `MAP.md` o `DECISIONS.md`.

---

## Cosa stiamo facendo

Spec-driven development: capability map e `docs/specs/SPEC-platform.md` approvate (2026-11-16). Piano `platform`
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
   **`identity-password` completo** su `feat/identity-password` (2026-11-17): password dimenticata e cambio
   password via email, controlli tutti verdi in locale (Mailpit incluso), PR verso `main` da unire dopo
   #13. Resta la procedura remota del titolare (`docs/setup-accounts.md` §6). **`settings` completo** su
   `feat/settings` (2026-11-18): riga unica `app.settings`, `app.update_settings` solo admin,
   `private.acting_operator_id()` e `reportNotEnabled()` condivisi, sezioni PUNTI / PUNTI E CONTROLLI di
   `/impostazioni`, progetto E2E `phone-settings`; 8 criteri di successo verificati
   (`tasks/settings/plan.md`), controlli tutti verdi in locale. Migrazione da applicare allo staging con
   `db push` insieme alle altre. **`customers` completo** su `feat/customers` (2026-11-18, PR verso `main` da
   unire dopo #15): tabella `app.customers` con nome unico senza accenti, RPC idempotenti, ricerca per nome
   o telefono, home "Cerca cliente", Nuovo/scheda/Modifica cliente, cancellazione dei dati solo admin;
   8 criteri di successo verificati test per test (`tasks/customers/plan.md`), quality bar completa verde
   in locale. Migrazione `*_customers.sql` da applicare allo staging con `db push`. Il ramo contiene anche
   modifiche trasversali (Enjoy Display, `src/lib/serverFault.ts`, allineamento ai wireframe finali).
   **`rewards` completo** su `feat/rewards` (2026-11-18, PR verso `main` da unire dopo #16 e #17): catalogo
   `app.rewards` con nome unico senza distinzione di maiuscole, RPC solo admin (`create_reward` idempotente,
   `update_reward`, `set_reward_active`), nessuna cancellazione; GESTIONE → "Catalogo premi" in
   `/impostazioni/premi` con Nuovo premio / Modifica premio; 9 criteri di successo verificati test per test
   (`tasks/rewards/plan.md`), quality bar completa verde in locale. Migrazioni `*_rewards*.sql` (3) da
   applicare allo staging con `db push`. **`card-input` completo** su `feat/card-input` (2026-11-18,
   ramo da `feat/rewards`, PR #19 verso `main` da unire dopo #18): servizio di lettura unico (Web NFC +
   lettore USB), `normalizeUid`, scrittura del link con verifica, `CardReadPanel` nella home, card finta solo
   con `VITE_E2E=1` e `check:bundle` in CI e su Vercel, guardia del confine; nessuna migrazione; 10 criteri di
   successo verificati test per test (`scripts/cardInputCriteria.test.ts`), quality bar completa e build verdi
   in locale. Resta la **prova manuale su Android** con l'utente (RUNBOOK, "Prova manuale della lettura
   card": criteri 2, 3 e 10, in parte solo dopo `cards`). **`cards` quasi completo** su `feat/cards`
   (2026-11-18, ramo da `feat/card-input`, PR verso `main` da unire dopo #18 e #19): `app.cards` con una
   card attiva per cliente, RPC idempotenti (associa, sostituisci, disattiva, Nuovo cliente con card),
   card letta in home → Registra spesa o Nuovo cliente con la card, link ai punti con token casuale (solo
   l'impronta sul server, mai l'uid) scritto e verificato sulla card, pagina pubblica `/s/:token` con il
   solo saldo (`public.card_points`, unica funzione eseguibile da `anon`), guardia del confine
   (`scripts/cardsBoundary.test.ts`); task 1-23 fatti, resta il task 24 (verifica dei 15 criteri e PR).
   Migrazione `*_cards.sql` da applicare allo staging con `db push`. Prima del lancio:
   `VITE_CARD_LINK_ORIGIN` su Vercel Production e prova manuale dei criteri 10 e 14 (RUNBOOK, "Prova
   manuale del link ai punti"). **Prossimo modulo**: `ledger` (ordine di `CAPABILITY-MAP.md`).
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

- Rami in catena non ancora in `main`: `feat/identity` (PR #13), `feat/identity-password`, `feat/settings`,
  `feat/customers`, `chore/specs-folder` (PR #17), `feat/rewards` (PR #18), `feat/card-input` (PR #19),
  `feat/cards`.

## Ultima sessione

- Repo creato (pubblico) e skill installate: Addy Osmani, Impeccable, webapp-testing, project-brain.
- CLAUDE.md riscritto in base a specifiche e wireframe.
- `interview-me` completata: perimetro = tutte e tre le fasi; decisioni in `DECISIONS.md`.
- `brain/` creato e compilato.
