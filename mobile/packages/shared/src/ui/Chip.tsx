import React from 'react';
import { Pressable, View, StyleSheet, ScrollView } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { colors, tints, type TintName } from '../theme/colors';
import { radius, spacing } from '../theme/typography';

export interface ChipProps {
  label: string;
  icon?: string;
  tint?: TintName;
  selected?: boolean;
  onPress?: () => void;
}

/**
 * Category pill: white card, 12px radius, optional 24x24 tinted icon tile.
 * Selection is shown with an emerald border, matching the reference hover state.
 */
export const Chip: React.FC<ChipProps> = ({
  label,
  icon,
  tint = 'success',
  selected = false,
  onPress,
}) => {
  const { bg, fg } = tints[tint];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {icon ? (
        <View style={[styles.iconBox, { backgroundColor: bg }]}>
          <Icon name={icon} size={14} color={fg} />
        </View>
      ) : null}
      <Text
        variant="captionSm"
        weight="medium"
        color={selected ? colors.primary : colors.onSurface}
      >
        {label}
      </Text>
    </Pressable>
  );
};

/** Horizontally scrolling chip row that bleeds to the screen edges. */
export const ChipRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.row}
    style={styles.bleed}
  >
    {children}
  </ScrollView>
);

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    paddingHorizontal: spacing.insetCard,
    paddingVertical: spacing.base,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipSelected: { borderColor: colors.primary },
  pressed: { opacity: 0.8 },
  iconBox: {
    width: 24,
    height: 24,
    borderRadius: radius.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bleed: { marginHorizontal: -spacing.insetPage },
  row: { gap: spacing.insetCard, paddingHorizontal: spacing.insetPage },
});
