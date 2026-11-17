# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

PWA installata da Chrome su Android (telefono 390×844). Su iPhone funziona solo con la ricerca, senza
lettura card. Tablet della cassa 1280×800 in orizzontale nella fase 3 (modulo `tablet-kiosk`).

## Users

- **Operatori** (camerieri): in piedi al bancone o in sala, di fretta, spesso con una mano sola.
  Riconoscono il cliente dalla card NFC o lo cercano per nome o telefono, poi registrano la spesa o
  riscattano un premio.
- **Amministratori** (titolari): fanno tutto quello che fanno gli operatori; in più gestiscono operatori,
  catalogo premi, rapporto euro/punto, soglia di conferma, export CSV, annullamenti e anonimizzazione.
- Il **cliente** consegna la card e non vede nulla, nemmeno il saldo: non è un utente dell'app.

## Product Purpose

Fidelity card a punti dell'Enjoy Bar: il cliente accumula punti in base a quanto spende e il titolare
decide quali premi offrire. Successo = dalla card alla conferma della spesa in **meno di 10 secondi**,
senza errori di importo o di punti.

## Positioning

Strumento interno di un solo bar, non un prodotto da vendere: niente app per i clienti, niente
marketing, niente contatti con i clienti. La card NFC è una scorciatoia e uno strumento di marketing,
ma tutto funziona anche senza card, cercando il cliente.

## Operating Context

- Bancone ben illuminato di giorno e **dehors all'aperto, anche in pieno sole**: serve contrasto alto
  e testo leggibile a colpo d'occhio.
- Uso in piedi, di fretta, a volte con un vassoio in mano: target touch ≥ 48 px, azioni principali grandi
  e lontane dal bordo inferiore (barre di Android).
- Flusso a senso unico: il cliente porge la card, l'operatore la avvicina al telefono, legge e conferma.
- Più operatori contemporaneamente sullo stesso archivio online; nessuna modalità offline.
- Importi inseriti con un tastierino interno a centesimi, come sui POS (1-2-5-0 = 12,50 €).

## Capabilities and Constraints

- Moduli e ordine di costruzione in `CAPABILITY-MAP.md`; specifiche per modulo in `SPEC-<id>.md`.
- Regole di dominio (importi in centesimi interi, saldo mai sotto zero, movimenti mai cancellati ma
  corretti, idempotenza) in `CLAUDE.md`.
- Lingua dell'interfaccia: italiano.
- Repo pubblico: nessun dato reale di clienti, nemmeno negli esempi.
- Aperti: logo SVG e icona dell'app definitivi (per ora segnaposto).

## Brand Commitments

- **Design system "Enjoy Bar" vincolante** (https://claude.ai/artifact/GY9B6wF97G5FCLapU8KRUH): colori,
  tipografia (Texturina, Stint Ultra Condensed), componenti e stati. Tema chiaro, come nei wireframe.
- **Wireframe** (https://claude.ai/artifact/K6PkvCmqMum8jV3cNuHD7n): struttura e flussi delle schermate.
- **Tono**: si dà del **tu**, diretto e breve ("Avvicina la card", "Spesa registrata").

## Evidence on Hand

Nessun contenuto reale: niente foto, testimonianze o dati di clienti, e non vanno inventati. Logo in SVG
non ancora disponibile.

## Product Principles

1. **Velocità al bancone**: ogni schermata serve a chiudere un'operazione in pochi tocchi; nulla di
   decorativo che rallenti.
2. **Correttezza prima di tutto**: importi e punti sempre visibili e confermati; errori spiegati in
   parole semplici, mai codici tecnici.
3. **Leggibile ovunque**: contrasto alto anche al sole, testo grande, un'azione principale per schermata.
4. **Riservatezza**: si mostra solo quello che serve all'operatore; il cliente non vede nulla.

## Accessibility & Inclusion

WCAG 2.1 AA come minimo; contrasto elevato per l'uso all'aperto; target touch ≥ 48 px (pulsanti
principali 56 px); focus visibile; uso con una mano sola.
