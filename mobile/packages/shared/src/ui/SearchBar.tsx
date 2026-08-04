import React from 'react';
import { View, TextInput, StyleSheet, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { colors } from '../theme/colors';
import { radius, spacing, typography } from '../theme/typography';

export interface SearchBarProps {
  value?: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  /** Renders a filter affordance on the right, as on the catalogue screens. */
  onFilterPress?: () => void;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** 16px radius, white fill, leading search glyph — per the Inputs spec. */
export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChangeText,
  placeholder = 'Search doctors, medicines, lab',
  onSubmit,
  onFilterPress,
  autoFocus,
  style,
}) => (
  <View style={[styles.container, style]}>
    <Icon name="search" size={22} color={colors.captionGray} />
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.captionGray}
      onSubmitEditing={onSubmit}
      returnKeyType="search"
      autoFocus={autoFocus}
      autoCorrect={false}
    />
    {onFilterPress ? (
      <Pressable onPress={onFilterPress} hitSlop={8}>
        <Icon name="filter_list" size={20} color={colors.primary} />
      </Pressable>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    height: 48,
    paddingHorizontal: spacing.insetPage,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
  },
  input: {
    flex: 1,
    ...typography.bodyMd,
    color: colors.onSurface,
    padding: 0,
  },
});
