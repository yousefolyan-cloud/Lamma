import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useI18n } from '@/i18n';
import { api, type RouteCard } from '@/lib/api';
import { useAction, useLoad } from '@/lib/useLoad';
import { Badge, Banner, Button, Card, Choice, Empty, ErrorBox, Loading, Row, Screen, T, TabBar, type Tone } from '@/ui';
import { AccountPanel } from './account';
import { DriverEquipment } from './settings';
import { routeTone, useFmt, Value } from '@/format';

type Tab = 'routes' | 'active' | 'equipment' | 'account';
const appTone = (s: string): Tone => (s === 'selected' ? 'success' : s === 'ineligible' || s === 'not_selected' ? 'danger' : 'warning');

export function DriverHome() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('routes');
  const mine = useLoad(api.myRoutes, [], 8000);
  const live = (mine.data ?? []).filter((r) => r.active);
  return (
    <View style={{ flex: 1 }}>
      <Screen title={tab === 'routes' ? t.driver.available : tab === 'active' ? t.driver.myRoute : tab === 'equipment' ? t.tabs.equipment : t.tabs.account} subtitle={t.ctx.driver}>
        {tab === 'routes' ? <AvailableRoutes /> : tab === 'active' ? <MyRoutes mine={mine} /> : tab === 'equipment' ? <DriverEquipment /> : <AccountPanel />}
      </Screen>
      <TabBar value={tab} onChange={setTab} tabs={[{ key: 'routes', label: t.tabs.routes }, { key: 'active', label: t.tabs.active, badge: live.length }, { key: 'equipment', label: t.tabs.equipment }, { key: 'account', label: t.tabs.account }]} />
    </View>
  );
}

function AvailableRoutes() {
  const { t } = useI18n();
  const routes = useLoad(api.availableRoutes, [], 10000);
  const vehicles = useLoad(api.vehicles, []);
  if (routes.loading) return <Loading />;
  if (routes.error) return <ErrorBox error={routes.error} onRetry={routes.reload} />;
  if (!routes.data?.length) return <Empty text={t.driver.noRoutes} />;
  return <>{routes.data.map((r) => <RouteCardView key={r.route_id} r={r} vehicles={vehicles.data ?? []} onChanged={routes.refresh} />)}</>;
}

/** The eight mandatory fields, always shown, in a fixed order. */
function RouteCardView({ r, vehicles, onChanged }: { r: RouteCard; vehicles: { id: string; plate: string; vehicle_type: string }[]; onChanged: () => void }) {
  const { t, locale, lookup, time } = useI18n();
  const fmt = useFmt();
  const act = useAction();
  const [vehicle, setVehicle] = useState<string | null>(null);
  const chosen = vehicle ?? (vehicles.length === 1 ? vehicles[0]!.id : null);
  const truck = [fmt.kg(r.required_capacity_g), fmt.liters(r.required_capacity_l)].filter(Boolean).join(' · ');
  const apply = async () => { if (!chosen) return; await act.run(() => api.applyToRoute(r.route_id, chosen)); onChanged(); };
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T v="heading"><Value>{r.code}</Value></T>
        {r.my_application_status ? <Badge tone={appTone(r.my_application_status)} label={lookup('appStatus', r.my_application_status)} /> : null}
      </View>
      <Row label={`1. ${t.driver.expectedWeight}`} value={<Value strong>{`${fmt.kg(r.est_total_g)} (${t.common.estimate})`}</Value>} />
      <Row label={`2. ${t.driver.truck}`} value={<Value>{truck}</Value>} />
      <Row label={`3. ${t.driver.stops}`} value={<T><Value>{String(r.stops_count)}</Value> · {t.driver.finalStation}: {r.station_name}</T>} />
      <Row label={`4. ${t.driver.start}`} value={time(r.starts_at)} />
      <Row label={`5. ${t.driver.distance}`} value={<Value>{`${fmt.km(r.distance_m)}${r.distance_is_estimate ? ` (${t.common.estimate})` : ''}`}</Value>} />
      <Row label={`6. ${t.driver.area}`} value={locale === 'ar' ? r.area_name_ar : r.area_name_en} />
      <Row label={`7. ${t.driver.duration}`} value={<Value>{fmt.duration(r.expected_duration_min)}</Value>} />
      <Row label={`8. ${t.driver.pay}`} value={<Value strong>{fmt.jod(r.pay_fils)}</Value>} />
      {r.my_application_status === 'ineligible' ? <Banner tone="danger" text={(r.my_application_reasons ?? []).map((x) => lookup('reasons', x)).join(' · ')} /> : null}
      {!r.my_application_status ? (
        <>
          {vehicles.length > 1 ? <><T v="label" muted>{t.driver.chooseVehicle}</T><Choice value={chosen} onChange={setVehicle} options={vehicles.map((v) => ({ value: v.id, label: `${v.vehicle_type} · ${v.plate}` }))} /></> : null}
          {vehicles.length === 0 ? <Banner tone="warning" text={t.driver.noVehicle} /> : null}
          <ErrorBox error={act.error} />
          <Button big label={t.driver.apply} onPress={apply} busy={act.busy} disabled={!chosen} />
        </>
      ) : null}
    </Card>
  );
}

function MyRoutes({ mine }: { mine: ReturnType<typeof useLoad<Awaited<ReturnType<typeof api.myRoutes>>>> }) {
  const { t, lookup, time } = useI18n();
  const fmt = useFmt();
  if (mine.loading) return <Loading />;
  if (mine.error) return <ErrorBox error={mine.error} onRetry={mine.reload} />;
  const live = (mine.data ?? []).filter((r) => r.active);
  const past = (mine.data ?? []).filter((r) => !r.active);
  return (
    <>
      {live.length === 0 ? <Empty text={t.driver.noActive} /> : live.map((r) => (
        <Card key={r.route_id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="heading"><Value>{r.code}</Value></T><Badge tone={routeTone(r.status)} label={lookup('routeStatus', r.status)} /></View>
          <Row label={t.driver.start} value={time(r.starts_at)} />
          <Row label={t.driver.pay} value={<Value strong>{fmt.jod(r.pay_fils)}</Value>} />
          <Button big label={t.driver.myRoute} onPress={() => router.push({ pathname: '/driver/route', params: { id: r.route_id } })} />
        </Card>
      ))}
      {past.length ? <T v="label" muted>{t.driver.history}</T> : null}
      {past.map((r) => (
        <Card key={r.route_id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="label"><Value>{r.code}</Value></T><Badge tone={routeTone(r.status)} label={lookup('routeStatus', r.status)} /></View>
          <Row label={t.driver.pay} value={<Value>{fmt.jod(r.pay_fils)}</Value>} />
          {r.receipt ? <Row label={t.station.stationNet} value={<Value>{fmt.kg(r.receipt.station_net_g)}</Value>} /> : null}
        </Card>
      ))}
    </>
  );
}
