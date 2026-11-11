import React, { useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '@/i18n';
import { api, type ReviewQueue } from '@/lib/api';
import { useAction, useLoad } from '@/lib/useLoad';
import { Badge, Banner, Button, Card, Empty, ErrorBox, Field, Loading, Row, Screen, T, TabBar } from '@/ui';
import { AccountPanel } from './account';
import { AdminSettings } from './settings';
import { routeTone, useFmt, Value } from '@/format';

type Tab = 'ops' | 'reviews' | 'settings' | 'account';
export function AdminHome() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('ops');
  const queue = useLoad(api.reviewQueue, [], 15000);
  const count = queue.data ? Object.values(queue.data).reduce((a, l) => a + l.length, 0) : 0;
  return (
    <View style={{ flex: 1 }}>
      <Screen title={tab === 'ops' ? t.admin.overview : tab === 'reviews' ? t.admin.reviews : tab === 'settings' ? t.tabs.settings : t.tabs.account} subtitle={t.ctx.lamma}>
        {tab === 'ops' ? <Ops /> : tab === 'reviews' ? <Reviews queue={queue} /> : tab === 'settings' ? <AdminSettings /> : <AccountPanel />}
      </Screen>
      <TabBar value={tab} onChange={setTab} tabs={[{ key: 'ops', label: t.tabs.ops }, { key: 'reviews', label: t.tabs.reviews, badge: count }, { key: 'settings', label: t.tabs.settings }, { key: 'account', label: t.tabs.account }]} />
    </View>
  );
}

function Ops() {
  const { t, lookup, time } = useI18n();
  const fmt = useFmt();
  const o = useLoad(api.overview, [], 8000);
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  if (o.loading) return <Loading />;
  if (o.error || !o.data) return <ErrorBox error={o.error} onRetry={o.reload} />;
  const d = o.data;
  const resolve = async (id: string, outcome: 'accept_receipt' | 'reweigh') => { await act.run(() => api.resolveCase(id, outcome, (notes[id] ?? '').trim())); o.reload(); };
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        {([[t.admin.waiting, String(d.requests_waiting)], [t.admin.reschedule, String(d.requests_need_reschedule)], [t.admin.collected, fmt.kg(d.collected_signed_g)], [t.admin.accepted, fmt.kg(d.station_accepted_g)]] as const).map(([k, v]) => (
          <Card key={k} style={{ flexGrow: 1, flexBasis: '45%' }}><T v="small" muted>{k}</T><Value strong>{v}</Value></Card>
        ))}
      </View>
      <ErrorBox error={act.error} />
      {msg ? <Banner tone="warning" text={msg} /> : null}
      <T v="heading">{t.admin.cases}</T>
      {d.cases.length === 0 ? <Empty text={t.admin.noCases} /> : d.cases.map((c) => (
        <Card key={c.case_id}>
          <Row label={c.route_code} value={<Badge tone="danger" label={c.reasons.map((x) => lookup('reasons', x)).join(' · ')} />} />
          {c.has_receipt ? <><Row label={t.station.signed} value={<Value>{fmt.kg(c.signed_total_g)}</Value>} /><Row label={t.station.stationNet} value={<Value>{fmt.kg(c.station_net_g)}</Value>} /><Row label={t.station.diff} value={<Value strong>{fmt.signedKg(c.diff_g ?? 0)}</Value>} /></> : null}
          {c.has_receipt ? (
            <>
              <Field label={t.admin.note} value={notes[c.case_id] ?? ''} onChangeText={(v) => setNotes((p) => ({ ...p, [c.case_id]: v }))} multiline />
              <Button label={t.admin.accept} busy={act.busy} disabled={!(notes[c.case_id] ?? '').trim()} onPress={() => resolve(c.case_id, 'accept_receipt')} />
              <Button variant="secondary" label={t.admin.reweigh} busy={act.busy} disabled={!(notes[c.case_id] ?? '').trim()} onPress={() => resolve(c.case_id, 'reweigh')} />
            </>
          ) : null}
        </Card>
      ))}
      <T v="heading">{t.admin.routes}</T>
      {d.routes.length === 0 ? <Empty text={t.common.empty} /> : d.routes.map((r) => (
        <Card key={r.route_id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="label"><Value>{r.code}</Value></T><Badge tone={routeTone(r.status)} label={lookup('routeStatus', r.status)} /></View>
          <T v="small" muted>{time(r.starts_at)} · {r.station_name}</T>
          <Row label={t.driver.stops} value={<Value>{String(r.stops)}</Value>} />
          <Row label={t.driver.expectedWeight} value={<Value>{fmt.kg(r.est_total_g)}</Value>} />
          <Row label={t.driver.pay} value={<Value>{fmt.jod(r.pay_fils)}</Value>} />
          {r.driver_name ? <Row label={t.station.driver} value={r.driver_name} /> : null}
          {r.status === 'published' ? (
            <>
              <Row label={t.admin.applications} value={<Value>{String(r.applications)}</Value>} />
              {r.applications > 0 ? <Button variant="secondary" label={t.admin.assignNow} busy={act.busy} onPress={async () => { setMsg(null); const a = await act.run(() => api.assignRoute(r.route_id)); if (a === null) setMsg(t.admin.noEligible); o.reload(); }} /> : null}
            </>
          ) : null}
        </Card>
      ))}
    </>
  );
}

function Reviews({ queue }: { queue: ReturnType<typeof useLoad<ReviewQueue>> }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const act = useAction();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  if (queue.loading) return <Loading />;
  if (queue.error || !queue.data) return <ErrorBox error={queue.error} onRetry={queue.reload} />;
  const q = queue.data;
  const item = (entity: string, id: string, title: string, lines: [string, string][]) => (
    <Card key={entity + id}>
      <T v="heading">{title}</T>
      {lines.map(([k, v]) => <Row key={k} label={k} value={<Value>{v}</Value>} />)}
      <Field label={t.admin.rejectReason} value={reasons[id] ?? ''} onChangeText={(v) => setReasons((p) => ({ ...p, [id]: v }))} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Button label={t.common.approve} busy={act.busy} onPress={async () => { await act.run(() => api.review(entity, id, 'approved', null)); queue.reload(); }} /></View>
        <View style={{ flex: 1 }}><Button variant="danger" label={t.common.reject} busy={act.busy} disabled={!(reasons[id] ?? '').trim()} onPress={async () => { await act.run(() => api.review(entity, id, 'rejected', reasons[id]!.trim())); queue.reload(); }} /></View>
      </View>
    </Card>
  );
  const sections: [string, React.ReactNode[]][] = [
    [t.admin.organizations, q.organizations.map((o) => item('organization', o.id, o.name, [[t.ctx.switch, t.ctx[o.kind as 'institution' | 'station']]]))],
    [t.admin.licenses, q.station_licenses.map((s) => item('station_license', s.id, s.name, [[t.join.licenseAuthority, s.authority ?? '—'], [t.join.licenseNumber, s.number ?? '—'], [t.admin.validUntil, s.expires_on ?? '—']]))],
    [t.admin.drivers, q.drivers.map((d) => item('driver', d.id, d.name, []))],
    [t.admin.vehicles, q.vehicles.map((v) => item('vehicle', v.id, `${v.driver} · ${v.plate}`, [[t.admin.capacity, `${fmt.kg(v.capacity_g)} · ${fmt.liters(v.capacity_l)}`]]))],
    [t.admin.documents, q.driver_documents.map((d) => item('driver_document', d.id, `${d.driver} · ${d.kind}`, [[t.admin.validUntil, d.expires_on ?? '—']]))],
    [t.admin.scales, q.driver_scales.map((s) => item('driver_scale', s.id, `${s.driver} · ${s.identifier}`, [[t.admin.capacity, fmt.kg(s.capacity_g)], [t.admin.precision, fmt.kg(s.precision_g)], [t.admin.validUntil, s.check_valid_until ?? '—']]))],
  ];
  const any = sections.some(([, items]) => items.length);
  return (
    <>
      <ErrorBox error={act.error} />
      {!any ? <Empty text={t.admin.nothing} /> : sections.filter(([, items]) => items.length).map(([title, items]) => <View key={title} style={{ gap: 12 }}><T v="label" muted>{title}</T>{items}</View>)}
    </>
  );
}
