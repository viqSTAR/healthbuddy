import { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import {
  Alert,
  Button,
  Card,
  GatewayCheckout,
  Icon,
  Loading,
  Screen,
  Text,
  TopBar,
  colors,
  confirmPayment,
  errorMessage,
  radius,
  rupees,
  simulatePayment,
  spacing,
  startCheckout,
  useAuth,
  type Checkout,
  type GatewayResult,
  type PaymentMethod,
  type PaymentPurpose,
} from '@healthbuddy/shared';

/**
 * The one place money is collected.
 *
 * Everything that costs something comes through here — a basket from the store,
 * a lab test, a prescription order — because the alternative is what this app
 * had before: each flow deciding for itself whether to charge, and two of them
 * deciding not to. Medicine orders were placed without ever opening a payment,
 * and lab tests went straight to the partner's queue as booked, so a ₹349 blood
 * test was collected, run and reported with nothing charged for it.
 *
 * The screen never sees a price it was given by the caller as authoritative:
 * `amount` here is for display, and the server re-prices the order it already
 * holds when the checkout opens. A client that could name its own price would
 * be a client that could pay ₹1 for anything.
 */

const METHODS: { value: PaymentMethod; label: string; hint: string; icon: string }[] = [
  { value: 'UPI', label: 'UPI', hint: 'GPay, PhonePe, Paytm', icon: 'account_balance' },
  { value: 'CARD', label: 'Card', hint: 'Credit or debit', icon: 'credit_card' },
  { value: 'NETBANKING', label: 'Net banking', hint: 'All major banks', icon: 'account_balance' },
  { value: 'WALLET', label: 'Wallet', hint: 'Paytm, Amazon Pay', icon: 'wallet' },
  // Last, and labelled with what it actually means, because it is the one
  // option where the patient still owes money after tapping the button.
  { value: 'COD', label: 'Cash on delivery', hint: 'Pay the rider at your door', icon: 'payments' },
];

export interface PaymentRouteParams {
  purpose: PaymentPurpose;
  targetId: string;
  /** Display only — the server prices from the order it holds. */
  amount: number;
  /** Where to land once the money is settled. */
  nextScreen: string;
  nextParams?: Record<string, unknown>;
  /** COD is refused for things nobody hands over at a door. */
  allowCod?: boolean;
  /** Passed through so the confirmation can say where collection happens. */
  collectionAddress?: string | null;
  testName?: string;
  /** Shown before paying, so nobody pays for a delivery they cannot see. */
  addressText?: string | null;
}

export const PaymentScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const {
    purpose,
    targetId,
    amount,
    nextScreen,
    nextParams,
    allowCod = true,
    collectionAddress,
    testName,
    addressText,
  } = (route.params ?? {}) as PaymentRouteParams;

  const { user } = useAuth();
  const [method, setMethod] = useState<PaymentMethod>('UPI');
  const [paying, setPaying] = useState(false);
  /** Set once the server hands back a real gateway order — opens the sheet. */
  const [gateway, setGateway] = useState<Checkout | null>(null);

  const options = METHODS.filter((m) => m.value !== 'COD' || allowCod);

  /**
   * A confirmation screen rather than an alert.
   *
   * This is the moment the patient has just paid and has no idea what they have
   * bought — whether someone is coming to their door, whether they have to go
   * somewhere, when anything arrives. An OK button answers none of that.
   */
  const done = (settled: PaymentMethod) =>
    navigation.replace('OrderConfirmed', {
      purpose,
      amount,
      method: settled,
      trackScreen: nextScreen,
      trackParams: nextParams ?? {},
      ...(collectionAddress ? { collectionAddress } : {}),
      ...(testName ? { testName } : {}),
    });

  /**
   * Verifies the gateway's result and finishes.
   *
   * What the sheet hands back is a message from a web page, so it decides
   * nothing: `confirmPayment` re-checks the signature server-side against the
   * key secret before any order is released. A forged success gets a 403 here.
   */
  const settleWithGateway = async (result: GatewayResult) => {
    setGateway(null);
    setPaying(true);
    try {
      await confirmPayment({
        orderId: result.razorpay_order_id,
        paymentId: result.razorpay_payment_id,
        signature: result.razorpay_signature,
      });
      done(method);
    } catch (err) {
      Alert.alert('We could not confirm that payment', errorMessage(err));
    } finally {
      setPaying(false);
    }
  };

  const pay = async () => {
    setPaying(true);
    try {
      const checkout = await startCheckout({ purpose, targetId, method });

      /**
       * Cash is collected at the door, so there is nothing to settle now — the
       * server has already released the order to the partner on that basis.
       */
      if (checkout.method === 'COD') {
        done('COD');
        return;
      }

      /**
       * A real gateway hands back an order id and a public key; the mock
       * provider hands back neither, because there is nothing to open.
       *
       * Branching on the checkout the server returned rather than on a build
       * flag means the app follows whatever the deployment is configured for —
       * and it stops the previous behaviour, where the only path was the
       * development stand-in and prepaid payment simply did not work in
       * production.
       */
      if (checkout.gatewayOrderId && checkout.publicKey) {
        setGateway(checkout);
        return;
      }

      await simulatePayment(checkout.paymentId);
      done(checkout.method);
    } catch (err) {
      Alert.alert('Payment failed', errorMessage(err));
    } finally {
      setPaying(false);
    }
  };

  if (!targetId) {
    return (
      <Screen scroll={false}>
        <TopBar title="Payment" onBack={navigation.goBack} />
        <Text variant="bodyMd" color={colors.captionGray} style={styles.pad}>
          There is nothing to pay for here.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen bottomInset={spacing.xxl}>
      <TopBar title="Payment" onBack={navigation.goBack} />

      {/*
        The gateway's own sheet, opened only once the server has created a real
        order with it. Cancelling closes it and charges nothing.
      */}
      {gateway ? (
        <GatewayCheckout
          checkout={gateway}
          description={testName ?? 'Health Buddy order'}
          prefill={{
            ...(user?.fullName ? { name: user.fullName } : {}),
            ...(user?.phoneNumber ? { contact: user.phoneNumber } : {}),
          }}
          onSuccess={(result) => void settleWithGateway(result)}
          onCancel={(reason) => {
            setGateway(null);
            setPaying(false);
            if (reason) Alert.alert('Payment not completed', reason);
          }}
        />
      ) : null}

      <Text variant="captionSm" color={colors.captionGray}>
        Amount to pay
      </Text>
      <Text variant="displayBold" color={colors.headingDark}>
        {rupees(amount)}
      </Text>

      {/*
        Where this is going, shown before the money moves.

        A lab booking used to jump here straight from the test list, having
        quietly used whichever address happened to be the default — so the
        patient paid for a home collection without ever being told where the
        phlebotomist was being sent. The cart shows this; the payment step did
        not, which meant the one flow that skipped the cart showed it nowhere.

        Changing it goes back rather than editing in place: the order already
        exists at this point and carries the address it was created with, so
        re-pointing it means going back and booking again rather than silently
        paying for one address and delivering to another.
      */}
      {addressText ? (
        <Card style={styles.address}>
          <Icon name="location_on" size={18} color={colors.primary} />
          <View style={styles.flex}>
            <Text variant="captionSm" color={colors.captionGray}>
              {purpose === 'LAB_ORDER' ? 'Sample collected from' : 'Deliver to'}
            </Text>
            <Text variant="bodyMd" color={colors.headingDark} numberOfLines={2}>
              {addressText}
            </Text>
          </View>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Text variant="captionSm" weight="semibold" color={colors.primary}>
              Change
            </Text>
          </Pressable>
        </Card>
      ) : null}

      <View style={styles.methods}>
        {options.map((option) => {
          const selected = method === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setMethod(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Card style={[styles.row, selected && styles.rowSelected]}>
                <View style={[styles.radio, selected && styles.radioOn]}>
                  {selected ? <View style={styles.radioDot} /> : null}
                </View>
                <Icon
                  name={option.icon}
                  size={22}
                  color={selected ? colors.primary : colors.onSurfaceVariant}
                />
                <View style={styles.flex}>
                  <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
                    {option.label}
                  </Text>
                  <Text variant="captionSm" color={colors.captionGray}>
                    {option.hint}
                  </Text>
                </View>
              </Card>
            </Pressable>
          );
        })}
      </View>

      {paying ? (
        <Loading label="Talking to your bank" />
      ) : (
        <Button
          label={method === 'COD' ? 'Confirm order' : `Pay ${rupees(amount)}`}
          icon="check_circle"
          onPress={pay}
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  pad: { padding: spacing.insetPage },
  address: { flexDirection: 'row', alignItems: 'center', gap: spacing.base, marginTop: spacing.insetCard },
  methods: { gap: spacing.base, marginVertical: spacing.insetCard },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  rowSelected: { borderColor: colors.primary, borderWidth: 1.5 },
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
  flex: { flex: 1 },
});
