import React from 'react';
import { Pressable, ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/typography';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: string;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const VARIANTS: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: colors.onPrimary },
  secondary: { bg: colors.successLight, fg: colors.successDark },
  outline: { bg: 'transparent', fg: colors.primary, border: colors.outlineVariant },
  ghost: { bg: 'transparent', fg: colors.primary },
  danger: { bg: colors.error, fg: colors.onError },
};

const SIZES: Record<Size, { height: number; px: number; radius: number; text: 'captionSm' | 'labelMd' | 'headlineSm'; icon: number }> = {
  // 10px label + 12px radius pill, as used by the "Join" affordance.
  sm: { height: 32, px: spacing.insetCard, radius: radius.md, text: 'captionSm', icon: 14 },
  md: { height: 44, px: spacing.insetPage, radius: radius.md, text: 'labelMd', icon: 18 },
  lg: { height: 52, px: spacing.lg, radius: radius.lg, text: 'headlineSm', icon: 20 },
};

export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
}) => {
  const v = VARIANTS[variant];
  const s = SIZES[size];
  const inactive = disabled || loading;

  const glyph = icon ? <Icon name={icon} size={s.icon} color={v.fg} /> : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.px,
          borderRadius: s.radius,
          backgroundColor: v.bg,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
        },
        fullWidth && styles.fullWidth,
        inactive && styles.inactive,
        pressed && !inactive && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} size="small" />
      ) : (
        <View style={styles.content}>
          {iconPosition === 'left' ? glyph : null}
          <Text variant={s.text} weight="semibold" color={v.fg}>
            {label}
          </Text>
          {iconPosition === 'right' ? glyph : null}
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.stackMedium },
  fullWidth: { width: '100%' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  inactive: { opacity: 0.5 },
});
