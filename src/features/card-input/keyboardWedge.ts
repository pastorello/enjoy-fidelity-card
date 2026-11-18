import type { DeliverRaw, UsbInputAdapter } from './cardReader';

/** The longest pause between two keys of the same reader burst (SPEC-card-input, point 4). */
export const MAX_KEY_GAP_MS = 50;
/** A burst closed by Enter with fewer characters is ordinary typing, not a card. */
export const MIN_UID_CHARS = 4;

/** What the wedge remembers between two keys: the burst so far and when its last key arrived. */
export type WedgeState = { readonly buffer: string; readonly lastKeyAt: number | null };

export const EMPTY_WEDGE: WedgeState = { buffer: '', lastKeyAt: null };

/** The parts of a `keydown` the wedge looks at; `editable` is true when the target takes text. */
export type WedgeKey = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  editable: boolean;
};

/** Modifier keys that readers send around upper-case letters: ignored, they neither add nor reset. */
const PASSIVE_KEYS = new Set(['Shift', 'CapsLock']);

const HEX_CHAR = /^[0-9A-Fa-f]$/;
const DEC_CHAR = /^[0-9]$/;

/** The characters a reader may type in this format, or null for an unknown format. */
function allowedChars(format: string): RegExp | null {
  switch (format) {
    case 'hex':
    case 'hex-reversed':
      return HEX_CHAR;
    case 'dec':
    case 'dec-reversed':
      return DEC_CHAR;
    default:
      return null;
  }
}

/**
 * One step of the wedge, without the DOM: returns the next state and, when Enter closes a fast burst
 * of at least `MIN_UID_CHARS` characters, the raw text to hand to the service (`raw`, else null).
 */
export function stepWedge(
  state: WedgeState,
  key: WedgeKey,
  at: number,
  format: string,
): { state: WedgeState; raw: string | null } {
  if (key.editable || key.ctrlKey || key.altKey || key.metaKey || key.repeat) {
    return { state: EMPTY_WEDGE, raw: null };
  }
  if (PASSIVE_KEYS.has(key.key)) return { state, raw: null };

  const inTime = state.lastKeyAt !== null && at - state.lastKeyAt <= MAX_KEY_GAP_MS;

  if (key.key === 'Enter') {
    const raw = inTime && state.buffer.length >= MIN_UID_CHARS ? state.buffer : null;
    return { state: EMPTY_WEDGE, raw };
  }

  if (allowedChars(format)?.test(key.key) !== true) return { state: EMPTY_WEDGE, raw: null };
  // A long pause starts a new burst with this character.
  const buffer = inTime ? state.buffer + key.key : key.key;
  return { state: { buffer, lastKeyAt: at }, raw: null };
}

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;
}

export type KeyboardWedgeOptions = {
  /** Where `keydown` is heard, in the capture phase: `document` in the app. */
  target: EventTarget;
  now: () => number;
};

/**
 * The USB reader of the cash-desk tablet (keyboard emulation): turns fast bursts closed by Enter into
 * reads for the service, with no always-focused text field. Typing in text fields and human-speed
 * typing are left alone. Never logs: the buffer is a card uid.
 */
export function createKeyboardWedge({ target, now }: KeyboardWedgeOptions): UsbInputAdapter {
  let state = EMPTY_WEDGE;
  let stopListening: (() => void) | null = null;

  return {
    start({ deliver, format }: { deliver: DeliverRaw; format: () => string | null }) {
      if (stopListening !== null) return;
      state = EMPTY_WEDGE;
      const onKeyDown = (event: Event) => {
        if (!(event instanceof KeyboardEvent)) return;
        const current = format();
        if (current === null) return;
        const step = stepWedge(
          state,
          {
            key: event.key,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
            repeat: event.repeat,
            editable: isEditable(event.target),
          },
          now(),
          current,
        );
        state = step.state;
        if (step.raw === null) return;
        // The Enter belongs to the reader: it must not press the focused button.
        event.preventDefault();
        event.stopPropagation();
        deliver(step.raw, current, 'usb');
      };
      target.addEventListener('keydown', onKeyDown, { capture: true });
      stopListening = () => {
        target.removeEventListener('keydown', onKeyDown, { capture: true });
      };
    },
    stop() {
      stopListening?.();
      stopListening = null;
      state = EMPTY_WEDGE;
    },
  };
}
