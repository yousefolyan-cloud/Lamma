import React from 'react';
import { formatJod, formatKg } from '@lamma/domain';
import { useI18n } from './i18n';
import { Num, T, type Tone } from './ui';

// keep digits, signs and decimal points together and left-to-right inside Arabic sentences
const iso = (n: string) => `\u2066${n}\u2069`;

export function useFmt() {
  const { t } = useI18n();
  return {
    kg: (g: number | string | null | undefined) => (g == null ? '—' : `${iso(formatKg(g))} ${t.common.kg}`),
    jod: (fils: number | string) => `${iso(formatJod(fils))} ${t.common.jod}`,
    km: (m: number) => `${iso((m / 1000).toFixed(1))} ${t.common.km}`,
    duration: (min: number) => `${iso(String(min))} ${t.common.min}`,
    liters: (l: number | null) => (l == null ? null : `${iso(String(l))} ${t.common.liter}`),
    signedKg: (g: number) => `${iso((g > 0 ? '+' : '') + formatKg(g))} ${t.common.kg}`,
  };
}
export const Value = ({ children, strong }: { children: string; strong?: boolean }) => <T v={strong ? 'number' : 'body'}><Num>{children}</Num></T>;

export const routeTone = (status: string): Tone => (status === 'completed' ? 'success' : status === 'needs_review' ? 'danger' : status === 'published' ? 'info' : status === 'cancelled' || status === 'abandoned' ? 'neutral' : 'warning');
export const reviewTone = (status: string): Tone => (status === 'approved' ? 'success' : status === 'rejected' || status === 'suspended' ? 'danger' : 'warning');
