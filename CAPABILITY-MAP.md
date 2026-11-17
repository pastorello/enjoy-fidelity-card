# Capability Map: Enjoy Card

Approvata il 2026-11-16. Gli id dei moduli sono stabili: non si rinominano. Ogni modulo ha la sua
specifica `SPEC-<id>.md` in questa cartella; questa mappa è l'indice di quelle esistenti. Contratto comune e
revisione incrociata: `docs/specs/`.

| Module id | Responsabilità | Dipende da | Spec |
|---|---|---|---|
| `platform` | Scheletro PWA, Supabase (UE), CI e deploy su Vercel, token del design system, struttura comune delle schermate | — | [SPEC-platform.md](SPEC-platform.md) (approvata) |
| `identity` | Accesso, uscita, sessione scaduta, ruoli; account creati a mano in Supabase (niente inviti); password dimenticata e cambio password con link via email | platform | [SPEC-identity.md](SPEC-identity.md) (V1), [SPEC-identity-password.md](SPEC-identity-password.md) (recupero password; procedura remota in `docs/setup-accounts.md` §6) |
| `settings` | Rapporto euro/punto, soglia di conferma importo, formato del lettore USB | identity | [SPEC-settings.md](SPEC-settings.md) |
| `customers` | Nuovo cliente (nome unico, telefono facoltativo, consenso), ricerca, modifica, anonimizzazione | identity | [SPEC-customers.md](SPEC-customers.md) |
| `card-input` | Unico ingresso per la lettura card: Web NFC, permesso e NFC spento, normalizzazione uid, adattatore finto per i test | platform, settings | [SPEC-card-input.md](SPEC-card-input.md) |
| `cards` | Associa/sostituisci card, una card attiva per cliente, card già associata, card sconosciuta → nuovo cliente | customers, card-input | [SPEC-cards.md](SPEC-cards.md) |
| `rewards` | Catalogo premi (nome, punti, attivo) | identity | [SPEC-rewards.md](SPEC-rewards.md) |
| `ledger` | Movimenti: spesa con tastierino e punti, riscatto (catalogo o libero), saldo, annullo entro 10 s, correzioni, idempotenza, saldo ≥ 0 | customers, settings, rewards | [SPEC-ledger.md](SPEC-ledger.md) |
| `export` | Esportazione CSV di clienti e movimenti | customers, ledger | [SPEC-export.md](SPEC-export.md) |
| `tablet-kiosk` | Account di dispositivo, cambio operatore con PIN (blocco dopo 5 errori), lettore USB, schermate tablet 1280×800 | identity, card-input, flussi sopra | [SPEC-tablet-kiosk.md](SPEC-tablet-kiosk.md) |

**Ordine di costruzione**: platform → identity → settings, customers, rewards → card-input → cards → ledger
→ export → *checkpoint di lancio (50 card)* → tablet-kiosk.

**Checkpoint di lancio** (non è un modulo): testo privacy approvato dal consulente, amministratori creati in
produzione, card stampate e provate su telefono.

**Schermate tablet**: tutte in `tablet-kiosk`; i moduli precedenti realizzano solo il layout telefono.
