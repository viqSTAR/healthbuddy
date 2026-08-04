import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Icon, Text, colors, radius, spacing } from '@healthbuddy/shared';

/** Icon per route, using the design's Material Symbols vocabulary. */
const ICONS: Record<string, string> = {
  Home: 'home',
  Doctors: 'medical_services',
  Records: 'description',
  Orders: 'shopping_cart',
  Profile: 'person',
  Pharmacy: 'pill',
  Labs: 'biotech',
  Emergency: 'emergency',
  Dashboard: 'dashboard',
  Queue: 'list_alt',
  Patients: 'groups',
  Users: 'groups',
};

/**
 * Custom tab bar matching the design spec: the active item gets a pill-shaped
 * Success Light background behind the icon rather than an indicator line, and
 * all labels use the 10px caption style.
 */
export const BottomNav: React.FC<BottomTabBarProps> = ({ state, descriptors, navigation }) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.insetCard) }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]!;
        const label = (options.tabBarLabel as string) ?? options.title ?? route.name;
        const focused = state.index === index;
        const emergency = route.name === 'Emergency';

        const activeColor = emergency ? colors.error : colors.successDark;
        const activeBg = emergency ? colors.dangerLight : colors.successLight;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={styles.item}
          >
            <View style={[styles.iconPill, focused && { backgroundColor: activeBg }]}>
              <Icon
                name={ICONS[route.name] ?? 'circle'}
                size={22}
                color={focused ? activeColor : colors.captionGray}
              />
            </View>
            <Text
              variant="labelMd"
              weight="medium"
              color={focused ? activeColor : colors.captionGray}
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
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    paddingTop: spacing.base,
    paddingHorizontal: spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant,
  },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  iconPill: {
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.inlineSm,
    borderRadius: radius.full,
  },
});
