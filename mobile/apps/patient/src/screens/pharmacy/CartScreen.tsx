import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Screen,
  Text,
  TopBar,
  colors,
  errorMessage,
  placeMedicineOrder,
  radius,
  spacing,
} from '@healthbuddy/shared';
import { useCart } from '../../services/cart';

const DELIVERY_FEE = 2.5;

/** Mirrors `medicine_cart`: line items with steppers, address, order summary. */
export const CartScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const cart = useCart();
  const [address, setAddress] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = Number((cart.subtotal + (cart.lines.length ? DELIVERY_FEE : 0)).toFixed(2));

  const checkout = async () => {
    if (address.trim().length < 5) {
      setError('Enter a delivery address of at least 5 characters.');
      return;
    }

    setError(null);
    setPlacing(true);
    try {
      const order = await placeMedicineOrder({
        items: cart.lines.map((l) => ({ medicineId: l.medicine.id, quantity: l.quantity })),
        address: address.trim(),
      });
      cart.clear();
      navigation.replace('OrderTracking', { orderId: order.id });
    } catch (err) {
      Alert.alert('Order failed', errorMessage(err));
    } finally {
      setPlacing(false);
    }
  };

  if (cart.lines.length === 0) {
    return (
      <Screen scroll={false}>
        <TopBar title="Your Cart" onBack={navigation.goBack} />
        <EmptyState
          icon="shopping_cart"
          title="Your cart is empty"
          message="Browse the store and add medicines to get started."
          actionLabel="Browse medicines"
          onActionPress={() => navigation.navigate('Pharmacy')}
        />
      </Screen>
    );
  }

  return (
    <>
      <Screen padded={false} bottomInset={140}>
        <TopBar title="Your Cart" onBack={navigation.goBack} />

        <View style={styles.page}>
          {cart.lines.map((line) => (
            <Card key={line.medicine.id} padding={spacing.insetCard} style={styles.line}>
              <View style={styles.thumb}>
                <Icon name="pill" size={22} color={colors.primary} />
              </View>

              <View style={styles.lineBody}>
                <Text variant="bodyMd" weight="semibold" color={colors.headingDark} numberOfLines={1}>
                  {line.medicine.name}
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  ${line.medicine.price.toFixed(2)} each
                </Text>

                <View style={styles.stepper}>
                  <Pressable
                    onPress={() => cart.setQuantity(line.medicine.id, line.quantity - 1)}
                    style={styles.stepButton}
                    accessibilityLabel="Decrease quantity"
                  >
                    <Icon name="remove" size={16} color={colors.primary} />
                  </Pressable>

                  <Text variant="labelMd" weight="semibold" color={colors.headingDark}>
                    {line.quantity}
                  </Text>

                  <Pressable
                    onPress={() => cart.setQuantity(line.medicine.id, line.quantity + 1)}
                    disabled={line.quantity >= line.medicine.stock}
                    style={[
                      styles.stepButton,
                      line.quantity >= line.medicine.stock && styles.stepDisabled,
                    ]}
                    accessibilityLabel="Increase quantity"
                  >
                    <Icon name="add" size={16} color={colors.primary} />
                  </Pressable>
                </View>
              </View>

              <View style={styles.lineRight}>
                <Text variant="bodyMd" weight="semibold" color={colors.primary}>
                  ${(line.medicine.price * line.quantity).toFixed(2)}
                </Text>
                <Pressable onPress={() => cart.remove(line.medicine.id)} hitSlop={8}>
                  <Icon name="delete" size={18} color={colors.error} />
                </Pressable>
              </View>
            </Card>
          ))}

          <Input
            label="Delivery address"
            icon="location_on"
            placeholder="Flat, street, city"
            value={address}
            onChangeText={(t) => {
              setAddress(t);
              setError(null);
            }}
            error={error ?? undefined}
            maxLength={300}
          />

          <Card style={styles.summary}>
            <Text variant="headlineSmMobile" color={colors.headingDark}>
              Order Summary
            </Text>
            <SummaryRow label="Subtotal" value={`$${cart.subtotal.toFixed(2)}`} />
            <SummaryRow label="Delivery" value={`$${DELIVERY_FEE.toFixed(2)}`} />
            <View style={styles.rule} />
            <SummaryRow label="Total" value={`$${total.toFixed(2)}`} emphasis />
          </Card>
        </View>
      </Screen>

      <View style={styles.footer}>
        <View style={styles.footerTotal}>
          <Text variant="captionSm" color={colors.captionGray}>
            Total
          </Text>
          <Text variant="displayBold" color={colors.headingDark}>
            ${total.toFixed(2)}
          </Text>
        </View>
        <Button label="Place Order" onPress={checkout} loading={placing} style={styles.footerCta} />
      </View>
    </>
  );
};

const SummaryRow: React.FC<{ label: string; value: string; emphasis?: boolean }> = ({
  label,
  value,
  emphasis,
}) => (
  <View style={styles.summaryRow}>
    <Text
      variant={emphasis ? 'bodyMd' : 'bodyMd'}
      weight={emphasis ? 'semibold' : 'regular'}
      color={emphasis ? colors.headingDark : colors.onSurfaceVariant}
    >
      {label}
    </Text>
    <Text
      variant="bodyMd"
      weight="semibold"
      color={emphasis ? colors.primary : colors.headingDark}
    >
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.insetPage },
  line: { flexDirection: 'row', gap: spacing.insetCard, alignItems: 'flex-start' },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineBody: { flex: 1, gap: spacing.stackTight },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard, marginTop: spacing.base },
  stepButton: {
    width: 28,
    height: 28,
    borderRadius: radius.base,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDisabled: { opacity: 0.4 },
  lineRight: { alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.lg },
  summary: { gap: spacing.insetCard },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rule: { height: 1, backgroundColor: colors.outlineVariant },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetPage,
    padding: spacing.insetPage,
    paddingBottom: spacing.xl,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  footerTotal: { gap: 0 },
  footerCta: { flex: 1 },
});
