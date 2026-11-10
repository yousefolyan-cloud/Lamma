import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSession, type ActiveContext } from '@/lib/session';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Badge, Banner, Button, Card, Choice, Empty, Row, Screen, T } from '@/ui';
import { reviewTone } from '@/format';
import { space } from '@/theme';

const label = (c: ActiveContext, t: ReturnType<typeof useI18n>['t']) => (c.kind === 'driver' ? t.ctx.driver : `${t.ctx[c.kind]} · ${c.orgName}`);

export function AccountPanel() {
  const { contexts, available, active, setActive, pending, signOut, session } = useSession();
  const { t, locale, setLocale, lookup, time } = useI18n();
  const notices = useLoad(api.notices, [active?.key], 30000);
  return (
    <>
      <Card>
        <T v="heading">{contexts?.profile?.full_name || session?.user.email}</T>
        <T v="small" muted>{session?.user.email}</T>
      </Card>
      {available.length > 1 ? (
        <Card>
          <T v="label" muted>{t.ctx.switch}</T>
          <Choice value={active?.key ?? null} onChange={setActive} options={available.map((c) => ({ value: c.key, label: label(c, t) }))} />
        </Card>
      ) : null}
      {pending.map((p, i) => (
        <Card key={i}>
          <Row label={`${t.ctx[p.kind]}${p.name ? ' · ' + p.name : ''}`} value={<Badge tone={reviewTone(p.status)} label={p.status === 'pending' ? t.pending.title : p.status === 'rejected' ? t.pending.rejected : t.pending.suspended} />} />
          {p.reason ? <T v="small" muted>{p.reason}</T> : null}
        </Card>
      ))}
      <Card>
        <T v="label" muted>{t.notice.title}</T>
        {notices.data?.length ? notices.data.slice(0, 8).map((n) => (
          <View key={n.id} style={{ paddingVertical: space.xs }}>
            <T v="label">{lookup('notice', n.kind)}{typeof n.payload.code === 'string' ? ` · ${n.payload.code}` : ''}</T>
            <T v="small" muted>{time(n.created_at)}</T>
          </View>
        )) : <T v="small" muted>{t.common.none}</T>}
      </Card>
      <Card>
        <T v="label" muted>{t.ctx.language}</T>
        <Choice value={locale} onChange={setLocale} options={[{ value: 'ar', label: t.ctx.arabic }, { value: 'en', label: t.ctx.english }]} />
      </Card>
      <Button variant="secondary" label={t.ctx.addRole} onPress={() => router.push('/join')} />
      <Button variant="ghost" label={t.auth.signOut} onPress={signOut} />
    </>
  );
}

export function PendingScreen() {
  const { pending, refresh, signOut } = useSession();
  const { t } = useI18n();
  const worst = pending.find((p) => p.status !== 'pending');
  return (
    <Screen title={t.pending.title} subtitle={t.app.name}>
      <Banner tone={worst ? 'danger' : 'warning'} text={worst ? (worst.status === 'rejected' ? t.pending.rejected : t.pending.suspended) : t.pending.body} />
      {pending.map((p, i) => (
        <Card key={i}>
          <Row label={`${t.ctx[p.kind]}${p.name ? ' · ' + p.name : ''}`} value={<Badge tone={reviewTone(p.status)} label={p.status === 'pending' ? t.pending.title : p.status === 'rejected' ? t.pending.rejected : t.pending.suspended} />} />
          {p.reason ? <T v="small" muted>{t.common.reason}: {p.reason}</T> : null}
        </Card>
      ))}
      <Button label={t.pending.refresh} onPress={refresh} />
      <Button variant="secondary" label={t.ctx.addRole} onPress={() => router.push('/join')} />
      <Button variant="ghost" label={t.auth.signOut} onPress={signOut} />
    </Screen>
  );
}
