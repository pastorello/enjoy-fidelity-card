# Spec: platform — V1

Status: approved (2026-11-16)
Modulo: `platform` ([CAPABILITY-MAP.md](CAPABILITY-MAP.md)) · Fonti: specifiche, wireframe e design system
"Enjoy Bar" (link in `brain/MAP.md` §5) · Decisioni: `brain/DECISIONS.md`.

## Objective

Costruire la base su cui poggiano tutti gli altri moduli, senza alcuna funzione di dominio: un'app PWA vuota
ma installabile, collegata a Supabase, con test, controlli automatici e pubblicazione già funzionanti, e con
l'aspetto del design system "Enjoy Bar".

**Chi la usa**: gli sviluppatori (umani e agenti) dei moduli successivi. Nessun utente finale vede ancora
funzioni utili.

**Perché prima di tutto**: ogni modulo successivo deve poter aggiungere una schermata, una migrazione e i
suoi test senza decidere di nuovo stack, struttura o stile.

## Tech Stack

Versioni stabili al 2026-11-16, fissate da `package-lock.json`; aggiornamenti maggiori = "Ask first".

| Area | Scelta |
|---|---|
| Linguaggio | TypeScript 7 (`strict`, `noUncheckedIndexedAccess`) |
| UI | React 19, React Router 8 (modalità libreria, SPA) |
| Build | Vite 8, `vite-plugin-pwa` 2 (manifest + service worker) |
| Dati | `@supabase/supabase-js` 2, TanStack Query 5 per lo stato server |
| Backend | Supabase (Postgres, Auth, RLS, Edge Functions); CLI `supabase` 3 come devDependency |
| Test | Vitest 5 + Testing Library; pgTAP (`supabase test db`); Playwright 1.65 |
| Qualità | Oxlint 1 (regole TypeScript, React, react-hooks, jsx-a11y) con controllo sui tipi via `oxlint-tsgolint` 7; Prettier |
| Hosting | Vercel (deploy da GitHub); Supabase in regione UE (Francoforte) |
| Runtime | Node 24, npm |

Stile: CSS con custom properties generate dai token, niente framework CSS; font self-hosted.

## Cosa include

1. **Scheletro app**: Vite + React + TS; routing con una rotta `/` segnaposto ("Enjoy Card") e una pagina 404.
   Error boundary globale con messaggio in italiano e pulsante "Riprova".
2. **Token del design system**: `src/styles/tokens.css` con colori, tipografia, spaziature, raggi, misure e
   breakpoint presi da `tokens.json` del design system (copiato in `design/tokens.json`). Solo tema
   **Chiaro**, quello dei wireframe (`surface` = paper `#faf5f1`, `ink` = black, header `enjoy-green`).
   Uno script (`npm run tokens`) rigenera il CSS dal JSON; il CSS generato è committato.
3. **Font**: Texturina (variabile, normale e corsivo) e Stint Ultra Condensed in `public/fonts/` (licenza
   OFL), dichiarati con `@font-face`. Nessuna richiesta a Google Fonts (privacy UE, app installata).
4. **Struttura comune delle schermate** (dal wireframe "Cerca cliente"): header verde alto 64 px con logo e
   pulsante account (48×48), area principale con margini `space-3`, area azioni in basso con bordo
   `divider`. Componente `AppShell`.
5. **Componenti base** in `src/shared/ui/`, usati da tutti i moduli:
   - `Button`: varianti primary (pieno `enjoy-green`), secondary (bordo verde su paper), danger; alto 56 px,
     testo `label-lg`, spigoli vivi.
   - `TextField` (alto 56 px, testo 18 px, label sopra, errore con `danger-text`), `SearchField`.
   - `ListRow` (min 64 px, area di tocco intera), `PointsBadge` (ocra, testo nero), `ScreenTitle`.
   - `ConfirmDialog` (anche pericoloso), `StatusView` per caricamento / vuoto / errore con "Riprova".
   - Focus visibile 2 px `focus-ring` con 2 px di distacco su tutti i controlli.
6. **Formattazione**: `formatCents(1250) → "12,50 €"` e `formatPoints(45) → "45 pt"` (locale `it-IT`) in
   `src/shared/format.ts`.
7. **PWA**: manifest (`name` "Enjoy Card", `lang` it, `display` standalone, `orientation` any,
   `theme_color` `#00603a`, `background_color` `#faf5f1`, icone 192/512 + maskable); il service worker
   mette in cache solo l'app shell, **mai** risposte di Supabase (nessuna modalità offline). Aggiornamento
   automatico alla nuova versione al successivo avvio.
8. **Supabase**:
   - Progetto locale con `supabase init` / `supabase start` (Docker); cartelle `supabase/migrations`,
     `supabase/functions`, `supabase/tests`.
   - Migrazione iniziale: estensione `pgcrypto`, schema `app` (accesso solo ad `authenticated` e
     `service_role`, mai ad `anon`), schema `private` per funzioni interne, event trigger che attiva la RLS
     su ogni tabella creata in `app` (verificato da un test pgTAP; `pgtap` si attiva solo nei test).
   - Registrazione libera disattivata (`enable_signup = false`): gli account li crea un amministratore.
     Storage di Supabase disattivato (non usato).
   - Client unico `getSupabase()` in `src/lib/supabase.ts` da `VITE_SUPABASE_URL` e
     `VITE_SUPABASE_PUBLISHABLE_KEY` (chiave *publishable*; rifiuta chiavi segrete e URL non HTTPS remoti).
     Quali tabelle esporre via API si decide nelle spec dei moduli successivi.
   - Progetti remoti: **produzione** e **staging**, entrambi in UE; le anteprime Vercel usano staging.
9. **HTTPS in sviluppo**: `npm run dev:https` serve l'app in HTTPS sulla rete locale (certificato di
   sviluppo), per provarla sul telefono Android: Web NFC funziona solo in HTTPS.
10. **CI (GitHub Actions)** su ogni PR e su `main`: typecheck, lint, test unitari, build, test database
    (`supabase start` + `supabase test db`), test E2E Playwright sulla build (viewport 390×844).
11. **Deploy**: integrazione Git di Vercel (anteprima per ogni PR, produzione da `main`); `vercel.json` con
    rewrite SPA e intestazioni di sicurezza (CSP restrittiva: solo l'origine dell'app e `*.supabase.co`,
    che copre i progetti di produzione e staging; `Referrer-Policy`, `X-Content-Type-Options`,
    `Permissions-Policy` che nega camera, microfono, posizione e pagamenti; Web NFC non ha una voce di
    Permissions-Policy e resta consentito alla stessa origine). `vite preview` applica le stesse intestazioni. Le migrazioni in produzione si
    applicano a mano con `supabase db push`, documentato nel RUNBOOK.

## Commands

```bash
npm install                 # dipendenze
npm run dev                 # Vite in locale (http://localhost:5173)
npm run dev:https           # HTTPS sulla rete locale, per il telefono
npm run tokens              # rigenera src/styles/tokens.css da design/tokens.json
npm run typecheck           # tsc --noEmit
npm run lint                # oxlint --type-aware --deny-warnings
npm run format              # prettier --write .
npm test                    # vitest run
npm run test:watch          # vitest
npm run build               # tsc -b && vite build
npm run preview             # serve la build
npm run db:start            # supabase start (Docker)
npm run db:reset            # supabase db reset (applica migrazioni + seed)
npm run db:test             # supabase test db (pgTAP)
npm run e2e                 # playwright test (avvia la preview da sé)
```

## Project Structure

```
src/
  app/              → AppShell, router, provider (Query, error boundary)
  features/<id>/    → un modulo della capability map per cartella (componenti, hook, test)
  shared/ui/        → componenti base del design system
  shared/format.ts  → formattazione importi e punti
  lib/supabase.ts   → client Supabase
  styles/           → tokens.css (generato), base.css, fonts.css
design/tokens.json  → copia del design system "Enjoy Bar"
public/fonts/       → woff2 self-hosted; public/icons/ → icone PWA
supabase/
  migrations/       → SQL versionato (un file per modifica)
  functions/        → Edge Functions (es. inviti, modulo identity)
  tests/            → test pgTAP
  seed.sql          → dati finti per lo sviluppo (mai dati reali)
e2e/                → test Playwright
scripts/            → script di build (es. generazione token)
```

I test unitari stanno accanto al codice (`*.test.ts(x)`).

## Code Style

```tsx
// src/shared/ui/PointsBadge.tsx
import { formatPoints } from '../format';
import styles from './PointsBadge.module.css';

type PointsBadgeProps = {
  points: number;
};

export function PointsBadge({ points }: PointsBadgeProps) {
  return <span className={styles.badge}>{formatPoints(points)}</span>;
}
```

- Codice, nomi e commenti in inglese; testi dell'interfaccia in italiano, scritti direttamente nei componenti.
- Componenti in PascalCase, un componente esportato per file, export nominati (niente default export).
- CSS Modules accanto al componente; solo variabili dei token, mai colori o misure scritte a mano.
- Importi sempre `number` intero in centesimi; il nome lo dice (`amountCents`).
- Accessibilità: controlli nativi (`button`, `a`, `input` + `label`), `aria-label` sui pulsanti con sola icona.
- SQL: snake_case, tabelle al plurale, ogni tabella con RLS e almeno una policy esplicita.

## Testing Strategy

| Livello | Strumento | Cosa copre | Dove |
|---|---|---|---|
| Unità | Vitest | Funzioni pure (formattazione; in futuro punti, uid) | accanto al codice |
| Componenti | Vitest + Testing Library | Comportamento e accessibilità dei componenti base | accanto al codice |
| Database | pgTAP | Schema, RLS, funzioni Postgres | `supabase/tests/` |
| End-to-end | Playwright | Percorsi completi nella build, viewport 390×844 | `e2e/` |

- In questo modulo: test di `format.ts`, dei componenti base (ruoli ARIA, focus, varianti), della RLS
  predefinita, e un E2E che carica `/`, verifica titolo, header e assenza di errori in console.
- Copertura: nessuna soglia globale; ogni funzione pura deve avere test (soglie da definire con
  `constraint-driven-development` se servono).
- Le regole di dominio saranno testate soprattutto a livello database, dove sono applicate.

## Boundaries

- **Always**: typecheck, lint e test verdi prima di ogni commit; nuove tabelle con RLS e test pgTAP; testi
  UI in italiano; solo token per colori e misure; PR piccole collegate alla sezione di spec che realizzano.
- **Ask first**: nuove dipendenze; modifiche allo schema non previste da una spec; cambi alla CI, a Vercel o
  ai progetti Supabase; `supabase db push` in produzione; aggiornamenti maggiori di versione.
- **Never**: segreti nel repo (la chiave service role solo nelle Edge Functions); dati reali nei seed o nei
  test; cache di dati Supabase nel service worker; disattivare la RLS; saltare o cancellare test per farli
  passare; richieste a servizi esterni non necessarie (font, analytics).

## Success Criteria

1. `npm install && npm run build` termina senza errori né warning di TypeScript.
2. `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:test` ed `npm run e2e` sono verdi in locale
   e in CI su una PR.
3. L'anteprima Vercel della PR mostra la schermata segnaposto con header verde, logo e font Texturina; la CSP
   non blocca nulla (console pulita).
4. Su un telefono Android con Chrome l'app di produzione si installa dalla voce "Installa app", si apre a
   schermo intero e mostra icona e nome "Enjoy Card".
5. Lighthouse sulla produzione: PWA installabile, Accessibilità ≥ 95, Best Practices ≥ 95.
6. Un test pgTAP prova che una tabella creata in `app` senza policy non è leggibile da un utente
   autenticato.
7. Il service worker non contiene in cache alcuna risposta da `*.supabase.co` (verificato da un test E2E).
8. Il progetto Supabase di produzione è nella regione UE (Francoforte).
9. RUNBOOK e CLAUDE.md riportano i comandi reali.

## Out of Scope (Deferred)

- Tema Scuro: i wireframe usano il Chiaro; i token scuri restano nel JSON per dopo.
- Layout tablet (breakpoint 600/840 px): arrivano con `tablet-kiosk`.
- Monitoraggio errori in produzione (es. Sentry): da valutare prima del lancio, vedi Open Questions.
- Dominio personalizzato: si parte con l'indirizzo Vercel.
- Funzionamento offline, notifiche push, analytics: non-obiettivi del progetto.

## Open Questions

Risolte il 2026-11-16:
- **Staging**: sì, due progetti Supabase (produzione e staging), entrambi in UE.
- **Account**: Supabase e Vercel li crea l'utente con il proprio account; l'agente prepara configurazione e
  istruzioni e non crea account.

Aperte (non bloccano l'avvio):
1. **Logo e icona**: il design system contiene i PNG ufficiali (`enjoy-lettering-negative.png` per la
   barra verde, `enjoy-badge-solo-negative.png` su quadrato `enjoy-green` per l'icona). Si usano quelli;
   un SVG resta preferibile se arriva il vettoriale.
2. **Monitoraggio errori**: resta fuori da questa spec (vedi Out of Scope); da decidere prima del lancio.
