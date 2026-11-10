import React, { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { parseKgToGrams } from '@lamma/domain';
import { useSession } from '@/lib/session';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAction, useLoad } from '@/lib/useLoad';
import { Banner, Button, Card, Choice, ErrorBox, Field, Loading, Screen, T } from '@/ui';

export default function NewRequest() {
  const { session } = useSession();
  const { org } = useLocalSearchParams<{ org: string }>();
  const { t, name } = useI18n();
  const branches = useLoad(() => api.branches(String(org)), [org]);
  const materials = useLoad(api.materials, []);
  const [branch, setBranch] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, { kg: string; containers: string }>>({});
  const [notes, setNotes] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const act = useAction();
  if (!session) return <Redirect href="/sign-in" />;
  const chosenBranch = branch ?? (branches.data?.length === 1 ? branches.data[0]!.id : null);

  const submit = async () => {
    setLocalError(null);
    const out: { material_id: string; est_g: number | null; containers: number | null }[] = [];
    for (const [id, l] of Object.entries(lines)) {
      const g = l.kg.trim() ? parseKgToGrams(l.kg) : null;
      const c = l.containers.trim() ? Number(l.containers) : null;
      if (l.kg.trim() && (g == null || g <= 0)) return setLocalError(t.errors.invalid_weight);
      if (c != null && (!Number.isInteger(c) || c <= 0)) return setLocalError(t.inst.pick);
      if (g != null || c != null) out.push({ material_id: id, est_g: g, containers: c });
    }
    if (!chosenBranch || out.length === 0) return setLocalError(t.inst.pick);
    const r = await act.run(() => api.submitRequest(chosenBranch, out, notes.trim() || null));
    if (r) setSent(true);
  };

  return (
    <Screen title={t.inst.ready} back footer={sent ? <Button big label={t.common.back} onPress={() => router.replace('/')} /> : <Button big label={t.inst.submit} onPress={submit} busy={act.busy} />}>
      {sent ? <Banner tone="success" text={t.inst.submitted} /> : (
        <>
          <Banner text={t.inst.readyHint} />
          {branches.loading || materials.loading ? <Loading /> : <ErrorBox error={branches.error ?? materials.error} onRetry={() => { branches.reload(); materials.reload(); }} />}
          {(branches.data?.length ?? 0) > 1 ? <Card><T v="label">{t.inst.branch}</T><Choice value={chosenBranch} onChange={setBranch} options={branches.data!.map((b) => ({ value: b.id, label: b.name }))} /></Card> : null}
          {materials.data?.map((m) => {
            const l = lines[m.id] ?? { kg: '', containers: '' };
            const set = (k: 'kg' | 'containers') => (v: string) => setLines((p) => ({ ...p, [m.id]: { ...l, [k]: v } }));
            return (
              <Card key={m.id}>
                <T v="heading">{name(m)}</T>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><Field label={t.inst.estKg} value={l.kg} onChangeText={set('kg')} keyboardType="decimal-pad" placeholder="0.000" /></View>
                  <View style={{ flex: 1 }}><Field label={t.inst.containers} value={l.containers} onChangeText={set('containers')} keyboardType="number-pad" /></View>
                </View>
              </Card>
            );
          })}
          <Field label={`${t.inst.notes} (${t.common.optional})`} value={notes} onChangeText={setNotes} multiline />
          {localError ? <Banner tone="danger" text={localError} /> : null}
          <ErrorBox error={act.error} />
        </>
      )}
    </Screen>
  );
}
