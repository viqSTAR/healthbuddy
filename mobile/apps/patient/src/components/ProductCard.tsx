import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Card, Icon, Text, colors, radius, rupees, spacing } from '@healthbuddy/shared';

export interface ProductCardProps {
  title: string;
  subtitle?: string;
  price: number;
  /** When higher than `price`, renders struck through beside the sale price. */
  originalPrice?: number;
  badge?: { label: string; tone: 'sale' | 'new' };
  outOfStock?: boolean;
  /** How soon this can arrive, e.g. "Under 30 min". */
  eta?: string;
  /** Draws the ETA as a fast-delivery flash rather than plain text. */
  express?: boolean;
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
  eta,
  express = false,
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

    {/* The arrival time sits above the name, not beside the price: it is what
        people scan for when they need something today, and reading it after
        deciding on price means re-deciding. */}
    {eta && !outOfStock ? (
      <View style={[styles.eta, express && styles.etaExpress]}>
        <Icon
          name={express ? 'bolt' : 'local_shipping'}
          size={12}
          color={express ? colors.successDark : colors.captionGray}
        />
        <Text
          variant="captionSm"
          weight={express ? 'semibold' : 'regular'}
          color={express ? colors.successDark : colors.captionGray}
        >
          {eta}
        </Text>
      </View>
    ) : null}

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
          {rupees(price)}
        </Text>
        {originalPrice && originalPrice > price ? (
          <Text variant="captionSm" color={colors.captionGray} style={styles.strike}>
            {rupees(originalPrice)}
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
  eta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    paddingHorizontal: spacing.stackMedium,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceContainerHigh,
  },
  etaExpress: { backgroundColor: colors.successLight },
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
