import React from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '@/lib/session';
import { configError } from '@/lib/supabase';
import { useI18n } from '@/i18n';
import { Banner, Button, ErrorBox, Loading, Screen, T } from '@/ui';
import { InstitutionHome } from '@/screens/institution';
import { DriverHome } from '@/screens/driver';
import { StationHome } from '@/screens/station';
import { AdminHome } from '@/screens/admin';
import { PendingScreen } from '@/screens/account';
import { color } from '@/theme';

export default function Gate() {
  const { ready, session, active, pending, loadError, refresh } = useSession();
  const { t } = useI18n();
  if (configError) return <Screen title={t.config.missingTitle}><Banner tone="danger" text={t.config.missingBody} /></Screen>;
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: color.bg }}><Loading /></View>;
  if (!session) return <Redirect href="/sign-in" />;
  if (loadError) return <Screen title={t.app.name}><ErrorBox error={loadError} onRetry={refresh} /></Screen>;
  if (!active) return pending.length ? <PendingScreen /> : <Redirect href="/join" />;
  // key = active context: switching organisation/role re-mounts the whole role UI, so no screen or data of the previous one survives
  switch (active.kind) {
    case 'institution': return <InstitutionHome key={active.key} ctx={active} />;
    case 'driver': return <DriverHome key={active.key} />;
    case 'station': return <StationHome key={active.key} ctx={active} />;
    case 'lamma': return <AdminHome key={active.key} />;
  }
}
