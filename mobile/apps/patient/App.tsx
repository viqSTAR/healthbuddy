import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, colors, useAppFonts } from '@healthbuddy/shared';

import { CartProvider } from './src/services/cart';
import { LocationProvider } from './src/services/location';
import { ToastProvider } from './src/components/Toast';
import { RootNavigator } from './src/navigation/RootNavigator';

// Hold the native splash until Inter has loaded, so no frame renders in a
// fallback face — weight carries the hierarchy in this design system.
void SplashScreen.preventAutoHideAsync();

export default function App() {
  const [fontsLoaded, fontError] = useAppFonts();

  const onLayout = useCallback(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // Render nothing until fonts resolve; `fontError` still unblocks so a font
  // CDN failure degrades to system faces rather than a permanent blank screen.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <View style={styles.root} onLayout={onLayout}>
        {/* No `backgroundColor`: Android edge-to-edge is forced on from SDK 54 and
            the prop warns. The root View below already paints the mint surface
            behind the translucent bar, so the result is identical. */}
        <StatusBar style="dark" />
        {/* appId routes push notifications to this install specifically. */}
        <AuthProvider appId="PATIENT">
          {/* Location wraps the cart: what is in the basket, and at what price,
              is only meaningful once we know where it is going. */}
          <LocationProvider>
            <CartProvider>
              {/* Outermost of the three so a toast can be raised from anywhere,
                  and draws last so it sits above the navigator. */}
              <ToastProvider>
                <RootNavigator />
              </ToastProvider>
            </CartProvider>
          </LocationProvider>
        </AuthProvider>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
