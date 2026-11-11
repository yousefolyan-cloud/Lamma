import React from 'react';
import { I18nManager, View } from 'react-native';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold, Cairo_800ExtraBold } from '@expo-google-fonts/cairo';
import { Tajawal_400Regular, Tajawal_500Medium, Tajawal_700Bold, Tajawal_800ExtraBold } from '@expo-google-fonts/tajawal';
import { Almarai_400Regular, Almarai_700Bold, Almarai_800ExtraBold } from '@expo-google-fonts/almarai';
import { ReadexPro_400Regular, ReadexPro_500Medium, ReadexPro_600SemiBold, ReadexPro_700Bold } from '@expo-google-fonts/readex-pro';
import { I18nProvider, useI18n } from '@/i18n';
import { SessionProvider } from '@/lib/session';
import { color } from '@/theme';

I18nManager.allowRTL(true);

function Direction({ children }: { children: React.ReactNode }) {
  const { rtl } = useI18n();
  // layout direction follows the chosen language without restarting the app
  return <View style={{ flex: 1, direction: rtl ? 'rtl' : 'ltr', backgroundColor: color.bg }}>{children}</View>;
}

export default function RootLayout() {
  const [loaded] = useFonts({ Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold, Cairo_800ExtraBold, Tajawal_400Regular, Tajawal_500Medium, Tajawal_700Bold, Tajawal_800ExtraBold, Almarai_400Regular, Almarai_700Bold, Almarai_800ExtraBold, ReadexPro_400Regular, ReadexPro_500Medium, ReadexPro_600SemiBold, ReadexPro_700Bold });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: color.surface }} />;
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <StatusBar style="dark" />
          <Direction><Slot /></Direction>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
