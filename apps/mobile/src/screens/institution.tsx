import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { ActiveContext } from '@/lib/session';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAction, useLoad } from '@/lib/useLoad';
import { Badge, Banner, Button, Card, Empty, ErrorBox, Loading, Row, Screen, Stepper, T, TabBar } from '@/ui';
import { Ionicons } from '@expo/vector-icons';
import { AccountPanel } from './account';
import { color, space } from '@/theme';
import { routeTone, useFmt, Value } from '@/format';

type Tab = 'home' | 'history' | 'account';
const OPEN = ['submitted', 'scheduled', 'assigned'];
const STEP: Record<string, number> = { submitted: 0, scheduled: 1, assigned: 2, collected: 3, delivered_to_station: 4 };

export function InstitutionHome({ ctx }: { ctx: Extract<ActiveContext, { kind: 'institution' }> }) {
  const { t, lookup, time } = useI18n();
  const fmt = useFmt();
  const [tab, setTab] = useState<Tab>('home');
  const branches = useLoad(() => api.branches(ctx.orgId), []);
  const ids = (branches.data ?? []).map((b) => b.id);
  const requests = useLoad(() => (ids.length ? api.requests(ids) : Promise.resolve([])), [ids.join(',')], 15000);
  const pending = useLoad(api.pendingSignoffs, [], 5000);
  const history = useLoad(api.collections, [], 20000);
  const cancel = useAction();
  const open = (requests.data ?? []).filter((r) => OPEN.includes(r.status));
  const totalSigned = (history.data ?? []).reduce((s, c) => s + (c.stop_status === 'collected' ? Number(c.signed_net_g ?? 0) : 0), 0);

  return (
    <View style={{ flex: 1 }}>
      <Screen title={ctx.orgName} subtitle={t.ctx.institution}>
        {tab === 'home' ? (
          <>
            {pending.data?.length ? (
              <Card style={{ borderColor: color.accent, borderWidth: 2 }}>
                <T v="heading">{t.inst.sign}</T>
                {pending.data.map((p) => (
                  <View key={p.version_id} style={{ gap: 4 }}>
                    <Row label={`${p.branch_name} · ${p.route_code}`} value={<Value strong>{fmt.kg(p.lines.reduce((s, l) => s + l.net_g, 0))}</Value>} />
                    <Button big label={t.inst.signTitle} onPress={() => router.push({ pathname: '/institution/sign', params: { version: p.version_id } })} />
                  </View>
                ))}
              </Card>
            ) : null}
            <Card>
              <T v="heading">{t.inst.openRequest}</T>
              {requests.loading || branches.loading ? <Loading /> : <ErrorBox error={requests.error ?? branches.error} onRetry={() => { branches.reload(); requests.reload(); }} />}
              {open.map((r) => (
                <View key={r.id} style={{ gap: space.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <View style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: color.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="leaf" size={24} color={color.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <T v="heading">{lookup('reqStatus', r.status)}</T>
                      <T v="small" muted>{branches.data?.find((b) => b.id === r.branch_id)?.name ?? ''} · {time(r.created_at)}</T>
                    </View>
                  </View>
                  <Stepper current={STEP[r.status] ?? 0} steps={[{ icon: 'document-text-outline', label: lookup('reqStatus', 'submitted') }, { icon: 'git-network-outline', label: lookup('reqStatus', 'scheduled') }, { icon: 'car-outline', label: lookup('reqStatus', 'assigned') }, { icon: 'cube-outline', label: lookup('reqStatus', 'collected') }, { icon: 'business-outline', label: lookup('reqStatus', 'delivered_to_station') }]} />
                  {r.status === 'submitted' ? <Button variant="ghost" busy={cancel.busy} label={t.inst.cancelRequest} onPress={async () => { await cancel.run(() => api.cancelRequest(r.id, 'cancelled_in_app')); requests.reload(); }} /> : null}
                </View>
              ))}
              {!requests.loading && open.length === 0 ? <T muted>{t.inst.noOpen}</T> : null}
              <ErrorBox error={cancel.error} />
            </Card>
            <Button big label={t.inst.ready} onPress={() => router.push({ pathname: '/institution/new-request', params: { org: ctx.orgId } })} />
            <Card>
              <T v="label" muted>{t.inst.totals}</T>
              <Row label={t.inst.collectedSigned} value={<Value strong>{fmt.kg(totalSigned)}</Value>} />
            </Card>
          </>
        ) : tab === 'history' ? (
          history.loading ? <Loading /> : history.error ? <ErrorBox error={history.error} onRetry={history.reload} /> : history.data?.length ? history.data.map((c) => (
            <Card key={c.stop_id}>
              <Row label={`${c.branch_name} · ${c.route_code}`} value={<Badge tone={routeTone(c.stop_status === 'exception' ? 'needs_review' : c.route_status)} label={c.stop_status === 'exception' ? lookup('exceptionKinds', c.exception_kind) : lookup('routeStatus', c.route_status)} />} />
              <Row label={t.inst.signedWeight} value={<Value>{fmt.kg(c.signed_net_g)}</Value>} />
              {c.completed_at ? <T v="small" muted>{time(c.completed_at)}</T> : null}
            </Card>
          )) : <Empty text={t.common.empty} />
        ) : <AccountPanel />}
      </Screen>
      <TabBar value={tab} onChange={setTab} tabs={[{ key: 'home', label: t.tabs.home, badge: pending.data?.length }, { key: 'history', label: t.inst.history }, { key: 'account', label: t.tabs.account }]} />
    </View>
  );
}
