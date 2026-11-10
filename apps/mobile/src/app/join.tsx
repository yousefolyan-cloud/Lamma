import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSession } from '@/lib/session';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAction, useLoad } from '@/lib/useLoad';
import { Banner, Button, Card, Choice, ErrorBox, Field, Loading, Screen, T } from '@/ui';

type Kind = 'institution' | 'driver' | 'station';
const coord = (s: string, max: number) => { const n = Number(s.trim()); return s.trim() !== '' && Number.isFinite(n) && Math.abs(n) <= max ? n : null; };

export default function Join() {
  const { session, refresh, signOut, available, pending } = useSession();
  const { t, name } = useI18n();
  const areas = useLoad(api.areas, []);
  const [kind, setKind] = useState<Kind | null>(null);
  const [f, setF] = useState({ name: '', type: '', branch: '', address: '', lat: '', lng: '', authority: '', number: '', expires: '' });
  const [area, setArea] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const act = useAction();
  if (!session) return <Redirect href="/sign-in" />;
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setLocalError(null);
    if (!area) return setLocalError(t.common.required);
    if (kind === 'driver') { await done(act.run(() => api.registerDriver([area]))); return; }
    const lat = coord(f.lat, 90), lng = coord(f.lng, 180);
    if (!f.name.trim() || (kind === 'institution' && !f.branch.trim())) return setLocalError(t.common.required);
    if (lat == null || lng == null) return setLocalError(t.join.badCoords);
    if (kind === 'institution') await done(act.run(() => api.registerInstitution({ name: f.name.trim(), type: f.type.trim(), branch: f.branch.trim(), area, address: f.address.trim(), lat, lng })));
    else await done(act.run(() => api.registerStation({ name: f.name.trim(), area, address: f.address.trim(), lat, lng, authority: f.authority.trim(), number: f.number.trim(), expires: /^\d{4}-\d{2}-\d{2}$/.test(f.expires.trim()) ? f.expires.trim() : null })));
  };
  const done = async (p: Promise<unknown>) => { const r = await p; if (r !== undefined) { await refresh(); router.replace('/'); } };

  const options: { k: Kind; title: string; desc: string }[] = [
    { k: 'institution', title: t.join.institution, desc: t.join.institutionDesc },
    { k: 'driver', title: t.join.driver, desc: t.join.driverDesc },
    { k: 'station', title: t.join.station, desc: t.join.stationDesc },
  ];
  return (
    <Screen title={t.join.title} subtitle={t.join.subtitle} back={available.length + pending.length > 0}>
      {!kind ? (
        <>
          {options.map((o) => (
            <Pressable key={o.k} accessibilityRole="button" onPress={() => setKind(o.k)}>
              <Card><T v="heading">{o.title}</T><T muted>{o.desc}</T></Card>
            </Pressable>
          ))}
          {available.length + pending.length === 0 ? <Button variant="ghost" label={t.auth.signOut} onPress={signOut} /> : null}
        </>
      ) : (
        <Card>
          <T v="heading">{options.find((o) => o.k === kind)!.title}</T>
          {kind !== 'driver' ? <Field label={kind === 'station' ? t.join.stationName : t.join.orgName} value={f.name} onChangeText={set('name')} /> : null}
          {kind === 'institution' ? <><Field label={t.join.orgType} value={f.type} onChangeText={set('type')} /><Field label={t.join.branchName} value={f.branch} onChangeText={set('branch')} /></> : null}
          <T v="label">{t.join.area}</T>
          {areas.loading ? <Loading /> : areas.error ? <ErrorBox error={areas.error} onRetry={areas.reload} /> : areas.data?.length
            ? <Choice value={area} onChange={setArea} options={areas.data.map((a) => ({ value: a.id, label: name(a) }))} />
            : <Banner tone="warning" text={t.join.noAreas} />}
          {kind !== 'driver' ? (
            <>
              <Field label={t.join.address} value={f.address} onChangeText={set('address')} />
              <Field label={t.join.lat} value={f.lat} onChangeText={set('lat')} keyboardType="numbers-and-punctuation" hint={t.join.locationHint} />
              <Field label={t.join.lng} value={f.lng} onChangeText={set('lng')} keyboardType="numbers-and-punctuation" />
            </>
          ) : null}
          {kind === 'station' ? (
            <>
              <Field label={t.join.licenseAuthority} value={f.authority} onChangeText={set('authority')} />
              <Field label={t.join.licenseNumber} value={f.number} onChangeText={set('number')} />
              <Field label={t.join.licenseExpiry} value={f.expires} onChangeText={set('expires')} keyboardType="numbers-and-punctuation" />
            </>
          ) : null}
          {localError ? <Banner tone="danger" text={localError} /> : null}
          <ErrorBox error={act.error} />
          <Button label={t.join.submit} onPress={submit} busy={act.busy} />
          <Button variant="ghost" label={t.common.back} onPress={() => { setKind(null); act.clear(); setLocalError(null); }} />
        </Card>
      )}
    </Screen>
  );
}
