import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import {
  Alert,
  Button,
  Card,
  colors,
  EmptyState,
  errorMessage,
  Icon,
  placeMedicineOrder,
  radius,
  rupees,
  Screen,
  spacing,
  Text,
  TopBar,
} from '@healthbuddy/shared';
import { useCart } from '../../services/cart';
import { useLocation } from '../../services/location';

/**
 * Mirrors `medicine_cart`: line items with steppers, address, order summary.
 *
 * The total shown here is the line items and nothing else, because that is
 * exactly what the server bills: `placeMedicineOrder` sums item totals and adds
 * no delivery charge. A fee invented on the client would quote the patient one
 * number and take another at checkout — and since the gateway splits the amount
 * it actually captured, the difference would never reconcile.
 */
export const CartScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const cart = useCart();
  const { selected, serviceability } = useLocation();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = cart.subtotal;

  const checkout = async () => {
    if (!selected) {
      setError('Choose a delivery address first.');
      return;
    }
    if (serviceability?.serviceable === false) {
      setError(`We don't deliver to ${selected.pincode} yet.`);
      return;
    }

    setError(null);
    setPlacing(true);
    try {
      // The saved address is sent by id, not as text: the server re-reads the
      // pincode from it and sources only from shops that serve there, so the
      // basket cannot be checked out to somewhere its prices never applied.
      const order = await placeMedicineOrder({
        items: cart.lines.map((l) => ({ medicineId: l.medicine.id, quantity: l.quantity })),
        addressId: selected.id,
      });
      cart.clear();
      /**
       * Placing the order is not paying for it. The order is created holding
       * stock and waiting on money, so the patient goes straight to the payment
       * screen rather than to tracking — landing on a tracking page for
       * something nobody has paid for is how an order sits unpaid until it is
       * cancelled.
       */
      navigation.replace('Payment', {
        purpose: 'MEDICINE_ORDER',
        targetId: order.id,
        amount: total,
        nextScreen: 'OrderTracking',
        nextParams: { orderId: order.id },
        allowCod: true,
      });
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
          <Pressable
            onPress={() => navigation.navigate('AddressBook')}
            style={styles.addressRow}
          >
            <Icon name="location_on" size={20} color={colors.primary} />
            <View style={styles.flex}>
              <Text variant="captionSm" weight="semibold" color={colors.primary}>
                Deliver to
              </Text>
              <Text variant="captionSm" color={colors.headingDark} numberOfLines={1}>
                {selected
                  ? [selected.line1, selected.city, selected.pincode].filter(Boolean).join(', ')
                  : 'Choose an address'}
              </Text>
            </View>
            <Text variant="captionSm" weight="medium" color={colors.primary}>
              Change
            </Text>
          </Pressable>

          {/* Split into parcels here rather than at the confirmation screen —
              "arrives separately" changes what people order, so it belongs
              where they can still change their mind. */}
          {cart.parcels.length > 1 ? (
            <View style={styles.splitNote}>
              <Icon name="local_shipping" size={16} color={colors.warningDark} />
              <Text variant="captionSm" color={colors.warningDark} style={styles.flex}>
                This order will arrive in {cart.parcels.length} separate parcels, from{' '}
                {cart.parcels.length} pharmacies.
              </Text>
            </View>
          ) : null}

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
                  {rupees(line.medicine.price)} each
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
                    disabled={line.quantity >= (line.medicine.available ?? line.medicine.stock)}
                    style={[
                      styles.stepButton,
                      line.quantity >= (line.medicine.available ?? line.medicine.stock) &&
                        styles.stepDisabled,
                    ]}
                    accessibilityLabel="Increase quantity"
                  >
                    <Icon name="add" size={16} color={colors.primary} />
                  </Pressable>
                </View>
              </View>

              <View style={styles.lineRight}>
                <Text variant="bodyMd" weight="semibold" color={colors.primary}>
                  {rupees(line.medicine.price * line.quantity)}
                </Text>
                <Pressable onPress={() => cart.remove(line.medicine.id)} hitSlop={8}>
                  <Icon name="delete" size={18} color={colors.error} />
                </Pressable>
              </View>
            </Card>
          ))}

          {error ? (
            <Text variant="captionSm" color={colors.error}>
              {error}
            </Text>
          ) : null}

          <Card style={styles.summary}>
            <Text variant="headlineSmMobile" color={colors.headingDark}>
              Order Summary
            </Text>
            <SummaryRow label="Subtotal" value={rupees(cart.subtotal)} />
            <SummaryRow label="Delivery" value="Free" />
            <View style={styles.rule} />
            <SummaryRow label="Total" value={rupees(total)} emphasis />
          </Card>
        </View>
      </Screen>

      <View style={styles.footer}>
        <View style={styles.footerTotal}>
          <Text variant="captionSm" color={colors.captionGray}>
            Total
          </Text>
          <Text variant="displayBold" color={colors.headingDark}>
            {rupees(total)}
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
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    padding: spacing.insetCard,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
  },
  splitNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.base,
    padding: spacing.insetCard,
    borderRadius: radius.md,
    backgroundColor: colors.warningLight,
  },
  flex: { flex: 1 },
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
