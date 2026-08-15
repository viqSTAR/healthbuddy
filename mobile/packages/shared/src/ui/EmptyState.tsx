import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/typography';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onActionPress?: () => void;
  /**
   * A second way out of the same dead end.
   *
   * Some empty states have two honest answers — "use my location" and "type a
   * pincode" — and offering only the first strands anyone who declines the
   * permission. Rendered quieter than the primary so the recommended path still
   * reads as the recommended one.
   */
  secondaryActionLabel?: string;
  onSecondaryActionPress?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = 'inbox',
  title,
  message,
  actionLabel,
  onActionPress,
  secondaryActionLabel,
  onSecondaryActionPress,
}) => (
  <View style={styles.container}>
    <View style={styles.iconBox}>
      <Icon name={icon} size={32} color={colors.primary} />
    </View>
    <Text variant="headlineSmMobile" color={colors.headingDark} center>
      {title}
    </Text>
    {message ? (
      <Text variant="bodyMd" color={colors.captionGray} center>
        {message}
      </Text>
    ) : null}
    {actionLabel ? (
      <Button label={actionLabel} onPress={onActionPress} size="md" style={styles.action} />
    ) : null}
    {secondaryActionLabel ? (
      <Button
        label={secondaryActionLabel}
        onPress={onSecondaryActionPress}
        size="md"
        variant="ghost"
      />
    ) : null}
  </View>
);

export const Loading: React.FC<{ label?: string }> = ({ label }) => (
  <View style={styles.container}>
    <ActivityIndicator size="large" color={colors.primary} />
    {label ? (
      <Text variant="bodyMd" color={colors.captionGray}>
        {label}
      </Text>
    ) : null}
  </View>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({
  message,
  onRetry,
}) => (
  <EmptyState
    icon="error-outline"
    title="Something went wrong"
    message={message}
    actionLabel={onRetry ? 'Try again' : undefined}
    onActionPress={onRetry}
  />
);

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.insetCard,
    paddingVertical: spacing.xxl * 1.5,
    paddingHorizontal: spacing.lg,
  },
  iconBox: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: { marginTop: spacing.base },
});
