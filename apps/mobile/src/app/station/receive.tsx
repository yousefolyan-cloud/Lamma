import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { parseKgToGrams } from '@lamma/domain';
import { useSession } from '@/lib/session';
import { useI18n } from '@/i18n';
import { api, type ReceiptResult } from '@/lib/api';
import { useAction, useLoad } from '@/lib/useLoad';
import { Banner, Button, Card, ErrorBox, Field, Loading, Row, Screen, T } from '@/ui';
import { useFmt, Value } from '@/format';

// Station receipt: weigh per material, see the comparison against the SIGNED field weights (not the planning estimate),
// then "confirm receipt". The server decides: match → route completed; difference / rejection → review, route stays open.
export default function Receive() {
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, name, lookup } = useI18n();
  const fmt = useFmt();
  const routes = useLoad(api.stationRoutes, []);
  const materials = useLoad(api.materials, []);
  const [vals, setVals] = useState<Record<string, { net: string; rejected: string; reason: string }>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiptResult | null>(null);
  const eventId = useRef(Crypto.randomUUID());
  const act = useAction();
  if (!session) return <Redirect href="/sign-in" />;
  const route = routes.data?.find((r) => r.route_id === id);
  if (!route || !materials.data) return <Screen title={t.station.receive} back>{routes.error ? <ErrorBox error={routes.error} onRetry={routes.reload} /> : <Loading />}</Screen>;

  const rows = route.signed_by_material.map((s) => {
    const v = vals[s.material_id] ?? { net: '', rejected: '', reason: '' };
    const net = parseKgToGrams(v.net); const rej = v.rejected.trim() ? parseKgToGrams(v.rejected) : 0;
    return { ...s, v, net, rej, material: materials.data!.find((m) => m.id === s.material_id) };
  });
  const complete = rows.every((r) => r.net != null);
  const stationTotal = rows.reduce((a, r) => a + (r.net ?? 0), 0);
  const diff = stationTotal - route.signed_total_g;

  const confirm = async () => {
    setLocalError(null);
    if (!rows.every((r) => r.net != null && r.rej != null && r.rej <= r.net && (r.rej === 0 || r.v.reason.trim()))) return setLocalError(t.station.invalid);
    const lines = rows.map((r) => ({ material_id: r.material_id, net_g: r.net!, accepted_g: r.net! - r.rej!, rejected_g: r.rej!, reject_reason: r.rej! > 0 ? r.v.reason.trim() : null }));
    const res = await act.run(() => api.submitReceipt(route.route_id, eventId.current, lines));
    if (res) setResult(res);
  };

  if (result) return (
    <Screen title={route.code} back footer={<Button big label={t.common.back} onPress={() => router.replace('/')} />}>
      <Banner tone={result.status === 'confirmed' ? 'success' : 'danger'} text={result.status === 'confirmed' ? t.station.confirmed : t.station.underReview} />
      <Card>
        <Row label={t.station.signed} value={<Value>{fmt.kg(route.signed_total_g)}</Value>} />
        <Row label={t.station.stationNet} value={<Value>{fmt.kg(stationTotal)}</Value>} />
        <Row label={t.station.diff} value={<Value strong>{fmt.signedKg(result.diff_g)}</Value>} />
        {result.reasons?.length ? <T tone="danger">{result.reasons.map((x) => lookup('reasons', x)).join(' · ')}</T> : null}
      </Card>
    </Screen>
  );

  return (
    <Screen title={`${t.station.receive} · ${route.code}`} subtitle={route.driver_name ? `${t.station.driver}: ${route.driver_name}${route.vehicle_plate ? ' · ' + route.vehicle_plate : ''}` : undefined} back
      footer={<><T v="small" muted>{t.station.confirmHint}</T><Button big label={t.station.confirm} onPress={confirm} busy={act.busy} disabled={!complete} /></>}>
      {rows.map((r) => {
        const set = (k: 'net' | 'rejected' | 'reason') => (x: string) => setVals((p) => ({ ...p, [r.material_id]: { ...r.v, [k]: x } }));
        return (
          <Card key={r.material_id}>
            <T v="heading">{r.material ? name(r.material) : ''}</T>
            <Row label={t.station.signed} value={<Value strong>{fmt.kg(r.signed_g)}</Value>} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label={t.station.netKg} value={r.v.net} onChangeText={set('net')} keyboardType="decimal-pad" placeholder="0.000" /></View>
              <View style={{ flex: 1 }}><Field label={t.station.rejectedKg} value={r.v.rejected} onChangeText={set('rejected')} keyboardType="decimal-pad" placeholder="0.000" /></View>
            </View>
            {r.rej ? <Field label={t.station.rejectReason} value={r.v.reason} onChangeText={set('reason')} /> : null}
            {r.net != null ? <Row label={t.station.diff} value={<Value>{fmt.signedKg(r.net - r.signed_g)}</Value>} /> : null}
          </Card>
        );
      })}
      <Card>
        <T v="heading">{t.station.compare}</T>
        <Row label={t.station.signed} value={<Value strong>{fmt.kg(route.signed_total_g)}</Value>} />
        <Row label={t.station.stationNet} value={<Value strong>{complete ? fmt.kg(stationTotal) : '—'}</Value>} />
        <Row label={t.station.diff} value={<Value strong>{complete ? `${fmt.signedKg(diff)}${route.signed_total_g ? `  (${((diff / route.signed_total_g) * 100).toFixed(2)}%)` : ''}` : '—'}</Value>} />
        <T v="small" muted>{t.station.planned}: {fmt.kg(route.planned_estimate_g)} ({t.common.estimate})</T>
      </Card>
      {localError ? <Banner tone="danger" text={localError} /> : null}
      <ErrorBox error={act.error} />
    </Screen>
  );
}
