import React, { useState } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/lib/session';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useAction, useLoad } from '@/lib/useLoad';
import { Banner, Button, Card, Empty, ErrorBox, Loading, Row, Screen, T } from '@/ui';
import { useFmt, Value } from '@/format';

// The owner / delegate reviews the exact weights and signs on their own account.
// The signature is bound to this data version (hash); if the driver changes anything, signing fails and the new version is shown.
export default function Sign() {
  const { session } = useSession();
  const { version } = useLocalSearchParams<{ version: string }>();
  const { t, name, time, locale } = useI18n();
  const fmt = useFmt();
  const pending = useLoad(api.pendingSignoffs, [], 5000);
  const [done, setDone] = useState(false);
  const act = useAction();
  if (!session) return <Redirect href="/sign-in" />;
  const item = pending.data?.find((p) => p.version_id === version) ?? (done ? undefined : pending.data?.[0]);
  const total = item?.lines.reduce((s, l) => s + l.net_g, 0) ?? 0;
  const sign = async () => { if (!item) return; const r = await act.run(() => api.signWeights(item.version_id, item.data_hash, locale)); if (r) setDone(true); else pending.reload(); };

  return (
    <Screen title={t.inst.signTitle} back footer={done ? <Button big label={t.common.back} onPress={() => router.replace('/')} /> : item ? <Button big label={t.inst.signButton} onPress={sign} busy={act.busy} /> : undefined}>
      {done ? <Banner tone="success" text={t.inst.signed} /> : pending.loading ? <Loading /> : pending.error ? <ErrorBox error={pending.error} onRetry={pending.reload} /> : !item ? <Empty text={t.common.empty} /> : (
        <>
          {item.version_id !== version ? <Banner tone="warning" text={t.errors.stale_version} /> : null}
          <Card>
            <Row label={t.inst.branch} value={item.branch_name} />
            <Row label={t.inst.route} value={<Value>{item.route_code}</Value>} />
            <Row label={t.inst.driver} value={item.driver_name} />
            <Row label={t.inst.scale} value={<Value>{item.scale_identifier}</Value>} />
            <Row label={t.inst.version} value={<Value>{String(item.version)}</Value>} />
            <T v="small" muted>{time(item.occurred_at)}</T>
            {item.correction_reason ? <Banner tone="warning" text={`${t.inst.correction}: ${item.correction_reason}`} /> : null}
          </Card>
          {item.lines.map((l) => (
            <Card key={l.material_id}>
              <T v="heading">{name(l)}</T>
              {l.method === 'gross_tare' ? <><Row label={t.inst.gross} value={<Value>{fmt.kg(l.gross_g)}</Value>} /><Row label={t.inst.tare} value={<Value>{fmt.kg(l.tare_g)}</Value>} /></> : null}
              <Row label={t.inst.net} value={<Value strong>{fmt.kg(l.net_g)}</Value>} />
            </Card>
          ))}
          <Card><Row label={t.inst.net} value={<Value strong>{fmt.kg(total)}</Value>} /></Card>
          <Banner text={t.inst.statement} />
          <ErrorBox error={act.error} />
        </>
      )}
    </Screen>
  );
}
