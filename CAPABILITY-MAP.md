# Capability Map: Enjoy Card

Approvata il 2026-11-16. Gli id dei moduli sono stabili: non si rinominano. Ogni modulo ha la sua
specifica `SPEC-<id>.md` in questa cartella; questa mappa è l'indice di quelle esistenti. Contratto comune e
revisione incrociata: `docs/specs/`.

| Module id | Responsabilità | Dipende da | Spec |
|---|---|---|---|
| `platform` | Scheletro PWA, Supabase (UE), CI e deploy su Vercel, token del design system, struttura comune delle schermate | — | [SPEC-platform.md](docs/specs/SPEC-platform.md) (approvata) |
| `identity` | Accesso, uscita, sessione scaduta, ruoli; account creati a mano in Supabase (niente inviti); password dimenticata e cambio password con link via email | platform | [SPEC-identity.md](docs/specs/SPEC-identity.md) (V1), [SPEC-identity-password.md](docs/specs/SPEC-identity-password.md) (recupero password; procedura remota in `docs/setup-accounts.md` §6) |
| `settings` | Rapporto euro/punto, soglia di conferma importo, formato del lettore USB | identity | [SPEC-settings.md](docs/specs/SPEC-settings.md) |
| `customers` | Nuovo cliente (nome unico, telefono facoltativo, consenso), ricerca, modifica, anonimizzazione | identity | [SPEC-customers.md](docs/specs/SPEC-customers.md) |
| `card-input` | Unico ingresso per la lettura card: Web NFC, permesso e NFC spento, normalizzazione uid, adattatore finto per i test | platform, settings | [SPEC-card-input.md](docs/specs/SPEC-card-input.md) |
| `cards` | Associa/sostituisci card, una card attiva per cliente, card già associata, card sconosciuta → nuovo cliente; link ai punti scritto sulla card e pagina pubblica del saldo `/s/:token` | customers, card-input | [SPEC-cards.md](docs/specs/SPEC-cards.md) |
| `rewards` | Catalogo premi (nome, punti, attivo) | identity | [SPEC-rewards.md](docs/specs/SPEC-rewards.md) |
| `ledger` | Movimenti: spesa con tastierino e punti, riscatto (catalogo o libero), saldo, annullo entro 10 s, correzioni, idempotenza, saldo ≥ 0 | customers, settings, rewards | [SPEC-ledger.md](docs/specs/SPEC-ledger.md) |
| `export` | Esportazione CSV di clienti e movimenti | customers, ledger | [SPEC-export.md](docs/specs/SPEC-export.md) |
| `tablet-kiosk` | Account di dispositivo, cambio operatore con PIN (blocco dopo 5 errori), lettore USB, schermate tablet 1280×800 | identity, card-input, flussi sopra | [SPEC-tablet-kiosk.md](docs/specs/SPEC-tablet-kiosk.md) |
| `customers-v2` | Delta del 2026-11-23: telefono rimosso, email facoltativa e unica (ricerca, scheda, export), elenco clienti in home a scorrimento infinito per ultima attività (al posto di SERVITI OGGI), premi attivi nella pagina pubblica dei punti, card disattivata o di cliente cancellato: Riattiva / Riformatta (solo amministratori) | customers, cards, card-input, ledger, rewards, export, tablet-kiosk | [SPEC-customers-v2.md](docs/specs/SPEC-customers-v2.md) (delta, proposta) |

**Ordine di costruzione**: platform → identity → settings, customers, rewards → card-input → cards → ledger
→ export → *checkpoint di lancio (50 card)* → tablet-kiosk → customers-v2 (delta del 2026-11-23).

**Checkpoint di lancio** (non è un modulo): testo privacy approvato dal consulente, amministratori creati in
produzione, card stampate e provate su telefono.

**Schermate tablet**: tutte in `tablet-kiosk`; i moduli precedenti realizzano solo il layout telefono.
