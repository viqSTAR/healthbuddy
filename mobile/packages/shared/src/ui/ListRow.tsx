import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { colors, tints, type TintName } from '../theme/colors';
import { radius, spacing } from '../theme/typography';

export interface ListRowProps {
  icon?: string;
  iconTint?: TintName;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  danger?: boolean;
  right?: React.ReactNode;
  /** Hides the hairline under the last row in a group. */
  last?: boolean;
}

/** Settings/detail row: tinted icon tile, title + subtitle, trailing chevron. */
export const ListRow: React.FC<ListRowProps> = ({
  icon,
  iconTint = 'success',
  title,
  subtitle,
  value,
  onPress,
  showChevron = true,
  danger = false,
  right,
  last = false,
}) => {
  const { bg, fg } = tints[iconTint];
  const titleColor = danger ? colors.error : colors.headingDark;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        !last && styles.divider,
        pressed && onPress ? styles.pressed : null,
      ]}
    >
      {icon ? (
        <View
          style={[
            styles.iconBox,
            { backgroundColor: danger ? colors.dangerLight : bg },
          ]}
        >
          <Icon name={icon} size={20} color={danger ? colors.error : fg} />
        </View>
      ) : null}

      <View style={styles.body}>
        <Text variant="bodyMd" weight="medium" color={titleColor}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="captionSm" color={colors.captionGray} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right}

      {value ? (
        <Text variant="labelMd" weight="medium" color={colors.onSurfaceVariant}>
          {value}
        </Text>
      ) : null}

      {showChevron && onPress ? (
        <Icon name="chevron_right" size={20} color={colors.captionGray} />
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    paddingVertical: spacing.insetCard,
    paddingHorizontal: spacing.insetPage,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outlineVariant },
  pressed: { backgroundColor: colors.surfaceContainerLow },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: spacing.stackTight },
  subtitle: { marginTop: 1 },
});
