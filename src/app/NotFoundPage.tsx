import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main>
      <h1>Pagina non trovata</h1>
      <p>Questa pagina non esiste.</p>
      <Link to="/">Torna all’inizio</Link>
    </main>
  );
}
