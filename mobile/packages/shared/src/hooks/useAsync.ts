import { useState, useEffect, useCallback, useRef } from 'react';
import { errorMessage } from '../services/api';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  reload: () => void;
  refresh: () => void;
  setData: (updater: T | ((prev: T | null) => T)) => void;
}

/**
 * Runs a fetcher on mount and whenever `deps` change, with a separate
 * `refreshing` flag so pull-to-refresh doesn't blank the screen.
 */
export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against setting state after unmount or from a superseded request.
  const mounted = useRef(true);
  const requestId = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (isRefresh: boolean) => {
    const id = ++requestId.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const result = await fetcherRef.current();
      if (mounted.current && id === requestId.current) setData(result);
    } catch (err) {
      if (mounted.current && id === requestId.current) setError(errorMessage(err));
    } finally {
      if (mounted.current && id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    data,
    loading,
    error,
    refreshing,
    reload: useCallback(() => void run(false), [run]),
    refresh: useCallback(() => void run(true), [run]),
    setData: useCallback((updater) => {
      setData((prev) => (typeof updater === 'function' ? (updater as (p: T | null) => T)(prev) : updater));
    }, []),
  };
}
