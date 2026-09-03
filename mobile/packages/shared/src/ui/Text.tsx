import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';
import { typography, type TypographyToken } from '../theme/typography';
import { colors } from '../theme/colors';

export interface TextProps extends RNTextProps {
  /** A token from the design system's type scale. */
  variant?: TypographyToken;
  color?: string;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold';
  center?: boolean;
  uppercase?: boolean;
}

const WEIGHT_FAMILY = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
} as const;

/**
 * How far the user's text-size setting is allowed to carry a label.
 *
 * Both platforms scale text, but iOS's accessibility sizes reach far higher
 * than anything Android offers, and this design pins heights all over the place
 * — a 52pt field, a 44pt brand mark, a bottom nav built on a 10px caption. At
 * the top of the iOS range those labels are simply cut in half, which is worse
 * for the person who asked for large text than a smaller increase would be.
 *
 * 1.3 is the compromise: a real, visible increase for anyone who needs it, and
 * still inside what fixed-height chrome can hold. Anything that genuinely needs
 * to scale further can pass its own `maxFontSizeMultiplier`.
 */
const MAX_FONT_SCALE = 1.3;

/**
 * Text with the design system's scale applied. `weight` overrides the family
 * rather than setting `fontWeight`, because Android ignores numeric weights on
 * custom fonts and would silently fall back to regular.
 */
export const Text: React.FC<TextProps> = ({
  variant = 'bodyMd',
  color = colors.onSurface,
  weight,
  center,
  uppercase,
  style,
  children,
  ...rest
}) => (
  <RNText
    style={[
      typography[variant],
      { color },
      weight ? { fontFamily: WEIGHT_FAMILY[weight] } : null,
      center ? styles.center : null,
      uppercase ? styles.uppercase : null,
      style,
    ]}
    maxFontSizeMultiplier={MAX_FONT_SCALE}
    {...rest}
  >
    {children}
  </RNText>
);

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  uppercase: { textTransform: 'uppercase' },
});
