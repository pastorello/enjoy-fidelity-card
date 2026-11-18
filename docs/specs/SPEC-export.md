# Spec: export — V1

Status: approvata (2026-11-17) su delega dell'utente — le Open Questions adottano i default proposti, da rivedere con il titolare (`docs/specs/cross-review.md` §3)
Modulo: `export` ([CAPABILITY-MAP.md](../../CAPABILITY-MAP.md)) · Dipende da: `identity`, `customers`, `cards`,
`ledger` · Fonti: specifiche ("Ruoli e account": esportazione dati per l'amministratore; "Sicurezza e
privacy": "Esportazione clienti e movimenti in CSV per l'amministratore", cancellazione su richiesta),
wireframe Impostazioni (sezione ESPORTA DATI), Impostazioni operatore (nota finale), Tablet: impostazioni e
nota "Solo amministratori: … esportazione CSV …" · Decisioni: `brain/DECISIONS.md` (2026-11-16 "Importi in
centesimi interi ovunque": export CSV convertito solo in uscita).

## Objective

Il titolare scarica sul telefono, in un tocco, due file CSV che si aprono bene in Excel in italiano:
**Clienti** (anagrafica e saldo) e **Movimenti** (tutto lo storico). Servono per conteggi, contabilità e
per rispondere a una richiesta di accesso ai dati. I camerieri non possono esportare.

**Utenti**:
- **Amministratore**: vede la sezione "ESPORTA DATI" in `/impostazioni` con i pulsanti "Clienti CSV" e
  "Movimenti CSV".
- **Operatore**: non vede la sezione. La nota finale del wireframe Impostazioni operatore ("Operatori, premi,
  esportazioni e annullamenti dei movimenti li gestiscono gli amministratori.") appartiene a `settings`, che
  costruisce la versione ridotta della pagina; se al momento dell'implementazione manca ancora, la aggiunge
  questo modulo con lo stesso testo. Le funzioni di export rifiutano l'operatore sul server.

**Successo**: un amministratore tocca "Movimenti CSV"; dopo pochi secondi Chrome salva
`enjoy-movimenti-2026-11-17.csv`; aperto in Excel (impostazioni italiane) mostra colonne separate, accenti
corretti, importi come numeri ("12,50"), date leggibili all'ora italiana, e nessun dato personale dei
clienti anonimizzati.

## Cosa include

1. **Sezione "ESPORTA DATI"** in `/impostazioni`, ultima della pagina (wireframe Impostazioni): titolo di
   sezione come le altre, griglia a due colonne con due pulsanti `secondary` alti 48 px e icona download
   (nuova icona Lucide `download`, gli stessi tre tracciati del wireframe, in `Icon`): **Clienti CSV** ·
   **Movimenti CSV**. Resa solo se `operator.role === 'admin'` (comodità di interfaccia: la protezione vera è
   il controllo sul server, punto 6). Le altre sezioni del wireframe (account, PUNTI E CONTROLLI, GESTIONE)
   non sono di questo modulo: account = `identity`, PUNTI E CONTROLLI = `settings`, Catalogo premi =
   `rewards`, Operatori rinviato (`brain/DECISIONS.md`, 2026-11-17). Sul tablet la stessa sezione appare nel
   layout di `tablet-kiosk` (fuori ambito, vedi sotto).
2. **Stati** (design system «Stati, errori e conferme», nota "Altri stati da gestire"):
   - *in corso*: il pulsante toccato usa `busy` del `Button` esistente (spinner, `aria-busy`, tocchi
     ignorati); la regione `aria-live="polite"` sotto i pulsanti dice "Preparazione del file…"; l'altro
     pulsante resta usabile; un secondo tocco sullo stesso pulsante non avvia un'altra esportazione (anche
     il hook `useExport` ignora `run()` mentre è in corso, non solo il pulsante);
   - *fatto*: nella stessa regione: "Clienti esportati: 312." / "Movimenti esportati: 4.518." (conteggio
     con `Intl.NumberFormat('it-IT', { useGrouping: 'always' })` come in `src/shared/format.ts`: senza
     `'always'` l'italiano non raggruppa i numeri di 4 cifre);
   - *nessun dato*: il file si scarica lo stesso con la sola riga di intestazione; messaggio "Nessun
     cliente da esportare: il file contiene solo le intestazioni." (idem "Nessun movimento…");
   - *errore di rete* (anche a metà delle pagine): nessun file parziale; messaggio "Esportazione non
     riuscita: controlla la connessione e riprova." e il pulsante torna attivo. Ripetere è sicuro:
     l'export **legge soltanto**, non scrive nulla, quindi non serve `operation_id`;
   - *permesso negato* (ruolo cambiato mentre la pagina era aperta, errore `42501`): "Solo un
     amministratore può esportare i dati." e `reportNotEnabled()` (`SPEC-customers.md`), che ricarica il
     profilo (la sezione sparisce) o torna su `/accedi` se l'account è stato tolto;
   - *errore imprevisto*: "Esportazione non riuscita. Riprova; se succede ancora, avvisa chi gestisce
     l'app.";
   - *sessione scaduta*: la gestisce `identity` (ritorno su `/accedi`).
3. **Generazione nel client**: il servizio legge le righe a pagine dalle funzioni RPC riservate agli
   amministratori (punto 6), le trasforma con funzioni pure in testo CSV e il browser lo salva con
   `Blob` (tipo `text/csv;charset=utf-8`) + `URL.createObjectURL` + `<a download>`. L'URL si revoca poco
   dopo il clic (`setTimeout`), non nello stesso istante, perché alcuni browser annullano un download il cui
   URL è già revocato. Il funzionamento in Chrome Android da PWA installata non è coperto da Playwright
   (Chromium desktop): si verifica a mano sul telefono (Success Criteria 10). Nessuna chiave service role,
   nessuna funzione Edge.
4. **Formato del file** (per Excel in italiano):
   - UTF-8 **con BOM** (`﻿`), separatore `;`, righe chiuse da CRLF, una riga di intestazione;
   - campi tra virgolette doppie solo se contengono `;`, `"`, CR o LF; le virgolette interne raddoppiate;
   - **testo libero** (nome cliente in entrambi i file, note, premio o descrizione, nomi operatore) che
     inizia con `=`, `+`, `-`, `@`, TAB o CR riceve un apostrofo iniziale (difesa da CSV injection, OWASP);
     i campi numerici e le date non sono toccati (`-12,50` e `-12` restano numeri);
   - **euro** solo in uscita da centesimi interi: `1250 → "12,50"`, `-1250 → "-12,50"`, senza simbolo € né
     separatore delle migliaia (Excel li legge come numeri); **punti** interi con segno, senza separatori;
   - **date** nel fuso `Europe/Rome` con `Intl.DateTimeFormat` (indipendente dal fuso del telefono), formato
     `gg/mm/aaaa hh:mm:ss` 24 ore (`hourCycle: 'h23'`, così la mezzanotte è `00`, mai `24`), ora legale
     compresa, componenti montati da `formatToParts` e non dalla stringa localizzata; data assente → campo
     vuoto;
   - **telefono e uid** come testo per Excel: `="+393331234567"`, `="04A1B2C3D4E5F6"` (altrimenti Excel li
     converte in numero, perde il "+" o gli zeri iniziali). Entrambi sono validati sul server (E.164 e
     `^[0-9A-F]{8,20}$`), ma `excelText` non si fida: usa la forma `="…"` solo se il valore rispetta
     `^\+?[0-9A-F]{1,20}$`, altrimenti scrive il valore come testo libero con la difesa dalle formule;
   - **nomi file** con la data di oggi a Roma: `enjoy-clienti-AAAA-MM-GG.csv`,
     `enjoy-movimenti-AAAA-MM-GG.csv`.
5. **Colonne** (in quest'ordine; intestazioni italiane):
   - *Clienti* (ordinati per nome, `it-IT`, insensibile a maiuscole e accenti; anonimizzati in fondo per
     data di creazione): `Codice cliente` (uuid) · `Nome` · `Telefono` · `Card attiva` (uid o vuoto) ·
     `Saldo punti` · `Consenso privacy` (data e ora) · `Note` · `Creato il` · `Creato da` (nome
     operatore) · `Anonimizzato il` (vuoto se no).
   - *Movimenti* (ordinati per `created_at`, poi `id`, dal più vecchio): `Data e ora` · `Codice movimento`
     (uuid) · `Codice cliente` · `Cliente` · `Tipo` (`Spesa` | `Riscatto` | `Correzione`) · `Importo €`
     (solo spese) · `Punti` · `Euro per punto` (rapporto in vigore, solo spese: `100 → "1,00"`) ·
     `Premio o descrizione` · `Operatore` · `Annulla il movimento` (codice del movimento corretto, solo
     correzioni) · `Annullato da` (codice della correzione, se esiste).
   - **Clienti anonimizzati**: `Nome`, `Telefono`, `Note` e `Card attiva` vuoti in entrambi i file
     (`Cliente` vuoto nei movimenti), qualunque cosa contenga la riga; restano codice, saldo, date e
     movimenti, "per i conteggi" (specifiche). L'azzeramento avviene **nella funzione SQL**: i dati
     personali di un anonimizzato non lasciano mai il server.
6. **Funzioni RPC di sola lettura** (migrazione di questo modulo, sezione seguente) con paginazione a chiave
   (keyset) da 1000 righe, il limite `max_rows` di PostgREST in `supabase/config.toml`: il client chiede
   pagine finché ne riceve una più corta del limite.

### Modello dati e regole di accesso

Nessuna tabella nuova. Due funzioni in schema `app`:

```sql
app.export_customers(p_after_id uuid default null, p_limit int default 1000)
  returns table (id uuid, name text, phone text, active_card_uid text, balance_points int,
                 privacy_consent_at timestamptz, notes text, created_at timestamptz,
                 created_by_name text, anonymized_at timestamptz)  -- balance_points: int
  -- ordine stabile per la paginazione: id; l'ordinamento per nome si fa nel client
app.export_movements(p_after_created_at timestamptz default null, p_after_id uuid default null,
                     p_limit int default 1000)
  returns table (id uuid, created_at timestamptz, customer_id uuid, customer_name text, kind text,
                 amount_cents int, points int, cents_per_point int, description text,
                 operator_name text, corrects_movement_id uuid, corrected_by_movement_id uuid)
  -- ordine (created_at, id); description = movements.description, altrimenti nome del premio
```

- `security definer`, `stable`, `set search_path = ''`; `revoke execute … from public, anon`;
  `grant execute … to authenticated`.
- Prima riga del corpo: `if not private.is_admin() then raise exception using errcode = '42501'`.
  Operatori, utenti senza profilo e operatori scollegati ricevono `42501`.
- `p_limit` null o fuori da 1–1000 → `22023`. Cursore: `(created_at, id) > (p_after_created_at,
  p_after_id)`; entrambi null = dall'inizio; uno solo dei due null → `22023`.
- Il nome di un cliente non anonimizzato è quello attuale (non una copia al momento del movimento).
- Anonimizzati (`anonymized_at is not null`): `name`, `phone`, `notes`, `active_card_uid` e
  `customer_name` restituiti `null`.
- `balance_points` = `private.customer_balance(id)` di `ledger` (somma di tutti i movimenti, correzioni
  comprese, `0` se nessuno): un solo calcolo del saldo in tutto il database.
- Le righe inserite durante un'esportazione possono esserci o no; una nuova esportazione le include.
- Indice `movements (created_at, id)`: lo crea già `ledger`, questo modulo non ne aggiunge.

## Commands

Nessun comando nuovo. Si usano `npm test`, `npm run db:test`, `npm run test:integration`, `npm run e2e`.
`test:integration` è previsto da `SPEC-identity.md` ma oggi non è in `package.json`: se manca ancora
all'inizio di questo modulo, lo si aggiunge (Vitest con una config che include solo `tests/integration/`).

## Project Structure

```
supabase/migrations/<timestamp>_export.sql     → export_customers, export_movements, grant/revoke
supabase/tests/export.test.sql                  → pgTAP
src/features/export/
  types.ts                  → CustomerExportRow, MovementExportRow, ExportService, ExportResult
  csv.ts (+ .test.ts)       → toCsv, escapeField, guardFormula, excelText, BOM
  formatExport.ts (+ .test.ts) → centsToEuroCell, romeDateTime, romeDateStamp, kindLabel
  buildCustomersCsv.ts / buildMovementsCsv.ts (+ .test.ts) → righe → testo, ordinamento
  fetchAllPages.ts (+ .test.ts) → paginazione keyset generica, tutto-o-niente
  supabaseExportService.ts (+ .test.ts) → RPC, mappa errori (42501 → forbidden, fetch → network)
  downloadFile.ts           → Blob + <a download> + revokeObjectURL (unico punto con il DOM)
  ExportSection.tsx (+ .module.css, .test.tsx)
src/shared/ui/Icon.tsx                          → icona `download`
src/test/fakeExportService.ts                   → servizio finto in memoria (dati @example)
src/features/identity/SettingsPage.tsx          → rende <ExportSection/> in fondo, solo admin
tests/integration/export.test.ts                → Vitest contro lo stack locale
e2e/export.spec.ts
```

## Code Style

Come `platform` e `identity`: i componenti non chiamano `getSupabase()`; centesimi interi nei tipi;
testi UI in italiano nei componenti; solo token CSS. Le funzioni di formattazione sono pure e testate senza DOM.

```ts
export type ExportKind = 'customers' | 'movements';
export type ExportResult =
  | { status: 'ok'; count: number }
  | { status: 'forbidden' | 'network' | 'unknown' };
export type ExportService = {
  fetchCustomers(): Promise<CustomerExportRow[]>;  // tutte le pagine o rifiuta
  fetchMovements(): Promise<MovementExportRow[]>;
};
export function useExport(kind: ExportKind): { run(): Promise<ExportResult>; busy: boolean };

export function centsToEuroCell(cents: number): string;   // 1250 → "12,50"; non intero → RangeError
export function romeDateTime(iso: string): string;        // "2026-07-01T10:05:00Z" → "01/07/2026 12:05:00"
```

`centsToEuroCell` è distinta da `formatCents` (che aggiunge spazio, `€` e separatore delle migliaia, adatti
allo schermo ma non a Excel).

## Testing Strategy

| Livello | Cosa copre |
|---|---|
| pgTAP (`export.test.sql`) | admin chiama entrambe le funzioni e riceve le colonne attese; operatore, utente senza profilo e `anon` → 42501 / permesso negato; anonimizzato: `name`, `phone`, `notes`, `active_card_uid`, `customer_name` null, saldo e movimenti presenti; `balance_points` = somma con correzioni, 0 senza movimenti; `corrected_by_movement_id` coerente con `corrects_movement_id`; paginazione: due pagine con `p_limit = 2` coprono tutte le righe senza duplicati; `p_limit` 0, 1001 e null → 22023; cursore con un solo campo → 22023; `anon` e `public` senza `execute` (catalogo `has_function_privilege`); nessuna scrittura (`provolatile = 's'`) |
| Unità (Vitest) | `escapeField` (`;`, `"`, a capo), difesa formule su `=`/`+`/`-`/`@`/TAB/CR solo nel testo (un importo `-12,50` resta intatto), `excelText` (valore valido → `="…"`, valore con `"` o lettere → testo protetto); BOM e CRLF; `centsToEuroCell` (0, 5, 1250, -1250, 123456); `romeDateTime` in ora solare e legale, mezzanotte (`00:…`, mai `24:…`), fuso del processo diverso (il test fissa `process.env.TZ`/usa un fuso diverso da Roma in CI, che gira in UTC); nome file con la data di Roma alle 23:30 UTC; ordinamento clienti per nome con accenti e anonimizzati in fondo; `fetchAllPages` con 0, 1000, 1001 righe (cursori passati correttamente alla seconda pagina) ed errore alla seconda pagina (rifiuta, nessuna riga restituita); mappatura errori del servizio (`42501` → forbidden, `TypeError` di fetch → network, altro → unknown) |
| Componenti (Vitest + Testing Library, `fakeExportService`, `fakeAuthService`, `downloadFile` sostituito) | admin vede i due pulsanti, operatore no; busy e niente doppio avvio (due clic rapidi → una sola chiamata al servizio); messaggi di "in corso", successo, nessun dato, rete, forbidden, imprevisto nella regione `aria-live`; in caso d'errore `downloadFile` non viene chiamato; dopo un errore di rete un nuovo tocco riesce; target ≥ 48 px |
| Integrazione (Vitest + stack locale) | con le credenziali del seed l'operatore riceve 42501 da entrambe le RPC; l'admin le legge; un cliente finto creato e anonimizzato nel test con le RPC di `customers`: il suo nome originale non compare nel corpo della risposta HTTP |
| E2E (Playwright, 390×844, build di produzione, Supabase locale) | admin: tocca "Clienti CSV" e "Movimenti CSV", `page.waitForEvent('download')`, nome file `enjoy-…-<oggi>.csv`, contenuto letto da `download.path()`: BOM, intestazioni italiane, `;`, un cliente creato nel test (nome finto e univoco per esecuzione) con saldo e una spesa con "12,50"; data del nome file calcolata nel test con `Europe/Rome`; richiesta RPC interrotta con `page.route(...).abort()` (i dati E2E stanno in una pagina; il caso a metà paginazione lo coprono unità e componenti) → nessun download, messaggio di rete, nuovo tocco riuscito; operatore: sezione assente; nessun errore in console; nessuna richiesta a Supabase ospitato. Dati preparati con la UI o con l'adattatore card finto dove serve |

## Boundaries

- **Always**: controllo del ruolo **sul server** in ogni funzione; dati personali degli anonimizzati
  azzerati in SQL; conversione centesimi → euro e fuso orario solo nella formattazione di uscita; file solo
  sul dispositivo dell'amministratore; dati finti nei test e nei fixture.
- **Ask first**: aggiungere colonne con dati personali (email operatori, card disattivate); filtri per
  periodo; altri formati (Excel `.xlsx`, PDF); invio dei file per email o a servizi esterni.
- **Never**: chiave service role nel client; esportazione da operatore; scrivere o modificare dati
  durante l'export; salvare i CSV su server o storage; loggare il contenuto dei file.

Nota: le policy di `customers` e `movements` permettono comunque a un operatore attivo di leggere i dati che
usa al banco; le RPC limitano la funzione di esportazione richiesta dalle specifiche, non la lettura.

## Success Criteria

1. Un amministratore vede "ESPORTA DATI" con "Clienti CSV" e "Movimenti CSV" (48 px); un operatore non la vede.
2. Da operatore, `app.export_customers` e `app.export_movements` chiamate dall'API danno errore di permesso
   (pgTAP + integrazione).
3. Il file Movimenti inizia con BOM e con la riga `Data e ora;Codice movimento;Codice cliente;Cliente;Tipo;
   Importo €;Punti;Euro per punto;Premio o descrizione;Operatore;Annulla il movimento;Annullato da`
   (CRLF); una spesa di 1250 centesimi con rapporto 100 compare con `12,50`, `12` e `1,00`.
4. Un movimento del 1° luglio alle 10:05 UTC compare come `01/07/2026 12:05:00`; uno del 15 gennaio alle
   10:05 UTC come `15/01/2026 11:05:00`, con qualunque fuso del dispositivo.
5. Un cliente anonimizzato compare con nome, telefono, note e card vuoti, saldo corretto, e i suoi movimenti
   con `Cliente` vuoto; le funzioni restituiscono quei campi `null` (pgTAP) e il nome originale non è nel
   corpo della risposta HTTP (integrazione).
6. Un nome che inizia con `=` esce come `'=…` (tra virgolette solo se contiene `;`, `"` o a capo); un nome
   con `;` e `"` esce tra virgolette con le virgolette raddoppiate, e un parser CSV RFC 4180 con separatore
   `;` lo rilegge come un solo campo identico all'originale (unità).
7. Con 1001 movimenti il file ne contiene 1001 (due pagine, unità `fetchAllPages`); con un errore di rete
   su una pagina `downloadFile` non viene chiamato e compare il messaggio di rete; un nuovo tocco riesce
   (componenti ed E2E con `page.route`).
8. Il nome del file è `enjoy-movimenti-AAAA-MM-GG.csv` con la data di Roma.
9. A 390×844 la sezione è l'ultima della pagina, con titolo "ESPORTA DATI" e i due pulsanti affiancati,
   "Clienti CSV" a sinistra, ciascuno alto ≥ 48 px con icona (E2E); detector Impeccable pulito; CI verde
   (typecheck, lint, test, integrazione, pgTAP, E2E).
10. Prova manuale sul telefono Android del titolare, con la PWA installata e lo stack di staging: i due file
    si scaricano e si aprono in Excel o Fogli Google con colonne e accenti corretti; esito annotato nel
    RUNBOOK.

## Out of Scope (Deferred)

- Layout tablet della sezione: `tablet-kiosk` (riusa `ExportSection`).
- Filtri per periodo, per cliente o per operatore; export di catalogo premi e operatori.
- Export in `.xlsx`, condivisione con il menu di Android (Web Share), invio automatico o pianificato.
- Export del solo cliente (richiesta di accesso GDPR di una persona): se serve, spec aggiuntiva.
- Registro di chi ha esportato e quando.

## Open Questions

1. **Colonne.** Le fonti dicono solo "clienti e movimenti in CSV". Proposta: le colonne del punto 5,
   con saldo nei clienti e codici (uuid) per collegare i due file (default adottato).
2. **Anonimizzati.** Proposta: nome, telefono, note e uid card vuoti, azzerati in SQL; righe e movimenti
   inclusi per i conteggi (default adottato). La descrizione di un premio libero resta com'è: se un
   operatore vi ha scritto dati personali, l'anonimizzazione (modulo `customers`) non li tocca.
3. **Telefono e uid in Excel.** Proposta: scritti come `="…"` perché Excel non tolga "+" e zeri; il
   rovescio è che in altri programmi si vede la formula testuale (default adottato).
4. **Formato date.** Proposta: una colonna `gg/mm/aaaa hh:mm:ss` all'ora di Roma, che Excel italiano
   riconosce come data (default adottato).
5. **Nessun dato.** Proposta: si scarica comunque il file con le sole intestazioni e lo si dice nel
   messaggio (default adottato).
6. **Periodo.** Proposta: sempre tutto lo storico, nessun filtro; i volumi (centinaia di clienti) lo
   permettono (default adottato).
7. **Operatori e lettura.** Proposta: le RPC bloccano solo l'esportazione; la lettura per il lavoro al banco
   resta regolata dalle policy degli altri moduli (default adottato).
8. **Ordine dei clienti.** Proposta: per nome (`it-IT`), anonimizzati in fondo (default adottato).
9. **Testi dei messaggi.** I wireframe mostrano solo i due pulsanti: i testi di "in corso", successo,
   nessun dato ed errori del punto 2 sono una proposta basata sul design system «Stati, errori e conferme»
   (default adottato).
10. **Dati personali nei file.** Il file Clienti contiene nome e telefono di tutti i clienti e resta nei
    Download del telefono. Proposta: nessuna protezione aggiuntiva (solo admin, file sul dispositivo); da
    citare nell'informativa privacy da far verificare al consulente (default adottato).
