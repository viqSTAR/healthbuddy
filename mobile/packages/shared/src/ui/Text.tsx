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
    {...rest}
  >
    {children}
  </RNText>
);

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  uppercase: { textTransform: 'uppercase' },
});
