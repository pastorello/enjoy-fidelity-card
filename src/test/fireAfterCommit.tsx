import { render } from '@testing-library/react';
import { Fragment, useLayoutEffect, type ComponentType, type ReactNode } from 'react';

type Hosted<P, R> = {
  /** The hook's latest result. */
  result: () => R;
  /**
   * Renders the hook with `props` and, in the same commit, calls `fire` with its result: after React
   * has committed the new props, before the commit's passive effects (`useEffect`) run.
   */
  rerenderAndFire: (props: P, fire: (result: R) => void) => void;
};

/**
 * Hosts `use(props)` and, on `rerenderAndFire`, calls back from a layout effect of a later sibling.
 * That is the window an event (a tap, a card read, a resolved promise) can land in on a busy device:
 * the screen already shows the new state, but `useEffect` has not run yet. A callback that still
 * sees the previous props there would act on what is no longer on screen.
 */
export function renderHookThenFire<P, R>(
  use: (props: P) => R,
  initialProps: P,
  { wrapper: Wrapper = Fragment }: { wrapper?: ComponentType<{ children: ReactNode }> } = {},
): Hosted<P, R> {
  let latest: { value: R } | null = null;
  let pending: ((result: R) => void) | null = null;
  let fired = false;

  function Host({ props }: { props: P }) {
    const value = use(props);
    useLayoutEffect(() => {
      latest = { value };
    });
    return null;
  }

  // Rendered after Host: its layout effects run after Host's, before any passive effect.
  function Trigger({ tick }: { tick: number }) {
    useLayoutEffect(() => {
      const fire = pending;
      pending = null;
      if (fire && latest) {
        fired = true;
        fire(latest.value);
      }
    }, [tick]);
    return null;
  }

  const tree = (props: P, tick: number) => (
    <Wrapper>
      <Host props={props} />
      <Trigger tick={tick} />
    </Wrapper>
  );
  let tick = 0;
  const view = render(tree(initialProps, tick));

  return {
    result() {
      if (!latest) throw new Error('not rendered');
      return latest.value;
    },
    rerenderAndFire(props, fire) {
      pending = fire;
      fired = false;
      tick += 1;
      view.rerender(tree(props, tick));
      if (!fired) throw new Error('the trigger did not fire');
    },
  };
}
