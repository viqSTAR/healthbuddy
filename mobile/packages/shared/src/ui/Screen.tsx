import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { Text } from './Text';
import { Icon } from './Icon';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/typography';

export interface TopBarProps {
  title?: string;
  onBack?: () => void;
  /** Renders the emerald brand mark + wordmark instead of a plain title. */
  brand?: boolean;
  right?: React.ReactNode;
  onNotificationsPress?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  onBack,
  brand,
  right,
  onNotificationsPress,
}) => (
  <View style={styles.topBar}>
    <View style={styles.topBarLeft}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Go back" accessibilityRole="button">
          <Icon name="arrow_back" size={24} color={colors.primary} />
        </Pressable>
      ) : null}

      {brand ? (
        <>
          <View style={styles.brandMark}>
            <Icon name="spa" size={24} color={colors.onPrimary} />
          </View>
          <Text variant="displayBold" color={colors.primary}>
            Health Buddy
          </Text>
        </>
      ) : title ? (
        <Text variant="displayBold" color={colors.primary} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
    </View>

    {right ??
      (onNotificationsPress ? (
        <Pressable
          onPress={onNotificationsPress}
          style={styles.iconButton}
          accessibilityLabel="Notifications"
          accessibilityRole="button"
        >
          <Icon name="notifications" size={22} color={colors.primary} />
        </Pressable>
      ) : null)}
  </View>
);

export interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  background?: string;
  edges?: readonly Edge[];
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Extra bottom padding so content clears the floating bottom nav. */
  bottomInset?: number;
  contentStyle?: StyleProp<ViewStyle>;
}

/** Page shell: mint background, 16px page margin, safe-area aware. */
export const Screen: React.FC<ScreenProps> = ({
  children,
  scroll = true,
  padded = true,
  background = colors.background,
  edges = ['top'],
  refreshing,
  onRefresh,
  bottomInset = 0,
  contentStyle,
}) => {
  const inner: StyleProp<ViewStyle> = [
    padded ? { paddingHorizontal: spacing.insetPage } : null,
    { paddingBottom: bottomInset },
    contentStyle,
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: background }]} edges={edges}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={inner}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
};

/** Section heading with an optional trailing action, used on most screens. */
export const SectionHeader: React.FC<{
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
}> = ({ title, actionLabel, onActionPress }) => (
  <View style={styles.sectionHeader}>
    <Text variant="headlineSmMobile" color={colors.headingDark}>
      {title}
    </Text>
    {actionLabel ? (
      <Pressable onPress={onActionPress} hitSlop={8}>
        <Text variant="labelMd" weight="medium" color={colors.primary}>
          {actionLabel}
        </Text>
      </Pressable>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.insetPage,
    gap: spacing.insetCard,
  },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard, flex: 1 },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.insetCard,
  },
});
