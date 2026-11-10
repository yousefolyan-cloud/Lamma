import { useCallback, useEffect, useRef, useState } from 'react';

/** Load server data with explicit loading / error / empty handling and optional polling. No cross-screen cache:
 *  role layouts are re-mounted when the active context changes, so nothing leaks between organisations. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs?: number) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const fnRef = useRef(fn); fnRef.current = fn;
  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { const d = await fnRef.current(); if (alive.current) { setData(d); setError(null); } }
    catch (e) { if (alive.current && !silent) setError(e); }
    finally { if (alive.current) setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { alive.current = true; reload(); return () => { alive.current = false; }; }, deps);
  useEffect(() => { if (!pollMs) return; const id = setInterval(() => reload(true), pollMs); return () => clearInterval(id); }, [pollMs, reload]);
  return { data, error, loading, reload: () => reload(false), refresh: () => reload(true) };
}

/** Run a server action once at a time (guards double taps) and surface its error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy) return undefined;
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e); return undefined; } finally { setBusy(false); }
  }, [busy]);
  return { busy, error, run, clear: () => setError(null) };
}
