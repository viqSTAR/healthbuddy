import React from 'react';
import { View, Image, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { colors, tints, type TintName } from '../theme/colors';
import { radius } from '../theme/typography';

export interface AvatarProps {
  /** Full name — initials are derived from it when no image is supplied. */
  name?: string;
  uri?: string;
  size?: number;
  tint?: TintName;
  /** Small emerald check overlaid bottom-right, as on the doctor profile. */
  verified?: boolean;
  square?: boolean;
  style?: StyleProp<ViewStyle>;
}

const initialsOf = (name?: string) => {
  if (!name) return '';
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
};

export const Avatar: React.FC<AvatarProps> = ({
  name,
  uri,
  size = 42,
  tint = 'success',
  verified = false,
  square = false,
  style,
}) => {
  const { bg, fg } = tints[tint];
  const shape = square ? radius.icon : size / 2;

  return (
    <View style={[{ width: size, height: size }, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: shape }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          style={[
            styles.fallback,
            { width: size, height: size, borderRadius: shape, backgroundColor: bg },
          ]}
        >
          <Text
            variant={size >= 56 ? 'headlineSm' : 'labelMd'}
            weight="medium"
            color={fg}
          >
            {initialsOf(name)}
          </Text>
        </View>
      )}

      {verified ? (
        <View style={[styles.check, { borderRadius: radius.full }]}>
          <Icon name="check" size={12} color={colors.onPrimary} />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  check: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surfaceContainerLowest,
  },
});
