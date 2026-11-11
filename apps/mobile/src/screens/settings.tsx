// Configuration screens. Nothing here ships with default figures: every threshold, pay rate, tolerance and price
// is typed in by the responsible person and stored by an audited server function.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatThousandths, parseThousandths } from '@lamma/domain';
import { useI18n } from '@/i18n';
import { api, POLICY_KEYS, type Area, type Material, type PolicyKey } from '@/lib/api';
import { useAction, useLoad } from '@/lib/useLoad';
import { Badge, Banner, Button, Card, Choice, Empty, ErrorBox, Field, Loading, Row, T, type Tone } from '@/ui';
import { useFmt, Value } from '@/format';

const statusTone = (s: string): Tone => (s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : 'warning');
const isDate = (s: string) => s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s);
const int = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
const num = { keyboardType: 'decimal-pad' as const };

// ======================= Lamma operations =======================
type Section = 'areas' | 'materials' | 'rules' | 'documents';
export function AdminSettings() {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>('areas');
  return (
    <>
      <Banner tone="info" text={t.cfg.noDefaults} />
      <Choice value={section} onChange={setSection} options={[{ value: 'areas', label: t.cfg.areas }, { value: 'materials', label: t.cfg.materials }, { value: 'rules', label: t.cfg.rules }, { value: 'documents', label: t.cfg.documents }]} />
      {section === 'areas' ? <Areas /> : section === 'materials' ? <Materials /> : section === 'rules' ? <Rules /> : <RequiredDocuments />}
    </>
  );
}

function Areas() {
  const { t, name } = useI18n();
  const list = useLoad(api.allAreas, []);
  const act = useAction();
  const blank = { id: null as string | null, code: '', name_ar: '', name_en: '', city: '', active: false };
  const [f, setF] = useState<typeof blank | null>(null);
  const save = async () => { if (!f) return; const ok = await act.run(() => api.upsertArea(f)); if (ok) { setF(null); list.reload(); } };
  if (list.loading) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  return (
    <>
      {!list.data?.length && !f ? <Empty text={t.cfg.noAreas} /> : null}
      {(list.data ?? []).map((a) => (
        <Card key={a.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T v="heading">{name(a)}</T>
            <Badge tone={a.active ? 'success' : 'warning'} label={a.active ? t.cfg.active : t.cfg.inactive} />
          </View>
          <Row label={t.cfg.code} value={<Value>{a.code}</Value>} />
          <Row label={t.cfg.city} value={a.city} />
          <Button variant="secondary" label={t.cfg.edit} onPress={() => { act.clear(); setF({ id: a.id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, city: a.city, active: a.active }); }} />
        </Card>
      ))}
      {f ? (
        <Card>
          <T v="heading">{f.id ? t.cfg.edit : t.cfg.addArea}</T>
          <Field label={t.cfg.code} value={f.code} autoCapitalize="none" onChangeText={(v) => setF({ ...f, code: v })} />
          <Field label={t.cfg.nameAr} value={f.name_ar} onChangeText={(v) => setF({ ...f, name_ar: v })} />
          <Field label={t.cfg.nameEn} value={f.name_en} onChangeText={(v) => setF({ ...f, name_en: v })} />
          <Field label={t.cfg.city} value={f.city} onChangeText={(v) => setF({ ...f, city: v })} />
          <Choice value={f.active ? 'on' : 'off'} onChange={(v) => setF({ ...f, active: v === 'on' })} options={[{ value: 'on', label: t.cfg.active }, { value: 'off', label: t.cfg.inactive }]} />
          <ErrorBox error={act.error} />
          <Button label={t.common.save} busy={act.busy} disabled={!f.code.trim() || !f.name_ar.trim() || !f.name_en.trim() || !f.city.trim()} onPress={save} />
          <Button variant="ghost" label={t.common.cancel} onPress={() => setF(null)} />
        </Card>
      ) : <Button label={t.cfg.addArea} onPress={() => { act.clear(); setF(blank); }} />}
    </>
  );
}

function Materials() {
  const { t, name } = useI18n();
  const list = useLoad(api.allMaterials, []);
  const act = useAction();
  const blank = { id: null as string | null, code: '', name_ar: '', name_en: '', density: '', source: '', active: true };
  const [f, setF] = useState<typeof blank | null>(null);
  const density = f ? (f.density.trim() === '' ? null : int(f.density)) : null;
  const densityOk = !!f && (f.density.trim() === '' || (density !== null && density > 0 && f.source.trim() !== ''));
  const save = async () => {
    if (!f) return;
    const ok = await act.run(() => api.upsertMaterial({ id: f.id, code: f.code, name_ar: f.name_ar, name_en: f.name_en, density, source: density ? f.source.trim() : null, active: f.active }));
    if (ok) { setF(null); list.reload(); }
  };
  if (list.loading) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  return (
    <>
      {!list.data?.length && !f ? <Empty text={t.cfg.noMaterials} /> : null}
      {(list.data ?? []).map((m) => (
        <Card key={m.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T v="heading">{name(m)}</T>
            <Badge tone={m.active ? 'success' : 'warning'} label={m.active ? t.cfg.active : t.cfg.inactive} />
          </View>
          <Row label={t.cfg.code} value={<Value>{m.code}</Value>} />
          <Row label={t.cfg.density} value={m.bulk_density_g_per_l == null ? t.cfg.notSet : <Value>{String(m.bulk_density_g_per_l)}</Value>} />
          {m.density_source ? <Row label={t.cfg.densitySource} value={m.density_source} /> : null}
          <Button variant="secondary" label={t.cfg.edit} onPress={() => { act.clear(); setF({ id: m.id, code: m.code, name_ar: m.name_ar, name_en: m.name_en, density: m.bulk_density_g_per_l == null ? '' : String(m.bulk_density_g_per_l), source: m.density_source ?? '', active: m.active }); }} />
        </Card>
      ))}
      {f ? (
        <Card>
          <T v="heading">{f.id ? t.cfg.edit : t.cfg.addMaterial}</T>
          <Field label={t.cfg.code} value={f.code} autoCapitalize="none" onChangeText={(v) => setF({ ...f, code: v })} />
          <Field label={t.cfg.nameAr} value={f.name_ar} onChangeText={(v) => setF({ ...f, name_ar: v })} />
          <Field label={t.cfg.nameEn} value={f.name_en} onChangeText={(v) => setF({ ...f, name_en: v })} />
          <Field label={t.cfg.density} hint={t.cfg.densityHint} value={f.density} {...num} onChangeText={(v) => setF({ ...f, density: v })} />
          <Field label={t.cfg.densitySource} value={f.source} onChangeText={(v) => setF({ ...f, source: v })} />
          <Choice value={f.active ? 'on' : 'off'} onChange={(v) => setF({ ...f, active: v === 'on' })} options={[{ value: 'on', label: t.cfg.active }, { value: 'off', label: t.cfg.inactive }]} />
          <ErrorBox error={act.error} />
          <Button label={t.common.save} busy={act.busy} disabled={!f.code.trim() || !f.name_ar.trim() || !f.name_en.trim() || !densityOk} onPress={save} />
          <Button variant="ghost" label={t.common.cancel} onPress={() => setF(null)} />
        </Card>
      ) : <Button label={t.cfg.addMaterial} onPress={() => { act.clear(); setF(blank); }} />}
    </>
  );
}

/** Per-area rules: minimum weight per material that makes a route worth running, driver pay, timings and tolerance. */
function Rules() {
  const { t, name } = useI18n();
  const areas = useLoad(api.allAreas, []);
  const [area, setArea] = useState<string | null>(null);
  if (areas.loading) return <Loading />;
  if (areas.error) return <ErrorBox error={areas.error} onRetry={areas.reload} />;
  if (!areas.data?.length) return <Empty text={t.cfg.noAreas} />;
  const chosen = area ?? areas.data[0]!.id;
  return (
    <>
      <Choice value={chosen} onChange={setArea} options={areas.data.map((a) => ({ value: a.id, label: name(a) }))} />
      <AreaRules key={chosen} area={areas.data.find((a) => a.id === chosen)!} />
    </>
  );
}

type Unit = 'jod' | 'kg' | 'int' | 'pct';
const POLICY_UNIT: Record<PolicyKey, Unit> = {
  base_pay_fils: 'jod', per_stop_pay_fils: 'jod', per_km_pay_fils: 'jod', application_window_min: 'int', early_start_min: 'int',
  service_min_per_stop: 'int', unload_min: 'int', max_route_min: 'int', max_stops: 'int', plan_capacity_g: 'kg', plan_capacity_l: 'int',
  tolerance_g: 'kg', tolerance_bps: 'pct',
};
const show = (u: Unit, v: number | string | null): string => (v == null ? '' : u === 'jod' || u === 'kg' ? formatThousandths(v) : u === 'pct' ? String(Number(v) / 100) : String(v));
/** undefined = not a valid entry; null = left empty (not approved yet) */
const read = (u: Unit, s: string): number | null | undefined => {
  if (s.trim() === '') return null;
  if (u === 'int') return int(s) ?? undefined;
  if (u === 'pct') { const n = Number(s); return Number.isFinite(n) && n >= 0 && n <= 100 && Number.isInteger(Math.round(n * 100)) ? Math.round(n * 100) : undefined; }
  return parseThousandths(s) ?? undefined;
};

function AreaRules({ area }: { area: Area }) {
  const { t, name } = useI18n();
  const fmt = useFmt();
  const data = useLoad(async () => ({ materials: await api.allMaterials(), thresholds: await api.thresholds(area.id), policy: (await api.areaPolicy(area.id))[0] ?? null }), [area.id]);
  const act = useAction();
  const [min, setMin] = useState<Record<string, string>>({});
  const [pol, setPol] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!data.data) return;
    setMin(Object.fromEntries(data.data.thresholds.map((x) => [x.material_id, formatThousandths(x.min_g)])));
    setPol(Object.fromEntries(POLICY_KEYS.map((k) => [k, show(POLICY_UNIT[k], data.data!.policy?.[k] ?? null)])));
  }, [data.data]);
  if (data.loading) return <Loading />;
  if (data.error || !data.data) return <ErrorBox error={data.error} onRetry={data.reload} />;
  const d = data.data;
  const current = (m: Material) => d.thresholds.find((x) => x.material_id === m.id)?.min_g ?? null;
  const parsed = POLICY_KEYS.map((k) => [k, read(POLICY_UNIT[k], pol[k] ?? '')] as const);
  const invalid = parsed.some(([, v]) => v === undefined);
  const savePolicy = async () => {
    setSaved(false);
    const changed = Object.fromEntries(parsed.filter(([k, v]) => v !== (d.policy?.[k] == null ? null : Number(d.policy[k]))));
    if (!Object.keys(changed).length) return;
    const r = await act.run(async () => { await api.setAreaPolicy(area.id, changed); return true; });
    if (r) { setSaved(true); data.refresh(); }
  };
  const saveMin = async (m: Material) => {
    const g = parseThousandths(min[m.id] ?? '');
    if (!g || g <= 0) return;
    setSaved(false);
    const r = await act.run(async () => { await api.setThreshold(area.id, m.id, g); return true; });
    if (r) { setSaved(true); data.refresh(); }
  };
  return (
    <>
      <ErrorBox error={act.error} />
      {saved ? <Banner tone="success" text={t.cfg.saved} /> : null}
      <T v="heading">{t.cfg.thresholds}</T>
      <T v="small" muted>{t.cfg.thresholdsHint}</T>
      {!d.materials.length ? <Empty text={t.cfg.noMaterials} /> : d.materials.filter((m) => m.active).map((m) => (
        <Card key={m.id}>
          <Row label={name(m)} value={current(m) == null ? <Badge tone="warning" label={t.cfg.notSet} /> : <Value strong>{fmt.kg(current(m))}</Value>} />
          <Field label={t.cfg.minKg} value={min[m.id] ?? ''} {...num} onChangeText={(v) => setMin((p) => ({ ...p, [m.id]: v }))} />
          <Button variant="secondary" label={t.common.save} busy={act.busy} disabled={!(parseThousandths(min[m.id] ?? '') ?? 0) || parseThousandths(min[m.id] ?? '') === current(m)} onPress={() => saveMin(m)} />
        </Card>
      ))}
      <T v="heading">{t.cfg.policy}</T>
      {d.policy?.base_pay_fils == null || d.policy?.application_window_min == null ? <Banner tone="warning" text={t.cfg.policyIncomplete} /> : null}
      <Card>
        {POLICY_KEYS.map((k) => <Field key={k} label={t.cfg.policyFields[k]} value={pol[k] ?? ''} placeholder={t.cfg.notSet} {...num} onChangeText={(v) => setPol((p) => ({ ...p, [k]: v }))} />)}
        <T v="small" muted>{t.cfg.toleranceHint}</T>
        <Button label={t.cfg.savePolicy} busy={act.busy} disabled={invalid} onPress={savePolicy} />
      </Card>
    </>
  );
}

function RequiredDocuments() {
  const { t } = useI18n();
  const list = useLoad(api.requiredDocuments, []);
  const act = useAction();
  const [kind, setKind] = useState('');
  if (list.loading) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  return (
    <>
      <T v="small" muted>{t.cfg.documentsHint}</T>
      <ErrorBox error={act.error} />
      {!list.data?.length ? <Empty text={t.cfg.noDocuments} /> : list.data.map((d) => (
        <Card key={d.kind}>
          <T v="heading">{d.kind}</T>
          <Button variant="danger" label={t.cfg.remove} busy={act.busy} onPress={async () => { await act.run(() => api.setRequiredDocument(d.kind, false)); list.reload(); }} />
        </Card>
      ))}
      <Card>
        <Field label={t.cfg.documentKind} value={kind} onChangeText={setKind} />
        <Button label={t.cfg.addDocument} busy={act.busy} disabled={!kind.trim()} onPress={async () => { await act.run(() => api.setRequiredDocument(kind.trim(), true)); setKind(''); list.reload(); }} />
      </Card>
    </>
  );
}

// ======================= station: accepted materials and prices =======================
export function StationPrices({ stationId, role }: { stationId: string; role: string }) {
  const { t, name } = useI18n();
  const fmt = useFmt();
  const canPrice = ['station_manager', 'station_accountant'].includes(role);
  const canAccept = role === 'station_manager';
  const data = useLoad(async () => ({
    materials: (await api.allMaterials()).filter((m) => m.active),
    accepted: await api.stationMaterials(stationId),
    prices: canPrice ? await api.stationPrices(stationId) : [],
  }), [stationId]);
  const act = useAction();
  const [price, setPrice] = useState<Record<string, string>>({});
  if (data.loading) return <Loading />;
  if (data.error || !data.data) return <ErrorBox error={data.error} onRetry={data.reload} />;
  const d = data.data;
  if (!d.materials.length) return <Empty text={t.cfg.noMaterials} />;
  return (
    <>
      <T v="small" muted>{t.cfg.pricesHint}</T>
      <ErrorBox error={act.error} />
      {d.materials.map((m) => {
        const acc = d.accepted.find((x) => x.material_id === m.id)?.accepted ?? false;
        const cur = d.prices.find((x) => x.material_id === m.id);
        const fils = parseThousandths(price[m.id] ?? '');
        return (
          <Card key={m.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="heading">{name(m)}</T>
              <Badge tone={acc ? 'success' : 'warning'} label={acc ? t.cfg.accepted : t.cfg.notAccepted} />
            </View>
            {canAccept ? <Button variant={acc ? 'ghost' : 'secondary'} label={acc ? t.cfg.stopAccepting : t.cfg.accept} busy={act.busy} onPress={async () => { await act.run(() => api.setStationMaterial(stationId, m.id, !acc, null)); data.refresh(); }} /> : null}
            {canPrice ? (
              <>
                <Row label={t.cfg.currentPrice} value={cur ? <Value strong>{fmt.jod(cur.price_fils_per_kg)}</Value> : <Badge tone="warning" label={t.cfg.notSet} />} />
                <Field label={t.cfg.newPrice} value={price[m.id] ?? ''} {...num} onChangeText={(v) => setPrice((p) => ({ ...p, [m.id]: v }))} />
                <Button label={t.cfg.savePrice} busy={act.busy} disabled={fils == null || fils < 0 || (!!cur && String(fils) === String(cur.price_fils_per_kg))}
                  onPress={async () => { const r = await act.run(async () => { await api.setStationPrice(stationId, m.id, fils!); return true; }); if (r) { setPrice((p) => ({ ...p, [m.id]: '' })); data.refresh(); } }} />
              </>
            ) : null}
          </Card>
        );
      })}
    </>
  );
}

// ======================= driver: vehicle, documents, scale =======================
export function DriverEquipment() {
  const { t } = useI18n();
  const fmt = useFmt();
  const data = useLoad(async () => ({ vehicles: await api.vehicles(), documents: await api.driverDocuments(), scales: await api.driverScales(), required: await api.requiredDocuments() }), []);
  const act = useAction();
  const [form, setForm] = useState<'vehicle' | 'document' | 'scale' | null>(null);
  const [v, setV] = useState({ type: '', plate: '', kg: '', liters: '' });
  const [doc, setDoc] = useState({ kind: '', expires: '' });
  const [sc, setSc] = useState({ identifier: '', type: '', kg: '', precision: '', until: '' });
  if (data.loading) return <Loading />;
  if (data.error || !data.data) return <ErrorBox error={data.error} onRetry={data.reload} />;
  const d = data.data;
  const done = () => { setForm(null); data.refresh(); };
  const vKg = parseThousandths(v.kg), vL = int(v.liters);
  const sKg = parseThousandths(sc.kg), sPrec = parseThousandths(sc.precision);
  const missing = d.required.filter((r) => !d.documents.some((x) => x.kind === r.kind && x.status !== 'rejected'));
  const open = (f: typeof form) => { act.clear(); setForm(f); };
  return (
    <>
      <T v="small" muted>{t.cfg.equipmentHint}</T>
      <T v="heading">{t.cfg.vehicles}</T>
      {!d.vehicles.length ? <Empty text={t.cfg.noVehicles} /> : d.vehicles.map((x) => (
        <Card key={x.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><T v="heading">{x.vehicle_type} · <Value>{x.plate}</Value></T><Badge tone={statusTone(x.status)} label={t.cfg.status[x.status as 'pending'] ?? x.status} /></View>
          <Row label={t.admin.capacity} value={<Value>{`${fmt.kg(x.capacity_g)} · ${fmt.liters(x.capacity_l)}`}</Value>} />
        </Card>
      ))}
      {form === 'vehicle' ? (
        <Card>
          <Field label={t.cfg.vehicleType} value={v.type} onChangeText={(x) => setV({ ...v, type: x })} />
          <Field label={t.cfg.plate} value={v.plate} onChangeText={(x) => setV({ ...v, plate: x })} />
          <Field label={t.cfg.capacityKg} value={v.kg} {...num} onChangeText={(x) => setV({ ...v, kg: x })} />
          <Field label={t.cfg.capacityL} value={v.liters} {...num} onChangeText={(x) => setV({ ...v, liters: x })} />
          <ErrorBox error={act.error} />
          <Button label={t.common.save} busy={act.busy} disabled={!v.type.trim() || !v.plate.trim() || !vKg || !vL}
            onPress={async () => { if (await act.run(() => api.addVehicle({ type: v.type.trim(), plate: v.plate.trim(), capacityG: vKg!, capacityL: vL! }))) { setV({ type: '', plate: '', kg: '', liters: '' }); done(); } }} />
          <Button variant="ghost" label={t.common.cancel} onPress={() => setForm(null)} />
        </Card>
      ) : <Button variant="secondary" label={t.cfg.addVehicle} onPress={() => open('vehicle')} />}

      <T v="heading">{t.cfg.scales}</T>
      {!d.scales.length ? <Empty text={t.cfg.noScales} /> : d.scales.map((x) => (
        <Card key={x.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><T v="heading"><Value>{x.identifier}</Value></T><Badge tone={statusTone(x.status)} label={t.cfg.status[x.status as 'pending'] ?? x.status} /></View>
          <Row label={t.admin.capacity} value={<Value>{fmt.kg(x.capacity_g)}</Value>} />
          <Row label={t.admin.precision} value={<Value>{fmt.kg(x.precision_g)}</Value>} />
          <Row label={t.admin.validUntil} value={<Value>{x.check_valid_until?.slice(0, 10) ?? '—'}</Value>} />
        </Card>
      ))}
      {form === 'scale' ? (
        <Card>
          <Field label={t.cfg.scaleId} value={sc.identifier} onChangeText={(x) => setSc({ ...sc, identifier: x })} />
          <Field label={t.cfg.scaleType} value={sc.type} onChangeText={(x) => setSc({ ...sc, type: x })} />
          <Field label={t.cfg.capacityKg} value={sc.kg} {...num} onChangeText={(x) => setSc({ ...sc, kg: x })} />
          <Field label={t.cfg.precisionKg} value={sc.precision} {...num} onChangeText={(x) => setSc({ ...sc, precision: x })} />
          <Field label={t.cfg.checkUntil} value={sc.until} placeholder="YYYY-MM-DD" onChangeText={(x) => setSc({ ...sc, until: x })} />
          <ErrorBox error={act.error} />
          <Button label={t.common.save} busy={act.busy} disabled={!sc.identifier.trim() || !sKg || !sPrec || !isDate(sc.until.trim())}
            onPress={async () => { if (await act.run(() => api.addDriverScale({ identifier: sc.identifier.trim(), type: sc.type.trim() || null, capacityG: sKg!, precisionG: sPrec!, validUntil: sc.until.trim() || null }))) { setSc({ identifier: '', type: '', kg: '', precision: '', until: '' }); done(); } }} />
          <Button variant="ghost" label={t.common.cancel} onPress={() => setForm(null)} />
        </Card>
      ) : <Button variant="secondary" label={t.cfg.addScale} onPress={() => open('scale')} />}

      <T v="heading">{t.cfg.myDocuments}</T>
      {missing.length ? <Banner tone="warning" text={`${t.cfg.missingDocs}: ${missing.map((m) => m.kind).join(' · ')}`} /> : null}
      {!d.documents.length ? <Empty text={t.cfg.noMyDocuments} /> : d.documents.map((x) => (
        <Card key={x.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><T v="heading">{x.kind}</T><Badge tone={statusTone(x.status)} label={t.cfg.status[x.status as 'pending'] ?? x.status} /></View>
          <Row label={t.admin.validUntil} value={<Value>{x.expires_on?.slice(0, 10) ?? '—'}</Value>} />
        </Card>
      ))}
      {form === 'document' ? (
        <Card>
          {d.required.length ? <Choice value={doc.kind || null} onChange={(k) => setDoc({ ...doc, kind: k })} options={d.required.map((r) => ({ value: r.kind, label: r.kind }))} /> : null}
          <Field label={t.cfg.documentKind} value={doc.kind} onChangeText={(x) => setDoc({ ...doc, kind: x })} />
          <Field label={t.cfg.expires} value={doc.expires} placeholder="YYYY-MM-DD" onChangeText={(x) => setDoc({ ...doc, expires: x })} />
          <T v="small" muted>{t.cfg.uploadLater}</T>
          <ErrorBox error={act.error} />
          <Button label={t.common.save} busy={act.busy} disabled={!doc.kind.trim() || !isDate(doc.expires.trim())}
            onPress={async () => { if (await act.run(() => api.addDriverDocument(doc.kind.trim(), doc.expires.trim() || null))) { setDoc({ kind: '', expires: '' }); done(); } }} />
          <Button variant="ghost" label={t.common.cancel} onPress={() => setForm(null)} />
        </Card>
      ) : <Button variant="secondary" label={t.cfg.addMyDocument} onPress={() => open('document')} />}
    </>
  );
}
