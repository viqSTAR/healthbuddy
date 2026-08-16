import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Icon, Text, colors, radius, spacing } from '@healthbuddy/shared';

/** Icon per route, using the design's Material Symbols vocabulary. */
const ICONS: Record<string, string> = {
  Available: 'explore',
  Jobs: 'local_shipping',
  Profile: 'person',
};

/**
 * The lifted pill bar from the reference designs. This is the one surface in
 * the system that uses a shadow — everywhere else depth is tonal.
 */
export const BottomNav: React.FC<BottomTabBarProps> = ({ state, descriptors, navigation }) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.base) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key]!;
        const label = (options.tabBarLabel as string) ?? route.name;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={styles.item}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={label}
          >
            <View style={[styles.pill, focused && styles.pillActive]}>
              <Icon
                name={ICONS[route.name] ?? 'circle'}
                size={22}
                color={focused ? colors.onPrimary : colors.captionGray}
                filled={focused}
              />
            </View>
            <Text
              variant="captionSm"
              weight={focused ? 'bold' : 'medium'}
              color={focused ? colors.primary : colors.captionGray}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerLowest,
    paddingTop: spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  pill: {
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.stackMedium,
    borderRadius: radius.full,
  },
  pillActive: { backgroundColor: colors.primary },
});
