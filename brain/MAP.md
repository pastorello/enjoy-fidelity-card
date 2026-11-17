# MAP — Mappa del progetto

> **A cosa risponde**: "Com'è fatto il progetto? Dove trovo le informazioni?"
> Granularità a livello di modulo. **Prima cosa da leggere in ogni nuova sessione**, insieme a `STATUS.md`.

---

## 1. Avvio rapido

`npm install`, `npm run db:start`, `npm run dev`. Comandi completi in `CLAUDE.md` e
`topics/operations/RUNBOOK.md`.

## 2. Moduli

| Modulo | Responsabilità | Stato | Posizione |
|---|---|---|---|
| App PWA | Interfaccia per telefono (390×844) e tablet (1280×800); lettura card via Web NFC e lettore USB | base pronta (`platform`) | `src/` |
| Backend Supabase | Postgres, Auth, RLS; transazioni di spesa/riscatto con controllo saldo e idempotenza | base pronta (schema `app`, RLS automatica) | `supabase/` |
| Tooling agenti | Skill, subagent e hook di progetto | stabile | `.claude/` |
| Memoria di progetto | Stato, decisioni, passaggi tra sessioni | stabile | `brain/` |

## 3. Dipendenze tra moduli

```
card NFC ──(Web NFC | lettore USB tastiera)──▶ App PWA ──(Supabase Auth + RLS)──▶ Postgres
                                                  │
                                       hosting Vercel (HTTPS, richiesto da Web NFC)
```

La lettura card ha un unico punto d'ingresso nell'app: telefono e lettore USB sono equivalenti.

## 4. I 5 file di continuità (`brain/`)

| File | Risponde a | Quando leggerlo |
|---|---|---|
| `PROJECT.md` | Definizione, intento confermato, non-obiettivi | Primo contatto, perimetro in dubbio |
| `MAP.md` | Struttura, indice dei documenti | Ogni sessione |
| `STATUS.md` | Stato attuale, prossimo passo | Ogni sessione |
| `HANDOFF.md` | Rapporto dell'ultimo turno | Ogni sessione (se compilato) |
| `DECISIONS.md` | Decisioni e alternative scartate | Quando serve il perché di una scelta |

`handoffs/` — archivio dei vecchi HANDOFF.

## 5. Documenti (topics e fonti)

### Fonti di verità esterne (claude.ai, private)
| Documento | Cos'è | Quando leggerlo |
|---|---|---|
| [Specifiche](https://claude.ai/artifact/59XU2sRGx1EoUtxS8mxN6S) | Obiettivo, architettura, ruoli, flussi, modello dati, privacy, fasi | Prima di scrivere spec, schema o flussi |
| [Wireframe](https://claude.ai/artifact/K6PkvCmqMum8jV3cNuHD7n) | 41 schermate telefono + tablet, stati ed errori, note | Prima di ogni lavoro di UI o di flusso |
| [Design system "Enjoy Bar"](https://claude.ai/artifact/GY9B6wF97G5FCLapU8KRUH) | Colori, tipografia, componenti, stati/errori/conferme | Prima di `/impeccable init` e di ogni UI |

### Nel repo
| File | Cos'è | Quando leggerlo |
|---|---|---|
| `CLAUDE.md` | Regole stabili: architettura, invarianti di dominio, ruoli, privacy, workflow skill | Ogni sessione (caricato in automatico) |
| `CAPABILITY-MAP.md` | Moduli, dipendenze, ordine di costruzione, indice delle spec | Prima di scegliere su cosa lavorare |
| `SPEC-platform.md` | Spec del modulo `platform` (approvata) | Prima di lavorare su scheletro, CI, deploy, UI base |
| `PRODUCT.md` | Contesto di prodotto per Impeccable (utenti, ambiente, tono "tu", vincoli di marchio) | Prima di ogni lavoro di UI |
| `design/tokens.json` | Copia dei token del design system "Enjoy Bar" (fonte di `src/styles/tokens.css`) | Quando cambiano colori, testo o misure |
| `tasks/plan.md`, `tasks/todo.md` | Piano e task del modulo in corso | Prima di implementare |
| `docs/setup-accounts.md` | Guida per creare Supabase (prod + staging) e Vercel, e applicare le migrazioni | Prima del primo deploy |
| `docs/adr/` | (da creare) decisioni architetturali dettagliate | Quando una decisione richiede più di una voce in DECISIONS |

### operations/
| File | Cos'è | Quando leggerlo |
|---|---|---|
| `topics/operations/RUNBOOK.md` | Comandi, controlli, dove guardare, trappole numerate | Prima di operare; quando qualcosa si rompe; prima di un HANDOFF |

`topics/systems/`, `topics/planning/`, `topics/feedback/`: vuote per ora; registrare qui ogni file aggiunto.

## 6. Flussi di lavoro e progetti vicini

Progetto a flusso unico (`STATUS.md` / `HANDOFF.md`), nessun progetto vicino. Se nasceranno flussi paralleli
(es. app e operazioni), seguire METHODOLOGY §3.5 di project-brain.

## 7. Auto-calibrazione della MAP

Aggiornare quando: un modulo nasce/cambia stato (§2), cambia una dipendenza (§3), si aggiunge o toglie un
documento (§5), cambiano i comandi di avvio (§1). Su richiesta ("calibra la MAP"): cercare file in `topics/`
non registrati, voci che puntano a file inesistenti, descrizioni non più vere.
