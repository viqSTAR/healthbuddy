import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  colors,
  useAuth,
  OtpVerificationScreen,
  NotificationsScreen,
  ChatThreadsScreen,
  ChatConversationScreen,
  VideoCallScreen,
  type AppNotification,
} from '@healthbuddy/shared';

import { BottomNav } from './BottomNav';

// Auth
import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignUpScreen } from '../screens/auth/SignUpScreen';

// Patient
import { HomeScreen } from '../screens/patient/HomeScreen';
import { DoctorDirectoryScreen } from '../screens/patient/DoctorDirectoryScreen';
import { DoctorProfileScreen } from '../screens/patient/DoctorProfileScreen';
import { BookConsultationScreen } from '../screens/patient/BookConsultationScreen';
import { AppointmentConfirmedScreen } from '../screens/patient/AppointmentConfirmedScreen';
import { MedicalRecordsScreen } from '../screens/patient/MedicalRecordsScreen';
import { PrescriptionScreen } from '../screens/patient/PrescriptionScreen';
import { PrescriptionOrderScreen } from '../screens/patient/PrescriptionOrderScreen';
import { ProfileScreen } from '../screens/patient/ProfileScreen';
import { AddressBookScreen } from '../screens/patient/AddressBookScreen';
import { PrivacyScreen } from '../screens/patient/PrivacyScreen';
import { AppointmentsScreen } from '../screens/patient/AppointmentsScreen';
import { PaymentsScreen } from '../screens/patient/PaymentsScreen';
import { HealthTipsScreen } from '../screens/patient/HealthTipsScreen';
import { HelpScreen } from '../screens/patient/HelpScreen';
import { VisitDetailScreen } from '../screens/patient/VisitDetailScreen';
import { EditProfileScreen } from '../screens/patient/EditProfileScreen';

// Pharmacy (patient-facing)
import { MedicineStoreScreen } from '../screens/pharmacy/MedicineStoreScreen';
import { CartScreen } from '../screens/pharmacy/CartScreen';
import { MyOrdersScreen } from '../screens/pharmacy/MyOrdersScreen';
import { OrderTrackingScreen } from '../screens/pharmacy/OrderTrackingScreen';
import { PaymentScreen } from '../screens/pharmacy/PaymentScreen';
import { OrderConfirmedScreen } from '../screens/pharmacy/OrderConfirmedScreen';
import { MedicineDetailScreen } from '../screens/pharmacy/MedicineDetailScreen';

// Labs
import { LabTestScreen } from '../screens/labs/LabTestScreen';
import { LabResultScreen } from '../screens/labs/LabResultScreen';
import { LabTestDetailScreen } from '../screens/labs/LabTestDetailScreen';

// Emergency
import { EmergencySosScreen } from '../screens/emergency/EmergencySosScreen';

// Consultation
import { JoinLobbyScreen } from '../screens/consult/JoinLobbyScreen';

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

/**
 * The five-item bar from the reference designs.
 *
 * This app ships only the patient experience — provider dashboards live in the
 * doctor and partner apps, each with its own store listing, permissions and
 * release cadence. There is no role switch here to get wrong.
 */
const PatientTabs = () => (
  <Tab.Navigator tabBar={(props) => <BottomNav {...props} />} screenOptions={{ headerShown: false }}>
    <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Home' }} />
    <Tab.Screen
      name="Doctors"
      component={DoctorDirectoryScreen}
      options={{ tabBarLabel: 'Doctors' }}
    />
    <Tab.Screen
      name="Records"
      component={MedicalRecordsScreen}
      options={{ tabBarLabel: 'Records' }}
    />
    <Tab.Screen name="Orders" component={MyOrdersScreen} options={{ tabBarLabel: 'Orders' }} />
    <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profile' }} />
  </Tab.Navigator>
);

export const RootNavigator: React.FC = () => {
  const { user, pendingPhone, bootstrapping } = useAuth();

  if (bootstrapping) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          pendingPhone ? (
            // Verification takes over the stack so back always returns to entry.
            <Stack.Screen name="Otp" component={OtpVerificationScreen} />
          ) : (
            <>
              <Stack.Screen name="Login">
                {({ navigation }) => <LoginScreen onSignUp={() => navigation.navigate('SignUp')} />}
              </Stack.Screen>
              <Stack.Screen name="SignUp">
                {({ navigation }) => <SignUpScreen onBack={() => navigation.goBack()} />}
              </Stack.Screen>
            </>
          )
        ) : (
          <>
            <Stack.Screen name="Tabs" component={PatientTabs} />

            <Stack.Screen name="Pharmacy" component={MedicineStoreScreen} />
            <Stack.Screen name="Cart" component={CartScreen} />
            <Stack.Screen name="Payment" component={PaymentScreen} />
            <Stack.Screen name="OrderConfirmed" component={OrderConfirmedScreen} />
            <Stack.Screen name="OrderTracking" component={OrderTrackingScreen} />
            <Stack.Screen name="MedicineDetail" component={MedicineDetailScreen} />
            <Stack.Screen name="Labs" component={LabTestScreen} />
            <Stack.Screen name="LabTestDetail" component={LabTestDetailScreen} />
            <Stack.Screen name="LabResult" component={LabResultScreen} />
            <Stack.Screen name="Emergency" component={EmergencySosScreen} />
            <Stack.Screen name="Privacy" component={PrivacyScreen} />
            <Stack.Screen name="Appointments" component={AppointmentsScreen} />
            <Stack.Screen name="Payments" component={PaymentsScreen} />
            <Stack.Screen name="HealthTips" component={HealthTipsScreen} />
            <Stack.Screen name="Help" component={HelpScreen} />
            <Stack.Screen name="DoctorProfile" component={DoctorProfileScreen} />
            <Stack.Screen name="BookConsultation" component={BookConsultationScreen} />
            <Stack.Screen name="AppointmentConfirmed" component={AppointmentConfirmedScreen} />
            <Stack.Screen name="Prescription" component={PrescriptionScreen} />
            {/* The consent gate between a prescription and a real order. */}
            <Stack.Screen name="PrescriptionOrder" component={PrescriptionOrderScreen} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            <Stack.Screen name="AddressBook" component={AddressBookScreen} />
            <Stack.Screen name="VisitDetail" component={VisitDetailScreen} />

            <Stack.Screen name="JoinLobby" component={JoinLobbyScreen} />
            {/* The consultation itself. Was a shell with no transport. */}
            <Stack.Screen name="VideoConsultation" options={{ animation: 'fade' }}>
              {({ navigation, route }) => (
                <VideoCallScreen navigation={navigation} route={route} role="PATIENT" />
              )}
            </Stack.Screen>
            {/* Follow-up messaging, opened by the server when a consultation completes. */}
            <Stack.Screen name="Messages">
              {({ navigation }) => <ChatThreadsScreen navigation={navigation} role="PATIENT" />}
            </Stack.Screen>
            <Stack.Screen name="ChatConversation">
              {({ navigation, route }) => (
                <ChatConversationScreen navigation={navigation} route={route} role="PATIENT" />
              )}
            </Stack.Screen>

            {/*
              Notifications route to the thing they are about. A "prescription
              ready" alert has to land on the consent screen — otherwise the
              automation is invisible and the basket expires unread.
            */}
            <Stack.Screen name="Notifications">
              {({ navigation }) => (
                <NotificationsScreen
                  navigation={navigation}
                  onOpen={(notification: AppNotification) => {
                    const data = notification.data ?? {};
                    if (typeof data.threadId === 'string') {
                      navigation.navigate('ChatConversation', { threadId: data.threadId });
                    } else if (typeof data.fulfilmentId === 'string') {
                      navigation.navigate('PrescriptionOrder', { fulfilmentId: data.fulfilmentId });
                    } else if (typeof data.orderId === 'string') {
                      navigation.navigate('OrderTracking', { orderId: data.orderId });
                    } else if (typeof data.labOrderId === 'string') {
                      navigation.navigate('LabResult', { orderId: data.labOrderId });
                    } else if (typeof data.prescriptionId === 'string') {
                      navigation.navigate('Prescription', { id: data.prescriptionId });
                    }
                  }}
                />
              )}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
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
