# PROJECT — Enjoy Card

> **A cosa risponde**: "Cos'è questo progetto? Che problema risolve? **Cosa NON facciamo?**"
> Contenuto quasi immutabile: se cambia spesso, la definizione sta derivando → registrarlo in `DECISIONS.md`.

---

## Definizione in una riga

Fidelity card a punti dell'Enjoy Bar: app (PWA) con cui titolari e camerieri riconoscono il cliente dalla
card NFC o per nome, registrano le spese in punti e riscattano premi.

## Problema risolto

Il bar vuole premiare i clienti abituali e farli tornare, con una card fisica che fa anche da strumento di
marketing, senza rallentare la cassa: dalla card alla conferma della spesa in meno di 10 secondi.

## Intento confermato (interview-me, 2026-11-16)

- **Risultato**: l'Enjoy Card completa, come da specifiche e wireframe, consegnata e in uso al bar.
- **Utenti**: titolari (amministratori) e camerieri (operatori), da telefono Android e tablet della cassa.
- **Perché ora**: partire con le prime 50 card. Nessuna data fissa; il tempo non è un vincolo.
- **Successo**: lettura card affidabile (telefono e lettore USB), card → conferma < 10 s, invarianti su
  punti e saldo mai violate.
- **Vincolo principale**: affidabilità, correttezza dei dati, sicurezza e privacy > velocità di consegna.
- **Perimetro**: tutte e tre le fasi delle specifiche (telefono con NFC, lancio 50 card, tablet con lettore
  USB e cambio operatore con PIN).

## Cosa NON facciamo (non-obiettivi)

- **Non contattiamo i clienti** (messaggi, offerte, campagne), perché il titolare non lo vuole: il telefono
  del cliente serve solo a trovarlo più in fretta, ed è facoltativo.
- **Nessuna area per il cliente oltre al saldo**: niente account, accesso, nome, movimenti o premi. L'unica
  cosa che il cliente vede è il proprio saldo, avvicinando la card al suo telefono (pagina pubblica dal
  link scritto sulla card, decisione del titolare del 2026-11-17). Alla cassa il flusso resta a senso unico:
  il cliente consegna la card all'operatore.
- **Niente funzionamento offline** (coda di spese in attesa di rete), perché l'utente l'ha escluso
  esplicitamente. Resta solo il reinvio idempotente dopo un errore di rete.
- **Sulle card scriviamo solo il link ai punti**: un record URL con un token segreto e casuale (mai l'uid),
  scritto dall'app con Web NFC alla consegna e verificato rileggendolo. Saldo e stato restano sul server; le
  card non si bloccano in sola lettura (scelta irreversibile, esclusa per ora dal titolare).
- **Nessuna lettura card su iPhone**: Web NFC esiste solo in Chrome per Android; su iPhone l'app funziona
  con la sola ricerca.

## Utenti

- **Sì**: titolari (amministratori) e camerieri (operatori) dell'Enjoy Bar.
- **No**: i clienti (non usano l'app), altri locali (un solo bar).

## Origine e convinzioni

- Specifiche e wireframe sono stati scritti prima del codice e restano le **fonti di verità**
  (link in `MAP.md` §5 e in `CLAUDE.md`).
- La card è una scorciatoia, non un requisito: tutto deve funzionare anche cercando per nome o telefono.
- Lo storico è intoccabile: i movimenti non si cancellano, si correggono.
