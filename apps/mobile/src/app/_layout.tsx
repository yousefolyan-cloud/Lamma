import React from 'react';
import { I18nManager, View } from 'react-native';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold, Cairo_800ExtraBold } from '@expo-google-fonts/cairo';
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
  const [loaded] = useFonts({ Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold, Cairo_800ExtraBold });
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
