// Who is signed in and which approved context (organisation / role) is active.
// Contexts come from the server (my_contexts); choosing one in the UI never creates a role.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { api, type Contexts } from './api';

export type ActiveContext =
  | { key: string; kind: 'institution'; orgId: string; orgName: string; role: string }
  | { key: string; kind: 'station'; orgId: string; orgName: string; role: string; stationId: string }
  | { key: string; kind: 'lamma'; orgId: string; orgName: string; role: string }
  | { key: string; kind: 'driver' };
export interface PendingItem { kind: 'institution' | 'station' | 'driver'; name: string; status: string; reason: string | null }

interface SessionState {
  ready: boolean; session: Session | null; contexts: Contexts | null; available: ActiveContext[]; pending: PendingItem[];
  active: ActiveContext | null; setActive: (key: string) => void; refresh: () => Promise<void>; signOut: () => Promise<void>; loadError: unknown;
}
const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [contexts, setContexts] = useState<Contexts | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(async (s: Session | null) => {
    if (!s) { setContexts(null); setActiveKey(null); setReady(true); return; }
    try { setContexts(await api.myContexts()); setLoadError(null); } catch (e) { setLoadError(e); }
    setReady(true);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); load(data.session); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession((prev) => {
        // a different account: drop everything tied to the previous one
        if (prev?.user.id !== s?.user.id) { setContexts(null); setActiveKey(null); setReady(false); setTimeout(() => load(s), 0); }
        return s;
      });
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const { available, pending } = useMemo(() => {
    const available: ActiveContext[] = []; const pending: PendingItem[] = [];
    for (const m of contexts?.memberships ?? []) {
      const ok = m.org_status === 'approved' && m.membership_status === 'approved';
      if (!ok) { if (m.kind !== 'lamma') pending.push({ kind: m.kind, name: m.org_name, status: m.org_status !== 'approved' ? m.org_status : m.membership_status, reason: m.status_reason }); continue; }
      const key = `${m.kind}:${m.org_id}:${m.role}`;
      if (m.kind === 'station' && m.station_id) available.push({ key, kind: 'station', orgId: m.org_id, orgName: m.org_name, role: m.role, stationId: m.station_id });
      else if (m.kind === 'institution') available.push({ key, kind: 'institution', orgId: m.org_id, orgName: m.org_name, role: m.role });
      else if (m.kind === 'lamma') available.push({ key, kind: 'lamma', orgId: m.org_id, orgName: m.org_name, role: m.role });
    }
    if (contexts?.driver) {
      if (contexts.driver.status === 'approved') available.push({ key: 'driver', kind: 'driver' });
      else pending.push({ kind: 'driver', name: '', status: contexts.driver.status, reason: contexts.driver.status_reason });
    }
    return { available, pending };
  }, [contexts]);

  const active = available.find((a) => a.key === activeKey) ?? available[0] ?? null;
  const value: SessionState = {
    ready, session, contexts, available, pending, active, loadError,
    setActive: setActiveKey,
    refresh: () => load(session),
    signOut: async () => { await supabase.auth.signOut(); setContexts(null); setActiveKey(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useSession = () => { const v = useContext(Ctx); if (!v) throw new Error('SessionProvider missing'); return v; };
