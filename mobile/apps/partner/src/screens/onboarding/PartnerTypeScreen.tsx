import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import {
  Button,
  Icon,
  Screen,
  Text,
  TopBar,
  colors,
  radius,
  spacing,
  useAuth,
  type ApplicationType,
} from '@healthbuddy/shared';

const OPTIONS: {
  type: ApplicationType;
  icon: string;
  title: string;
  blurb: string;
  points: string[];
}[] = [
  {
    type: 'PHARMACY',
    icon: 'local_pharmacy',
    title: 'Pharmacy',
    blurb: 'Dispense and deliver medicine against patient orders.',
    points: ['Manage your own stock and prices', 'Accept and dispatch orders', 'Drug licence required'],
  },
  {
    type: 'LAB',
    icon: 'science',
    title: 'Diagnostic lab',
    blurb: 'Collect samples and deliver reports to patients.',
    points: ['Set your own test pricing', 'Schedule home collection', 'Lab registration required'],
  },
];

/**
 * The fork between the two partner businesses.
 *
 * This choice selects a registration form and, after approval, a dashboard —
 * it is stored as `ProviderApplication.type` and is never consulted for
 * authorisation. What a partner may actually do comes from the role an admin
 * grants them.
 */
export const PartnerTypeScreen: React.FC<{ onSelect: (type: ApplicationType) => void }> = ({
  onSelect,
}) => {
  const { signOut } = useAuth();

  return (
    <Screen scroll>
      <TopBar
        brand
        right={<Button label="Sign out" variant="ghost" size="sm" onPress={() => void signOut()} />}
      />

      <View style={styles.hero}>
        <Text variant="displayBold" color={colors.headingDark}>
          What do you run?
        </Text>
        <Text variant="bodyMd" color={colors.captionGray}>
          We verify every partner's licence before they go live on Health Buddy.
        </Text>
      </View>

      <View style={styles.options}>
        {OPTIONS.map((option) => (
          <Pressable
            key={option.type}
            onPress={() => onSelect(option.type)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <View style={styles.iconBox}>
              <Icon name={option.icon} size={30} color={colors.primary} />
            </View>

            <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
              {option.title}
            </Text>
            <Text variant="captionSm" color={colors.captionGray}>
              {option.blurb}
            </Text>

            <View style={styles.points}>
              {option.points.map((point) => (
                <View key={point} style={styles.point}>
                  <Icon name="check_circle" size={14} color={colors.successDark} />
                  <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
                    {point}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.cta}>
              <Text variant="labelMd" weight="bold" color={colors.primary}>
                Continue
              </Text>
              <Icon name="arrow_forward" size={18} color={colors.primary} />
            </View>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { gap: spacing.base, paddingVertical: spacing.lg },
  options: { gap: spacing.insetPage },
  card: {
    gap: spacing.base,
    padding: spacing.insetPage,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  pressed: { opacity: 0.85 },
  iconBox: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
  },
  points: { gap: spacing.base, marginTop: spacing.base },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing.stackMedium },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.stackMedium,
    marginTop: spacing.base,
  },
});
