import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { fakeOperator } from '../../test/fakeAuthService';
import { createFakeCardsService } from '../../test/fakeCardsService';
import { createTestCardReader } from '../../test/fakeCardReader';
import { createFakeCustomerService } from '../../test/fakeCustomerService';
import { createFakeExportService, fakeMovementExportRow } from '../../test/fakeExportService';
import { createFakeLedgerService } from '../../test/fakeLedgerService';
import { createFakeRewardsService } from '../../test/fakeRewardsService';
import { createFakeSettingsService } from '../../test/fakeSettingsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { buildCustomersCsv } from './buildCustomersCsv';
import { buildMovementsCsv } from './buildMovementsCsv';

const operatorSession = () =>
  signedInFake({ operator: { id: 'op-2', name: 'Marco Prova', role: 'operator' } });

describe('ESPORTA DATI section of the settings (SPEC-export, criteria 1 and 9)', () => {
  it('offers "Clienti CSV" then "Movimenti CSV" to administrators, with a live region below', async () => {
    renderApp('/impostazioni', signedInFake());
    const section = await screen.findByRole('region', { name: 'ESPORTA DATI' });
    expect(
      within(section).getByRole('heading', { level: 2, name: 'ESPORTA DATI' }),
    ).toBeInTheDocument();
    const buttons = within(section).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Clienti CSV', 'Movimenti CSV']);
    for (const button of buttons) {
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAttribute('data-variant', 'secondary');
      // The download icon of the wireframe: its three Lucide strokes.
      const paths = Array.from(button.querySelectorAll('svg path')).map((path) =>
        path.getAttribute('d'),
      );
      expect(paths).toEqual([
        'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
        'm7 10 5 5 5-5',
        'M12 15V3',
      ]);
    }
    // Nothing to announce yet; the region comes after the buttons.
    const status = within(section).getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();
    const lastButton = buttons.at(-1);
    expect(lastButton).toBeDefined();
    expect(
      lastButton && lastButton.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('is the last section of the administrator page', async () => {
    renderApp('/impostazioni', signedInFake());
    const section = await screen.findByRole('region', { name: 'ESPORTA DATI' });
    expect(screen.getByRole('main').lastElementChild).toBe(section);
  });

  it('is not shown to operators, who still read the final note', async () => {
    renderApp('/impostazioni', operatorSession());
    await screen.findByRole('region', { name: 'ACCOUNT' });
    expect(screen.queryByRole('region', { name: 'ESPORTA DATI' })).not.toBeInTheDocument();
    expect(screen.queryByText('ESPORTA DATI')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CSV/ })).not.toBeInTheDocument();
    expect(screen.getByText(/li gestiscono gli amministratori\.$/)).toBeInTheDocument();
  });
});

type ExportFake = ReturnType<typeof createFakeExportService>;

/** Opens /impostazioni as `auth` with `exportService`, the other services as renderApp makes them. */
async function openSection(exportService: ExportFake, auth = signedInFake()) {
  const settings = createFakeSettingsService();
  const customers = createFakeCustomerService();
  const rewards = createFakeRewardsService();
  renderApp(
    '/impostazioni',
    auth,
    settings,
    customers,
    rewards,
    createTestCardReader(),
    createFakeCardsService({ customers }),
    createFakeLedgerService({ customers, rewards, settings }),
    exportService,
  );
  const section = await screen.findByRole('region', { name: 'ESPORTA DATI' });
  return {
    section,
    status: within(section).getByRole('status'),
    customersButton: within(section).getByRole('button', { name: 'Clienti CSV' }),
    movementsButton: within(section).getByRole('button', { name: 'Movimenti CSV' }),
  };
}

const networkMessage = 'Esportazione non riuscita: controlla la connessione e riprova.';
const forbiddenMessage = 'Solo un amministratore può esportare i dati.';
const unexpectedMessage =
  "Esportazione non riuscita. Riprova; se succede ancora, avvisa chi gestisce l'app.";

describe('ESPORTA DATI states (SPEC-export, point 2)', () => {
  it('busy on the tapped button only, one export for two quick taps, then the count', async () => {
    const fake = createFakeExportService();
    const { status, customersButton, movementsButton } = await openSection(fake);
    const hold = fake.holdNext('fetchCustomers');

    await userEvent.dblClick(customersButton);
    expect(status).toHaveTextContent('Preparazione del file…');
    expect(customersButton).toHaveAttribute('aria-busy', 'true');
    expect(movementsButton).not.toHaveAttribute('aria-busy');
    expect(movementsButton).not.toHaveAttribute('aria-disabled');
    await userEvent.click(customersButton);
    expect(fake.service.fetchCustomers).toHaveBeenCalledTimes(1);

    hold.release();
    await waitFor(() => expect(status).toHaveTextContent('Clienti esportati: 2.'));
    expect(customersButton).not.toHaveAttribute('aria-busy');
    expect(fake.service.fetchCustomers).toHaveBeenCalledTimes(1);
    expect(fake.downloads).toHaveLength(1);
    expect(fake.downloads[0]?.content).toBe(buildCustomersCsv(fake.customers()));
  });

  it('the other button still exports while the first is busy', async () => {
    const fake = createFakeExportService();
    const { status, customersButton, movementsButton } = await openSection(fake);
    const hold = fake.holdNext('fetchCustomers');

    await userEvent.click(customersButton);
    await userEvent.click(movementsButton);
    await waitFor(() => expect(status).toHaveTextContent('Movimenti esportati: 3.'));
    expect(customersButton).toHaveAttribute('aria-busy', 'true');
    expect(fake.downloads.map((file) => file.content)).toEqual([
      buildMovementsCsv(fake.movements()),
    ]);

    hold.release();
    await waitFor(() => expect(status).toHaveTextContent('Clienti esportati: 2.'));
    expect(fake.downloads).toHaveLength(2);
  });

  it('groups the count of a large file ("1.234"), read over two pages', async () => {
    const movements = Array.from({ length: 1234 }, () => fakeMovementExportRow());
    const fake = createFakeExportService({ customers: [], movements });
    const { status, movementsButton } = await openSection(fake);

    await userEvent.click(movementsButton);
    await waitFor(() => expect(status).toHaveTextContent('Movimenti esportati: 1.234.'));
    expect(fake.pages.filter((page) => page.method === 'fetchMovements')).toHaveLength(2);
  });

  it('with no rows still saves the file with the headers only, and says so', async () => {
    const fake = createFakeExportService({ customers: [], movements: [] });
    const { status, customersButton, movementsButton } = await openSection(fake);

    await userEvent.click(customersButton);
    await waitFor(() =>
      expect(status).toHaveTextContent(
        'Nessun cliente da esportare: il file contiene solo le intestazioni.',
      ),
    );
    await userEvent.click(movementsButton);
    await waitFor(() =>
      expect(status).toHaveTextContent(
        'Nessun movimento da esportare: il file contiene solo le intestazioni.',
      ),
    );
    expect(fake.downloads.map((file) => file.content)).toEqual([
      buildCustomersCsv([]),
      buildMovementsCsv([]),
    ]);
  });

  it('criterion 7: a network error on a page saves nothing, and a new tap succeeds', async () => {
    const fake = createFakeExportService({ pageLimit: 1 });
    fake.failPage('fetchMovements', 2, 'network');
    const { status, movementsButton } = await openSection(fake);

    await userEvent.click(movementsButton);
    await waitFor(() => expect(status).toHaveTextContent(networkMessage));
    expect(fake.download).not.toHaveBeenCalled();
    expect(movementsButton).not.toHaveAttribute('aria-busy');
    expect(movementsButton).not.toHaveAttribute('aria-disabled');

    await userEvent.click(movementsButton);
    await waitFor(() => expect(status).toHaveTextContent('Movimenti esportati: 3.'));
    expect(fake.service.fetchMovements).toHaveBeenCalledTimes(2);
    expect(fake.download).toHaveBeenCalledTimes(1);
    expect(fake.downloads[0]?.content).toBe(buildMovementsCsv(fake.movements()));
  });

  it.each([
    ['an unknown refusal', 'unknown' as const],
    ['a server fault', new ServerFaultError('misconfigured')],
    ['an unexpected error', new Error('boom')],
  ])('%s: the unexpected message, nothing saved', async (_label, failure) => {
    const fake = createFakeExportService();
    fake.failPage('fetchCustomers', 1, failure);
    const { status, customersButton } = await openSection(fake);

    await userEvent.click(customersButton);
    await waitFor(() => expect(status).toHaveTextContent(unexpectedMessage));
    expect(fake.download).not.toHaveBeenCalled();
    expect(customersButton).not.toHaveAttribute('aria-busy');
  });

  it('forbidden: the permission message, and AuthProvider checks the role again', async () => {
    const auth = signedInFake();
    const fake = createFakeExportService({ role: 'operator' });
    const { status, customersButton } = await openSection(fake, auth);
    const checksBefore = auth.service.loadIdentity.mock.calls.length;

    // A double tap is one export and one report.
    const hold = fake.holdNext('fetchCustomers');
    await userEvent.dblClick(customersButton);
    hold.release();
    await waitFor(() => expect(status).toHaveTextContent(forbiddenMessage));
    expect(fake.download).not.toHaveBeenCalled();
    await waitFor(() => expect(auth.service.loadIdentity.mock.calls.length).toBe(checksBefore + 1));
    expect(fake.service.fetchCustomers).toHaveBeenCalledTimes(1);
    // The re-check still says administrator: the section and its message stay.
    expect(status).toHaveTextContent(forbiddenMessage);
  });

  it('forbidden after the role became operator: the section disappears', async () => {
    const auth = signedInFake();
    const fake = createFakeExportService();
    const { movementsButton } = await openSection(fake, auth);
    auth.setProfile({ ...fakeOperator, role: 'operator' });
    fake.setRole('operator');

    await userEvent.click(movementsButton);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'ESPORTA DATI' })).not.toBeInTheDocument(),
    );
    expect(fake.download).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'ACCOUNT' })).toBeInTheDocument();
  });
});
