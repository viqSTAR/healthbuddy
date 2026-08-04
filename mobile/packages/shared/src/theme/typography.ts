import { Platform, type TextStyle } from 'react-native';
import { colors } from './colors';

/**
 * Inter is loaded at startup (see `useAppFonts`). Weights map to the concrete
 * family names because React Native on Android ignores `fontWeight` for custom
 * fonts and silently renders regular instead.
 */
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
} as const;

export type FontWeightName = keyof typeof fontFamily;

/**
 * The type scale from `health_buddy/DESIGN.md`. The 10px caption is load
 * bearing in this system — it carries ratings, categories and nav labels.
 */
export const typography = {
  displayBold: {
    fontFamily: fontFamily.semibold,
    fontSize: 20,
    lineHeight: 24,
  },
  headlineSm: {
    fontFamily: fontFamily.semibold,
    fontSize: 16,
    lineHeight: 22,
  },
  headlineSmMobile: {
    fontFamily: fontFamily.semibold,
    fontSize: 16,
    lineHeight: 20,
  },
  bodyMd: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  labelMd: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  captionSm: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.1,
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;

/** Radii from the `rounded` block, plus the card/pill sizes the components use. */
export const radius = {
  sm: 4,
  base: 8,
  md: 12,
  lg: 16,
  xl: 24,
  card: 20,
  cardSm: 18,
  icon: 14,
  input: 16,
  full: 9999,
} as const;

/** Named spacing from the `spacing` block. */
export const spacing = {
  stackTight: 2,
  inlineSm: 4,
  stackMedium: 6,
  base: 8,
  insetCard: 12,
  insetPage: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

/**
 * The system uses tonal layering rather than shadows. This is the single
 * permitted lift, reserved for floating surfaces (bottom nav, sheets).
 */
export const elevation = Platform.select({
  ios: {
    shadowColor: '#0B3D2C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
  },
  android: { elevation: 2 },
  default: {},
}) as TextStyle;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;

export { colors };
