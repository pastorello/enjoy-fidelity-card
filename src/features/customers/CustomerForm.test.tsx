import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CustomerForm, validateCustomerForm, type CustomerFormValues } from './CustomerForm';
import { PRIVACY_NOTICE_STATUS, PRIVACY_NOTICE_TEXT } from './privacyNotice';

const NAME = 'Nome e cognome';
const PHONE = 'Telefono (facoltativo)';
const NOTES = 'Note (facoltative)';
const CONSENT = /Ha letto l’informativa privacy/;

const valid: CustomerFormValues = {
  name: 'Maria Rossi',
  phone: '',
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

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Salva cliente' }));
}

describe('validateCustomerForm', () => {
  it('accepts a name with consent, no phone and no notes', () => {
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

  it('rejects a phone that does not normalize, accepts a blank or a valid one', () => {
    const phone = 'Numero non valido: scrivi solo le cifre, con o senza prefisso.';
    expect(validateCustomerForm({ ...valid, phone: '12ab' }, { requireConsent: true })).toEqual({
      phone,
    });
    expect(validateCustomerForm({ ...valid, phone: '  ' }, { requireConsent: true })).toEqual({});
    expect(
      validateCustomerForm({ ...valid, phone: '333 123 4521' }, { requireConsent: true }),
    ).toEqual({});
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
    const phone = screen.getByRole('textbox', { name: PHONE });
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('placeholder', 'Numero di cellulare');
    expect(
      screen.getByText(
        'Il nome identifica il cliente: non può essere già di un altro. Il telefono serve solo a trovarlo più in fretta.',
      ),
    ).toBeInTheDocument();
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

  it('shows the phone error under the phone, and focuses it when the name is fine', () => {
    const { onSubmit } = renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: NAME }), {
      target: { value: 'Maria Rossi' },
    });
    const phone = screen.getByRole('textbox', { name: PHONE });
    fireEvent.change(phone, { target: { value: '12ab' } });
    fireEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
    save();
    expect(phone).toHaveAccessibleDescription(
      'Numero non valido: scrivi solo le cifre, con o senza prefisso.',
    );
    expect(phone).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
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
    fireEvent.change(screen.getByRole('textbox', { name: PHONE }), { target: { value: 'abc' } });
    save();
    expect(screen.getByRole('textbox', { name: NAME })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: PHONE })).toBeInvalid();
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
    fireEvent.change(screen.getByRole('textbox', { name: PHONE }), {
      target: { value: '333 123 4521' },
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
      phone: '333 123 4521',
      email: '',
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
        initialValues={{ name: 'Maria Rossi' }}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole('textbox', { name: NAME })).toHaveValue('Maria Rossi');
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
