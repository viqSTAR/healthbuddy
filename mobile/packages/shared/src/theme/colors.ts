/**
 * Colour tokens transcribed verbatim from the Stitch design system
 * (`health_buddy/DESIGN.md`). Do not hand-tune these values — the screens are
 * matched against the reference renders and depend on exact hexes.
 *
 * Note `surface` is the mint page background (#e7fff2); pure white is
 * `surfaceContainerLowest` and is what cards use.
 */
export const colors = {
  // Surfaces
  surface: '#e7fff2',
  surfaceDim: '#c5e0d3',
  surfaceBright: '#e7fff2',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#defaec',
  surfaceContainer: '#d9f4e6',
  surfaceContainerHigh: '#d3eee1',
  surfaceContainerHighest: '#cde9db',
  surfaceVariant: '#cde9db',
  surfaceTint: '#006c4b',

  background: '#e7fff2',
  onBackground: '#072018',
  onSurface: '#072018',
  onSurfaceVariant: '#3d4943',
  inverseSurface: '#1d352c',
  inverseOnSurface: '#dcf7e9',

  // Outlines
  outline: '#6d7a72',
  outlineVariant: '#bdcac0',

  // Primary (emerald)
  primary: '#006949',
  onPrimary: '#ffffff',
  primaryContainer: '#00855d',
  onPrimaryContainer: '#f5fff7',
  inversePrimary: '#6bdbab',
  primaryFixed: '#88f8c5',
  primaryFixedDim: '#6bdbab',
  onPrimaryFixed: '#002114',
  onPrimaryFixedVariant: '#005138',

  // Secondary (blue)
  secondary: '#005ab6',
  onSecondary: '#ffffff',
  secondaryContainer: '#0472e3',
  onSecondaryContainer: '#fefcff',
  secondaryFixed: '#d7e3ff',
  secondaryFixedDim: '#abc7ff',
  onSecondaryFixed: '#001b3f',
  onSecondaryFixedVariant: '#00458f',

  // Tertiary (warm neutral)
  tertiary: '#635b48',
  onTertiary: '#ffffff',
  tertiaryContainer: '#7c745f',
  onTertiaryContainer: '#fffbff',
  tertiaryFixed: '#ede1c8',
  tertiaryFixedDim: '#d0c6ad',
  onTertiaryFixed: '#201b0c',
  onTertiaryFixedVariant: '#4d4634',

  // Error / danger
  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  // Functional pastels
  successDark: '#087A55',
  successLight: '#DDF6E9',
  infoLight: '#EAF4FF',
  dangerLight: '#FCE8E7',

  // Text
  headingDark: '#10231B',
  captionGray: '#6F8278',

  /**
   * Amber pair used inline throughout the reference markup (lab tests,
   * dermatology, warning chips) but not named in the token block.
   */
  warningLight: '#FFF3D9',
  warningDark: '#8B6E2F',
} as const;

export type ColorToken = keyof typeof colors;

/** Category tints, paired exactly as they appear across the reference screens. */
export const tints = {
  success: { bg: colors.successLight, fg: colors.successDark },
  info: { bg: colors.infoLight, fg: colors.secondary },
  warning: { bg: colors.warningLight, fg: colors.warningDark },
  danger: { bg: colors.dangerLight, fg: colors.error },
  neutral: { bg: colors.surfaceContainerHigh, fg: colors.onSurfaceVariant },
} as const;

export type TintName = keyof typeof tints;
