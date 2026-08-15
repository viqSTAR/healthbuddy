import { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, colors, useAppFonts } from '@healthbuddy/shared';

import { RootNavigator } from './src/navigation/RootNavigator';

// Hold the native splash until Inter has loaded, so no frame renders in a
// fallback face — weight carries the hierarchy in this design system.
void SplashScreen.preventAutoHideAsync();

export default function App() {
  const [fontsLoaded, fontError] = useAppFonts();

  const onLayout = useCallback(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <View style={styles.root} onLayout={onLayout}>
        {/* No `backgroundColor`: Android edge-to-edge is forced on from SDK 54 and
            the prop warns. The root View below already paints the mint surface
            behind the translucent bar, so the result is identical. */}
        <StatusBar style="dark" />
        <AuthProvider appId="PARTNER">
          <RootNavigator />
        </AuthProvider>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
