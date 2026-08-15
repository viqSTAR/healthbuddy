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
  type LabPackage,
} from '@healthbuddy/shared';

/**
 * What the test is, and what actually happens if you book it.
 *
 * A lab test is bought sight-unseen: the patient has no way to judge it from a
 * name and a price, and the things that decide whether the booking is useful
 * are all practical. Fasting leads for that reason — it is the only item on
 * this screen that can void the sample and make them pay twice. It is stated as
 * an instruction rather than shown as a badge, because a badge is something you
 * skim past.
 *
 * The rest answers "how is this done": what is taken, whether someone comes to
 * you or you attend, and what you get back at the end. A test that produces
 * films rather than a PDF is a materially different purchase and has to say so
 * before the money, not after.
 */
export const LabTestDetailScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const pkg = (route.params?.pkg ?? null) as LabPackage | null;
  const onBook = route.params?.onBook as (() => void) | undefined;

  if (!pkg) {
    return (
      <Screen scroll={false}>
        <TopBar title="Lab test" onBack={navigation.goBack} />
        <Text variant="bodyMd" color={colors.captionGray} style={styles.pad}>
          This test is no longer listed.
        </Text>
      </Screen>
    );
  }

  const steps = pkg.homeCollection
    ? [
        {
          icon: 'event_available',
          title: 'You book a slot',
          body: 'Pay online to confirm — the lab only receives the booking once it is paid.',
        },
        {
          icon: 'home',
          title: 'A phlebotomist visits',
          body: `They collect your ${pkg.sampleType.toLowerCase()} sample at your address. You get a call before they set out.`,
        },
        {
          icon: 'science',
          title: 'The lab runs the test',
          body: 'Usually a day, longer for larger panels.',
        },
        {
          icon: pkg.deliveryMode === 'DIGITAL_REPORT' ? 'description' : 'image',
          title: 'You get the result',
          body:
            pkg.deliveryMode === 'PHYSICAL'
              ? 'Films are delivered to your address, with a report.'
              : pkg.deliveryMode === 'DIGITAL_IMAGING'
                ? 'A report plus the images, in Records.'
                : 'A report appears under Records, ready to share with any doctor here.',
        },
      ]
    : [
        {
          icon: 'event_available',
          title: 'You book a slot',
          body: 'Pay online to confirm — the lab only receives the booking once it is paid.',
        },
        {
          icon: 'local_hospital',
          title: 'You visit the lab',
          body: 'This test cannot be done at home; you attend in person.',
        },
        {
          icon: 'science',
          title: 'The lab runs the test',
          body: 'Usually a day, longer for larger panels.',
        },
        {
          icon: 'description',
          title: 'You get the result',
          body: 'It appears under Records, ready to share with any doctor here.',
        },
      ];

  return (
    <Screen bottomInset={spacing.xxl}>
      <TopBar title="Lab test" onBack={navigation.goBack} />

      <View style={styles.hero}>
        <View style={styles.thumb}>
          <Icon name="biotech" size={40} color={colors.warningDark} />
        </View>
        <Text variant="displayBold" color={colors.headingDark} center>
          {pkg.testName}
        </Text>
        <Text variant="captionSm" color={colors.captionGray}>
          {pkg.category}
        </Text>
        <Text variant="displayBold" color={colors.primary}>
          {rupees(pkg.price)}
        </Text>
      </View>

      {/*
        The one instruction that can waste the whole visit. Stated in full, at
        the top, not reduced to a badge.
      */}
      {pkg.fastingReq ? (
        <Card style={[styles.notice, { backgroundColor: colors.warningLight }]}>
          <Icon name="no_meals" size={18} color={colors.warningDark} />
          <View style={styles.flex}>
            <Text variant="bodyMd" weight="semibold" color={colors.warningDark}>
              Fasting required
            </Text>
            <Text variant="captionSm" color={colors.warningDark}>
              Nothing but water for 8–12 hours before the sample. Eating first makes the result
              unusable and the test has to be repeated.
            </Text>
          </View>
        </Card>
      ) : (
        <Card style={styles.notice}>
          <Icon name="restaurant" size={18} color={colors.successDark} />
          <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
            No fasting needed — eat and drink normally before this test.
          </Text>
        </Card>
      )}

      {pkg.description ? (
        <Card style={styles.block}>
          <Text variant="captionSm" color={colors.captionGray}>
            What it looks for
          </Text>
          <Text variant="bodyMd" color={colors.onSurface}>
            {pkg.description}
          </Text>
        </Card>
      ) : null}

      <View style={styles.badges}>
        <Badge label={`${pkg.sampleType} sample`} tint="info" icon="colorize" />
        <Badge
          label={pkg.homeCollection ? 'Home collection' : 'Visit the lab'}
          tint={pkg.homeCollection ? 'success' : 'neutral'}
          icon={pkg.homeCollection ? 'home' : 'local_hospital'}
        />
      </View>

      <Text variant="headlineSmMobile" color={colors.headingDark}>
        How it works
      </Text>

      <View style={styles.steps}>
        {steps.map((step, index) => (
          <View key={step.title} style={styles.step}>
            <View style={styles.rail}>
              <View style={styles.dot}>
                <Icon name={step.icon} size={16} color={colors.onSurfaceVariant} />
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

      <Button
        label={`Book this test · ${rupees(pkg.price)}`}
        icon="biotech"
        onPress={() => {
          // Booking lives on the list screen, which owns the address check and
          // the payment handoff. Going back and invoking it keeps one path
          // rather than two that can drift apart.
          navigation.goBack();
          onBook?.();
        }}
      />
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
    backgroundColor: colors.warningLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    marginBottom: spacing.insetCard,
  },
  block: { gap: 4, marginBottom: spacing.insetCard },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.base, marginBottom: spacing.lg },
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
  line: { flex: 1, width: 2, backgroundColor: colors.outlineVariant, minHeight: 20 },
  stepBody: { flex: 1, gap: 2, paddingBottom: spacing.insetCard },
  flex: { flex: 1 },
});
