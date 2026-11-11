import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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
  const { t, rtl } = useI18n();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={[s.header, { paddingTop: insets.top + space.md }]}>
        <View style={{ flex: 1, gap: space.xs }}>
          {back ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t.common.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12} style={s.back}>
              <Ionicons name="chevron-forward" size={22} color={color.primary} style={{ transform: [{ scaleX: rtl ? 1 : -1 }] }} />
            </Pressable>
          ) : null}
          <T v="title" tone="onPrimary" accessibilityRole="header">{title}</T>
          {subtitle ? (
            <View style={s.subPill}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#A7F3C9' }} />
              <T v="small" tone="onPrimary" style={{ fontFamily: type.label.fontFamily }}>{subtitle}</T>
            </View>
          ) : null}
        </View>
        {right}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.lg, paddingTop: space.xl, gap: space.md, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      {footer ? <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, backgroundColor: color.surface, gap: space.sm, ...shadow.bar }}>{footer}</View> : null}
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
      style={({ pressed }) => [s.button, { backgroundColor: bg, minHeight: big ? touch.driver : touch.min, opacity: off ? 0.5 : pressed ? 0.85 : 1 }, variant === 'ghost' && { borderWidth: 1.5, borderColor: color.primary }]}>
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
  <View style={{ backgroundColor: tones[tone][0], paddingHorizontal: space.md, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' }}>
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

const TAB_ICONS: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  home: ['home', 'home-outline'], history: ['time', 'time-outline'], account: ['person-circle', 'person-circle-outline'],
  inbound: ['cube', 'cube-outline'], prices: ['pricetags', 'pricetags-outline'], routes: ['map', 'map-outline'],
  active: ['navigate-circle', 'navigate-circle-outline'], equipment: ['car', 'car-outline'], ops: ['speedometer', 'speedometer-outline'],
  reviews: ['shield-checkmark', 'shield-checkmark-outline'], settings: ['settings', 'settings-outline'],
};
export function TabBar<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string; badge?: number }[]; value: K; onChange: (k: K) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={[s.tabbar, { paddingBottom: insets.bottom + space.xs }]}>
      {tabs.map((tab) => {
        const on = tab.key === value;
        const icons = TAB_ICONS[tab.key] ?? ['ellipse', 'ellipse-outline'];
        return (
          <Pressable key={tab.key} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected: on }} onPress={() => onChange(tab.key)} style={s.tab}>
            <View>
              <Ionicons name={on ? icons[0] : icons[1]} size={25} color={on ? color.primary : color.textFaint} />
              {tab.badge ? <View style={s.dot}><Text style={[type.small, { color: '#fff', fontSize: 10, lineHeight: 14, fontFamily: type.label.fontFamily }]}>{tab.badge}</Text></View> : null}
            </View>
            <Text numberOfLines={1} style={[type.small, { color: on ? color.primary : color.textMuted, fontFamily: on ? type.heading.fontFamily : type.small.fontFamily, fontSize: 11.5 }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** order-tracking style progress: one icon per step joined by a bar that fills up to the current step */
export function Stepper({ steps, current }: { steps: { icon: keyof typeof Ionicons.glyphMap; label: string }[]; current: number }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={steps[Math.max(0, current)]?.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space.xs }}>
      {steps.map((st, i) => {
        const done = i < current, on = i === current;
        return (
          <React.Fragment key={i}>
            {i > 0 ? (
              <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: color.border, overflow: 'hidden' }}>
                <View style={{ width: i <= current ? '100%' : '0%', height: '100%', backgroundColor: color.primaryBright }} />
              </View>
            ) : null}
            {done ? (
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: color.primaryBright, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="checkmark" size={17} color="#fff" /></View>
            ) : (
              <Ionicons name={st.icon} size={on ? 28 : 24} color={on ? color.primary : color.textFaint} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

/** round icon button (call, chat, navigate) */
export const IconButton = ({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
    style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
    <Ionicons name={icon} size={21} color={color.text} />
  </Pressable>
);

/** a pill like "On time" */
export const Pill = ({ label, tone = 'success' }: { label: string; tone?: Tone }) => (
  <View style={{ backgroundColor: tones[tone][0], borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 3 }}>
    <Text style={[type.small, { color: tones[tone][1], fontFamily: type.label.fontFamily }]}>{label}</Text>
  </View>
);

const s = StyleSheet.create({
  header: { backgroundColor: color.primary, paddingHorizontal: space.lg, paddingBottom: space.xl, flexDirection: 'row', alignItems: 'flex-end', gap: space.md, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  subPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3 },
  dot: { position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: color.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: '#fff' },
  back: { alignSelf: 'flex-start', backgroundColor: color.surface, borderRadius: radius.pill, width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, ...shadow.card },
  button: { borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center' },
  input: { backgroundColor: color.bg, borderWidth: 1.5, borderColor: color.bg, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touch.min, color: color.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: 2 },
  tabbar: { flexDirection: 'row', backgroundColor: color.surface, paddingTop: space.sm, ...shadow.bar },
  tab: { flex: 1, alignItems: 'center', minHeight: touch.min, justifyContent: 'center', gap: 2 },
});
