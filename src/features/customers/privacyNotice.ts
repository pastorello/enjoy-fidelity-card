/**
 * The privacy notice shown from "Mostra l’informativa" (SPEC-customers, "Informativa privacy").
 * The only place its text lives. For now a placeholder: the real text comes from the bar's
 * consultant and is a requirement of the launch checkpoint (CAPABILITY-MAP). No legal text is
 * written here by anyone else.
 */

/** `'draft'` until the consultant approves the text; then `'approved'`. */
export const PRIVACY_NOTICE_STATUS: 'draft' | 'approved' = 'draft';

export const PRIVACY_NOTICE_TEXT =
  'Testo dell’informativa in attesa di verifica del consulente del bar.';
