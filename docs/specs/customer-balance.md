# Spec: balance — assorbita in `cards` e `card-input`

Status: **non è un modulo**. La prima bozza (2026-11-17) descriveva la stessa funzione con un disegno
diverso da `SPEC-cards.md` e `SPEC-card-input.md` (tabella `app.card_links` con privilegi di colonna,
pagina separata `/clienti/:id/link`, `VITE_BALANCE_LINK_ORIGIN`, `reader.writeUrl` + `bypassRepeat`,
`CardRead.url` ai consumatori, `__enjoyFakeNfcWrites`, testi diversi, link riattivabile con la card).
Due spec normative sulla stessa tabella e sulla stessa pagina si sarebbero contraddette: vale **solo**
quanto scritto in

- `SPEC-cards.md` punti 4, 5, 8 (scrittura del link, `LinkState`), 9 (pagina pubblica `/s/:token`),
  "Modello dati" (`private.card_links`, `link_written_*`, `link_pending_at`, RPC, `public.card_points`),
  "Abuso della funzione pubblica", Open Questions 13–21;
- `SPEC-card-input.md` punto 9 (`useCardWriter().writeUrl`, verifica, `wrong-card`, `unreadable`) e la
  scrittura finta (`__enjoyFakeCardWrites`, `__enjoyFakeCardControl`).

Nessuna voce `balance` in `CAPABILITY-MAP.md`: il lavoro è dentro `cards` (dopo `card-input`; la pagina
pubblica usa `private.customer_balance` di `ledger` quando c'è, `0` prima).

Decisione del titolare del 2026-11-17 «Punti visibili al cliente con la card»: da registrare in
`brain/DECISIONS.md`; cambia i non-obiettivi di `brain/PROJECT.md` (applicato il 2026-11-17).

## Scelte della bozza scartate, e perché

| Bozza `balance` | Vale invece (`cards`) | Motivo |
|---|---|---|
| `app.card_links` con `grant select (card_id, written_at)` | `private.card_links` senza nessun `grant` + stato non segreto in `app.cards` | lo schema `private` non è esposto dall'API; niente privilegi di colonna, fragili con `select *` |
| link della card riattivata di nuovo valido | ogni disattivazione cancella il link; la riattivazione ne scrive uno nuovo | una card persa può essere stata letta o copiata da altri mentre era fuori |
| verifica dell'uid nel server (`confirm_card_link(card_id, uid, token)`) | verifica dell'uid nello scrittore (`expectedUid`), token in attesa finché non è riletto | l'uid mandato dal client non prova nulla in più; il token in attesa basta a non pubblicare saldi sulla card sbagliata |
| `CardRead.url` ai consumatori di `useCardRead` | gli URL letti restano dentro `card-input` | contengono il token del cliente: meno codice li vede, meno rischi di log |
| pagina separata `/clienti/:id/link` | sezione `CardLinkWriter` dentro le schermate | un passaggio di navigazione in meno alla consegna |

## Controlli di sicurezza fatti nella revisione (dove sono scritti)

| Rischio | Esito | Dove |
|---|---|---|
| Indovinare un token | 128 bit casuali: ~10⁻³⁶ per tentativo con qualche centinaio di card; nessun limite di frequenza nel database, e non serve | `cards` "Abuso" |
| `anon` legge altro | `app` e `private` chiusi ad `anon`; in `public` l'unica funzione eseguibile da `anon` è `card_points(text)` (allowlist pgTAP: i privilegi predefiniti di Supabase la darebbero a ogni nuova funzione di `public`) | `cards` Testing |
| Risposta che distingue i casi | sempre intero o `null`, mai errori; token in attesa, card disattivata, cliente anonimizzato e token inventato danno `null` | `cards` `card_points` |
| Token nei log | `POST` con il token nel corpo (non nell'URL di Supabase); log di Vercel: compare come percorso `/s/…` (vede al più un saldo); nessun log, `ErrorBoundary` o analisi registra `location.href`; Web Analytics/Speed Insights spenti; RPC senza token nei messaggi d'errore | `cards` punti 8–9, "Abuso" |
| Token nel referrer, cache, motori | `Referrer-Policy: no-referrer` (già), `Cache-Control: no-store` su `/s/(.*)` e nella risposta della funzione, `X-Robots-Tag` + `meta robots` | `cards` "Intestazioni" |
| Token nell'interfaccia degli operatori o nell'export | il token esce dal server una sola volta (in memoria nello scrittore), mai nel DOM; `export` legge solo `app` (uid della card attiva, nessun dato del link) | `cards` Boundaries; `SPEC-export.md` invariata |
| Cronologia del telefono del personale | con la lettura attiva in primo piano la card va all'app; altrimenti Android apre il link (browser o app installata) e il link resta in cronologia: accettato | `cards` "Card scritta sul telefono del personale", OQ 21 |
| PWA sul telefono del cliente | niente service worker né proposta d'installazione su `/s/…` | `cards` punto 9 |
| Scrittura sulla card sbagliata | scrittura solo dopo aver riconosciuto l'uid; `wrong-card` con `otherUid`; il token vale solo dopo la verifica sulla card giusta | `card-input` punto 9, `cards` punto 8 |
| Scrittura interrotta / card rovinata | `io`; Chrome può non dare più l'uid (`readingerror`): riparazione con «Scrivi comunque»; alla cassa ricerca per nome | `card-input` punto 9, OQ 17; `cards` OQ 20 |
| Scritta ma non confermata | `link_pending_at` → stato `unverified` in Modifica cliente; rete su `confirm` → «Riprova» con lo stesso token | `cards` punti 5 e 8 |
| Associazione annullata dopo la scrittura | impossibile: si scrive solo dopo l'associazione confermata; una disattivazione successiva uccide il link | `cards` punto 8, Modello dati |
| Card riscritta da altri (non bloccata) | link falso possibile; l'uid alla cassa funziona; si riscrive | `cards` "Abuso", OQ 19 (titolare) |
| Spazio sulla card | ~60 byte su 504 | `cards` punto 8.7 |
| Obiettivo 10 s | il percorso della spesa non scrive mai | `cards` Objective, Success Criteria 14 |
| iPhone | lettura in background da XS in poi, schermo sbloccato, notifica da toccare; l'app su iPhone non scrive (`canWrite` falso) | `cards` Objective, `card-input` RUNBOOK |
| Tablet | il lettore USB non scrive: "link non scritto", si scrive poi da un Android | `cards` punto 4, `card-input` punto 6 |

## Altri documenti da allineare (fuori da queste tre spec)

- `CLAUDE.md`: «Card: adesivi NTAG215, **solo lettura** dell'uid, mai scritte» e «il cliente … **non vede
  nulla**, nemmeno il saldo» → card con il solo link ai punti; il cliente vede solo il saldo dal suo telefono.
- `brain/PROJECT.md` non-obiettivi (`PROJECT-nonobiettivi.patch.md`) e `brain/DECISIONS.md`.
- `SPEC-ledger.md` Ask first «mostrare qualcosa al cliente»: eccezione per il solo saldo della pagina pubblica.
- `SPEC-tablet-kiosk.md`: Associa card dal lettore USB lascia "link non scritto" (testo «non ci scrive
  nulla» corretto sul tablet).
- `CAPABILITY-MAP.md`: `cards` aggiunge `/s/:token` e dipende (morbidamente) da `ledger` per il saldo.
- Wireframe "Associa o sostituisci card" («non ci scrive nulla») superato dalle tavole definitive del
  titolare "Associa-link" (scrittura del link: «Card associata a Maria», «Tieni la card appoggiata»,
  «Scrivo il link per vedere i punti…», «Salta, lo scrivo più tardi») e "Associa-link-errore" («Link non
  scritto», «Scrivi di nuovo il link», «Più tardi», «Puoi scriverlo anche dopo, da Modifica cliente.»);
  pagina pubblica nelle tavole "Saldo-punti" («ENJOY YOUR POINTS», saldo in stile `figure`, «Mostra la card
  alla cassa per usare i tuoi punti.») e "Saldo-card-non-attiva" («Card non attiva» · «Questa card non
  mostra punti. Chiedi al bar.»): testi in `cards` punti 4, 8 e 9 (OQ 15 chiusa).
- `docs/specs/cross-review.md` §3.1 (riga dell'informativa, `cards` OQ 16) e §3.2 (testi).
- `SPEC-export.md`: nessuna modifica; facoltativo un caso pgTAP che le colonne esportate non includano
  nulla di `private.card_links`.
