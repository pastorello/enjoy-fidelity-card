import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { ButtonLink } from '../../shared/ui/Button';
import { ListRow } from '../../shared/ui/ListRow';
import { PointsBadge } from '../../shared/ui/PointsBadge';
import { SearchField } from '../../shared/ui/SearchField';
import { StatusView } from '../../shared/ui/StatusView';
import { useCurrentOperator } from '../identity/AuthProvider';
import styles from './HomePage.module.css';
import { maskPhone } from './phone';
import { SEARCH_SHOWN_ROWS, useCustomerSearch } from './useCustomerSearch';

/** Home "Cerca cliente": search by name or phone, "Nuovo cliente". */
export function HomePage() {
  const operator = useCurrentOperator();
  const [searchParams, setSearchParams] = useSearchParams();
  // The text lives in the URL too (`?q=`, replaced), so "Indietro" from a customer finds it again.
  const [text, setText] = useState(() => searchParams.get('q') ?? '');
  const search = useCustomerSearch(text);

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
        <ButtonLink to="/clienti/nuovo" variant="secondary" icon="plus" block>
          Nuovo cliente
        </ButtonLink>
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
      {search.status === 'done' && (
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
