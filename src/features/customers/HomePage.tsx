import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { formatTime } from '../../shared/format';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { ListRow } from '../../shared/ui/ListRow';
import { PointsBadge } from '../../shared/ui/PointsBadge';
import { SearchField } from '../../shared/ui/SearchField';
import { StatusView } from '../../shared/ui/StatusView';
import { CardReadPanel } from '../card-input/CardReadPanel';
import { homeCardNotice } from '../cards/homeCardNotice';
import { useHomeCardRead } from '../cards/useHomeCardRead';
import { useCurrentOperator } from '../identity/AuthProvider';
import styles from './HomePage.module.css';
import { customerBackState } from './customerBack';
import { readHomeNotice } from './homeNotice';
import { loadErrorText } from './loadErrorText';
import { classifyQuery, maskPhone } from './phone';
import type { CustomerSummary } from './types';
import { SEARCH_SHOWN_ROWS, useCustomerSearch, type CustomerSearch } from './useCustomerSearch';
import { useServedToday, type ServedToday } from './useServedToday';

/**
 * The label of the button that registers the name searched without results (wireframe Ricerca
 * senza risultati). Enjoy Display lacks the guillemets, and the name is typed by the user: both
 * are set in the body font (plan.md, Open Question 1). Changing the button's form touches only this.
 */
function newCustomerLabel(name: string): ReactNode {
  return (
    <span className={styles.newCustomerLabel}>
      Nuovo cliente <span className={styles.typedName}>«{name}»</span>
    </span>
  );
}

/** "••• 4521" or "Senza telefono": the second line of a customer row. */
function phoneLine(customer: CustomerSummary): string {
  return customer.phone === null ? 'Senza telefono' : maskPhone(customer.phone);
}

/** "••• 0388 · 10:15": the phone and the time of the last purchase or redemption. */
function servedLine(customer: CustomerSummary): string {
  const phone = phoneLine(customer);
  return customer.lastServedAt === null ? phone : `${phone} · ${formatTime(customer.lastServedAt)}`;
}

/**
 * SERVITI OGGI (wireframe Cerca cliente): nothing while loading or when nobody was served today,
 * a compact row with "Riprova" when the list cannot be loaded.
 */
function ServedTodaySection({
  served,
  headingRef,
  onRetry,
}: {
  served: ServedToday;
  /** The h2, which takes the focus from "Riprova" and stays mounted while the list loads. */
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRetry: () => void;
}) {
  if (served.status === 'loading') return null;
  if (served.status === 'done' && served.customers.length === 0) return null;
  return (
    <section aria-labelledby="served-today" className={styles.served}>
      <h2 ref={headingRef} id="served-today" tabIndex={-1} className={styles.sectionTitle}>
        SERVITI OGGI
      </h2>
      {served.status === 'error' ? (
        <div role="alert" className={styles.servedError}>
          <p className={styles.servedErrorText}>
            <Icon name="circle-alert" size={20} />
            Non riesco a caricare i clienti di oggi
          </p>
          <Button variant="secondary" busy={served.retrying} onClick={onRetry}>
            Riprova
          </Button>
        </div>
      ) : (
        <ul className={styles.list}>
          {served.customers.map((customer) => (
            <ListRow
              key={customer.id}
              to={`/clienti/${customer.id}`}
              title={customer.name}
              subtitle={servedLine(customer)}
              trailing={<PointsBadge points={customer.balance} />}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What the live region under the search says once a search ends: TalkBack users hear that it is
 * done and how many rows came back. Empty while idle or loading, so the next outcome is a change
 * (and is read) even when it says the same; an error has its own `role="alert"`.
 */
function searchAnnouncement(search: CustomerSearch): string {
  if (search.status !== 'done') return '';
  const count = search.customers.length;
  if (count === 0) return 'Nessun cliente trovato';
  if (search.hasMore) return `Più di ${SEARCH_SHOWN_ROWS} clienti trovati: scrivi qualcosa in più`;
  return count === 1 ? '1 cliente trovato' : `${count} clienti trovati`;
}

/** A live region is read only when its text changes after it is on the page. */
const NOTICE_DELAY_MS = 100;

/**
 * The one-time message of the navigation state (`homeNotice.ts`): kept for as long as the home
 * is open, dropped at once from the history entry so "Indietro" or a reload does not show it again.
 */
function useHomeNotice(): { notice: string | null; written: boolean } {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice] = useState(() => readHomeNotice(location.state));
  // The status row is mounted empty and the message written a moment later, so it is read out.
  const [written, setWritten] = useState(false);
  useEffect(() => {
    if (notice === null) return undefined;
    const timer = window.setTimeout(() => setWritten(true), NOTICE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const carried = readHomeNotice(location.state) !== null;
  useEffect(() => {
    if (!carried) return;
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
  }, [carried, navigate, location.pathname, location.search, location.hash]);
  return { notice, written };
}

/** Text of the card panel while reading is active (wireframe Cerca cliente). */
const CARD_PANEL_TITLE = 'Avvicina la card';
const CARD_PANEL_TEXT =
  'Lettura attiva: appoggia la card sul retro del telefono. Una card nuova apre la registrazione del cliente.';

/** The panel's text while `cards` looks the card up (SPEC-cards, point 1). */
const CARD_PANEL_READING = 'Lettura della card…';

/** Home "Cerca cliente": card panel, search by name or phone, SERVITI OGGI, "Nuovo cliente". */
export function HomePage() {
  const operator = useCurrentOperator();
  const { notice, written: noticeWritten } = useHomeNotice();
  const served = useServedToday();
  const [searchParams, setSearchParams] = useSearchParams();
  // The text lives in the URL too (`?q=`, replaced), so "Indietro" from a customer finds it again.
  const [text, setText] = useState(() => searchParams.get('q') ?? '');
  const search = useCustomerSearch(text);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchOutcome = useRef<HTMLDivElement>(null);
  const servedHeading = useRef<HTMLHeadingElement>(null);
  // Set by SERVITI OGGI's "Riprova" until its answer arrives.
  const servedRetrying = useRef(false);
  const servedCount = served.status === 'done' ? served.customers.length : null;
  // `cards` handles the card reads: Registra spesa, Nuovo cliente with the card, or a notice.
  const cardRead = useHomeCardRead();
  const cardNotice = homeCardNotice(cardRead);
  // While a search is shown the card panel shrinks to one line (wireframe Ricerca senza risultati),
  // unless it has something to say about the card just read.
  const searching = search.status !== 'idle';

  // "Riprova" is replaced by the loading state: the focus goes to the search outcome, which
  // stays mounted while searching and then holds the results, not to <body>.
  function retrySearch() {
    search.retry();
    searchOutcome.current?.focus();
  }

  function retryServed() {
    servedRetrying.current = true;
    served.retry();
    servedHeading.current?.focus();
  }

  // With nobody served today the section goes away after "Riprova": the focus goes to the search.
  useEffect(() => {
    if (!servedRetrying.current || servedCount === null) return;
    servedRetrying.current = false;
    if (servedCount === 0) searchInput.current?.focus();
  }, [servedCount]);
  // No results for a name: the button registers that name (`?nome=`); for a phone, nothing.
  const typedName = text.trim().replace(/\s+/g, ' ');
  const prefill =
    search.status === 'done' && search.customers.length === 0 && classifyQuery(typedName) === 'name'
      ? typedName
      : null;

  function changeText(value: string) {
    setText(value);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === '') next.delete('q');
        else next.set('q', value);
        return next;
      },
      { replace: true },
    );
  }

  return (
    <AppShell
      account={{ name: operator.name, to: '/impostazioni' }}
      actions={
        prefill === null ? (
          <ButtonLink to="/clienti/nuovo" variant="secondary" icon="plus" block>
            Nuovo cliente
          </ButtonLink>
        ) : (
          <ButtonLink
            to={`/clienti/nuovo?${new URLSearchParams({ nome: prefill }).toString()}`}
            icon="plus"
            block
          >
            {newCustomerLabel(prefill)}
          </ButtonLink>
        )
      }
    >
      {notice !== null && (
        <output className={noticeWritten ? styles.notice : 'visually-hidden'}>
          {noticeWritten && (
            <>
              <Icon name="check" size={20} />
              {notice}
            </>
          )}
        </output>
      )}
      <CardReadPanel
        title={CARD_PANEL_TITLE}
        description={cardRead.status === 'reading' ? CARD_PANEL_READING : CARD_PANEL_TEXT}
        variant={searching && cardRead.status === 'idle' ? 'compact' : 'full'}
        notice={cardNotice}
      />
      <SearchField
        ref={searchInput}
        label={searching ? 'Cerca per nome o telefono' : 'Oppure cerca per nome o telefono'}
        placeholder="Es. Rossi o 4521"
        value={text}
        onChange={changeText}
      />
      {/* On the page from the start: TalkBack does not read a live region that arrives with its text. */}
      <p className="visually-hidden" aria-live="polite" data-testid="search-announcer">
        {searchAnnouncement(search)}
      </p>
      {/* The focus target of "Riprova": mounted from the first search to the last result. */}
      {searching && (
        <div ref={searchOutcome} tabIndex={-1} className={styles.outcome}>
          {search.status === 'loading' && <StatusView kind="loading" label="Ricerca…" />}
          {search.status === 'error' && (
            <StatusView
              kind="error"
              title="Ricerca non riuscita"
              description={loadErrorText(search.error)}
              onRetry={retrySearch}
            />
          )}
          {search.status === 'done' && search.customers.length === 0 && (
            <StatusView
              kind="empty"
              title="Nessun cliente trovato"
              description="Controlla come è scritto, o cerca con le ultime 4 cifre del telefono."
            />
          )}
          {search.status === 'done' && search.customers.length > 0 && (
            <section>
              <ul className={styles.list} aria-label="Risultati della ricerca">
                {search.customers.map((customer) => (
                  <ListRow
                    key={customer.id}
                    to={`/clienti/${customer.id}`}
                    // "Indietro" from the customer page comes back to this search.
                    state={customerBackState(text)}
                    title={customer.name}
                    subtitle={phoneLine(customer)}
                    trailing={<PointsBadge points={customer.balance} />}
                  />
                ))}
              </ul>
              {search.hasMore && (
                <p className={styles.more}>
                  Mostro i primi {SEARCH_SHOWN_ROWS}: scrivi qualcosa in più
                </p>
              )}
            </section>
          )}
        </div>
      )}
      {/* While a search is shown, SERVITI OGGI is not. */}
      {!searching && (
        <ServedTodaySection served={served} headingRef={servedHeading} onRetry={retryServed} />
      )}
    </AppShell>
  );
}
