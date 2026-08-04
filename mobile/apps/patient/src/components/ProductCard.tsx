import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Card, Icon, Text, colors, radius, spacing } from '@healthbuddy/shared';

export interface ProductCardProps {
  title: string;
  subtitle?: string;
  price: number;
  /** When higher than `price`, renders struck through beside the sale price. */
  originalPrice?: number;
  badge?: { label: string; tone: 'sale' | 'new' };
  outOfStock?: boolean;
  onPress?: () => void;
  onAdd?: () => void;
}

/**
 * Grid tile for the medicine store: image placeholder, optional corner badge,
 * name, pack size, price and a circular add button.
 */
export const ProductCard: React.FC<ProductCardProps> = ({
  title,
  subtitle,
  price,
  originalPrice,
  badge,
  outOfStock = false,
  onPress,
  onAdd,
}) => (
  <Card size="cardSm" padding={spacing.insetCard} onPress={onPress} style={styles.card}>
    <View style={styles.imageBox}>
      <Icon name="image" size={26} color={colors.secondaryFixedDim} />
      {badge ? (
        <View
          style={[
            styles.badge,
            { backgroundColor: badge.tone === 'sale' ? colors.error : colors.primary },
          ]}
        >
          <Text variant="captionSm" weight="bold" color={colors.onPrimary} uppercase>
            {badge.label}
          </Text>
        </View>
      ) : null}
    </View>

    <Text variant="bodyMd" weight="semibold" color={colors.headingDark} numberOfLines={1}>
      {title}
    </Text>
    {subtitle ? (
      <Text variant="captionSm" color={colors.captionGray} numberOfLines={1}>
        {subtitle}
      </Text>
    ) : null}

    <View style={styles.footer}>
      <View style={styles.priceBlock}>
        <Text variant="bodyMd" weight="semibold" color={colors.primary}>
          ${price.toFixed(2)}
        </Text>
        {originalPrice && originalPrice > price ? (
          <Text variant="captionSm" color={colors.captionGray} style={styles.strike}>
            ${originalPrice.toFixed(2)}
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={onAdd}
        disabled={outOfStock}
        accessibilityLabel={`Add ${title} to cart`}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.addButton,
          outOfStock && styles.addDisabled,
          pressed && !outOfStock && styles.pressed,
        ]}
      >
        <Icon name="add" size={20} color={colors.onPrimary} />
      </Pressable>
    </View>

    {outOfStock ? (
      <Text variant="captionSm" weight="medium" color={colors.error}>
        Out of stock
      </Text>
    ) : null}
  </Card>
);

const styles = StyleSheet.create({
  card: { flex: 1, gap: spacing.stackMedium },
  imageBox: {
    height: 120,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.inlineSm,
  },
  badge: {
    position: 'absolute',
    top: spacing.base,
    left: spacing.base,
    paddingHorizontal: spacing.base,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 'auto',
  },
  priceBlock: { gap: 0 },
  strike: { textDecorationLine: 'line-through' },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addDisabled: { backgroundColor: colors.outlineVariant },
  pressed: { opacity: 0.85, transform: [{ scale: 0.94 }] },
});
