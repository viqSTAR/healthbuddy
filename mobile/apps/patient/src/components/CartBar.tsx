import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Icon, Text, colors, radius, rupees, spacing, elevation } from '@healthbuddy/shared';
import { useCart } from '../services/cart';

/**
 * The strip that sits above the tab bar once anything is in the basket.
 *
 * A toast confirms the add and disappears; this is what remains. Without it the
 * only evidence of a growing basket is a small tab badge, and people add three
 * things and then hunt for where they went. It renders nothing on an empty
 * cart, so it costs no space until it has something to say.
 */
export const CartBar: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const cart = useCart();
  if (cart.count === 0) return null;

  const parcels = new Set(
    cart.lines.map((l) => l.medicine.soldBy?.id).filter((id): id is string => Boolean(id))
  ).size;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`View cart, ${cart.count} ${cart.count === 1 ? 'item' : 'items'}`}
      >
        <View style={styles.left}>
          <View style={styles.badge}>
            <Text variant="captionSm" weight="bold" color={colors.primary}>
              {cart.count}
            </Text>
          </View>
          <View>
            <Text variant="labelMd" weight="semibold" color={colors.surfaceContainerLowest}>
              {cart.count} {cart.count === 1 ? 'item' : 'items'}
            </Text>
            <Text variant="captionSm" color={colors.primaryFixed}>
              {/* Said here rather than at checkout: two parcels is a thing to
                  know while still shopping, not a surprise on the last screen. */}
              {parcels > 1 ? `${rupees(cart.subtotal)} · ${parcels} parcels` : rupees(cart.subtotal)}
            </Text>
          </View>
        </View>

        <View style={styles.right}>
          <Text variant="labelMd" weight="semibold" color={colors.surfaceContainerLowest}>
            View cart
          </Text>
          <Icon name="arrow_forward" size={18} color={colors.surfaceContainerLowest} />
        </View>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.insetPage,
    right: spacing.insetPage,
    bottom: spacing.insetCard,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.insetCard,
    paddingHorizontal: spacing.insetCard + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    ...elevation,
  },
  pressed: { backgroundColor: colors.primaryContainer },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  badge: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: spacing.stackMedium,
    borderRadius: radius.base,
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.inlineSm },
});
