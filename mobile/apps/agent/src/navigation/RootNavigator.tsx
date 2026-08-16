import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  NotificationsScreen,
  OtpVerificationScreen,
  colors,
  errorMessage,
  fetchMyAgentProfile,
  useAuth,
} from '@healthbuddy/shared';

import { BottomNav } from './BottomNav';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { AgentRegistrationScreen } from '../screens/onboarding/AgentRegistrationScreen';
import { AvailableJobsScreen } from '../screens/AvailableJobsScreen';
import { MyJobsScreen } from '../screens/MyJobsScreen';
import { JobDetailScreen } from '../screens/JobDetailScreen';
import { PickupDetailScreen } from '../screens/PickupDetailScreen';
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

const Splash = () => (
  <View style={styles.splash}>
    <ActivityIndicator size="large" color={colors.primary} />
  </View>
);

const AgentTabs = () => (
  <Tab.Navigator tabBar={(props) => <BottomNav {...props} />} screenOptions={{ headerShown: false }}>
    <Tab.Screen name="Available" component={AvailableJobsScreen} options={{ tabBarLabel: 'Available' }} />
    <Tab.Screen name="Jobs" component={MyJobsScreen} options={{ tabBarLabel: 'My jobs' }} />
    <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profile' }} />
  </Tab.Navigator>
);

const AgentStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Tabs" component={AgentTabs} />
    <Stack.Screen name="JobDetail" component={JobDetailScreen} />
    <Stack.Screen name="PickupDetail" component={PickupDetailScreen} />
    <Stack.Screen name="Notifications" component={NotificationsScreen} />
  </Stack.Navigator>
);

/**
 * Routed by whether this account has an agent record at all.
 *
 * The role is the answer, and the record is what the role is granted against —
 * so this asks the server rather than trusting anything the client holds. An
 * account with a record but no verification still reaches the app: they can see
 * their profile and what the work looks like, and the pool itself refuses them
 * with a reason, which is a better screen than a locked door.
 */
const SignedInArea: React.FC = () => {
  const { user, refreshSession } = useAuth();
  const [state, setState] = useState<'loading' | 'registered' | 'unregistered'>('loading');

  const load = useCallback(async () => {
    if (user?.role !== 'DELIVERY_AGENT') {
      setState('unregistered');
      return;
    }
    try {
      await fetchMyAgentProfile();
      setState('registered');
    } catch (err) {
      // A missing profile is the only reason to show registration. Anything
      // else — a dropped connection, a server error — must not push somebody
      // who is already an agent back through a form they have filled in.
      setState(/not found|404/i.test(errorMessage(err)) ? 'unregistered' : 'registered');
    }
  }, [user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') return <Splash />;

  if (state === 'unregistered') {
    return (
      <AgentRegistrationScreen
        onRegistered={async () => {
          // Registration grants the role, so the session has to be re-minted
          // before any agent endpoint will answer.
          await refreshSession();
          setState('registered');
        }}
      />
    );
  }

  return <AgentStack />;
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
        <SignedInArea />
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
