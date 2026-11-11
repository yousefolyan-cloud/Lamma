// Design tokens — لمّة.
// Palette source: the Canva brand board "لمّة Arabic app brand board" (fresh green, deep leaf green, mint tint, white, amber).
// Typeface: Cairo, from Adobe Fonts' recommendation for Arabic interface text (open licence, bundled with the app).
// EXPO_PUBLIC_THEME switches between candidate directions while the owner chooses; 'fresh' is the default.
const palettes = {
  // A — Canva board: fresh green on white with mint surfaces and an amber accent
  fresh: {
    bg: '#F6FBF8', surface: '#FFFFFF', surfaceAlt: '#E8F6EF', border: '#DCEBE3',
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
export const radius = { sm: 10, md: 18, lg: 26, pill: 999 } as const;
const fonts = {
  cairo: { regular: 'Cairo_400Regular', medium: 'Cairo_600SemiBold', bold: 'Cairo_700Bold', black: 'Cairo_800ExtraBold' },
  tajawal: { regular: 'Tajawal_400Regular', medium: 'Tajawal_500Medium', bold: 'Tajawal_700Bold', black: 'Tajawal_800ExtraBold' },
  almarai: { regular: 'Almarai_400Regular', medium: 'Almarai_700Bold', bold: 'Almarai_700Bold', black: 'Almarai_800ExtraBold' },
  readex: { regular: 'ReadexPro_400Regular', medium: 'ReadexPro_500Medium', bold: 'ReadexPro_600SemiBold', black: 'ReadexPro_700Bold' },
} as const;
export type FontName = keyof typeof fonts;
const chosenFont = (process.env.EXPO_PUBLIC_FONT ?? 'cairo') as FontName;
export const fontName: FontName = chosenFont in fonts ? chosenFont : 'cairo';
export const font = fonts[fontName];
export const type = {
  title: { fontFamily: font.black, fontSize: 26, lineHeight: 40 },
  heading: { fontFamily: font.bold, fontSize: 18, lineHeight: 30 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 28 },
  label: { fontFamily: font.medium, fontSize: 14, lineHeight: 24 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 22 },
  number: { fontFamily: font.black, fontSize: 22, lineHeight: 34 },
} as const;
export const touch = { min: 50, driver: 60 } as const;
export const shadow = { card: { shadowColor: '#12261C', shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 } } as const;
