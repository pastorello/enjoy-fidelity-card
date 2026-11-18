// Types of the CSV export (SPEC-export, "Code Style"). Amounts stay in integer cents and dates stay the
// ISO strings the server sends: they become euros and Rome times only in the cells of the file.

/** Which file is being exported. */
export type ExportKind = 'customers' | 'movements';

/** The kind of a movement as the server returns it. */
export type MovementExportKind = 'purchase' | 'redemption' | 'correction';

/** A row of `app.export_customers`. The server sends the personal fields null once anonymized. */
export type CustomerExportRow = {
  id: string;
  name: string | null;
  phone: string | null;
  activeCardUid: string | null;
  balancePoints: number;
  privacyConsentAt: string;
  notes: string | null;
  createdAt: string;
  createdByName: string;
  anonymizedAt: string | null;
};

/** A row of `app.export_movements`. */
export type MovementExportRow = {
  id: string;
  createdAt: string;
  customerId: string;
  /** The customer's current name; null once the customer is anonymized. */
  customerName: string | null;
  kind: MovementExportKind;
  /** Purchase only: integer cents. */
  amountCents: number | null;
  /** Signed points. */
  points: number;
  /** Purchase only: the ratio in force, cents per point. */
  centsPerPoint: number | null;
  /** The movement's description, or else the reward's name. */
  description: string | null;
  operatorName: string;
  /** Correction only: the movement it cancels. */
  correctsMovementId: string | null;
  /** The correction that cancels this movement, if any. */
  correctedByMovementId: string | null;
};

/** What an export run ends with: the rows written, or why there is no file. */
export type ExportResult =
  { status: 'ok'; count: number } | { status: 'forbidden' | 'network' | 'unknown' };

/** Reads every row of a file from the server: all the pages, or it rejects. */
export type ExportService = {
  fetchCustomers(): Promise<CustomerExportRow[]>;
  fetchMovements(): Promise<MovementExportRow[]>;
};
