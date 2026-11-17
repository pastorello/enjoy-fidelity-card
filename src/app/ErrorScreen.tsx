type ErrorScreenProps = {
  onRetry: () => void;
};

export function ErrorScreen({ onRetry }: ErrorScreenProps) {
  return (
    <main>
      <h1>Qualcosa è andato storto</h1>
      <p>L’operazione non è riuscita. Riprova; se il problema continua, chiudi e riapri l’app.</p>
      <button type="button" onClick={onRetry}>
        Riprova
      </button>
    </main>
  );
}
