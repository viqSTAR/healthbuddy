import React, { useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { colors } from '../theme/colors';
import { radius, spacing, typography } from '../theme/typography';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  icon?: string;
  error?: string;
  hint?: string;
  /** Adds a show/hide toggle and masks the field. */
  password?: boolean;
  right?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}

/** Mint-filled field with a leading glyph; emerald ring on focus. */
export const Input: React.FC<InputProps> = ({
  label,
  icon,
  error,
  hint,
  password,
  right,
  containerStyle,
  ...rest
}) => {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!password);

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="bodyMd" weight="medium" color={colors.onSurfaceVariant} style={styles.label}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          focused && styles.fieldFocused,
          !!error && styles.fieldError,
        ]}
      >
        {icon ? <Icon name={icon} size={20} color={colors.captionGray} /> : null}

        <TextInput
          style={styles.input}
          placeholderTextColor={colors.captionGray}
          secureTextEntry={hidden}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          {...rest}
        />

        {password ? (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
            <Icon
              name={hidden ? 'visibility' : 'visibility-off'}
              size={20}
              color={colors.captionGray}
            />
          </Pressable>
        ) : (
          right
        )}
      </View>

      {error ? (
        <Text variant="captionSm" color={colors.error} style={styles.help}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="captionSm" color={colors.captionGray} style={styles.help}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  label: { marginBottom: spacing.base },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    height: 52,
    paddingHorizontal: spacing.insetPage,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  fieldFocused: { borderColor: colors.primary, backgroundColor: colors.surfaceContainerLowest },
  fieldError: { borderColor: colors.error },
  input: { flex: 1, ...typography.bodyMd, color: colors.onSurface, padding: 0 },
  help: { marginTop: spacing.stackMedium },
});
