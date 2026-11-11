// Design tokens — لمّة.
// Palette source: the Canva brand board "لمّة Arabic app brand board" (fresh green, deep leaf green, mint tint, white, amber).
// Typeface: Almarai (open licence). Layout follows a food-delivery-app feel at the owner's request (2026-11-11): icon tab bar, solid green header, borderless shadowed cards, rounded-rect buttons.
// EXPO_PUBLIC_THEME switches between candidate directions while the owner chooses; 'fresh' is the default.
const palettes = {
  // A — Canva board: fresh green on white with mint surfaces and an amber accent
  fresh: {
    bg: '#F3F5F4', surface: '#FFFFFF', surfaceAlt: '#E8F6EF', border: '#E7ECEA',
    primary: '#198751', primaryDark: '#116B3F', primaryBright: '#2DB36E', primarySoft: '#E8F6EF', onPrimary: '#FFFFFF',
    accent: '#F2A225', accentSoft: '#FEF3DC',
    text: '#12261C', textMuted: '#55665D', textFaint: '#8C9A93',
  },
  // B — night blue with the logo green as the accent
  navy: {
    bg: '#F4F7FB', surface: '#FFFFFF', surfaceAlt: '#E9EEF6', border: '#DCE3EE',
    primary: '#17355E', primaryDark: '#0F2543', primaryBright: '#2DB36E', primarySoft: '#E4ECF7', onPrimary: '#FFFFFF',
    accent: '#2DB36E', accentSoft: '#E8F6EF',
    text: '#111C2B', textMuted: '#56637A', textFaint: '#8B96A8',
  },
  // C — logo lime with charcoal: black-and-white calm, the logo's lime green as the single colour
  lime: {
    bg: '#FAFBF8', surface: '#FFFFFF', surfaceAlt: '#F0F6E6', border: '#E3E8DA',
    primary: '#1E2A22', primaryDark: '#111913', primaryBright: '#7DC242', primarySoft: '#EEF6E2', onPrimary: '#FFFFFF',
    accent: '#7DC242', accentSoft: '#EEF6E2',
    text: '#171D19', textMuted: '#5A635C', textFaint: '#8F978F',
  },
} as const;
export type ThemeName = keyof typeof palettes;
const chosen = (process.env.EXPO_PUBLIC_THEME ?? 'fresh') as ThemeName;
export const themeName: ThemeName = chosen in palettes ? chosen : 'fresh';

export const color = {
  ...palettes[themeName],
  success: '#198751', successSoft: '#E1F4EA', warning: '#9A5B00', warningSoft: '#FEF3DC',
  danger: '#C0362C', dangerSoft: '#FBE4E1', info: '#1F5F99', infoSoft: '#E2EEF9',
} as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const font = { regular: 'Almarai_400Regular', medium: 'Almarai_700Bold', bold: 'Almarai_700Bold', black: 'Almarai_800ExtraBold' } as const;
export const type = {
  title: { fontFamily: font.black, fontSize: 24, lineHeight: 34 },
  heading: { fontFamily: font.bold, fontSize: 17, lineHeight: 26 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 24 },
  label: { fontFamily: font.medium, fontSize: 14, lineHeight: 22 },
  small: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 20 },
  number: { fontFamily: font.black, fontSize: 22, lineHeight: 30 },
} as const;
export const touch = { min: 50, driver: 60 } as const;
export const shadow = { card: { shadowColor: '#0B1F14', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 }, bar: { shadowColor: '#0B1F14', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: -3 }, elevation: 8 } } as const;
