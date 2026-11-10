import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ar, type Dict } from './ar';
import { en } from './en';
import { ApiError } from '@/lib/api';

export type Locale = 'ar' | 'en';
const dicts: Record<Locale, Dict> = { ar, en };
interface I18n { locale: Locale; rtl: boolean; t: Dict; setLocale: (l: Locale) => void; name: (o: { name_ar: string; name_en: string }) => string; err: (e: unknown) => string; lookup: (group: keyof Dict, key: string | null | undefined) => string; time: (iso: string) => string }
const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ar'); // Arabic is the default language
  useEffect(() => { AsyncStorage.getItem('lamma.locale').then((v) => { if (v === 'en' || v === 'ar') setLocaleState(v); }).catch(() => {}); }, []);
  const value = useMemo<I18n>(() => {
    const t = dicts[locale];
    return {
      locale, rtl: locale === 'ar', t,
      setLocale: (l) => { setLocaleState(l); AsyncStorage.setItem('lamma.locale', l).catch(() => {}); },
      name: (o) => (locale === 'ar' ? o.name_ar : o.name_en),
      lookup: (group, key) => (key && (t[group] as Record<string, string>)[key]) || key || '',
      err: (e) => {
        if (e instanceof ApiError) return (t.errors as Record<string, string>)[e.code] ?? (/fetch|network/i.test(e.message) ? t.errors.network : t.errors.unknown_error);
        return /fetch|network/i.test(String((e as Error)?.message)) ? t.errors.network : t.errors.unknown_error;
      },
      // Western digits in both languages keep weights and money unambiguous in mixed-direction text
      time: (iso) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB', { timeZone: 'Asia/Amman', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)),
    };
  }, [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useI18n = () => { const v = useContext(Ctx); if (!v) throw new Error('I18nProvider missing'); return v; };
