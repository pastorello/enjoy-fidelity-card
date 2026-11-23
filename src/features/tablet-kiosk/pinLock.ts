import { useEffect, useState } from 'react';

// The texts and the countdown of a refused PIN, shared by /cassa and by the admin actions of the
// Operators screen on the till tablet (SPEC-operators Open Questions 11): the same counter and the
// same lock on the server, so the same words on screen.

/** "4:05" from the seconds left. */
export function minutesSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A wrong PIN, with the attempts left before the lock. */
export function wrongPinText(attemptsLeft: number): string {
  return `PIN errato. Tentativi rimasti: ${attemptsLeft}`;
}

/** The lock of the till, counted down. */
export function lockText(secondsLeft: number): string {
  return `Troppi tentativi: riprova tra ${minutesSeconds(secondsLeft)}`;
}

/**
 * The lock of the till, counted down from the seconds the server gave (`lockSecondsLeft` of the
 * identity, or of a refused PIN), never from the tablet's clock. A countdown that runs late only
 * keeps the keypad off longer: the server refuses any PIN until its own lock ends.
 */
export function usePinLock(serverSeconds: number) {
  const [secondsLeft, setSecondsLeft] = useState(serverSeconds);
  // A fresh reading of the identity says how long the lock still lasts (0: none).
  const [readSeconds, setReadSeconds] = useState(serverSeconds);
  if (readSeconds !== serverSeconds) {
    setReadSeconds(serverSeconds);
    setSecondsLeft(serverSeconds);
  }
  const locked = secondsLeft > 0;

  useEffect(() => {
    if (!locked) return undefined;
    const timer = setInterval(() => {
      setSecondsLeft((left) => Math.max(left - 1, 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [locked]);

  return { secondsLeft, lockFor: setSecondsLeft };
}
