# Capability Map: Enjoy Card

Approvata il 2026-11-16. Gli id dei moduli sono stabili: non si rinominano. Ogni modulo ha la sua
specifica `SPEC-<id>.md` in questa cartella; questa mappa è l'indice di quelle esistenti.

| Module id | Responsabilità | Dipende da | Spec |
|---|---|---|---|
| `platform` | Scheletro PWA, Supabase (UE), CI e deploy su Vercel, token del design system, struttura comune delle schermate | — | [SPEC-platform.md](SPEC-platform.md) (approvata) |
| `identity` | Accesso, invito via email, password (scelta e recupero), ruoli, gestione e disattivazione operatori, sessione scaduta | platform | — |
| `settings` | Rapporto euro/punto, soglia di conferma importo, formato del lettore USB | identity | — |
| `customers` | Nuovo cliente (nome unico, telefono facoltativo, consenso), ricerca, modifica, anonimizzazione | identity | — |
| `card-input` | Unico ingresso per la lettura card: Web NFC, permesso e NFC spento, normalizzazione uid, adattatore finto per i test | platform, settings | — |
| `cards` | Associa/sostituisci card, una card attiva per cliente, card già associata, card sconosciuta → nuovo cliente | customers, card-input | — |
| `rewards` | Catalogo premi (nome, punti, attivo) | identity | — |
| `ledger` | Movimenti: spesa con tastierino e punti, riscatto (catalogo o libero), saldo, annullo entro 10 s, correzioni, idempotenza, saldo ≥ 0 | customers, settings, rewards | — |
| `export` | Esportazione CSV di clienti e movimenti | customers, ledger | — |
| `tablet-kiosk` | Account di dispositivo, cambio operatore con PIN (blocco dopo 5 errori), lettore USB, schermate tablet 1280×800 | identity, card-input, flussi sopra | — |

**Ordine di costruzione**: platform → identity → settings, customers, rewards → card-input → cards → ledger
→ export → *checkpoint di lancio (50 card)* → tablet-kiosk.

**Checkpoint di lancio** (non è un modulo): testo privacy approvato dal consulente, amministratori creati in
produzione, card stampate e provate su telefono.

**Schermate tablet**: tutte in `tablet-kiosk`; i moduli precedenti realizzano solo il layout telefono.
