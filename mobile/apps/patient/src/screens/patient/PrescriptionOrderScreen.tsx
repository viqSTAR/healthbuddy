import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Alert, Pressable } from 'react-native';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Icon,
  Input,
  Loading,
  Screen,
  SectionHeader,
  Text,
  TopBar,
  colors,
  consentToFulfilment,
  declineFulfilment,
  errorMessage,
  fetchFulfilment,
  fetchMyProfile,
  radius,
  spacing,
  simulatePayment,
  useAsync,
  type Checkout,
  type LabQuoteLine,
  type MedicineQuoteLine,
  type PaymentMethod,
} from '@healthbuddy/shared';

const hoursLeft = (iso: string): number =>
  Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3600_000));

/**
 * Payment choices, in the order a quick-commerce checkout shows them.
 *
 * COD is last and labelled with what it means, because it is the one option
 * where the patient still owes money after the order is confirmed.
 */
const PAYMENT_METHODS: { value: PaymentMethod; label: string; hint: string; icon: string }[] = [
  { value: 'UPI', label: 'UPI', hint: 'GPay, PhonePe, Paytm', icon: 'account_balance' },
  { value: 'CARD', label: 'Card', hint: 'Credit or debit', icon: 'credit_card' },
  { value: 'NETBANKING', label: 'Net banking', hint: 'All major banks', icon: 'account_balance' },
  { value: 'COD', label: 'Cash on delivery', hint: 'Pay the rider at your door', icon: 'payments' },
];

/**
 * The consent screen.
 *
 * A prescription is clinical advice; buying what it names is a separate
 * decision. So this screen shows a fully priced basket, lets the patient drop
 * anything they already have, and orders nothing until they tap approve.
 *
 * Items that could not be priced — out of stock, or not in the catalogue — are
 * shown greyed with the reason rather than quietly omitted, so the patient
 * knows the prescription had more on it than the basket does.
 */
export const PrescriptionOrderScreen: React.FC<{ route: any; navigation: any }> = ({
  route,
  navigation,
}) => {
  const { fulfilmentId } = route.params as { fulfilmentId: string };

  const fulfilment = useAsync(() => fetchFulfilment(fulfilmentId), [fulfilmentId]);
  const profile = useAsync(fetchMyProfile, []);

  const [excludedMedicines, setExcludedMedicines] = useState<Set<string>>(new Set());
  const [excludedTests, setExcludedTests] = useState<Set<string>>(new Set());
  const [address, setAddress] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('UPI');
  const [busy, setBusy] = useState(false);

  // Prefill from the saved profile address, but let it be edited per order.
  useEffect(() => {
    if (profile.data?.address && !address) setAddress(profile.data.address);
  }, [profile.data, address]);

  const data = fulfilment.data;

  const orderableMedicines = useMemo(
    () => (data?.medicines ?? []).filter((m) => !m.unavailableReason),
    [data]
  );
  const orderableTests = useMemo(
    () => (data?.labTests ?? []).filter((t) => !t.unavailableReason && t.labPackageId),
    [data]
  );

  const totals = useMemo(() => {
    const medicines = orderableMedicines
      .filter((m) => !excludedMedicines.has(m.medicineId))
      .reduce((sum, m) => sum + m.itemTotal, 0);
    const tests = orderableTests
      .filter((t) => !excludedTests.has(t.labPackageId!))
      .reduce((sum, t) => sum + (t.price ?? 0) + t.homeCollectionFee, 0);
    // Mirrors the server's rule so the figure shown matches what is charged.
    const delivery = medicines > 0 && medicines < 500 ? 40 : 0;
    return { medicines, tests, delivery, grand: medicines + tests + delivery };
  }, [orderableMedicines, orderableTests, excludedMedicines, excludedTests]);

  const toggleMedicine = (id: string) =>
    setExcludedMedicines((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleTest = (id: string) =>
    setExcludedTests((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const approve = async () => {
    if (address.trim().length < 5) {
      Alert.alert('Address needed', 'Enter where this should be delivered.');
      return;
    }

    const acceptMedicineIds = orderableMedicines
      .filter((m) => !excludedMedicines.has(m.medicineId))
      .map((m) => m.medicineId);
    const acceptLabPackageIds = orderableTests
      .filter((t) => !excludedTests.has(t.labPackageId!))
      .map((t) => t.labPackageId!);

    if (acceptMedicineIds.length === 0 && acceptLabPackageIds.length === 0) {
      Alert.alert('Nothing selected', 'Choose at least one item to order.');
      return;
    }

    setBusy(true);
    try {
      const result = await consentToFulfilment(fulfilmentId, {
        acceptMedicineIds,
        acceptLabPackageIds,
        deliveryAddress: address.trim(),
        // Sent when the profile has them, so a rider has coordinates as well
        // as a written address.
        ...(profile.data?.latitude != null ? { latitude: profile.data.latitude } : {}),
        ...(profile.data?.longitude != null ? { longitude: profile.data.longitude } : {}),
        paymentMethod: method,
      });

      await settle(result.checkout, result.message);
    } catch (err) {
      Alert.alert('Could not place the order', errorMessage(err));
      fulfilment.reload();
    } finally {
      setBusy(false);
    }
  };

  const goToOrders = () => navigation.replace('Tabs', { screen: 'Orders' });

  /**
   * Takes the checkout the server opened and finishes it.
   *
   * Cash on delivery is already done — the order is confirmed and the money
   * arrives at the door. A prepaid order still has to be paid, and until it is,
   * no pharmacy sees it, so leaving the patient on this screen with an
   * unexplained "placed" would be a lie.
   */
  const settle = async (checkout: Checkout | null, fallbackMessage: string) => {
    if (!checkout) {
      Alert.alert('Saved, but not paid', fallbackMessage, [
        { text: 'Open my orders', onPress: goToOrders },
      ]);
      return;
    }

    if (checkout.method === 'COD') {
      Alert.alert('Order confirmed', checkout.message, [{ text: 'Track it', onPress: goToOrders }]);
      return;
    }

    // With a real gateway this is where the checkout sheet opens; against the
    // mock provider the server mints the same signed result the sheet would.
    if (checkout.publicKey === 'mock_key') {
      try {
        const paid = await simulatePayment(checkout.paymentId);
        Alert.alert('Payment received', paid.message, [
          { text: 'Track it', onPress: goToOrders },
        ]);
      } catch (err) {
        Alert.alert('Payment did not complete', errorMessage(err), [
          { text: 'Open my orders', onPress: goToOrders },
        ]);
      }
      return;
    }

    Alert.alert(
      'Ready to pay',
      `₹${checkout.amount.toFixed(2)} is due. Your order is held until the payment goes through.`,
      [{ text: 'Open my orders', onPress: goToOrders }]
    );
  };

  const decline = () => {
    Alert.alert('Not now?', 'You can still order these from the store later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          try {
            await declineFulfilment(fulfilmentId);
            navigation.goBack();
          } catch (err) {
            Alert.alert('Could not decline', errorMessage(err));
          }
        },
      },
    ]);
  };

  if (fulfilment.loading) return <Loading label="Loading your prescription" />;
  if (fulfilment.error) return <ErrorState message={fulfilment.error} onRetry={fulfilment.reload} />;
  if (!data) return <ErrorState message="This prescription order is no longer available." />;

  const settled = data.status !== 'PENDING_CONSENT';
  const remaining = hoursLeft(data.expiresAt);

  return (
    <Screen scroll bottomInset={settled ? 0 : 150}>
      <TopBar title="Approve your order" onBack={() => navigation.goBack()} />

      <Card style={styles.header}>
        <View style={styles.flex}>
          <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
            {data.diagnosis}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            Prescribed by {data.doctorName}
          </Text>
        </View>
        {settled ? <Badge label={data.status.replace(/_/g, ' ')} tint="neutral" /> : null}
      </Card>

      {settled ? (
        <Card background={colors.infoLight} style={styles.notice}>
          <Icon name="info" size={18} color={colors.secondary} />
          <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
            {data.status === 'CONSENTED'
              ? 'You already approved this — check your orders to track it.'
              : data.status === 'DECLINED'
                ? 'You declined this order. You can still buy the items from the store.'
                : 'This offer expired. Ask your doctor to reissue it.'}
          </Text>
        </Card>
      ) : (
        <Card background={colors.warningLight} style={styles.notice}>
          <Icon name="schedule" size={18} color={colors.warningDark} />
          <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
            Prices held for {remaining} more hour{remaining === 1 ? '' : 's'}. Nothing is ordered or
            charged until you approve.
          </Text>
        </Card>
      )}

      {data.medicines.length > 0 ? (
        <>
          <SectionHeader title="Medicines" />
          <View style={styles.list}>
            {data.medicines.map((line, index) => (
              <MedicineRow
                key={`${line.medicineId}-${index}`}
                line={line}
                excluded={excludedMedicines.has(line.medicineId)}
                disabled={settled}
                onToggle={() => toggleMedicine(line.medicineId)}
              />
            ))}
          </View>
        </>
      ) : null}

      {data.labTests.length > 0 ? (
        <>
          <SectionHeader title="Lab tests" />
          <View style={styles.list}>
            {data.labTests.map((line, index) => (
              <TestRow
                key={`${line.labPackageId ?? line.testName}-${index}`}
                line={line}
                excluded={line.labPackageId ? excludedTests.has(line.labPackageId) : false}
                disabled={settled}
                onToggle={() => line.labPackageId && toggleTest(line.labPackageId)}
              />
            ))}
          </View>
        </>
      ) : null}

      {!settled ? (
        <>
          <SectionHeader title="Deliver to" />
          <Card>
            <Input
              label="Delivery address"
              icon="location_on"
              value={address}
              onChangeText={setAddress}
              placeholder="Flat, street, landmark"
              multiline
            />
          </Card>

          <SectionHeader title="Payment" />
          <View style={styles.list}>
            {PAYMENT_METHODS.map((option) => (
              <PaymentOption
                key={option.value}
                option={option}
                selected={method === option.value}
                onSelect={() => setMethod(option.value)}
              />
            ))}
          </View>

          <SectionHeader title="Summary" />
          <Card style={styles.summary}>
            <SummaryRow label="Medicines" value={totals.medicines} />
            <SummaryRow label="Lab tests" value={totals.tests} />
            <SummaryRow
              label="Delivery"
              value={totals.delivery}
              hint={totals.delivery === 0 ? 'Free' : undefined}
            />
            <View style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text variant="labelMd" weight="bold" color={colors.onSurface}>
                Total
              </Text>
              <Text variant="headlineSm" weight="bold" color={colors.primary}>
                ₹{totals.grand.toFixed(0)}
              </Text>
            </View>
          </Card>

          <View style={styles.actions}>
            <Button
              label={
                method === 'COD'
                  ? `Place order · pay ₹${totals.grand.toFixed(0)} on delivery`
                  : `Pay ₹${totals.grand.toFixed(0)} and order`
              }
              icon="check_circle"
              iconPosition="right"
              onPress={() => void approve()}
              loading={busy}
              fullWidth
            />
            <Button label="Not now" variant="ghost" onPress={decline} fullWidth />
          </View>
        </>
      ) : null}
    </Screen>
  );
};

const MedicineRow: React.FC<{
  line: MedicineQuoteLine;
  excluded: boolean;
  disabled: boolean;
  onToggle: () => void;
}> = ({ line, excluded, disabled, onToggle }) => {
  const unavailable = Boolean(line.unavailableReason);

  return (
    <Pressable onPress={unavailable || disabled ? undefined : onToggle}>
      <Card style={[styles.row, (excluded || unavailable) && styles.rowMuted]}>
        {!disabled ? (
          <View style={[styles.check, excluded && styles.checkOff, unavailable && styles.checkNone]}>
            {unavailable ? (
              <Icon name="block" size={14} color={colors.captionGray} />
            ) : excluded ? null : (
              <Icon name="check" size={14} color={colors.onPrimary} />
            )}
          </View>
        ) : null}

        <View style={styles.flex}>
          <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
            {line.name}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {line.dosage} · {line.frequency}
            {line.durationDays ? ` · ${line.durationDays} days` : ''}
          </Text>

          {unavailable ? (
            <Text variant="captionSm" color={colors.warningDark}>
              {line.unavailableReason}
            </Text>
          ) : (
            <View style={styles.tags}>
              <Text variant="captionSm" color={colors.captionGray}>
                {line.quantity} × ₹{line.unitPrice} · {line.pharmacyName}
              </Text>
              {line.requiresPrescription ? <Badge label="Rx" tint="warning" /> : null}
            </View>
          )}
        </View>

        {!unavailable ? (
          <Text variant="labelMd" weight="bold" color={colors.primary}>
            ₹{line.itemTotal}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
};

const TestRow: React.FC<{
  line: LabQuoteLine;
  excluded: boolean;
  disabled: boolean;
  onToggle: () => void;
}> = ({ line, excluded, disabled, onToggle }) => {
  const unavailable = Boolean(line.unavailableReason);
  const total = (line.price ?? 0) + line.homeCollectionFee;

  return (
    <Pressable onPress={unavailable || disabled ? undefined : onToggle}>
      <Card style={[styles.row, (excluded || unavailable) && styles.rowMuted]}>
        {!disabled ? (
          <View style={[styles.check, excluded && styles.checkOff, unavailable && styles.checkNone]}>
            {unavailable ? (
              <Icon name="block" size={14} color={colors.captionGray} />
            ) : excluded ? null : (
              <Icon name="check" size={14} color={colors.onPrimary} />
            )}
          </View>
        ) : null}

        <View style={styles.flex}>
          <View style={styles.tags}>
            <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
              {line.testName}
            </Text>
            {line.urgent ? <Badge label="Urgent" tint="danger" /> : null}
          </View>
          {unavailable ? (
            <Text variant="captionSm" color={colors.warningDark}>
              {line.unavailableReason}
            </Text>
          ) : (
            <Text variant="captionSm" color={colors.captionGray}>
              {line.labPartnerName}
              {line.homeCollectionFee > 0
                ? ` · +₹${line.homeCollectionFee} collection`
                : ' · free home collection'}
            </Text>
          )}
          {line.instructions ? (
            <Text variant="captionSm" color={colors.captionGray}>
              {line.instructions}
            </Text>
          ) : null}
        </View>

        {!unavailable ? (
          <Text variant="labelMd" weight="bold" color={colors.primary}>
            ₹{total}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
};

const PaymentOption: React.FC<{
  option: (typeof PAYMENT_METHODS)[number];
  selected: boolean;
  onSelect: () => void;
}> = ({ option, selected, onSelect }) => (
  <Pressable
    onPress={onSelect}
    accessibilityRole="radio"
    accessibilityState={{ selected }}
    accessibilityLabel={`${option.label}. ${option.hint}`}
  >
    <Card style={[styles.row, selected && styles.rowSelected]}>
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <Icon
        name={option.icon}
        size={20}
        color={selected ? colors.primary : colors.onSurfaceVariant}
      />
      <View style={styles.flex}>
        <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
          {option.label}
        </Text>
        <Text variant="captionSm" color={colors.captionGray}>
          {option.hint}
        </Text>
      </View>
    </Card>
  </Pressable>
);

const SummaryRow: React.FC<{ label: string; value: number; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <View style={styles.summaryRow}>
    <Text variant="bodyMd" color={colors.onSurfaceVariant}>
      {label}
    </Text>
    <Text variant="bodyMd" weight="semibold" color={colors.onSurface}>
      {hint ?? `₹${value.toFixed(0)}`}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    marginTop: spacing.insetCard,
  },
  list: { gap: spacing.insetCard },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  rowMuted: { opacity: 0.55 },
  rowSelected: { borderWidth: 1.5, borderColor: colors.primary },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOff: { backgroundColor: colors.surfaceContainerHigh },
  checkNone: { backgroundColor: colors.surfaceContainerLow },
  tags: { flexDirection: 'row', alignItems: 'center', gap: spacing.stackMedium, flexWrap: 'wrap' },
  summary: { gap: spacing.base },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.outlineVariant,
    marginVertical: spacing.base,
  },
  actions: { gap: spacing.base, marginTop: spacing.xl },
});
