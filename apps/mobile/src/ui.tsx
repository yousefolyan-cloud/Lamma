import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { color, radius, shadow, space, touch, type } from './theme';
import { useI18n } from './i18n';

type Variant = keyof typeof type;
export function T({ v = 'body', muted, tone, center, style, ...p }: TextProps & { v?: Variant; muted?: boolean; tone?: 'danger' | 'success' | 'warning' | 'onPrimary'; center?: boolean }) {
  const { rtl } = useI18n();
  const c = tone === 'danger' ? color.danger : tone === 'success' ? color.success : tone === 'warning' ? color.warning : tone === 'onPrimary' ? color.onPrimary : muted ? color.textMuted : color.text;
  return <Text {...p} style={[type[v], { color: c, textAlign: center ? 'center' : rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }, style]} />;
}
/** inline numeric value; the digits themselves are direction-isolated in format.tsx */
export const Num = ({ children, ...p }: TextProps) => <Text {...p}>{children}</Text>;

export function Screen({ title, subtitle, back, right, children, footer }: { title: string; subtitle?: string; back?: boolean; right?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + space.md }]}>
        <View style={{ flex: 1 }}>
          {back ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t.common.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12} style={{ marginBottom: space.xs }}>
              <T v="label" tone="onPrimary" style={{ opacity: 0.85 }}>{t.common.back}</T>
            </Pressable>
          ) : null}
          <T v="title" tone="onPrimary" accessibilityRole="header">{title}</T>
          {subtitle ? <T v="small" tone="onPrimary" style={{ opacity: 0.85 }}>{subtitle}</T> : null}
        </View>
        {right}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      {footer ? <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, backgroundColor: color.surface, borderTopWidth: 1, borderColor: color.border, gap: space.sm }}>{footer}</View> : null}
    </View>
  );
}

export const Card = ({ style, ...p }: ViewProps) => <View {...p} style={[s.card, style]} />;

export function Button({ label, onPress, variant = 'primary', big, busy, disabled }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; big?: boolean; busy?: boolean; disabled?: boolean }) {
  const off = disabled || busy;
  const bg = variant === 'primary' ? color.primary : variant === 'danger' ? color.danger : variant === 'secondary' ? color.primarySoft : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? color.onPrimary : color.primary;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} disabled={off} onPress={onPress}
      style={({ pressed }) => [s.button, { backgroundColor: bg, minHeight: big ? touch.driver : touch.min, opacity: off ? 0.5 : pressed ? 0.85 : 1 }, variant === 'ghost' && { borderWidth: 1, borderColor: color.border }]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[big ? type.heading : type.label, { color: fg, textAlign: 'center' }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, ...p }: TextInputProps & { label: string; hint?: string }) {
  const { rtl } = useI18n();
  return (
    <View style={{ gap: space.xs }}>
      <T v="label">{label}</T>
      <TextInput accessibilityLabel={label} placeholderTextColor={color.textFaint} {...p}
        style={[s.input, type.body, { textAlign: p.keyboardType && p.keyboardType !== 'default' ? 'left' : rtl ? 'right' : 'left', writingDirection: p.keyboardType && p.keyboardType !== 'default' ? 'ltr' : rtl ? 'rtl' : 'ltr' }, p.multiline && { minHeight: 88, textAlignVertical: 'top' }]} />
      {hint ? <T v="small" muted>{hint}</T> : null}
    </View>
  );
}

const tones = { neutral: [color.surfaceAlt, color.textMuted], success: [color.successSoft, color.success], warning: [color.warningSoft, color.warning], danger: [color.dangerSoft, color.danger], info: [color.infoSoft, color.info] } as const;
export type Tone = keyof typeof tones;
export const Badge = ({ label, tone = 'neutral' }: { label: string; tone?: Tone }) => (
  <View style={{ backgroundColor: tones[tone][0], paddingHorizontal: space.md, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' }}>
    <Text style={[type.small, { color: tones[tone][1], fontFamily: type.label.fontFamily }]}>{label}</Text>
  </View>
);

export const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => (
  <View style={s.row}>
    <T v="label" muted style={{ flexShrink: 1 }}>{label}</T>
    {typeof value === 'string' ? <T v={strong ? 'heading' : 'body'} style={{ flexShrink: 1 }}>{value}</T> : value}
  </View>
);

export function Banner({ text, tone = 'info' }: { text: string; tone?: Tone }) {
  return <View accessibilityRole="alert" style={{ backgroundColor: tones[tone][0], borderRadius: radius.md, padding: space.md }}><T v="label" style={{ color: tones[tone][1] }}>{text}</T></View>;
}
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { err, t } = useI18n();
  if (!error) return null;
  return <View style={{ gap: space.sm }}><Banner tone="danger" text={err(error)} />{onRetry ? <Button variant="ghost" label={t.common.retry} onPress={onRetry} /> : null}</View>;
}
export const Loading = () => { const { t } = useI18n(); return <View style={{ padding: space.xl, alignItems: 'center', gap: space.sm }}><ActivityIndicator color={color.primary} /><T v="small" muted>{t.common.loading}</T></View>; };
export const Empty = ({ text }: { text: string }) => <Card style={{ alignItems: 'center', paddingVertical: space.xl }}><T muted center>{text}</T></Card>;

export function Choice<V extends string>({ options, value, onChange }: { options: { value: V; label: string }[]; value: V | null; onChange: (v: V) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
            style={{ minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1.5, borderColor: on ? color.primary : color.border, backgroundColor: on ? color.primarySoft : color.surface }}>
            <Text style={[type.label, { color: on ? color.primary : color.text }]}>{on ? '✓ ' : ''}{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TabBar<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string; badge?: number }[]; value: K; onChange: (k: K) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={[s.tabbar, { paddingBottom: insets.bottom + space.xs }]}>
      {tabs.map((tab) => {
        const on = tab.key === value;
        return (
          <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(tab.key)} style={s.tab}>
            <View style={{ height: 3, width: 28, borderRadius: 2, backgroundColor: on ? color.accent : 'transparent', marginBottom: space.xs }} />
            <Text style={[type.label, { color: on ? color.primary : color.textMuted, fontFamily: on ? type.heading.fontFamily : type.label.fontFamily }]}>{tab.label}{tab.badge ? `  (${tab.badge})` : ''}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: color.primary, paddingHorizontal: space.lg, paddingBottom: space.lg, flexDirection: 'row', alignItems: 'flex-end', gap: space.md, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  card: { backgroundColor: color.surface, borderRadius: radius.md, padding: space.lg, gap: space.sm, borderWidth: 1, borderColor: color.border, ...shadow.card },
  button: { borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center' },
  input: { backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touch.min, color: color.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: 2 },
  tabbar: { flexDirection: 'row', backgroundColor: color.surface, borderTopWidth: 1, borderColor: color.border },
  tab: { flex: 1, alignItems: 'center', minHeight: touch.min + 8, justifyContent: 'center' },
});
