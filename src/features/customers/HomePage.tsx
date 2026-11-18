import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { ServerFaultError } from '../../lib/serverFault';
import { ButtonLink } from '../../shared/ui/Button';
import { ListRow } from '../../shared/ui/ListRow';
import { PointsBadge } from '../../shared/ui/PointsBadge';
import { SearchField } from '../../shared/ui/SearchField';
import { StatusView } from '../../shared/ui/StatusView';
import { useCurrentOperator } from '../identity/AuthProvider';
import styles from './HomePage.module.css';
import { classifyQuery, maskPhone } from './phone';
import { SEARCH_SHOWN_ROWS, useCustomerSearch } from './useCustomerSearch';

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

/** A server fault is not a connection problem: same words as the sign-in page. */
function searchErrorText(error: unknown): string {
  if (error instanceof ServerFaultError) {
    return error.kind === 'misconfigured'
      ? 'Servizio non configurato: chiedi a un amministratore.'
      : 'Servizio momentaneamente non disponibile: riprova tra poco.';
  }
  return 'Controlla la connessione e riprova.';
}

/** Home "Cerca cliente": search by name or phone, "Nuovo cliente". */
export function HomePage() {
  const operator = useCurrentOperator();
  const [searchParams, setSearchParams] = useSearchParams();
  // The text lives in the URL too (`?q=`, replaced), so "Indietro" from a customer finds it again.
  const [text, setText] = useState(() => searchParams.get('q') ?? '');
  const search = useCustomerSearch(text);
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
      {/* The card reading panel of `card-input` goes here, above the search. */}
      <SearchField
        label="Cerca per nome o telefono"
        placeholder="Es. Rossi o 4521"
        value={text}
        onChange={changeText}
      />
      {search.status === 'loading' && <StatusView kind="loading" label="Ricerca…" />}
      {search.status === 'error' && (
        <StatusView
          kind="error"
          title="Ricerca non riuscita"
          description={searchErrorText(search.error)}
          onRetry={search.retry}
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
                title={customer.name}
                subtitle={customer.phone === null ? 'Senza telefono' : maskPhone(customer.phone)}
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
    </AppShell>
  );
}
