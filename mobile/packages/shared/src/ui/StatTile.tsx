import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/typography';

export interface StatTileProps {
  value: string;
  label: string;
  icon?: string;
  /** Emerald-filled treatment used for the headline metric. */
  emphasis?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Compact metric card — the "12+ / Exp. Years" row on provider dashboards. */
export const StatTile: React.FC<StatTileProps> = ({
  value,
  label,
  icon,
  emphasis = false,
  style,
}) => (
  <View
    style={[
      styles.tile,
      { backgroundColor: emphasis ? colors.primary : colors.surfaceContainerLowest },
      style,
    ]}
  >
    <View style={styles.valueRow}>
      <Text
        variant="displayBold"
        color={emphasis ? colors.onPrimary : colors.primary}
      >
        {value}
      </Text>
      {icon ? (
        <Icon name={icon} size={14} color={emphasis ? colors.onPrimary : colors.primary} />
      ) : null}
    </View>
    <Text
      variant="captionSm"
      color={emphasis ? colors.onPrimaryContainer : colors.captionGray}
    >
      {label}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.stackTight,
    paddingVertical: spacing.insetCard,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
  },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.inlineSm },
});
