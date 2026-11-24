import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeCustomerService, fakeCustomer } from '../../test/fakeCustomerService';
import { signedInFake } from '../../test/renderApp';
import { AuthProvider, useAuth } from '../identity/AuthProvider';
import { CustomerServiceProvider } from './CustomerServiceProvider';
import type { CustomerListRow } from './types';
import {
  listQuery,
  SEARCH_DELAY_MS,
  useCustomerList,
  type CustomerListState,
} from './useCustomerList';

/** `count` customers named "Cliente 01"…; the fake clock makes later ones newer (listed first). */
function archive(count: number) {
  return Array.from({ length: count }, (_, index) =>
    fakeCustomer({ name: `Cliente ${String(index + 1).padStart(2, '0')}` }),
  );
}

function setup({ customers = archive(45), text = '' } = {}) {
  const auth = signedInFake();
  const fake = createFakeCustomerService({ customers });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider service={auth.service}>
      <CustomerServiceProvider service={fake.service}>{children}</CustomerServiceProvider>
    </AuthProvider>
  );
  const hook = renderHook(
    ({ text: current }: { text: string }) => ({
      list: useCustomerList(current),
      auth: useAuth().state,
    }),
    { initialProps: { text }, wrapper },
  );
  return { auth, fake, hook };
}

/** Runs the timers due in `ms` and the answers they release. */
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function becomeVisible() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function names(rows: CustomerListRow[]) {
  return rows.map((row) => row.name);
}

/** Row `index` of a loaded list (throws otherwise, so a test cannot pass on a missing row). */
function rowAt(list: CustomerListState, index: number): CustomerListRow {
  const row = list.status === 'done' ? list.customers[index] : undefined;
  if (!row) throw new Error(`no row ${index} in a ${list.status} list`);
  return row;
}

function listCalls(fake: ReturnType<typeof createFakeCustomerService>) {
  return fake.service.list.mock.calls.map(([input]) => input);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('listQuery', () => {
  it('cleans the text like clean_name and keeps it only from 2 characters', () => {
    expect(listQuery('  mario   rossi ')).toBe('mario rossi');
    expect(listQuery(' r ')).toBe('');
    expect(listQuery('ro')).toBe('ro');
    expect(listQuery('')).toBe('');
  });
});

describe('useCustomerList', () => {
  it('loads the first page when the home opens, without waiting', async () => {
    const { fake, hook } = setup();
    expect(hook.result.current.list.status).toBe('loading');

    await advance();

    expect(listCalls(fake)).toEqual([{ query: '', after: null }]);
    const shown = hook.result.current.list;
    if (shown.status !== 'done') throw new Error(`unexpected ${shown.status}`);
    expect(shown.customers).toHaveLength(20);
    expect(shown.customers[0]?.name).toBe('Cliente 45');
    expect(shown.hasMore).toBe(true);
    expect(shown.more).toEqual({ status: 'idle' });
    expect(shown.query).toBe('');
  });

  it('asks the next page with the last row received, its values as the strings sent', async () => {
    const { fake, hook } = setup();
    await advance();
    // The first page is shown as received (no row repeated on still data).
    const last = rowAt(hook.result.current.list, 19);

    act(() => hook.result.current.list.loadMore());
    expect(hook.result.current.list).toMatchObject({ more: { status: 'loading' } });
    await advance();

    const after = listCalls(fake)[1]?.after;
    expect(after).toEqual({
      activityAt: last.lastActivityAt,
      createdAt: last.createdAt,
      id: last.id,
    });
    // Strings exactly as received (microseconds included), never a Date.
    expect(typeof after?.createdAt).toBe('string');
    expect(after?.createdAt).toMatch(/\.\d{6}\+00:00$/);
    expect(hook.result.current.list).toMatchObject({ hasMore: true, more: { status: 'idle' } });
    if (hook.result.current.list.status !== 'done') throw new Error('not done');
    expect(names(hook.result.current.list.customers).slice(19, 21)).toEqual([
      'Cliente 26',
      'Cliente 25',
    ]);
  });

  it('keeps the activity of the last row in the cursor', async () => {
    const customers = archive(25).map((customer, index) =>
      index >= 5
        ? {
            ...customer,
            lastActivityAt: `2026-11-20T10:00:${String(index).padStart(2, '0')}.000123+00:00`,
          }
        : customer,
    );
    const { fake, hook } = setup({ customers });
    await advance();

    act(() => hook.result.current.list.loadMore());
    await advance();

    expect(listCalls(fake)[1]?.after).toMatchObject({
      activityAt: '2026-11-20T10:00:05.000123+00:00',
    });
    if (hook.result.current.list.status !== 'done') throw new Error('not done');
    expect(hook.result.current.list.customers).toHaveLength(25);
    expect(hook.result.current.list.hasMore).toBe(false);
  });

  it('ends the list with a page shorter than 20 rows, and asks nothing more', async () => {
    const { fake, hook } = setup();
    await advance();
    act(() => hook.result.current.list.loadMore());
    await advance();
    act(() => hook.result.current.list.loadMore());
    await advance();

    const shown = hook.result.current.list;
    if (shown.status !== 'done') throw new Error('not done');
    expect(shown.customers).toHaveLength(45);
    expect(shown.customers.at(-1)?.name).toBe('Cliente 01');
    expect(shown.hasMore).toBe(false);

    act(() => hook.result.current.list.loadMore());
    await advance();
    expect(fake.service.list).toHaveBeenCalledTimes(3);
  });

  it('shows nothing more after a full page followed by an empty one', async () => {
    const { fake, hook } = setup({ customers: archive(40) });
    await advance();
    act(() => hook.result.current.list.loadMore());
    await advance();
    act(() => hook.result.current.list.loadMore());
    await advance();

    expect(fake.service.list).toHaveBeenCalledTimes(3);
    const shown = hook.result.current.list;
    if (shown.status !== 'done') throw new Error('not done');
    expect(shown.customers).toHaveLength(40);
    expect(shown.hasMore).toBe(false);
  });

  it('drops a row already shown when a later page repeats it', async () => {
    const { fake, hook } = setup();
    await advance();
    const repeated = rowAt(hook.result.current.list, 19);
    const fresh: CustomerListRow = {
      id: '00000000-0000-4000-8000-000000000999',
      name: 'Cliente Nuovo',
      balance: 0,
      lastActivityAt: null,
      createdAt: '2026-10-01T08:00:00.000001+00:00',
    };
    fake.service.list.mockResolvedValueOnce({ customers: [repeated, fresh], hasMore: false });

    act(() => hook.result.current.list.loadMore());
    await advance();

    const shown = hook.result.current.list;
    if (shown.status !== 'done') throw new Error('not done');
    expect(shown.customers).toHaveLength(21);
    expect(shown.customers.filter((row) => row.id === repeated.id)).toHaveLength(1);
    expect(shown.customers.at(-1)?.name).toBe('Cliente Nuovo');
  });

  it('sends one request at a time', async () => {
    const { fake, hook } = setup();
    await advance();
    const held = fake.holdNext('list');

    act(() => hook.result.current.list.loadMore());
    act(() => hook.result.current.list.loadMore());
    becomeVisible();
    await advance();
    expect(fake.service.list).toHaveBeenCalledTimes(2);

    held.release();
    await advance();
    expect(hook.result.current.list).toMatchObject({ more: { status: 'idle' } });
    if (hook.result.current.list.status !== 'done') throw new Error('not done');
    expect(hook.result.current.list.customers).toHaveLength(40);
  });

  it('turns a failed first page into the error, and "Riprova" loads it again', async () => {
    const customers = archive(3);
    const auth = signedInFake();
    const fake = createFakeCustomerService({ customers });
    fake.failNext('list', 'network');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider service={auth.service}>
        <CustomerServiceProvider service={fake.service}>{children}</CustomerServiceProvider>
      </AuthProvider>
    );
    const hook = renderHook(() => useCustomerList(''), { wrapper });
    await advance();

    expect(hook.result.current).toMatchObject({ status: 'error', error: { kind: 'network' } });

    act(() => hook.result.current.retry());
    expect(hook.result.current.status).toBe('loading');
    await advance();
    expect(hook.result.current).toMatchObject({ status: 'done' });
    expect(fake.service.list).toHaveBeenCalledTimes(2);
    expect(fake.service.list).toHaveBeenLastCalledWith({ query: '', after: null });
  });

  it('keeps the rows when a later page fails, and asks it again with the same cursor', async () => {
    const { fake, hook } = setup();
    await advance();
    fake.failNext('list', 'network');

    act(() => hook.result.current.list.loadMore());
    await advance();

    const shown = hook.result.current.list;
    expect(shown).toMatchObject({
      status: 'done',
      hasMore: true,
      more: { status: 'error', error: { kind: 'network' } },
    });
    if (shown.status !== 'done') throw new Error('not done');
    expect(shown.customers).toHaveLength(20);

    act(() => hook.result.current.list.loadMore());
    await advance();
    expect(listCalls(fake)[2]).toEqual(listCalls(fake)[1]);
    expect(hook.result.current.list).toMatchObject({ more: { status: 'idle' } });
    if (hook.result.current.list.status !== 'done') throw new Error('not done');
    expect(hook.result.current.list.customers).toHaveLength(40);
  });

  it('searches 250 ms after the last change, with the cleaned text', async () => {
    const { fake, hook } = setup();
    await advance();

    hook.rerender({ text: 'Cli' });
    await advance(100);
    hook.rerender({ text: '  Cliente   0' });
    await advance(SEARCH_DELAY_MS - 1);
    expect(fake.service.list).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(listCalls(fake)[1]).toEqual({ query: 'Cliente 0', after: null });
    expect(fake.service.list).toHaveBeenCalledTimes(2);
    expect(hook.result.current.list).toMatchObject({ status: 'done', query: 'Cliente 0' });
    if (hook.result.current.list.status !== 'done') throw new Error('not done');
    // Every word in the name: "cliente" and "0" (01–09, 10, 20, 30, 40).
    expect(hook.result.current.list.customers).toHaveLength(13);
    expect(hook.result.current.list.hasMore).toBe(false);
  });

  it('lists everyone under 2 characters', async () => {
    const { fake, hook } = setup({ text: 'C' });
    await advance();
    expect(listCalls(fake)).toEqual([{ query: '', after: null }]);

    hook.rerender({ text: 'Cliente 01' });
    await advance(SEARCH_DELAY_MS);
    hook.rerender({ text: 'C' });
    await advance(SEARCH_DELAY_MS);

    expect(listCalls(fake)[2]).toEqual({ query: '', after: null });
    if (hook.result.current.list.status !== 'done') throw new Error('not done');
    expect(hook.result.current.list.customers).toHaveLength(20);
    expect(hook.result.current.list.query).toBe('');
  });

  it('ignores an answer superseded by a newer text', async () => {
    const { fake, hook } = setup();
    await advance();
    const held = fake.holdNext('list');

    hook.rerender({ text: 'Cliente 0' });
    await advance(SEARCH_DELAY_MS);
    hook.rerender({ text: 'Cliente 45' });
    await advance(SEARCH_DELAY_MS);
    expect(hook.result.current.list).toMatchObject({ status: 'done', query: 'Cliente 45' });

    held.release();
    await advance();
    expect(hook.result.current.list).toMatchObject({ status: 'done', query: 'Cliente 45' });
    if (hook.result.current.list.status !== 'done') throw new Error('not done');
    expect(names(hook.result.current.list.customers)).toEqual(['Cliente 45']);
  });

  it('ignores a later page asked before the text changed', async () => {
    const { fake, hook } = setup();
    await advance();
    const held = fake.holdNext('list');
    act(() => hook.result.current.list.loadMore());

    hook.rerender({ text: 'Cliente 45' });
    await advance(SEARCH_DELAY_MS);
    held.release();
    await advance();

    if (hook.result.current.list.status !== 'done') throw new Error('not done');
    expect(names(hook.result.current.list.customers)).toEqual(['Cliente 45']);
    expect(hook.result.current.list.more).toEqual({ status: 'idle' });
  });

  it('reloads the first page when the page becomes visible, only with the first page loaded', async () => {
    const { fake, hook } = setup();
    await advance();
    // Served meanwhile: the reload brings it to the top.
    const oldest = fake.customers().find((customer) => customer.name === 'Cliente 01');
    fake.applyMovement(oldest?.id ?? '', 10, '2026-11-23T09:15:00.000001+00:00');

    becomeVisible();
    await advance();
    expect(listCalls(fake)).toEqual([
      { query: '', after: null },
      { query: '', after: null },
    ]);
    if (hook.result.current.list.status !== 'done') throw new Error('not done');
    expect(hook.result.current.list.customers[0]?.name).toBe('Cliente 01');
    expect(hook.result.current.list.customers).toHaveLength(20);

    act(() => hook.result.current.list.loadMore());
    await advance();
    becomeVisible();
    await advance();
    // Scrolling past the first page: the place is kept.
    expect(fake.service.list).toHaveBeenCalledTimes(3);
    if (hook.result.current.list.status !== 'done') throw new Error('not done');
    expect(hook.result.current.list.customers).toHaveLength(40);
  });

  it('does not reload while the page is hidden', async () => {
    const { fake } = setup();
    await advance();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    becomeVisible();
    await advance();
    visibility.mockRestore();
    expect(fake.service.list).toHaveBeenCalledTimes(1);
  });

  it('keeps the rows shown when the reload on return fails', async () => {
    const { fake, hook } = setup();
    await advance();
    fake.failNext('list', 'network');

    becomeVisible();
    await advance();

    expect(fake.service.list).toHaveBeenCalledTimes(2);
    expect(hook.result.current.list).toMatchObject({ status: 'done', more: { status: 'idle' } });
    if (hook.result.current.list.status !== 'done') throw new Error('not done');
    expect(hook.result.current.list.customers).toHaveLength(20);
  });

  it('reports not_operator to AuthProvider', async () => {
    const { auth, fake, hook } = setup();
    await advance();
    expect(hook.result.current.auth.status).toBe('signed-in');
    auth.removeProfile();
    fake.failNext('list', 'not_operator');

    act(() => hook.result.current.list.loadMore());
    await advance();

    expect(hook.result.current.auth).toMatchObject({
      status: 'signed-out',
      reason: 'not-enabled',
    });
  });

  it('drops the answers arriving after the home is gone', async () => {
    const { fake, hook } = setup();
    const held = fake.holdNext('list');
    await advance();
    hook.unmount();
    held.release();
    await advance();
    expect(fake.service.list).toHaveBeenCalledTimes(1);
  });
});
