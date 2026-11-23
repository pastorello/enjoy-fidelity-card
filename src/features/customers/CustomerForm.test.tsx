import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  CustomerForm,
  validateCustomerForm,
  type CustomerFormValues,
  type CustomerRefusal,
} from './CustomerForm';
import { PRIVACY_NOTICE_STATUS, PRIVACY_NOTICE_TEXT } from './privacyNotice';

const NAME = 'Nome e cognome';
const EMAIL = 'Email (facoltativa)';
const EMAIL_INVALID = 'Email non valida: controlla come è scritta.';
const HELP =
  'Il nome identifica il cliente: non può essere già di un altro. L’email serve solo a ritrovarlo: l’app non scrive ai clienti.';
const NOTES = 'Note (facoltative)';
const CONSENT = /Ha letto l’informativa privacy/;

const valid: CustomerFormValues = {
  name: 'Maria Rossi',
  email: '',
  notes: '',
  privacyConsent: true,
};

function renderForm(withPrivacy = true) {
  const onSubmit = vi.fn<(values: CustomerFormValues) => void>();
  render(
    <>
      <CustomerForm id="customer-form" withPrivacy={withPrivacy} onSubmit={onSubmit} />
      {/* The page puts "Salva cliente" in the footer, outside the form. */}
      <button type="submit" form="customer-form">
        Salva cliente
      </button>
    </>,
  );
  return { onSubmit, user: userEvent.setup() };
}

/** The form inside a router (its "Apri la scheda" is a link), with a refusal of the server. */
function renderRefused(refusal: CustomerRefusal, initialValues: Partial<CustomerFormValues> = {}) {
  const element = (
    <CustomerForm
      id="customer-form"
      withPrivacy
      initialValues={initialValues}
      onSubmit={() => {}}
      refusal={refusal}
    />
  );
  const router = createMemoryRouter([{ path: '*', element }]);
  render(<RouterProvider router={router} />);
}

/** Whether `b` comes after `a` in the document. */
function follows(a: Node, b: Node): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));
}

describe('validateCustomerForm', () => {
  it('accepts a name with consent, no email and no notes', () => {
    expect(validateCustomerForm(valid, { requireConsent: true })).toEqual({});
  });

  it('asks for the name when it is blank', () => {
    expect(validateCustomerForm({ ...valid, name: '   ' }, { requireConsent: true })).toEqual({
      name: 'Scrivi nome e cognome.',
    });
  });

  it('counts the name as the server does: cleaned, in characters', () => {
    const eighty = 'à'.repeat(80);
    expect(
      validateCustomerForm({ ...valid, name: `  ${eighty}  ` }, { requireConsent: true }),
    ).toEqual({});
    expect(
      validateCustomerForm({ ...valid, name: `${eighty}b` }, { requireConsent: true }),
    ).toEqual({
      name: 'Al massimo 80 caratteri.',
    });
    // Inner spaces collapse to one before counting.
    expect(
      validateCustomerForm(
        { ...valid, name: `${'a'.repeat(40)}     ${'b'.repeat(39)}` },
        { requireConsent: true },
      ),
    ).toEqual({});
  });

  it('rejects an email that does not normalize, accepts a blank one or one with spaces and capitals', () => {
    for (const email of ['rossi@', 'rossi', 'a@b.c d', 'a@b', '@example.com']) {
      expect(validateCustomerForm({ ...valid, email }, { requireConsent: true })).toEqual({
        email: EMAIL_INVALID,
      });
    }
    expect(validateCustomerForm({ ...valid, email: '   ' }, { requireConsent: true })).toEqual({});
    expect(
      validateCustomerForm({ ...valid, email: '  Rossi@Example.COM ' }, { requireConsent: true }),
    ).toEqual({});
  });

  it('rejects an email over 254 characters, as the server does', () => {
    const email = `${'a'.repeat(243)}@example.com`;
    expect(email).toHaveLength(255);
    expect(validateCustomerForm({ ...valid, email }, { requireConsent: true })).toEqual({
      email: EMAIL_INVALID,
    });
  });

  it('asks for consent only when the form requires it', () => {
    const noConsent = { ...valid, privacyConsent: false };
    expect(validateCustomerForm(noConsent, { requireConsent: true })).toEqual({
      consent: 'Serve il consenso privacy per registrare il cliente.',
    });
    expect(validateCustomerForm(noConsent, { requireConsent: false })).toEqual({});
  });

  it('rejects notes over 500 characters', () => {
    expect(
      validateCustomerForm({ ...valid, notes: 'x'.repeat(501) }, { requireConsent: true }),
    ).toEqual({ notes: 'Al massimo 500 caratteri.' });
  });
});

describe('CustomerForm', () => {
  it('shows the fields of the wireframe, with accessible labels', () => {
    renderForm();
    const name = screen.getByRole('textbox', { name: NAME });
    expect(name).toHaveAttribute('placeholder', 'Es. Maria Rossi');
    const email = screen.getByRole('textbox', { name: EMAIL });
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('inputmode', 'email');
    // The customer's email typed by the operator: the browser must not offer the operator's own.
    expect(email).toHaveAttribute('autocomplete', 'off');
    expect(email).toHaveAttribute('autocapitalize', 'none');
    expect(email).toHaveAttribute('spellcheck', 'false');
    expect(email).toHaveAttribute('maxLength', '254');
    expect(email).toHaveAttribute('placeholder', 'nome@esempio.it');
    expect(screen.getByText(HELP)).toBeInTheDocument();
    // The email takes the place of the phone: no phone field and no phone text.
    expect(screen.queryByRole('textbox', { name: /Telefono/ })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/telefono/i);
    expect(screen.getByRole('group', { name: 'PRIVACY' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: CONSENT })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: CONSENT })).toHaveAccessibleName(
      'Ha letto l’informativa privacy (obbligatorio)',
    );
    expect(screen.getByRole('button', { name: 'Mostra l’informativa' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: NOTES })).toHaveAttribute('maxLength', '500');
  });

  it('keeps the notes at the end of the form, after the privacy section', () => {
    renderForm();
    const notes = screen.getByRole('textbox', { name: NOTES });
    const privacy = screen.getByRole('group', { name: 'PRIVACY' });
    expect(privacy.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no privacy section when the form does not ask for consent (edit)', () => {
    renderForm(false);
    expect(screen.queryByRole('group', { name: 'PRIVACY' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows "Scrivi nome e cognome." under an empty name, focuses it and sends nothing', () => {
    const { onSubmit } = renderForm();
    save();
    const name = screen.getByRole('textbox', { name: NAME });
    expect(name).toHaveAccessibleDescription('Scrivi nome e cognome.');
    expect(name).toBeInvalid();
    expect(name).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows "Al massimo 80 caratteri." for a name too long, and focuses it', () => {
    const { onSubmit } = renderForm();
    const name = screen.getByRole('textbox', { name: NAME });
    fireEvent.change(name, { target: { value: 'a'.repeat(81) } });
    fireEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
    save();
    expect(name).toHaveAccessibleDescription('Al massimo 80 caratteri.');
    expect(name).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the order of the wireframe: name, email, help text, PRIVACY', () => {
    renderForm();
    const name = screen.getByRole('textbox', { name: NAME });
    const email = screen.getByRole('textbox', { name: EMAIL });
    const help = screen.getByText(HELP);
    const privacy = screen.getByRole('group', { name: 'PRIVACY' });
    expect(follows(name, email)).toBe(true);
    expect(follows(email, help)).toBe(true);
    expect(follows(help, privacy)).toBe(true);
  });

  it('shows the email error under the email, and focuses it when the name is fine', () => {
    const { onSubmit } = renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: NAME }), {
      target: { value: 'Maria Rossi' },
    });
    const email = screen.getByRole('textbox', { name: EMAIL });
    fireEvent.change(email, { target: { value: 'rossi@' } });
    fireEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
    save();
    expect(email).toHaveAccessibleDescription(EMAIL_INVALID);
    expect(email).toBeInvalid();
    expect(email).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('email already used: the error, "Apri la scheda" to the other customer, no help text', () => {
    const other = '00000000-0000-4000-8000-000000000042';
    renderRefused(
      { kind: 'taken', field: 'email', existingCustomerId: other },
      {
        name: 'Maria Rossi',
        email: 'rossi@example.com',
      },
    );
    const email = screen.getByRole('textbox', { name: EMAIL });
    expect(email).toBeInvalid();
    expect(email).toHaveFocus();
    expect(email).toHaveAccessibleDescription(
      'Esiste già un cliente con questa email. Apri la scheda',
    );
    const link = screen.getByRole('link', { name: 'Apri la scheda' });
    expect(link).toHaveAttribute('href', `/clienti/${other}`);
    // The link stands in place of the help text (like a name already used).
    expect(screen.queryByText(HELP)).not.toBeInTheDocument();
    // Only the email is wrong: the name keeps no error.
    expect(screen.getByRole('textbox', { name: NAME })).not.toBeInvalid();
  });

  it('email already used, the other customer unknown: the error without the link', () => {
    renderRefused({ kind: 'taken', field: 'email', existingCustomerId: null });
    const email = screen.getByRole('textbox', { name: EMAIL });
    expect(email).toHaveAccessibleDescription('Esiste già un cliente con questa email.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('name already used: the error and its suggestion under the name, nothing under the email', () => {
    const other = '00000000-0000-4000-8000-000000000043';
    renderRefused({ kind: 'taken', field: 'name', existingCustomerId: other });
    const name = screen.getByRole('textbox', { name: NAME });
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription(
      'Esiste già un cliente con questo nome. Apri la scheda Se è un’altra persona, aggiungi un dettaglio al nome, per esempio «Maria Rossi Serapo».',
    );
    expect(screen.getByRole('textbox', { name: EMAIL })).not.toBeInvalid();
    expect(screen.queryByText(HELP)).not.toBeInTheDocument();
  });

  it('a server refusal of the email format shows under the email', () => {
    renderRefused({ kind: 'field', field: 'email', text: EMAIL_INVALID });
    const email = screen.getByRole('textbox', { name: EMAIL });
    expect(email).toHaveAccessibleDescription(EMAIL_INVALID);
    expect(email).toHaveFocus();
    expect(screen.getByText(HELP)).toBeInTheDocument();
  });

  it('asks for consent under the checkbox and focuses it', () => {
    const { onSubmit } = renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: NAME }), {
      target: { value: 'Maria Rossi' },
    });
    save();
    const consent = screen.getByRole('checkbox', { name: CONSENT });
    expect(consent).toHaveAccessibleDescription(
      'Serve il consenso privacy per registrare il cliente.',
    );
    expect(consent).toBeInvalid();
    expect(consent).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows every error at once and focuses the first wrong field', () => {
    renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: EMAIL }), { target: { value: 'abc' } });
    save();
    expect(screen.getByRole('textbox', { name: NAME })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: EMAIL })).toBeInvalid();
    expect(screen.getByRole('checkbox', { name: CONSENT })).toBeInvalid();
  });

  it('sets the errors in the danger text style', () => {
    renderForm();
    save();
    const message = screen.getByText('Scrivi nome e cognome.');
    expect(message.className).toMatch(/error/);
  });

  it('clears the errors once the form is valid and sends the name cleaned, the rest as typed', () => {
    const { onSubmit } = renderForm();
    save();
    fireEvent.change(screen.getByRole('textbox', { name: NAME }), {
      target: { value: '\u00a0Maria \u202fRossi\u00a0' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: EMAIL }), {
      target: { value: '  Rossi@Example.COM ' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: NOTES }), {
      target: { value: 'Preferisce il caffè macchiato' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
    save();
    expect(screen.queryByText('Scrivi nome e cognome.')).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Maria Rossi',
      // Not lowercased: the server normalizes it. The edge spaces are dropped by the browser itself
      // (an `<input type="email">` value has no leading or trailing whitespace).
      email: 'Rossi@Example.COM',
      notes: 'Preferisce il caffè macchiato',
      privacyConsent: true,
    });
  });

  it('fills the fields from the initial values', () => {
    const onSubmit = vi.fn<(values: CustomerFormValues) => void>();
    render(
      <CustomerForm
        id="customer-form"
        withPrivacy
        initialValues={{ name: 'Maria Rossi', email: 'rossi@example.com' }}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole('textbox', { name: NAME })).toHaveValue('Maria Rossi');
    expect(screen.getByRole('textbox', { name: EMAIL })).toHaveValue('rossi@example.com');
  });

  it('toggles the consent from the keyboard', async () => {
    const { user } = renderForm();
    const consent = screen.getByRole('checkbox', { name: CONSENT });
    consent.focus();
    await user.keyboard(' ');
    expect(consent).toBeChecked();
  });
});

describe('PrivacyNoticeDialog', () => {
  it('is a placeholder until the bar’s consultant approves the text: no legal text invented', () => {
    expect(PRIVACY_NOTICE_STATUS).toBe('draft');
    expect(PRIVACY_NOTICE_TEXT).toBe(
      'Testo dell’informativa in attesa di verifica del consulente del bar.',
    );
  });

  it('opens from "Mostra l’informativa" and closes with "Chiudi", from the keyboard', async () => {
    const { user } = renderForm();
    const opener = screen.getByRole('button', { name: 'Mostra l’informativa' });
    opener.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Informativa privacy' });
    expect(dialog).toHaveTextContent(PRIVACY_NOTICE_TEXT);
    const close = screen.getByRole('button', { name: 'Chiudi' });
    expect(close).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes with Esc and gives the focus back', async () => {
    const { user } = renderForm();
    const opener = screen.getByRole('button', { name: 'Mostra l’informativa' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Informativa privacy' });
    // jsdom does not turn Esc into the dialog's `cancel` event: dispatch it as the browser does.
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('does not submit the form or change the consent', async () => {
    const { user, onSubmit } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Mostra l’informativa' }));
    await user.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: CONSENT })).not.toBeChecked();
    expect(screen.queryByText('Scrivi nome e cognome.')).not.toBeInTheDocument();
  });
});
