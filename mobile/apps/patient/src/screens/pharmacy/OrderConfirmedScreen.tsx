import { View, StyleSheet } from 'react-native';
import {
  Button,
  Card,
  Icon,
  Screen,
  Text,
  colors,
  radius,
  spacing,
  type PaymentMethod,
  type PaymentPurpose,
} from '@healthbuddy/shared';

/**
 * What happens after the money lands.
 *
 * This replaced a system alert that said "Payment received" and left. An alert
 * is the wrong shape for this moment: it is the one point where the patient has
 * just parted with money and has no idea what they have bought — whether a
 * phlebotomist is coming to their door, whether they need to go somewhere, or
 * when anything arrives. The commonest support question after a payment is not
 * "did it work", it is "what now", and an OK button answers neither.
 *
 * So it says what was paid, and then what the next few days look like, in the
 * order they will happen. Cash on delivery is called out separately because the
 * patient still owes money and should not be told the order is paid for.
 */

export interface OrderConfirmedRouteParams {
  purpose: PaymentPurpose;
  amount: number;
  method: PaymentMethod;
  /** Where "track" goes. */
  trackScreen: string;
  trackParams?: Record<string, unknown>;
  /** Set for a home visit, so the steps can say where it happens. */
  collectionAddress?: string | null;
  testName?: string;
}

interface Step {
  icon: string;
  title: string;
  body: string;
}

/**
 * The steps are written as what the patient will experience, not as the status
 * names the database uses. "PROCESSING" tells someone nothing; "your sample is
 * with the lab" tells them why nothing has happened yet today.
 */
const stepsFor = (
  purpose: PaymentPurpose,
  params: OrderConfirmedRouteParams
): Step[] => {
  if (purpose === 'LAB_ORDER') {
    const where = params.collectionAddress
      ? `at ${params.collectionAddress}`
      : 'at your address';
    return [
      {
        icon: 'event_available',
        title: 'Booking confirmed',
        body: `${params.testName ?? 'Your test'} is booked and the lab has it.`,
      },
      {
        icon: 'home_health',
        title: 'Sample collection',
        body: `A phlebotomist will collect your sample ${where}. You'll get a call before they set out.`,
      },
      {
        icon: 'science',
        title: 'At the lab',
        body: 'Testing usually takes a day, longer for some panels.',
      },
      {
        icon: 'description',
        title: 'Report ready',
        body: 'It appears under Records, and you can share it with any doctor here.',
      },
    ];
  }

  return [
    {
      icon: 'receipt_long',
      title: 'Order confirmed',
      body: 'The pharmacy has your order and is checking the items.',
    },
    {
      icon: 'inventory_2',
      title: 'Being packed',
      body: 'Items from different pharmacies are packed and sent separately, so they may arrive at different times.',
    },
    {
      icon: 'local_shipping',
      title: 'Out for delivery',
      body: "You'll see the rider's details once the parcel leaves the shop.",
    },
    {
      icon: 'check_circle',
      title: 'Delivered',
      body: 'Check the strip and expiry when it arrives, before you take anything.',
    },
  ];
};

export const OrderConfirmedScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const params = (route.params ?? {}) as OrderConfirmedRouteParams;
  const { purpose, amount, method, trackScreen, trackParams } = params;

  const isCod = method === 'COD';
  const steps = stepsFor(purpose, params);

  return (
    <Screen bottomInset={spacing.xxl}>
      <View style={styles.hero}>
        <View style={styles.tick}>
          <Icon name="check_circle" size={56} color={colors.primary} />
        </View>
        <Text variant="displayBold" color={colors.headingDark} center>
          {isCod ? 'Order confirmed' : 'Payment received'}
        </Text>
        <Text variant="bodyMd" color={colors.captionGray} center>
          {isCod
            ? `Pay ₹${amount.toFixed(2)} in cash when it arrives.`
            : `₹${amount.toFixed(2)} paid · ${method}`}
        </Text>
      </View>

      <Text variant="headlineSmMobile" color={colors.headingDark}>
        What happens next
      </Text>

      <View style={styles.steps}>
        {steps.map((step, index) => (
          <View key={step.title} style={styles.step}>
            {/* The rail makes it read as a sequence rather than four tips. */}
            <View style={styles.rail}>
              <View style={[styles.dot, index === 0 && styles.dotNow]}>
                <Icon
                  name={step.icon}
                  size={16}
                  color={index === 0 ? colors.onPrimary : colors.onSurfaceVariant}
                />
              </View>
              {index < steps.length - 1 ? <View style={styles.line} /> : null}
            </View>

            <View style={styles.stepBody}>
              <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
                {step.title}
              </Text>
              <Text variant="captionSm" color={colors.captionGray}>
                {step.body}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {isCod ? (
        <Card style={styles.note}>
          <Icon name="payments" size={18} color={colors.secondary} />
          <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
            Keep ₹{amount.toFixed(2)} ready. The rider cannot break large notes.
          </Text>
        </Card>
      ) : null}

      <Button
        label={purpose === 'LAB_ORDER' ? 'Track booking' : 'Track order'}
        icon="local_shipping"
        onPress={() => navigation.replace(trackScreen, trackParams ?? {})}
      />
      <Button
        label="Back to home"
        variant="ghost"
        onPress={() => navigation.navigate('Tabs')}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.base, paddingVertical: spacing.lg },
  tick: {
    width: 96,
    height: 96,
    borderRadius: radius.full,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  steps: { marginTop: spacing.insetCard, marginBottom: spacing.lg },
  step: { flexDirection: 'row', gap: spacing.insetCard },
  rail: { alignItems: 'center', width: 32 },
  dot: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotNow: { backgroundColor: colors.primary },
  line: { flex: 1, width: 2, backgroundColor: colors.outlineVariant, minHeight: 20 },
  stepBody: { flex: 1, gap: 2, paddingBottom: spacing.insetCard },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    backgroundColor: colors.infoLight,
    marginBottom: spacing.insetCard,
  },
  flex: { flex: 1 },
});
