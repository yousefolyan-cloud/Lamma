import React from 'react';
import { I18nManager, View } from 'react-native';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, IBMPlexSansArabic_400Regular, IBMPlexSansArabic_500Medium, IBMPlexSansArabic_700Bold } from '@expo-google-fonts/ibm-plex-sans-arabic';
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
  const [loaded] = useFonts({ IBMPlexSansArabic_400Regular, IBMPlexSansArabic_500Medium, IBMPlexSansArabic_700Bold });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: color.primary }} />;
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <StatusBar style="light" />
          <Direction><Slot /></Direction>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
