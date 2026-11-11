import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { Redirect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, Choice, Field, Screen, T } from '@/ui';
import { space } from '@/theme';

export default function SignIn() {
  const { session } = useSession();
  const { t, locale, setLocale } = useI18n();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  if (session) return <Redirect href="/" />;
  const submit = async () => {
    if (!email.trim() || !password || (mode === 'up' && !name.trim())) { setError(t.common.required); return; }
    setBusy(true); setError(null);
    const res = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() } } });
    setBusy(false);
    if (res.error) setError(mode === 'in' ? t.auth.invalid : res.error.message);
  };
  return (
    <Screen title={t.app.name} subtitle={t.app.tagline}>
      <Image source={require('../../assets/lamma-logo.png')} accessibilityLabel={t.app.name} resizeMode="contain" style={{ width: 132, height: 132, alignSelf: 'center', marginVertical: space.sm }} />
      <Card>
        <T v="heading">{mode === 'in' ? t.auth.signIn : t.auth.signUp}</T>
        {mode === 'up' ? <Field label={t.auth.fullName} value={name} onChangeText={setName} autoComplete="name" /> : null}
        <Field label={t.auth.email} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Field label={t.auth.password} value={password} onChangeText={setPassword} secureTextEntry keyboardType="visible-password" autoCapitalize="none" />
        {error ? <Banner tone="danger" text={error} /> : null}
        <Button label={mode === 'in' ? t.auth.signIn : t.auth.signUp} onPress={submit} busy={busy} />
        <Button variant="ghost" label={mode === 'in' ? t.auth.noAccount : t.auth.haveAccount} onPress={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }} />
      </Card>
      <View style={{ gap: space.sm }}>
        <T v="label" muted>{t.ctx.language}</T>
        <Choice value={locale} onChange={setLocale} options={[{ value: 'ar', label: t.ctx.arabic }, { value: 'en', label: t.ctx.english }]} />
      </View>
    </Screen>
  );
}
