import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AppShell } from '../../app/AppShell';
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
import { UsbReaderStatus } from '../tablet-kiosk/UsbReaderStatus';
import { useUsbCardInput } from '../tablet-kiosk/useUsbCardInput';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';
import { activityLabel } from './activityLabel';
import styles from './HomePage.module.css';
import { customerBackState } from './customerBack';
import { homeSearchState, readHomeSearch } from './homeSearch';
import { loadErrorText } from './loadErrorText';
import { NavigationNotice } from './NavigationNotice';
import { listQuery, useCustomerList, type CustomerList } from './useCustomerList';

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

/** How far below the window the sentinel starts the next page (SPEC-customers-v2 point 6). */
const SENTINEL_MARGIN = '400px';

/**
 * Calls `onEnter` when the element given to the returned callback ref comes within 400 px of the
 * window. The window scrolls on the phone and on the tablet (`root: null`). The page renders the
 * sentinel only while a next page can be asked, with the row count as its `key`: a new element
 * for every page, so a sentinel still in view after a page loads asks the next one. Without
 * `IntersectionObserver` nothing happens ("Mostra altri clienti" stays).
 */
function useSentinel(onEnter: () => void): (element: HTMLDivElement | null) => void {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (target === null || !('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onEnter();
      },
      { root: null, rootMargin: SENTINEL_MARGIN },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [target, onEnter]);
  return setTarget;
}

/**
 * What the live region under the search says once a search ends (SPEC-customers-v2 point 6):
 * TalkBack users hear that it is done. Empty for the plain list and while the rows of the text
 * typed are not there yet, so the next outcome is a change (and is read) even when it says the
 * same; an error has its own `role="alert"`.
 */
function searchAnnouncement(list: CustomerList, query: string): string {
  if (query === '' || list.status !== 'done' || list.query !== query) return '';
  return list.customers.length === 0 ? 'Nessun cliente trovato' : 'Clienti trovati';
}

/** Text of the card panel while reading is active (wireframe Cerca cliente). */
const CARD_PANEL_TITLE = 'Avvicina la card';
const CARD_PANEL_TEXT =
  'Lettura attiva: appoggia la card sul retro del telefono. Una card nuova apre la registrazione del cliente.';

/** Texts of the reader column on the till tablet (wireframe "Tablet: cerca cliente"). */
const TABLET_PANEL_TITLE = 'Passa la card sul lettore';
const TABLET_PANEL_TEXT =
  'L’app riceve il codice dal lettore da sola, senza bisogno di toccare un campo. Una card nuova apre la registrazione del cliente.';

/** The panel's text while `cards` looks the card up (SPEC-cards, point 1). */
const CARD_PANEL_READING = 'Lettura della card…';

/**
 * Home "Cerca cliente": card panel, search by name or email, CLIENTI, "Nuovo cliente". CLIENTI
 * (SPEC-customers-v2 point 6) lists every customer by last activity, 20 at a time, the next page
 * when its sentinel nears the window or with "Mostra altri clienti"; the text typed filters the
 * same list and lives in the history state, never in the URL. On the till tablet
 * (SPEC-tablet-kiosk, point 10) the same page in two columns: the USB reader on the left, the
 * search with "Nuovo cliente" beside it and CLIENTI in two columns on the right.
 */
export function HomePage() {
  const operator = useCurrentOperator();
  // 1280×800: the reader column on the left, the search and CLIENTI beside it.
  const tablet = useTabletLayout();
  // The till tablet reads cards with its USB reader only, whatever the window's size.
  const usb = useUsbCardInput();
  const location = useLocation();
  const navigate = useNavigate();
  // The text lives in the history state (replaced), so a reload or "Indietro" finds it again.
  const [text, setText] = useState(() => readHomeSearch(location.state));
  const list = useCustomerList(text);
  // The text the list is filtered by: '' (everyone) under 2 characters.
  const query = listQuery(text);
  const searching = query !== '';
  const outcome = useRef<HTMLDivElement>(null);
  const moreArea = useRef<HTMLDivElement>(null);
  const done = list.status === 'done' ? list : null;
  const sentinel = useSentinel(list.loadMore);
  // `cards` handles the card reads: Registra spesa, Nuovo cliente with the card, or a notice.
  const cardRead = useHomeCardRead();
  const cardNotice = homeCardNotice(cardRead);

  // "Riprova" is replaced by the loading state: the focus goes to the list's outcome, which
  // stays mounted while loading and then holds the rows, not to <body>.
  function retryFirst() {
    list.retry();
    outcome.current?.focus();
  }

  // "Mostra altri clienti" and the next page's "Riprova" give way to "Carico altri clienti…".
  function loadMore() {
    list.loadMore();
    moreArea.current?.focus();
  }

  // No results for a name: the button registers that name (`?nome=`); with an @, nothing.
  const prefill =
    done !== null &&
    done.query === query &&
    searching &&
    done.customers.length === 0 &&
    !query.includes('@')
      ? query
      : null;

  function changeText(value: string) {
    setText(value);
    // The same entry, without any query string: not '.', which on the index route adds `?index`.
    void navigate(
      { pathname: location.pathname },
      { replace: true, state: homeSearchState(value) },
    );
  }

  const newCustomerAction =
    prefill === null ? (
      <ButtonLink
        to="/clienti/nuovo"
        variant="secondary"
        icon="plus"
        block={!tablet}
        className={tablet ? styles.tabletAction : undefined}
      >
        Nuovo cliente
      </ButtonLink>
    ) : (
      <ButtonLink
        to={`/clienti/nuovo?${new URLSearchParams({ nome: prefill }).toString()}`}
        icon="plus"
        block={!tablet}
        className={tablet ? styles.tabletAction : undefined}
      >
        {newCustomerLabel(prefill)}
      </ButtonLink>
    );

  // The USB reader stays in full whatever is searched (wireframe "Tablet: cerca cliente"): in a
  // column at 1280×800, at the top in a narrow window. On the phone the panel shrinks to one line
  // while a search is shown.
  const usbPanel = (
    <>
      <CardReadPanel
        mode="usb"
        title={TABLET_PANEL_TITLE}
        description={cardRead.status === 'reading' ? CARD_PANEL_READING : TABLET_PANEL_TEXT}
        notice={cardNotice}
      />
      <UsbReaderStatus />
    </>
  );
  const cardPanel = tablet ? (
    <div className={styles.readerColumn}>{usbPanel}</div>
  ) : usb ? (
    usbPanel
  ) : (
    <CardReadPanel
      title={CARD_PANEL_TITLE}
      description={cardRead.status === 'reading' ? CARD_PANEL_READING : CARD_PANEL_TEXT}
      variant={searching && cardRead.status === 'idle' ? 'compact' : 'full'}
      notice={cardNotice}
    />
  );

  const searchField = (
    <SearchField
      label={searching && !tablet ? 'Cerca per nome o email' : 'Oppure cerca per nome o email'}
      placeholder="Es. Rossi o rossi@"
      value={text}
      onChange={changeText}
    />
  );

  const moreRows = done !== null && (
    // The focus target of "Mostra altri clienti" and "Riprova": mounted with the rows.
    <div ref={moreArea} tabIndex={-1} className={styles.moreArea}>
      {done.more.status === 'loading' && (
        <output className={styles.moreStatus}>
          <Icon name="loader-circle" size={20} className={styles.spinner} />
          Carico altri clienti…
        </output>
      )}
      {done.more.status === 'error' && (
        <div role="alert" className={styles.moreError}>
          <p className={styles.moreErrorText}>
            <Icon name="circle-alert" size={20} />
            Non riesco a caricare altri clienti.
          </p>
          <Button variant="secondary" onClick={loadMore}>
            Riprova
          </Button>
        </div>
      )}
      {done.more.status === 'idle' && done.hasMore && (
        <>
          <div
            key={done.customers.length}
            ref={sentinel}
            className={styles.sentinel}
            aria-hidden="true"
          />
          <Button variant="secondary" block={!tablet} onClick={loadMore}>
            Mostra altri clienti
          </Button>
        </>
      )}
    </div>
  );

  const customersSection = (
    <section aria-labelledby="home-customers" className={styles.customers}>
      <h2 id="home-customers" className={styles.sectionTitle}>
        CLIENTI
      </h2>
      {/* On the page from the start: TalkBack does not read a live region that arrives with its text. */}
      <p className="visually-hidden" aria-live="polite" data-testid="search-announcer">
        {searchAnnouncement(list, query)}
      </p>
      <div ref={outcome} tabIndex={-1} className={styles.outcome}>
        {list.status === 'loading' && <StatusView kind="loading" label="Carico i clienti…" />}
        {list.status === 'error' && (
          <StatusView
            kind="error"
            title="Clienti non caricati"
            description={loadErrorText(list.error)}
            onRetry={retryFirst}
          />
        )}
        {done !== null && done.customers.length === 0 && done.query === '' && (
          <StatusView
            kind="empty"
            title="Ancora nessun cliente"
            description="Registra il primo con «Nuovo cliente»."
          />
        )}
        {done !== null && done.customers.length === 0 && done.query !== '' && (
          <StatusView
            kind="empty"
            title="Nessun cliente trovato"
            description="Controlla come è scritto, o cerca con l’email."
          />
        )}
        {done !== null && done.customers.length > 0 && (
          <>
            <ul className={styles.list} data-columns={tablet ? '2' : undefined}>
              {done.customers.map((customer) => (
                <ListRow
                  key={customer.id}
                  to={`/clienti/${customer.id}`}
                  // "Indietro" from the customer page comes back to this search.
                  state={customerBackState(text)}
                  title={customer.name}
                  subtitle={activityLabel(customer.lastActivityAt)}
                  trailing={<PointsBadge points={customer.balance} />}
                />
              ))}
            </ul>
            {moreRows}
          </>
        )}
      </div>
    </section>
  );

  if (tablet) {
    return (
      <AppShell account={{ name: operator.name, to: '/impostazioni' }}>
        <div className={styles.tabletLayout} data-tablet="true">
          {cardPanel}
          <div className={styles.tabletContent}>
            <NavigationNotice />
            <div className={styles.searchRow}>
              <div className={styles.searchCell}>{searchField}</div>
              {newCustomerAction}
            </div>
            {customersSection}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell account={{ name: operator.name, to: '/impostazioni' }} actions={newCustomerAction}>
      <NavigationNotice />
      {cardPanel}
      {searchField}
      {customersSection}
    </AppShell>
  );
}
