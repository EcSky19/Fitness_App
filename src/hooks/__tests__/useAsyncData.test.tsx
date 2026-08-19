/**
 * `useAsyncData` / `useAsyncDataOnce` contract tests.
 *
 * The regressions guarded here: a stale `error` leaking onto the next dep-set,
 * and `useAsyncDataOnce` re-rendering on every write despite documenting that
 * it ignores `dataVersion`.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useAsyncData, useAsyncDataOnce } from '@/hooks/useAsyncData';
import { useAppStore } from '@/store/appStore';

/** A promise plus its resolve/reject handles, so tests control the ordering. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAsyncData', () => {
  it('loads on mount and clears the spinner', async () => {
    const { result } = renderHook(() => useAsyncData(async () => 'value', [], 'initial'));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe('initial');

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe('value');
    expect(result.current.error).toBeNull();
  });

  it('drops a stale response when the deps change mid-flight', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const loaders: Record<string, Promise<string>> = { a: first.promise, b: second.promise };

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncData(() => loaders[key], [key], 'initial'),
      { initialProps: { key: 'a' } }
    );

    rerender({ key: 'b' });

    await act(async () => {
      second.resolve('for-b');
      await second.promise;
    });
    await waitFor(() => expect(result.current.data).toBe('for-b'));

    // The abandoned request for 'a' resolves last and must be ignored.
    await act(async () => {
      first.resolve('for-a');
      await first.promise;
    });
    expect(result.current.data).toBe('for-b');
  });

  it('keeps the previous data while the next dep-set loads', async () => {
    const pending = deferred<string>();
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useAsyncData(() => (key === 'a' ? Promise.resolve('data-a') : pending.promise), [key], ''),
      { initialProps: { key: 'a' } }
    );

    await waitFor(() => expect(result.current.data).toBe('data-a'));

    rerender({ key: 'b' });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.data).toBe('data-a');

    await act(async () => {
      pending.resolve('data-b');
      await pending.promise;
    });
    await waitFor(() => expect(result.current.data).toBe('data-b'));
  });

  it('applies the newest response when reload() fires during a request', async () => {
    const responses = [deferred<string>(), deferred<string>()];
    let call = 0;
    const { result } = renderHook(() =>
      useAsyncData(() => responses[call++].promise, [], 'initial')
    );

    await waitFor(() => expect(call).toBe(1));
    act(() => result.current.reload());
    await waitFor(() => expect(call).toBe(2));

    await act(async () => {
      responses[1].resolve('second');
      responses[0].resolve('first');
      await Promise.all([responses[0].promise, responses[1].promise]);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe('second');
  });

  it('re-runs once per dataVersion bump without looping', async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useAsyncData(async () => {
        calls += 1;
        return calls;
      }, [], 0)
    );

    await waitFor(() => expect(result.current.data).toBe(1));

    await act(async () => {
      useAppStore.getState().invalidate();
    });
    await waitFor(() => expect(result.current.data).toBe(2));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(2);
  });

  it('clears a previous error when a new dep-set starts loading', async () => {
    const pending = deferred<string>();
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useAsyncData(
          () => (key === 'a' ? Promise.reject(new Error('boom')) : pending.promise),
          [key],
          ''
        ),
      { initialProps: { key: 'a' } }
    );

    await waitFor(() => expect(result.current.error).toBe('boom'));

    rerender({ key: 'b' });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.error).toBeNull();

    await act(async () => {
      pending.resolve('ok');
      await pending.promise;
    });
    await waitFor(() => expect(result.current.data).toBe('ok'));
    expect(result.current.error).toBeNull();
  });

  it('reports non-Error rejections with a readable message', async () => {
    const { result } = renderHook(() =>
      useAsyncData(() => Promise.reject('plain string'), [], '')
    );
    await waitFor(() => expect(result.current.error).toBe('plain string'));

    const { result: unknownError } = renderHook(() =>
      useAsyncData(() => Promise.reject({ weird: true }), [], '')
    );
    await waitFor(() => expect(unknownError.current.error).toBe('Something went wrong'));
  });

  it('does not update state after unmount', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const pending = deferred<string>();

    const { unmount } = renderHook(() => useAsyncData(() => pending.promise, [], ''));
    unmount();

    await act(async () => {
      pending.resolve('late');
      await pending.promise;
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('useAsyncDataOnce', () => {
  it('ignores dataVersion completely — no refetch and no re-render', async () => {
    let calls = 0;
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useAsyncDataOnce(async () => {
        calls += 1;
        return calls;
      }, [], 0);
    });

    await waitFor(() => expect(result.current.data).toBe(1));
    const rendersAfterLoad = renders;

    await act(async () => {
      useAppStore.getState().invalidate();
      useAppStore.getState().invalidate();
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(1);
    expect(renders).toBe(rendersAfterLoad);
  });

  it('still re-runs on reload() and on dep changes', async () => {
    let calls = 0;
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useAsyncDataOnce(async () => {
          calls += 1;
          return `${key}-${calls}`;
        }, [key], ''),
      { initialProps: { key: 'a' } }
    );

    await waitFor(() => expect(result.current.data).toBe('a-1'));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe('a-2'));

    rerender({ key: 'b' });
    await waitFor(() => expect(result.current.data).toBe('b-3'));
  });
});
