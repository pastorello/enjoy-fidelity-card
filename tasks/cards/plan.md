# Implementation Plan: cards

Source spec: [SPEC-cards.md](../../docs/specs/SPEC-cards.md) (approvata il 2026-11-17, rivista il 2026-11-18 per
il link ai punti; le Open Questions usano i default adottati). Assorbe
[customer-balance.md](../../docs/specs/customer-balance.md): link ai punti scritto sulla card e pagina
pubblica `/s/:token`.

## Overview

Ogni card (uid di un NTAG215) si lega a un solo cliente, per sempre. Dalla home una card attiva apre
Registra spesa del suo cliente senza tocchi, una card sconosciuta apre Nuovo cliente con la card già
associata. Da Modifica cliente si associa, sostituisce (la vecchia si disattiva, i punti restano) o
disattiva la card. Dopo ogni associazione confermata dal server l'app scrive sulla card **solo un link**
`https://<origine>/s/<token>` con un token casuale di 128 bit (mai l'uid), verificato rileggendo la card e
valido solo dopo `confirm_card_link`. Chi avvicina la card al proprio telefono vede, senza accesso, solo il
saldo dei punti. Ogni disattivazione cancella il link. Il percorso della spesa non scrive mai la card.

## Architecture Decisions

- **Prima il database, poi il servizio, poi la UI** (rischio più alto in testa). I rischi gravi sono sul
  server: due card attive per un cliente o due clienti per un uid con chiamate concorrenti, un uid che passa
  a un altro cliente, il token in chiaro nel database o nei messaggi d'errore, un token in attesa che mostra
  punti, una disattivazione che lascia vivo il link, `anon` che esegue altro oltre a `public.card_points`
  (i privilegi predefiniti di Supabase danno `execute` ad `anon` su ogni nuova funzione di `public`). Si
  fissa tutto con pgTAP nei task 1–4, prima di ogni riga di UI, e con la revisione `security-and-hardening`
  al Checkpoint A.
- **Una sola migrazione `*_cards.sql`**, creata con `npx supabase migration new cards` (dopo quelle di
  `rewards`) e completata nei task 1–4 (non pubblicata: si modifica in place e si applica con
  `npm run db:reset`). Errori come `customers`: `raise exception` con `errcode 'P0001'` e codice nel
  messaggio (`not_operator`, `customer_not_found`, `customer_anonymized`, `invalid_uid`, `card_taken`,
  `card_not_found`, `card_inactive`, `link_token_mismatch`); nessun messaggio contiene token, impronta o uid.
  Operatore registrato con `private.acting_operator_id()`, mai `auth.uid()`. `execute` delle RPC revocato a
  `public`/`anon` e concesso ad `authenticated` (resta verde `function_privileges.test.sql`).
- **Segreto fuori dallo schema esposto.** `private.card_links` (RLS attiva, nessuna policy, nessun `grant`)
  tiene solo l'impronta sha256 del token valido e di quello in attesa (`private.card_token_hash(text)`, unica
  formula); `app.cards` tiene solo lo stato non segreto (`link_written_at/by`, `link_pending_at`) da cui il
  client calcola `LinkState`. I trigger su `app.cards` azzerano lo stato del link e cancellano la riga di
  `private.card_links` a **ogni** passaggio `active` true → false (sostituzione, `deactivate_card`,
  anonimizzazione).
- **`public.card_points(text)` è l'unica porta per `anon`**: `stable security definer`, `search_path = ''`,
  sempre un intero o `null`, `Cache-Control: no-store` via `response.headers`; saldo da
  `private.customer_balance` di `ledger` se esiste (`to_regprocedure`), altrimenti `0`. Un test pgTAP
  allowlist blocca qualsiasi altra funzione di `public` eseguibile da `anon`.
- **Un solo punto di accesso a Supabase per modulo.** `supabaseCardsService.ts` (operatori) e
  `public/cardPointsService.ts` (solo `public.card_points`, `POST`, mai `{ get: true }`) sono gli unici file
  che chiamano Supabase; guardia `scripts/cardsBoundary.test.ts` come `customersBoundary.test.ts`. Gli errori
  diventano errori tipizzati (`CardTakenError`, `CustomerUnavailableError`, `CardInactiveError`,
  `NetworkError`, …); i guasti del server passano da `serverFaultFor` di `src/lib/serverFault.ts`; ogni codice
  sollevato dalla migrazione ha una traduzione (guardia come `scripts/customerErrorCodes.test.ts`).
  `not_operator` → `reportNotEnabled()` di `AuthProvider`.
- **Servizio iniettato come gli altri moduli.** `CardsServiceProvider` / `useCardsService()` in `main.tsx` e
  in `renderApp` (nuovo parametro facoltativo in coda: i test esistenti restano invariati).
  `src/test/fakeCardsService.ts` replica le regole del server (un uid un cliente, una card attiva, card
  sconosciuta/disattivata/anonimizzata, token in attesa e confermato), registra le chiamate e simula rete
  giù e "arrivato ma risposta persa".
- **Scrittura solo tramite `card-input`.** `CardLinkWriter` usa `useCardWriter().writeUrl(url, {
  expectedUid, signal, allowUnreadable })` e `canWrite`; negli unit test uno scrittore finto
  (`src/test/fakeCardReader.ts`), negli E2E `window.__enjoyFakeCard`, `__enjoyFakeCardWrites`,
  `__enjoyFakeCardControl` (`failNextWrite`, `setCanWrite`) già presenti. Il token vive solo in memoria nel
  componente: mai nel DOM, nello stato del router, in `localStorage` o nei log (test di componente e
  guardia del confine).
- **Le schermate di `customers` si estendono, non si copiano.** Home (consumatore di `useCardRead` al posto
  di `ignoreCardRead`), Nuovo cliente (riquadro «Card letta» o sezione «Card (facoltativa)»), Modifica
  cliente (sezione CARD prima di DATI DEL CLIENTE) e Scheda cliente (parte «Card attiva …E5F6 · ») ricevono
  componenti di `src/features/cards/`; la proprietà delle schermate segue `cross-review.md` §2.
  `/clienti/:id/spesa` è un segnaposto (`PurchasePlaceholderPage`) che `ledger` sostituirà.
- **Dopo l'associazione si torna sempre alla Scheda cliente** `/clienti/:id` (`replace`), con il messaggio
  `role="status"` («Card …A1B2 associata» o «… Link non scritto.»); «Indietro» e «Annulla» restano su
  Modifica cliente. Nuovo cliente da card va su `/clienti/:id/spesa` (`replace`).
- **Pagina pubblica isolata.** `/s/:token` fuori da `RequireAuth` e `AppShell`, caricata con `lazy`; nessun
  `CardReaderSession`, nessuna attesa di `AuthProvider`; `meta robots` noindex. Il service worker non si
  registra su `/s/…` (`injectRegister: false` + registrazione in `main.tsx` che salta `/s/`) e
  `beforeinstallprompt` è annullato. `vercel.json` aggiunge per `/s/(.*)` `Cache-Control: no-store` e
  `X-Robots-Tag: noindex, nofollow` (provato da un test Vitest che legge il file).
- **Origine del link.** `cardLinkUrl(token)` usa `VITE_CARD_LINK_ORIGIN` (solo `https://` senza percorso) o
  `location.origin`; `vite.config.ts` fa fallire la build con `VERCEL_ENV=production` se manca o non è
  `https:`. Variabile in `.env.example` (vuota).
- **Enjoy Display**: titoli e pulsanti senza `… « » @ # * × →` (`scripts/displayGlyphs.test.ts`). I testi
  della spec con «…E5F6» in un titolo (dialogo «Disattivare la card …E5F6?», passo «Avvicina la card
  …E5F6») vanno nel corpo del testo o con l'etichetta fuori dal titolo: vedi Risks.
- **E2E nel progetto `phone`** (parallelo): clienti e uid creati dal test con suffisso unico per
  esecuzione (rieseguibile), mai la card del seed in modifica; contesto del browser senza accesso per la
  pagina pubblica.
- **Revisione di sicurezza obbligatoria** (`security-and-hardening`) ai Checkpoint A (RLS, privilegi,
  token, funzione pubblica) e E (pagina pubblica, intestazioni, service worker, log).
- **Pubblicazione esclusa da questo piano**: migrazioni remote, anteprima e produzione le gestisce
  l'orchestratore; anche le verifiche manuali su Android/iPhone (RUNBOOK) richiedono l'anteprima HTTPS. La PR
  va su `main` e si unisce dopo #18 (`feat/rewards`) e #19 (`feat/card-input`).

## Dependency Graph

```
migrazione cards (task 1-4: tabella, RPC, link, card_points)
    │
    ├── servizio + finto + provider (task 5-6) ── integrazione (task 7)
    │       │
    │       ├── home → spesa / nuovo cliente (task 9-11)
    │       ├── Associa card, Modifica, Scheda (task 12-14)
    │       │       │
    │       │       └── CardLinkWriter (task 15-16, usa card-input writeUrl + cardLinkUrl del task 8)
    │       │               └── scrittura in Associa / Nuovo cliente / Modifica (task 17-19)
    │       │
    │       └── pagina pubblica /s/:token (task 20-22, usa public.card_points del task 4)
    │
    └── guardie, RUNBOOK, criteri, PR (task 23-24)
```

## Task List

Dettaglio di ogni task (criteri, verifica, file) in [todo.md](todo.md).

### Fase 1: Database (rischio più alto)
- [x] Task 1: `app.cards`, trigger, policy, `lookup_card`, `associate_card`, `deactivate_card`, card del seed, pgTAP
- [x] Task 2: `create_customer_with_card` tutto-o-niente e idempotente; anonimizzazione disattiva la card
- [x] Task 3: Link ai punti: `private.card_links`, `issue_card_link`, `confirm_card_link`, disattivazione = link morto
- [x] Task 4: `public.card_points` e allowlist delle funzioni eseguibili da `anon`

### Checkpoint A: `db:test` verde; revisione `security-and-hardening` su RLS, privilegi, token e funzione pubblica

### Fase 2: Servizio
- [ ] Task 5: Tipi, `supabaseCardsService`, traduzione degli errori e guardia dei codici
- [ ] Task 6: `fakeCardsService`, `CardsServiceProvider`, `main.tsx` e `renderApp`
- [ ] Task 7: Integrazione contro lo stack locale: concorrenza, errori, `card_points` via HTTP
- [ ] Task 8: `formatCardLabel`, `cardLinkUrl` e controllo di `VITE_CARD_LINK_ORIGIN` nella build

### Checkpoint B: quality bar completa verde; test esistenti invariati

### Fase 3: Letture
- [ ] Task 9: Home: card attiva → segnaposto Registra spesa, sconosciuta → Nuovo cliente, avvisi
- [ ] Task 10: Nuovo cliente da card nuova (`?card=`): riquadro «Card letta», salvataggio con card, `card_taken`
- [ ] Task 11: Sezione «Card (facoltativa)» in Nuovo cliente senza card

### Fase 4: Associa, Modifica, Scheda
- [ ] Task 12: Associa o sostituisci card (`/clienti/:id/card`): tutti gli esiti dell'associazione
- [ ] Task 13: Sezione CARD di Modifica cliente: card attiva, sostituisci, disattiva, nessuna card
- [ ] Task 14: Riga card della Scheda cliente

### Checkpoint C: Impeccable pulito; confronto a 390×844 con Cerca cliente, Card sconosciuta, Nuovo cliente senza card, Associa card, Card già associata, Modifica cliente, Scheda cliente

### Fase 5: Scrittura del link
- [ ] Task 15: `CardLinkWriter`: emissione, scrittura, conferma, esiti principali, «Salta, lo scrivo più tardi»
- [ ] Task 16: `CardLinkWriter`: rete su conferma con lo stesso token, card scambiata, card illeggibile, card non attiva
- [ ] Task 17: Scrittura in Associa card (tavole Associa-link e Associa-link-errore) ed E2E
- [ ] Task 18: Scrittura dopo il salvataggio in Nuovo cliente (con e senza `?card`) ed E2E
- [ ] Task 19: `LinkState` in Modifica cliente: «Scrivi il link», «Scrivi di nuovo il link», dispositivo che non scrive

### Checkpoint D: tutti gli esiti del punto 8 con test di componente; E2E del link verdi; token mai nel DOM

### Fase 6: Pagina pubblica
- [ ] Task 20: `CardPointsPage` su `/s/:token` (tavole Saldo-punti e Saldo-card-non-attiva), rotta lazy fuori da `RequireAuth`
- [ ] Task 21: Niente PWA su `/s/`: service worker saltato, installazione annullata
- [ ] Task 22: E2E della pagina pubblica (link scritto → saldo senza accesso; vecchio link → «Card non attiva») e intestazioni di `/s/(.*)` in `vercel.json`

### Checkpoint E: revisione `security-and-hardening` della pagina pubblica; Impeccable pulito; leggibile a 320 px

### Fase 7: Chiusura
- [ ] Task 23: Guardia del confine, testi in Enjoy Display, RUNBOOK, `.env.example`, memoria di progetto
- [ ] Task 24: Verifica dei criteri di successo e PR

### Checkpoint F: i 15 criteri verificati (parte manuale su Android/iPhone con l'utente sull'anteprima); quality bar completa verde; PR su `main` pronta per `code-review-and-quality`, da unire dopo #18 e #19

## Copertura dei criteri di successo

| Criterio (docs/specs/SPEC-cards.md) | Task |
|---|---|
| 1. Card attiva in home → `/clienti/:id/spesa` con il nome, entro 2 s, senza tocchi | 9, 10, 22 |
| 2. Card sconosciuta → `/clienti/nuovo?card=UID` con il codice; dopo «Salva cliente» `/clienti/:id/spesa` (Indietro non torna al form), `lookup_card` dà la card | 2, 10 |
| 3. Sostituisci card: vecchia `active=false` con `deactivated_at`, nuova attiva, nulla cambia fuori da `app.cards` | 1, 12 |
| 4. Mai due card attive per un cliente né due clienti per un uid, anche in concorrenza | 1, 7 |
| 5. Card di un altro cliente → «Card già associata» con i testi del wireframe; nessun nome se anonimizzato | 1, 11, 12 |
| 6. Card disattivata in home non apre la spesa e mostra «Card disattivata» | 9, 12 (E2E dopo la sostituzione) |
| 7. Ripetere `associate_card`, `deactivate_card`, `create_customer_with_card` non crea doppioni né errori | 1, 2, 10, 12, 13 |
| 8. `anon` e utente senza profilo non leggono `cards` e non eseguono le RPC | 1, 3, 4 |
| 9. Impeccable pulito; typecheck, lint, test, pgTAP ed E2E verdi in CI | ogni task; 23, 24 |
| 10. Link scritto e verificato su Android tenendo la card; aperto senza accesso mostra solo «ENJOY YOUR POINTS» e il saldo; iPhone XS apre la pagina (manuale) | 15, 17, 18, 20, 22, 23 (RUNBOOK) |
| 11. Sostituire, disattivare o anonimizzare rende il vecchio link uguale a uno inventato; token non verificato non mostra punti | 3, 4, 22 |
| 12. `anon` esegue solo `public.card_points` (intero o `null`, `Cache-Control: no-store`); `private.card_links` senza token in chiaro | 3, 4, 7, 22 |
| 13. Associazione da dispositivo che non scrive → «Link non scritto»; il link si scrive poi da Modifica cliente | 17, 19 |
| 14. Card → Registra spesa non scrive e non chiama `issue_card_link`; card con link in primo piano apre la spesa, non il browser (manuale) | 9, 10, 22, 23 (RUNBOOK) |
| 15. Scrittura riuscita ma non confermata lascia la card `unverified`, mai `written` | 3, 16, 19 |

## Risks and Mitigations

| Rischio | Impatto | Mitigazione |
|---|---|---|
| `anon` esegue una funzione di `public` oltre a `card_points` (privilegi predefiniti di Supabase) | Alto | Allowlist pgTAP sull'insieme esatto; `revoke execute … from public` esplicito |
| Token in chiaro nel database, nei messaggi d'errore, nel DOM, nei log o nell'URL della richiesta | Alto | Solo impronta sha256 (pgTAP su ogni colonna); errori senza `p_token`; test di componente sul DOM; `POST` (E2E sulle richieste); guardia contro `console.*` e `localStorage` |
| Saldo mostrato da una card sbagliata o non verificata | Alto | Token "in attesa" non riconosciuto da `card_points` finché `confirm_card_link` non lo promuove; conferma solo dopo la verifica di `writeUrl` su `expectedUid` |
| Link di una card persa ancora valido | Alto | Trigger `after update` che cancella `private.card_links` a ogni disattivazione; vincolo `check (active or …)`; pgTAP per sostituzione, disattivazione, anonimizzazione, riattivazione |
| Corse fra operatori: due card attive o un uid su due clienti | Alto | `for update` sul cliente, indice unico parziale, `unique_violation` → `card_taken`; test di integrazione concorrenti |
| Build di produzione con origine del link sbagliata o assente | Alto | Controllo in `vite.config.ts` con `VERCEL_ENV=production`; card dei clienti scritte solo dall'app di produzione (RUNBOOK) |
| La pagina pubblica scarica l'app e il service worker sul telefono del cliente | Medio | Rotta lazy; registrazione del SW saltata su `/s/`; `beforeinstallprompt` annullato; test di componente ed E2E |
| `?card` usato per associare un uid preso altrove | Medio | Il server rifà ogni controllo; `normalizeUid(card, 'hex')` nel client; `card_taken` gestito |
| Glifi mancanti in Enjoy Display («…E5F6» in titoli della spec) | Medio | `displayGlyphs.test.ts`; etichetta nel corpo del testo o titolo senza «…» (es. «Disattivare la card E5F6?»): da confermare con l'utente se il testo della spec cambia |
| Il form di `customers` cambia comportamento per la card | Medio | Estensione con props facoltative; test di `customers` invariati e verdi |
| E2E che dipendono dallo stato o dai tempi di scrittura finta (riavvicinare la card dopo 1,5 s) | Medio | Uid e clienti univoci per esecuzione; `__enjoyFakeCard(uid)` esplicito prima della scrittura |
| Intestazioni di `vercel.json` non provabili in locale | Basso | Test Vitest sul file; `curl -I` sull'anteprima annotato nel RUNBOOK (lo fa l'orchestratore) |
| Template email dopo `supabase start` | Basso | `scripts/reload-auth-templates.sh` dopo l'avvio dello stack (RUNBOOK) |

## Open Questions

Nessuna bloccante: le Open Questions 1–21 della spec usano i default adottati, da rivedere con il titolare
(`docs/specs/cross-review.md` §3). Da chiedere all'utente durante l'implementazione, senza fermare il lavoro:

- se un testo della spec con «…» in un titolo in Enjoy Display va riformulato (Risks);
- se registrare in `brain/DECISIONS.md` la decisione del titolare del 2026-11-17 «Punti visibili al cliente
  con la card» (citata dalla spec, non ancora presente nel file).
