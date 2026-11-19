import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * A ref to the value of the last committed render, for callbacks that keep their identity (event
 * handlers, card-read consumers, answers of promises). It is updated in the layout phase, with the
 * DOM: an event that lands after a commit but before its passive effects (`useEffect`) run, which
 * a busy phone or CI runner makes likely, already sees what the screen shows. Updated in
 * `useEffect`, it would still see the previous render: e.g. "Salva cliente" tapped just after "Card
 * letta" appeared created the customer without the card (RUNBOOK §4, trap 45).
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
