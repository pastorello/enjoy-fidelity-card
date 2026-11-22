import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeKioskService } from '../../test/fakeKioskService';
import { createFakeOperatorsService } from '../../test/fakeOperatorsService';
import { renderApp, signedInFake } from '../../test/renderApp';
import { OperatorsServiceProvider, useOperatorsService } from './OperatorsServiceProvider';

function Probe() {
  const service = useOperatorsService();
  return <p>{typeof service.invite}</p>;
}

describe('OperatorsServiceProvider', () => {
  it('gives its service to useOperatorsService', () => {
    const { service } = createFakeOperatorsService();
    function SameProbe() {
      const injected = useOperatorsService();
      return <p>{injected === service ? 'same' : 'other'}</p>;
    }
    render(
      <OperatorsServiceProvider service={service}>
        <Probe />
        <SameProbe />
      </OperatorsServiceProvider>,
    );
    expect(screen.getByText('function')).toBeInTheDocument();
    expect(screen.getByText('same')).toBeInTheDocument();
  });

  it('useOperatorsService outside the provider throws a clear error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(
      'useOperatorsService must be used inside <OperatorsServiceProvider>',
    );
    vi.restoreAllMocks();
  });
});

describe('renderApp', () => {
  it('keeps the parameters of the other modules and adds the operators fake last', () => {
    const kiosk = createFakeKioskService();
    const operators = createFakeOperatorsService();
    const rendered = renderApp(
      '/accedi',
      signedInFake(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      kiosk,
      operators,
    );
    expect(rendered.kiosk).toBe(kiosk);
    expect(rendered.operators).toBe(operators);
    expect(renderApp('/accedi').operators.service.list).toBeTypeOf('function');
  });
});
