import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Icon, Text, colors, radius, spacing } from '@healthbuddy/shared';
import { useLocation } from '../services/location';

const LABEL: Record<string, string> = { HOME: 'Home', WORK: 'Work', OTHER: 'Saved' };

/**
 * Where the user is shopping from, always visible and always one tap from
 * being changed.
 *
 * Delivery apps put this at the top of every screen for a reason: prices,
 * availability and arrival times all depend on it, so hiding it inside a
 * settings page means people see a catalogue without knowing which one.
 */
export const LocationChip: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const { active, serviceability, locating } = useLocation();

  /**
   * A detected pincode is a real location and says so. Showing "Set your
   * delivery address" while the app is already pricing a catalogue against a
   * pincode it worked out from GPS tells the user nothing is set when
   * something is.
   */
  const line = active
    ? active.address
      ? [active.address.line1, active.address.city].filter(Boolean).join(', ')
      : [active.city, active.state].filter(Boolean).join(', ') || `Pincode ${active.pincode}`
    : locating
      ? 'Finding your location…'
      : 'Set your delivery location';

  const heading = active
    ? active.address
      ? (LABEL[active.address.label] ?? 'Saved')
      : active.source === 'gps'
        ? 'Current location'
        : 'Delivering to'
    : 'Deliver to';

  // Only ever shown as a warning once we have a definite "no" — an unresolved
  // check must not flash a scary state at someone whose network is just slow.
  const unserviceable = serviceability?.serviceable === false;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Change delivery address"
    >
      <Icon
        name="location_on"
        size={18}
        color={unserviceable ? colors.error : colors.primary}
      />

      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text variant="captionSm" weight="semibold" color={colors.primary}>
            {heading}
          </Text>
          {active ? (
            <Text variant="captionSm" color={colors.captionGray}>
              {active.pincode}
            </Text>
          ) : null}
        </View>

        <Text
          variant="captionSm"
          color={unserviceable ? colors.error : colors.headingDark}
          numberOfLines={1}
        >
          {unserviceable ? "We don't deliver here yet" : line}
        </Text>
      </View>

      <Icon name="expand_more" size={18} color={colors.captionGray} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.insetCard,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
  },
  pressed: { backgroundColor: colors.surfaceContainerLow },
  body: { flex: 1, gap: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
});
