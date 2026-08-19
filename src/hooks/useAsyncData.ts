/**
 * `useAsyncData` — the standard way screens read from the repositories.
 *
 *   const { data, loading, error, reload } = useAsyncData(
 *     () => listEntriesByDate(date),
 *     [date],
 *     [] as FoodEntry[]
 *   );
 *
 * It re-runs whenever `deps` change, whenever any repository write bumps
 * `dataVersion` on the app store, and whenever `reload()` is called. Stale
 * responses are dropped (fast date switching can never render out of order) and
 * the previous data is kept while refreshing so screens never flash empty.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppStore } from '@/store/appStore';

export interface AsyncDataResult<T> {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Stable string key for a dependency list (identity-independent). */
function serializeDeps(deps: unknown[]): string {
  try {
    return JSON.stringify(deps ?? []);
  } catch {
    return (deps ?? []).map((dep) => String(dep)).join('|');
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Something went wrong';
}

function useAsyncDataInternal<T>(
  loader: () => Promise<T>,
  depsKey: string,
  initial: T,
  watchDataVersion: boolean
): AsyncDataResult<T> {
  const dataVersion = useAppStore((state) => state.dataVersion);
  const version = watchDataVersion ? dataVersion : 0;

  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const loadedKeysRef = useRef<Set<string>>(new Set<string>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    // Only the first load of a dep-set shows a spinner; refreshes keep the data.
    if (!loadedKeysRef.current.has(depsKey)) setLoading(true);

    const isCurrent = (): boolean => mountedRef.current && requestId === requestIdRef.current;

    void (async () => {
      try {
        const result = await loaderRef.current();
        if (!isCurrent()) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!isCurrent()) return;
        setError(toMessage(err));
      } finally {
        if (isCurrent()) {
          loadedKeysRef.current.add(depsKey);
          setLoading(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, version, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { data, loading, error, reload };
}

/** Loads async data, re-running on `deps`, store invalidation or `reload()`. */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  initial: T
): AsyncDataResult<T> {
  return useAsyncDataInternal(loader, serializeDeps(deps), initial, true);
}

/**
 * Same contract as {@link useAsyncData} but ignores `dataVersion`: the loader
 * only runs on mount, when `deps` change, or when `reload()` is called. Useful
 * for expensive one-shot reads (exports, stats) that should not refetch on
 * every write.
 */
export function useAsyncDataOnce<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  initial: T
): AsyncDataResult<T> {
  return useAsyncDataInternal(loader, serializeDeps(deps), initial, false);
}

export default useAsyncData;
