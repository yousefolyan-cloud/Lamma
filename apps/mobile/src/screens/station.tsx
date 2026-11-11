import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { ActiveContext } from '@/lib/session';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAction, useLoad } from '@/lib/useLoad';
import { Badge, Banner, Button, Card, Empty, ErrorBox, Loading, Row, Screen, T, TabBar } from '@/ui';
import { AccountPanel } from './account';
import { StationPrices } from './settings';
import { routeTone, useFmt, Value } from '@/format';

type Tab = 'inbound' | 'prices' | 'account';
export function StationHome({ ctx }: { ctx: Extract<ActiveContext, { kind: 'station' }> }) {
  const { t, lookup, time } = useI18n();
  const fmt = useFmt();
  const [tab, setTab] = useState<Tab>('inbound');
  const routes = useLoad(api.stationRoutes, [], 6000);
  const act = useAction();
  const canReceive = ['station_manager', 'station_receiver'].includes(ctx.role);
  const live = (routes.data ?? []).filter((r) => ['en_route_to_station', 'awaiting_station_receipt', 'needs_review'].includes(r.status));
  return (
    <View style={{ flex: 1 }}>
      <Screen title={ctx.orgName} subtitle={t.ctx.station}>
        {tab === 'account' ? <AccountPanel /> : tab === 'prices' ? <StationPrices stationId={ctx.stationId} role={ctx.role} /> : routes.loading ? <Loading /> : routes.error ? <ErrorBox error={routes.error} onRetry={routes.reload} /> : !routes.data?.length ? <Empty text={t.station.none} /> : (
          <>
            <ErrorBox error={act.error} />
            {routes.data.map((r) => (
              <Card key={r.route_id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <T v="heading"><Value>{r.code}</Value></T>
                  <Badge tone={routeTone(r.status)} label={r.status === 'en_route_to_station' ? t.station.onTheWay : lookup('routeStatus', r.status)} />
                </View>
                {r.driver_name ? <Row label={t.station.driver} value={`${r.driver_name}${r.vehicle_plate ? ' · ' + r.vehicle_plate : ''}`} /> : null}
                <Row label={t.station.eta} value={time(r.expected_arrival)} />
                <Row label={t.station.signedTotal} value={<Value strong>{fmt.kg(r.signed_total_g)}</Value>} />
                <Row label={t.station.planned} value={<Value>{`${fmt.kg(r.planned_estimate_g)} (${t.common.estimate})`}</Value>} />
                <Row label={t.station.stopsInfo} value={<Value>{`${r.stops_collected} / ${r.stops_exception}`}</Value>} />
                {r.receipt ? <Row label={t.station.diff} value={<Value>{fmt.signedKg(r.receipt.diff_g)}</Value>} /> : null}
                {r.status === 'en_route_to_station' ? <T v="small" muted>{t.station.waitingDriver}</T> : null}
                {r.status === 'needs_review' ? <Banner tone="danger" text={`${t.station.reviewOpen}: ${(r.case_reasons ?? []).map((x) => lookup('reasons', x)).join(' · ')}`} /> : null}
                {canReceive && r.status === 'awaiting_station_receipt' && r.receipt?.status === 'review_cleared' ? (
                  <><Banner tone="info" text={t.station.cleared} /><Button big label={t.station.confirm} busy={act.busy} onPress={async () => { await act.run(() => api.confirmReviewed(r.receipt!.receipt_id)); routes.reload(); }} /></>
                ) : canReceive && r.status === 'awaiting_station_receipt' ? (
                  <Button big label={t.station.receive} onPress={() => router.push({ pathname: '/station/receive', params: { id: r.route_id } })} />
                ) : null}
              </Card>
            ))}
          </>
        )}
      </Screen>
      <TabBar value={tab} onChange={setTab} tabs={[{ key: 'inbound', label: t.tabs.inbound, badge: live.length }, { key: 'prices', label: t.tabs.prices }, { key: 'account', label: t.tabs.account }]} />
    </View>
  );
}
