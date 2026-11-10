// Design tokens — لمّة: deep green, warm light surfaces, one clear accent for action.
export const color = {
  bg: '#F7F3EA', surface: '#FFFFFF', surfaceAlt: '#EFE9DC', border: '#E2DACA',
  primary: '#0F4D3A', primaryDark: '#0A3628', primarySoft: '#DDEBE4', onPrimary: '#FFFFFF',
  accent: '#E08A1E', accentSoft: '#FBEBD3',
  text: '#16231D', textMuted: '#5E6B64', textFaint: '#8A948E',
  success: '#1F7A4D', successSoft: '#DCF0E4', warning: '#A9650B', warningSoft: '#FBEBD3',
  danger: '#B3261E', dangerSoft: '#F9DEDC', info: '#1D5C8A', infoSoft: '#DCEAF5',
} as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;
export const font = { regular: 'IBMPlexSansArabic_400Regular', medium: 'IBMPlexSansArabic_500Medium', bold: 'IBMPlexSansArabic_700Bold' } as const;
export const type = {
  title: { fontFamily: font.bold, fontSize: 24, lineHeight: 36 },
  heading: { fontFamily: font.bold, fontSize: 18, lineHeight: 28 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 26 },
  label: { fontFamily: font.medium, fontSize: 14, lineHeight: 22 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 20 },
  number: { fontFamily: font.bold, fontSize: 20, lineHeight: 30 },
} as const;
export const touch = { min: 48, driver: 60 } as const;
export const shadow = { card: { shadowColor: '#0A3628', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 } } as const;
