import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { colors, tints, type TintName } from '../theme/colors';
import { radius, spacing } from '../theme/typography';

export interface QuickActionProps {
  icon: string;
  label: string;
  tint?: TintName;
  onPress?: () => void;
}

/**
 * Vertical stack: a 42x42 tinted icon container at 14px radius under a 10px
 * medium label — the "Quick Actions" component from the design spec.
 */
export const QuickAction: React.FC<QuickActionProps> = ({
  icon,
  label,
  tint = 'success',
  onPress,
}) => {
  const { bg, fg } = tints[tint];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.iconBox, { backgroundColor: bg }]}>
        <Icon name={icon} size={22} color={fg} />
      </View>
      <Text variant="captionSm" weight="medium" color={colors.onSurfaceVariant} center>
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', gap: spacing.base },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: radius.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
