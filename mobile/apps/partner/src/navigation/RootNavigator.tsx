import React, { useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  NotificationsScreen,
  OtpVerificationScreen,
  VerificationStatus,
  colors,
  useAuth,
  useProviderApplication,
  type ApplicationType,
} from '@healthbuddy/shared';

import { BottomNav } from './BottomNav';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { PartnerTypeScreen } from '../screens/onboarding/PartnerTypeScreen';
import { PartnerRegistrationScreen } from '../screens/onboarding/PartnerRegistrationScreen';
import { OrdersScreen } from '../screens/pharmacy/OrdersScreen';
import { InventoryScreen } from '../screens/pharmacy/InventoryScreen';
import { BookingsScreen } from '../screens/lab/BookingsScreen';
import { TestCatalogueScreen } from '../screens/lab/TestCatalogueScreen';
import { ProfileScreen } from '../screens/ProfileScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surfaceContainerLowest,
    primary: colors.primary,
    text: colors.onSurface,
    border: colors.outlineVariant,
  },
};

const tabOptions = { headerShown: false } as const;

/**
 * The two dashboards share a shell but almost no screens — a pharmacy fulfils
 * orders from stock it holds, a lab collects samples and returns reports. The
 * saving from one app is the release pipeline, not the code, so the split is at
 * the navigator rather than inside every screen.
 */
const PharmacyTabs = () => (
  <Tab.Navigator tabBar={(props) => <BottomNav {...props} />} screenOptions={tabOptions}>
    <Tab.Screen name="Orders" component={OrdersScreen} options={{ tabBarLabel: 'Orders' }} />
    <Tab.Screen name="Stock" component={InventoryScreen} options={{ tabBarLabel: 'Stock' }} />
    <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profile' }} />
  </Tab.Navigator>
);

const LabTabs = () => (
  <Tab.Navigator tabBar={(props) => <BottomNav {...props} />} screenOptions={tabOptions}>
    <Tab.Screen name="Bookings" component={BookingsScreen} options={{ tabBarLabel: 'Bookings' }} />
    <Tab.Screen name="Tests" component={TestCatalogueScreen} options={{ tabBarLabel: 'Tests' }} />
    <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profile' }} />
  </Tab.Navigator>
);

const Splash = () => (
  <View style={styles.splash}>
    <ActivityIndicator size="large" color={colors.primary} />
  </View>
);

const VerifiedArea: React.FC = () => {
  const { user, signOut } = useAuth();
  const { gate, application, reload } = useProviderApplication(['PHARMACY', 'LAB']);

  /** Which registration form to show before an application exists. */
  const [chosenType, setChosenType] = useState<ApplicationType | null>(null);

  if (gate === 'loading') return <Splash />;

  if (gate === 'unregistered') {
    // An existing draft already carries its type; otherwise ask.
    const type = application?.type ?? chosenType;
    if (!type) return <PartnerTypeScreen onSelect={setChosenType} />;

    return (
      <PartnerRegistrationScreen
        type={type}
        onSubmitted={() => void reload()}
        onBack={() => setChosenType(null)}
      />
    );
  }

  if ((gate === 'pending' || gate === 'rejected') && application) {
    return (
      <VerificationStatus
        application={application}
        onEdit={() => void reload()}
        onRefresh={() => void reload()}
        onSignOut={() => void signOut()}
      />
    );
  }

  // The role decides which dashboard appears — not the application row, and
  // certainly not anything the client chose.
  const Tabs = user?.role === 'LAB_PARTNER' ? LabTabs : PharmacyTabs;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={Tabs} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
    </Stack.Navigator>
  );
};

export const RootNavigator: React.FC = () => {
  const { user, pendingPhone, bootstrapping } = useAuth();

  if (bootstrapping) return <Splash />;

  return (
    <NavigationContainer theme={navTheme}>
      {!user ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {pendingPhone ? (
            <Stack.Screen name="Otp">
              {() => <OtpVerificationScreen brand="Health Buddy" />}
            </Stack.Screen>
          ) : (
            <Stack.Screen name="Login" component={LoginScreen} />
          )}
        </Stack.Navigator>
      ) : (
        <VerifiedArea />
      )}
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
