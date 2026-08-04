import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, colors, radius, spacing } from '@healthbuddy/shared';

export interface PromoBannerProps {
  eyebrow: string;
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
}

/** Emerald promo block — "Health Buddy Plus / 20% Off on your first order". */
export const PromoBanner: React.FC<PromoBannerProps> = ({
  eyebrow,
  title,
  actionLabel,
  onActionPress,
}) => (
  <View style={styles.banner}>
    <Text variant="labelMd" weight="medium" color={colors.onPrimaryContainer}>
      {eyebrow}
    </Text>
    <Text variant="displayBold" color={colors.onPrimary} style={styles.title}>
      {title}
    </Text>

    {actionLabel ? (
      <Pressable
        onPress={onActionPress}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Text variant="bodyMd" weight="semibold" color={colors.primary}>
          {actionLabel}
        </Text>
      </Pressable>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.primary,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.stackMedium,
  },
  title: { fontSize: 22, lineHeight: 28 },
  action: {
    alignSelf: 'flex-start',
    marginTop: spacing.base,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base + 2,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.full,
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
});
