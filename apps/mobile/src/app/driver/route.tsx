import React, { useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { parseKgToGrams } from '@lamma/domain';
import { useSession } from '@/lib/session';
import { useI18n } from '@/i18n';
import { api, type DriverStop, type Material, type WeighLineInput } from '@/lib/api';
import { useAction, useLoad } from '@/lib/useLoad';
import { Badge, Banner, Button, Card, Choice, ErrorBox, Field, Loading, Row, Screen, T } from '@/ui';
import { routeTone, useFmt, Value } from '@/format';

const openMaps = (lat: number | null, lng: number | null) => { if (lat != null && lng != null) Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`).catch(() => {}); };
const EXC = ['closed', 'no_materials', 'contaminated', 'prohibited', 'no_access', 'delegate_absent', 'signature_refused', 'scale_failure', 'over_capacity', 'other'] as const;

export default function DriverRoute() {
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lookup, time } = useI18n();
  const fmt = useFmt();
  const routes = useLoad(api.myRoutes, [], 4000);
  const stops = useLoad(() => api.routeStops(String(id)), [id], 4000);
  const materials = useLoad(api.materials, []);
  const act = useAction();
  if (!session) return <Redirect href="/sign-in" />;
  const route = routes.data?.find((r) => r.route_id === id);
  const reload = () => { routes.refresh(); stops.refresh(); };
  const doIt = async (fn: () => Promise<unknown>) => { await act.run(fn); reload(); };
  if (!route || !stops.data) return <Screen title={t.driver.myRoute} back>{routes.error || stops.error ? <ErrorBox error={routes.error ?? stops.error} onRetry={() => { routes.reload(); stops.reload(); }} /> : <Loading />}</Screen>;
  const current = stops.data.find((s) => s.status === 'pending' || s.status === 'arrived');
  const total = stops.data.length;

  return (
    <Screen title={route.code} subtitle={lookup('routeStatus', route.status)} back>
      <Card>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {stops.data.map((s) => <Badge key={s.stop_id} tone={s.status === 'collected' ? 'success' : s.status === 'exception' ? 'danger' : s.stop_id === current?.stop_id ? 'warning' : 'neutral'} label={`${s.seq}`} />)}
          <Badge tone={routeTone(route.status)} label={route.station_name} />
        </View>
        <Row label={t.driver.start} value={time(route.starts_at)} />
        <Row label={t.driver.pay} value={<Value strong>{fmt.jod(route.pay_fils)}</Value>} />
      </Card>
      <ErrorBox error={act.error} />

      {route.status === 'assigned' ? <Button big label={t.driver.startRoute} busy={act.busy} onPress={() => doIt(() => api.startRoute(route.route_id))} /> : null}

      {route.status === 'in_progress' && current ? (
        <StopPanel key={current.stop_id} stop={current} total={total} materials={materials.data ?? []} busy={act.busy} doIt={doIt} />
      ) : null}

      {route.status === 'en_route_to_station' ? (
        <Card>
          <T v="heading">{t.driver.toStation}</T>
          <T>{route.station_name}</T>
          {route.station_address ? <T muted>{route.station_address}</T> : null}
          <Button variant="secondary" big label={t.driver.navigate} onPress={() => openMaps(route.station_lat, route.station_lng)} />
          <Button big label={t.driver.arrivedStation} busy={act.busy} onPress={() => doIt(() => api.arriveStation(route.route_id))} />
        </Card>
      ) : null}

      {route.status === 'awaiting_station_receipt' ? <Card><T v="heading">{t.driver.awaiting}</T><T muted>{t.driver.awaitingBody}</T></Card> : null}
      {route.status === 'needs_review' ? (
        <Card>
          <Banner tone="danger" text={t.driver.review} />
          {route.receipt ? <><Row label={t.station.signed} value={<Value>{fmt.kg(route.receipt.signed_total_g)}</Value>} /><Row label={t.station.stationNet} value={<Value>{fmt.kg(route.receipt.station_net_g)}</Value>} /><Row label={t.driver.stationDiff} value={<Value strong>{fmt.signedKg(route.receipt.diff_g)}</Value>} /></> : null}
        </Card>
      ) : null}
      {route.status === 'completed' ? <Banner tone="success" text={t.driver.completed} /> : null}

      {stops.data.filter((s) => s.status === 'collected' || s.status === 'exception').map((s) => (
        <Card key={s.stop_id}>
          <Row label={`${t.driver.stopOf} ${s.seq} · ${s.org_name}`} value={<Badge tone={s.status === 'collected' ? 'success' : 'danger'} label={s.status === 'collected' ? fmt.kg(s.weigh?.lines.reduce((a, l) => a + l.net_g, 0) ?? 0) : lookup('exceptionKinds', s.exception_kind)} />} />
        </Card>
      ))}
    </Screen>
  );
}

function StopPanel({ stop, total, materials, busy, doIt }: { stop: DriverStop; total: number; materials: Material[]; busy: boolean; doIt: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { t, name, lookup } = useI18n();
  const fmt = useFmt();
  const [editing, setEditing] = useState(false);
  const [exc, setExc] = useState(false);
  const [excKind, setExcKind] = useState<(typeof EXC)[number] | null>(null);
  const [excNote, setExcNote] = useState('');
  const matName = (id: string) => { const m = materials.find((x) => x.id === id); return m ? name(m) : ''; };

  return (
    <Card>
      <T v="label" muted>{t.driver.stopOf} {stop.seq} / {total}</T>
      <T v="heading">{stop.org_name}</T>
      <T>{stop.branch_name}{stop.address ? ` · ${stop.address}` : ''}</T>
      {stop.entrance_notes ? <T v="small" muted>{t.driver.entrance}: {stop.entrance_notes}</T> : null}
      {stop.expected?.length ? <T v="small" muted>{t.driver.expected}: {stop.expected.map((e) => `${matName(e.material_id)} ${e.est_g != null ? fmt.kg(e.est_g) : ''}`).join(' · ')} ({t.common.estimate})</T> : null}

      {stop.status === 'pending' ? (
        <>
          <Button variant="secondary" big label={t.driver.navigate} onPress={() => openMaps(stop.lat, stop.lng)} />
          <Button big label={t.driver.arrive} busy={busy} onPress={() => doIt(() => api.arriveStop(stop.stop_id))} />
        </>
      ) : !stop.weigh || editing ? (
        <WeighForm stop={stop} materials={materials} correction={!!stop.weigh} busy={busy} onSaved={() => setEditing(false)} doIt={doIt} />
      ) : (
        <>
          {stop.weigh.lines.map((l) => <Row key={l.material_id} label={matName(l.material_id)} value={<Value strong>{fmt.kg(l.net_g)}</Value>} />)}
          {stop.weigh.status === 'awaiting_signature'
            ? <Banner tone="warning" text={t.driver.waitingSign} />
            : <><Banner tone="success" text={t.driver.signedOk} /><Button big label={t.driver.completeStop} busy={busy} onPress={() => doIt(() => api.completeStop(stop.stop_id))} /></>}
          <Button variant="ghost" label={t.driver.reweigh} onPress={() => setEditing(true)} />
        </>
      )}

      {!exc ? <Button variant="ghost" label={t.driver.exception} onPress={() => setExc(true)} /> : (
        <View style={{ gap: 8 }}>
          <Choice value={excKind} onChange={setExcKind} options={EXC.map((k) => ({ value: k, label: lookup('exceptionKinds', k) }))} />
          <Field label={t.driver.exceptionNote} value={excNote} onChangeText={setExcNote} multiline />
          <Button variant="danger" label={t.driver.exception} busy={busy} disabled={!excKind || !excNote.trim()} onPress={() => doIt(() => api.stopException(stop.stop_id, excKind!, excNote.trim()))} />
          <Button variant="ghost" label={t.common.cancel} onPress={() => setExc(false)} />
        </View>
      )}
    </Card>
  );
}

function WeighForm({ stop, materials, correction, busy, onSaved, doIt }: { stop: DriverStop; materials: Material[]; correction: boolean; busy: boolean; onSaved: () => void; doIt: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { t, name } = useI18n();
  const fmt = useFmt();
  const expected = (stop.expected ?? []).map((e) => e.material_id);
  const [chosen, setChosen] = useState<string[]>(expected);
  const [vals, setVals] = useState<Record<string, { gross: string; tare: string }>>({});
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  // one id per measurement: a retry after a lost connection re-sends the same event and is never counted twice
  const eventId = useRef(Crypto.randomUUID());
  const others = materials.filter((m) => !chosen.includes(m.id));

  const save = async () => {
    setLocalError(null);
    const lines: WeighLineInput[] = [];
    for (const id of chosen) {
      const v = vals[id]; if (!v || (!v.gross.trim() && !v.tare.trim())) continue;
      const gross = parseKgToGrams(v.gross), tare = parseKgToGrams(v.tare.trim() || '0');
      if (gross == null || tare == null || gross <= tare) return setLocalError(t.driver.invalidWeight);
      lines.push({ material_id: id, method: 'gross_tare', gross_g: gross, tare_g: tare, net_g: gross - tare });
    }
    if (!lines.length) return setLocalError(t.driver.invalidWeight);
    if (correction && !reason.trim()) return setLocalError(t.errors.reason_required);
    await doIt(async () => { await api.recordWeights(stop.stop_id, eventId.current, lines, correction ? reason.trim() : null); eventId.current = Crypto.randomUUID(); onSaved(); });
  };

  return (
    <View style={{ gap: 12 }}>
      <T v="heading">{t.driver.weigh}</T>
      {chosen.map((id) => {
        const m = materials.find((x) => x.id === id); const v = vals[id] ?? { gross: '', tare: '' };
        const g = parseKgToGrams(v.gross), tr = parseKgToGrams(v.tare.trim() || '0');
        const net = g != null && tr != null && g > tr ? g - tr : null;
        const set = (k: 'gross' | 'tare') => (x: string) => setVals((p) => ({ ...p, [id]: { ...v, [k]: x } }));
        return (
          <View key={id} style={{ gap: 6 }}>
            <T v="label">{m ? name(m) : ''}</T>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label={t.driver.gross} value={v.gross} onChangeText={set('gross')} keyboardType="decimal-pad" placeholder="0.000" /></View>
              <View style={{ flex: 1 }}><Field label={t.driver.tare} value={v.tare} onChangeText={set('tare')} keyboardType="decimal-pad" placeholder="0.000" /></View>
            </View>
            <Row label={t.driver.net} value={<Value strong>{net != null ? fmt.kg(net) : '—'}</Value>} />
          </View>
        );
      })}
      {others.length ? <Choice value={null} onChange={(id) => setChosen((c) => [...c, id])} options={others.map((m) => ({ value: m.id, label: `+ ${name(m)}` }))} /> : null}
      {correction ? <Field label={t.driver.correctionReason} value={reason} onChangeText={setReason} /> : null}
      {localError ? <Banner tone="danger" text={localError} /> : null}
      <Button big label={t.driver.saveWeights} onPress={save} busy={busy} />
    </View>
  );
}
