import { useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Icon } from '../../shared/ui/Icon';
import { TextField } from '../../shared/ui/TextField';
import styles from './CustomerForm.module.css';
import { customerErrorText, type CustomerField } from './errorCodes';
import { normalizePhone } from './phone';
import { PrivacyNoticeDialog } from './PrivacyNoticeDialog';

/** The fields as typed: the server cleans the name and normalizes the phone. */
export type CustomerFormValues = {
  name: string;
  phone: string;
  notes: string;
  privacyConsent: boolean;
};

/** One message per wrong field, in the order of the form. */
export type CustomerFormErrors = Partial<Record<CustomerField, string>>;

const NAME_MAX = 80;
const NOTES_MAX = 500;
const FIELD_ORDER: CustomerField[] = ['name', 'phone', 'consent', 'notes'];

const EMPTY: CustomerFormValues = { name: '', phone: '', notes: '', privacyConsent: false };

/** `private.clean_name`: trimmed, inner spaces collapsed to one. */
function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Characters, as Postgres `length` counts them (not UTF-16 units). */
function characters(text: string): number {
  return Array.from(text).length;
}

/**
 * The checks the server makes too (SPEC-customers, "Errori del modulo"), done in the app first so
 * a wrong form costs no call. A name already used is known only to the server.
 */
export function validateCustomerForm(
  values: CustomerFormValues,
  { requireConsent }: { requireConsent: boolean },
): CustomerFormErrors {
  const errors: CustomerFormErrors = {};
  const name = cleanName(values.name);
  if (name === '') errors.name = customerErrorText('name_required');
  else if (characters(name) > NAME_MAX) errors.name = customerErrorText('name_too_long');
  if (values.phone.trim() !== '' && normalizePhone(values.phone) === null) {
    errors.phone = customerErrorText('phone_invalid');
  }
  if (requireConsent && !values.privacyConsent) {
    errors.consent = customerErrorText('consent_required');
  }
  if (characters(values.notes.trim()) > NOTES_MAX)
    errors.notes = customerErrorText('notes_too_long');
  return errors;
}

type CustomerFormProps = {
  /** The form's id: the page's "Salva cliente" in the footer submits it with `form={id}`. */
  id: string;
  /** New customer: the PRIVACY section and its mandatory consent. Edit: none. */
  withPrivacy: boolean;
  initialValues?: Partial<CustomerFormValues>;
  /** Called only with a valid form. */
  onSubmit: (values: CustomerFormValues) => void;
};

/**
 * The fields shared by Nuovo cliente and Modifica cliente (wireframe Nuovo cliente senza card):
 * name, phone, help text, PRIVACY, notes at the end. Errors go under their field and the first
 * wrong one gets the focus.
 */
export function CustomerForm({ id, withPrivacy, initialValues, onSubmit }: CustomerFormProps) {
  const [values, setValues] = useState<CustomerFormValues>(() => ({
    ...EMPTY,
    ...initialValues,
  }));
  const [errors, setErrors] = useState<CustomerFormErrors>({});
  const [noticeOpen, setNoticeOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLInputElement>(null);
  const consentErrorId = useId();
  const refs: Record<CustomerField, RefObject<HTMLInputElement | null>> = {
    name: nameRef,
    phone: phoneRef,
    consent: consentRef,
    notes: notesRef,
  };

  function change<K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateCustomerForm(values, { requireConsent: withPrivacy });
    setErrors(found);
    const first = FIELD_ORDER.find((field) => found[field] !== undefined);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    onSubmit(values);
  }

  return (
    <form id={id} className={styles.form} noValidate onSubmit={handleSubmit}>
      <TextField
        ref={nameRef}
        label="Nome e cognome"
        placeholder="Es. Maria Rossi"
        value={values.name}
        onChange={(value) => change('name', value)}
        error={errors.name}
        autoComplete="off"
        autoCapitalize="words"
      />
      <TextField
        ref={phoneRef}
        label="Telefono (facoltativo)"
        type="tel"
        placeholder="Numero di cellulare"
        value={values.phone}
        onChange={(value) => change('phone', value)}
        error={errors.phone}
        autoComplete="off"
        inputMode="tel"
      />
      <p className={styles.help}>
        Il nome identifica il cliente: non può essere già di un altro. Il telefono serve solo a
        trovarlo più in fretta.
      </p>
      {withPrivacy && (
        <fieldset className={styles.privacy}>
          <legend className={styles.legend}>PRIVACY</legend>
          <label className={styles.consent}>
            <input
              ref={consentRef}
              type="checkbox"
              className={styles.checkbox}
              checked={values.privacyConsent}
              onChange={(event) => change('privacyConsent', event.target.checked)}
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={errors.consent ? consentErrorId : undefined}
            />
            <span>
              Ha letto l’informativa privacy{' '}
              <span className={styles.mandatory}>(obbligatorio)</span>
            </span>
          </label>
          {errors.consent && (
            <p id={consentErrorId} className={styles.error}>
              <Icon name="circle-alert" size={18} />
              {errors.consent}
            </p>
          )}
          <button type="button" className={styles.noticeLink} onClick={() => setNoticeOpen(true)}>
            Mostra l’informativa
          </button>
        </fieldset>
      )}
      <TextField
        ref={notesRef}
        label="Note (facoltative)"
        value={values.notes}
        onChange={(value) => change('notes', value)}
        error={errors.notes}
        maxLength={NOTES_MAX}
        autoComplete="off"
      />
      <PrivacyNoticeDialog open={noticeOpen} onClose={() => setNoticeOpen(false)} />
    </form>
  );
}
