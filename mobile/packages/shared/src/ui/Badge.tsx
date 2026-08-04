import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { tints, type TintName } from '../theme/colors';
import { radius, spacing } from '../theme/typography';

export interface BadgeProps {
  label: string;
  tint?: TintName;
  icon?: string;
  /** Verified-style badges are uppercase 9px bold; status chips are 10px medium. */
  emphasis?: 'chip' | 'verified';
  style?: StyleProp<ViewStyle>;
}

/**
 * Small pill container with a tinted background and matching foreground —
 * the design system's status/verification affordance.
 */
export const Badge: React.FC<BadgeProps> = ({
  label,
  tint = 'success',
  icon,
  emphasis = 'chip',
  style,
}) => {
  const { bg, fg } = tints[tint];
  const verified = emphasis === 'verified';

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: bg,
          borderRadius: verified ? radius.full : 10,
          paddingVertical: verified ? 2 : 4,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={verified ? 10 : 12} color={fg} /> : null}
      <Text
        variant="captionSm"
        weight={verified ? 'bold' : 'medium'}
        color={fg}
        uppercase={verified}
        style={verified ? styles.verifiedText : undefined}
      >
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inlineSm,
    paddingHorizontal: spacing.base,
    alignSelf: 'flex-start',
  },
  verifiedText: { fontSize: 9, lineHeight: 12 },
});
