import React from 'react';
import { View, Pressable, StyleSheet, type ViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/typography';

export interface CardProps extends ViewProps {
  /** `card` = 20px radius (appointments); `cardSm` = 18px (doctor/service tiles). */
  size?: 'card' | 'cardSm';
  background?: string;
  padded?: boolean;
  padding?: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The system's mid-layer surface: a white block on a tinted background. Depth
 * comes from tonal contrast, so cards carry no shadow by design.
 */
export const Card: React.FC<CardProps> = ({
  size = 'card',
  background = colors.surfaceContainerLowest,
  padded = true,
  padding,
  onPress,
  style,
  children,
  ...rest
}) => {
  const cardStyle: StyleProp<ViewStyle> = [
    styles.base,
    { borderRadius: radius[size], backgroundColor: background },
    padded ? { padding: padding ?? spacing.insetPage } : null,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [cardStyle, pressed && styles.pressed]}
        {...rest}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={cardStyle} {...rest}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  base: { overflow: 'hidden' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.995 }] },
});
