import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  EarningsScreen,
  NotificationsScreen,
  OtpVerificationScreen,
  VerificationStatus,
  colors,
  useAuth,
  useProviderApplication,
} from '@healthbuddy/shared';

import { BottomNav } from './BottomNav';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { DoctorRegistrationScreen } from '../screens/onboarding/DoctorRegistrationScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { ScheduleScreen } from '../screens/ScheduleScreen';
import { ConsultationScreen } from '../screens/ConsultationScreen';
import { PrescribeScreen } from '../screens/PrescribeScreen';
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

const DoctorTabs = () => (
  <Tab.Navigator tabBar={(props) => <BottomNav {...props} />} screenOptions={{ headerShown: false }}>
    <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ tabBarLabel: 'Today' }} />
    <Tab.Screen name="Schedule" component={ScheduleScreen} options={{ tabBarLabel: 'Schedule' }} />
    <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profile' }} />
  </Tab.Navigator>
);

const Splash = () => (
  <View style={styles.splash}>
    <ActivityIndicator size="large" color={colors.primary} />
  </View>
);

/**
 * Signed-in practitioners are routed by verification state, not by what they
 * claim to be. `gate` derives `approved` from the SERVER-issued role — an
 * application row alone never opens the dashboard, and every doctor endpoint
 * enforces the role independently regardless of what this navigator renders.
 */
const VerifiedArea: React.FC = () => {
  const { signOut } = useAuth();
  const { gate, application, reload } = useProviderApplication(['DOCTOR']);

  if (gate === 'loading') return <Splash />;

  /**
   * The role is the answer. An application is only how one is usually asked for.
   *
   * `gate` resolves to `approved` straight from the server-issued role and
   * deliberately does not load an application in that case — there is nothing
   * left to decide. This then required one anyway, so every doctor whose role
   * was granted directly rather than through the application queue was sent
   * back to "Register your practice" and could never reach their dashboard:
   * an admin provisioning a doctor via provisionRoleService creates the Doctor
   * row and the role but no application, and so does the seed. All six seeded
   * doctors were locked out of an app they are verified to use, while every
   * endpoint behind it would have served them.
   */
  if (gate === 'approved') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={DoctorTabs} />
        <Stack.Screen name="Consultation" component={ConsultationScreen} />
        <Stack.Screen name="Prescribe" component={PrescribeScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="Earnings" component={EarningsScreen} />
      </Stack.Navigator>
    );
  }

  if (gate === 'unregistered' || !application) {
    return <DoctorRegistrationScreen onSubmitted={() => void reload()} />;
  }

  if (gate === 'pending' || gate === 'rejected') {
    return (
      <VerificationStatus
        application={application}
        onEdit={() => void reload()}
        onRefresh={() => void reload()}
        onSignOut={() => void signOut()}
      />
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={DoctorTabs} />
      <Stack.Screen name="Consultation" component={ConsultationScreen} />
      <Stack.Screen name="Prescribe" component={PrescribeScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Earnings" component={EarningsScreen} />
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
