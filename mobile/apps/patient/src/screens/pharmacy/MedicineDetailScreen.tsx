import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Icon,
  Screen,
  Text,
  TopBar,
  colors,
  radius,
  rupees,
  spacing,
  type Medicine,
} from '@healthbuddy/shared';
import { useCart } from '../../services/cart';
import { useToast } from '../../components/Toast';

/**
 * What a patient needs to know before putting a drug in a basket.
 *
 * The store grid can only show a name and a price, which is enough to browse
 * and not enough to buy. Two things in particular were only discoverable at
 * checkout, which is the worst place to find them: that a drug needs a
 * prescription, and what is actually in it.
 *
 * Composition leads for that second reason. It is how someone recognises that
 * the Crocin in their cupboard and the Paracetamol 500mg on this screen are the
 * same molecule — so they do not take both — and how they spot something they
 * react to. A brand name tells them none of that.
 *
 * Deliberately absent: side effects, interactions and dosage guidance. None of
 * it is in the catalogue, and writing it here would mean inventing clinical
 * advice. That belongs to a licensed drug database, or to the doctor whose
 * prescription brought them here.
 */
export const MedicineDetailScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const medicine = (route.params?.medicine ?? null) as Medicine | null;
  const cart = useCart();
  const toast = useToast();
  const [quantity, setQuantity] = useState(1);

  if (!medicine) {
    return (
      <Screen scroll={false}>
        <TopBar title="Medicine" onBack={navigation.goBack} />
        <Text variant="bodyMd" color={colors.captionGray} style={styles.pad}>
          This medicine is no longer listed.
        </Text>
      </Screen>
    );
  }

  /**
   * `available` is what this shop can actually sell right now, and only exists
   * on a pincode-scoped listing; `stock` is the catalogue figure. Preferring
   * the former means the cap here matches the cap the order will be checked
   * against.
   */
  const sellable = medicine.available ?? medicine.stock;
  const outOfStock = sellable <= 0;
  const savings = medicine.mrp && medicine.mrp > medicine.price ? medicine.mrp - medicine.price : 0;

  const add = () => {
    cart.add(medicine, quantity);
    toast.show(`${medicine.name} added to cart`);
    navigation.goBack();
  };

  return (
    <Screen bottomInset={spacing.xxl}>
      <TopBar title="Medicine" onBack={navigation.goBack} />

      <View style={styles.hero}>
        <View style={styles.thumb}>
          <Icon name="pill" size={40} color={colors.primary} />
        </View>
        <Text variant="displayBold" color={colors.headingDark}>
          {medicine.name}
        </Text>
        <Text variant="captionSm" color={colors.captionGray}>
          {medicine.category}
        </Text>
      </View>

      {/*
        The prescription rule, said before the basket rather than at checkout.
        Finding out a drug cannot be bought after choosing a payment method
        wastes the trip and reads as a broken shop.
      */}
      {medicine.requiresPrescription ? (
        <Card style={[styles.notice, { backgroundColor: colors.warningLight }]}>
          <Icon name="assignment" size={18} color={colors.warningDark} />
          <Text variant="captionSm" color={colors.warningDark} style={styles.flex}>
            Prescription required. A pharmacist will check a valid prescription before dispensing
            this.
          </Text>
        </Card>
      ) : null}

      <View style={styles.priceRow}>
        <Text variant="displayBold" color={colors.primary}>
          {rupees(medicine.price)}
        </Text>
        {savings > 0 ? (
          <>
            <Text variant="captionSm" color={colors.captionGray} style={styles.struck}>
              {rupees(medicine.mrp!)}
            </Text>
            <Badge label={`Save ${rupees(savings)}`} tint="success" />
          </>
        ) : null}
      </View>

      {medicine.soldBy ? (
        <Text variant="captionSm" color={colors.captionGray}>
          Sold by {medicine.soldBy.name}
          {medicine.deliverySpeed === 'EXPRESS' ? ' · express delivery' : ''}
        </Text>
      ) : null}

      {/* Composition first: it is the only field that prevents doubling up. */}
      {medicine.composition ? (
        <Card style={styles.block}>
          <Text variant="captionSm" color={colors.captionGray}>
            Composition
          </Text>
          <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
            {medicine.composition}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            Check this against anything else you are taking — the same molecule is often sold under
            several brand names.
          </Text>
        </Card>
      ) : null}

      {medicine.description ? (
        <Card style={styles.block}>
          <Text variant="captionSm" color={colors.captionGray}>
            About
          </Text>
          <Text variant="bodyMd" color={colors.onSurface}>
            {medicine.description}
          </Text>
        </Card>
      ) : null}

      <View style={styles.badges}>
        <Badge
          label={outOfStock ? 'Out of stock' : `${sellable} in stock`}
          tint={outOfStock ? 'neutral' : 'success'}
          icon={outOfStock ? 'block' : 'check_circle'}
        />
        <Badge label={medicine.schedule.replace('_', ' ')} tint="info" icon="category" />
      </View>

      {!outOfStock ? (
        <>
          <View style={styles.stepper}>
            <Text variant="bodyMd" color={colors.headingDark} style={styles.flex}>
              Quantity
            </Text>
            <Button
              label="−"
              variant="outline"
              size="sm"
              onPress={() => setQuantity((q) => Math.max(1, q - 1))}
            />
            <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
              {quantity}
            </Text>
            <Button
              label="+"
              variant="outline"
              size="sm"
              onPress={() => setQuantity((q) => Math.min(sellable, q + 1))}
            />
          </View>

          <Button
            label={`Add to cart · ${rupees(medicine.price * quantity)}`}
            icon="shopping_cart"
            onPress={add}
          />
        </>
      ) : (
        <Button label="Out of stock" variant="outline" onPress={() => navigation.goBack()} />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  pad: { padding: spacing.insetPage },
  hero: { alignItems: 'center', gap: spacing.base, paddingVertical: spacing.lg },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    marginTop: spacing.insetCard,
  },
  struck: { textDecorationLine: 'line-through' },
  block: { gap: 4, marginTop: spacing.insetCard },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.base,
    marginVertical: spacing.insetCard,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    marginBottom: spacing.insetCard,
  },
  flex: { flex: 1 },
});
