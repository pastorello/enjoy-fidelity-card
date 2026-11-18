import { AppShell } from '../../app/AppShell';
import { Button } from '../../shared/ui/Button';
import { CustomerForm } from './CustomerForm';

const FORM_ID = 'new-customer';

/**
 * Nuovo cliente (`/clienti/nuovo`, wireframe Nuovo cliente senza card): the form, checked in the
 * app, and "Salva cliente" in the footer. Saving (and `?nome=`) comes with the next task of the
 * plan (tasks/customers/todo.md, Task 11); for now a valid form goes nowhere.
 */
export function NewCustomerPage() {
  return (
    <AppShell
      title="Nuovo cliente"
      backTo="/"
      actions={
        <Button type="submit" form={FORM_ID} block>
          Salva cliente
        </Button>
      }
    >
      <CustomerForm id={FORM_ID} withPrivacy onSubmit={() => undefined} />
    </AppShell>
  );
}
