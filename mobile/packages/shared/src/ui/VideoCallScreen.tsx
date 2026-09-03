import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Text } from './Text';
import { Icon } from './Icon';
import { Button } from './Button';
import { Alert } from '../services/alert';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/typography';
import { errorMessage } from '../services/api';
import { joinConsultation, endConsultation, type VideoSession } from '../services/endpoints';

/**
 * The consultation itself.
 *
 * The room runs in a WebView rather than a native SDK, because a native WebRTC
 * module needs a development build and this has to work in Expo Go. The URL is
 * the one the server issues — a 128-bit room name handed out only inside the
 * window around the booked slot — so this screen never decides who may join;
 * it only renders what it was given.
 *
 * What replaced what: there used to be a call *shell* here — controls, a
 * timer, participant tiles, and no transport at all. It looked like a call and
 * connected nobody. A screen that says "Connected" while carrying no media is
 * worse than one that admits it has none, so the shell is gone and the two
 * honest states remain: a real room, or a plain statement that no transport is
 * configured.
 */

type Phase = 'joining' | 'live' | 'unavailable' | 'error';

/*
 * Camera and microphone are requested by the WebView, not here.
 *
 * This screen used to ask for them itself with PermissionsAndroid before
 * loading the room. Inside Expo Go that promise never settled — the grants
 * were already held, and the screen sat on "Checking camera and microphone"
 * forever. The WebView asks for exactly what the page needs at the moment it
 * needs it, which is one fewer thing to get wrong and the same prompt for the
 * user either way.
 */

export interface VideoCallScreenProps {
  navigation: any;
  /** `route.params.appointmentId` is required. */
  route: any;
  role: 'PATIENT' | 'DOCTOR';
}

export const VideoCallScreen: React.FC<VideoCallScreenProps> = ({ navigation, route, role }) => {
  const { appointmentId, counterpartName } = (route.params ?? {}) as {
    appointmentId: string;
    counterpartName?: string;
  };

  const [phase, setPhase] = useState<Phase>('joining');
  const [session, setSession] = useState<VideoSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [ending, setEnding] = useState(false);
  const webRef = useRef<WebView>(null);
  const mounted = useRef(true);
  /** Set once the exit has been agreed, so the guard below stands aside. */
  const leaving = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    setPhase('joining');
    setError(null);
    try {
      const next = await joinConsultation(appointmentId);
      if (!mounted.current) return;
      setSession(next);
      // No URL means no transport is configured. Say so rather than render an
      // empty room that looks like a failed call.
      setPhase(next.url ? 'live' : 'unavailable');
    } catch (err) {
      if (!mounted.current) return;
      // The server refuses early joins and lapsed windows with a reason worth
      // showing verbatim — "opens at 10:00" beats "could not join".
      setError(errorMessage(err));
      setPhase('error');
    }
  }, [appointmentId]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (phase !== 'live') return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const leave = useCallback(() => {
    // Leaving is not ending. A patient stepping out of the room does not
    // complete the consultation, and neither does a doctor whose connection
    // dropped — only the explicit end below does that.
    navigation.goBack();
  }, [navigation]);

  /**
   * One guard over every way out of a live room.
   *
   * This used to be a `BackHandler` subscription, which only ever fires on
   * Android. iOS has no hardware back button — it has the edge swipe, which the
   * stack navigator enables by default — so the confirmation Android showed
   * simply did not exist there: a patient brushing the left edge dropped out of
   * a consultation mid-sentence, and a doctor could not tell that from someone
   * hanging up.
   *
   * `beforeRemove` sits under all three routes out — the hardware button, the
   * swipe, and the arrow in the call bar — so the two platforms now ask the same
   * question. The screen is left by re-dispatching the very action that was
   * intercepted, which keeps "back" meaning back and "go to Home" meaning Home.
   */
  useEffect(() => {
    if (phase !== 'live') return;

    const unsubscribe = navigation.addListener(
      'beforeRemove',
      (event: { preventDefault: () => void; data: { action: unknown } }) => {
        if (leaving.current) return;
        event.preventDefault();

        Alert.alert('Leave the consultation?', 'You can rejoin while the slot is open.', [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: () => {
              leaving.current = true;
              navigation.dispatch(event.data.action);
            },
          },
        ]);
      }
    );

    return unsubscribe;
  }, [navigation, phase]);

  /** Doctor only: closes the consultation for both sides. */
  const endForEveryone = () =>
    Alert.alert('End this consultation?', 'It will be marked completed for both of you.', [
      { text: 'Keep open', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: async () => {
          setEnding(true);
          try {
            await endConsultation(appointmentId);
            // Already agreed to above — the leave guard has nothing to ask.
            leaving.current = true;
            navigation.goBack();
          } catch (err) {
            Alert.alert('Could not end it', errorMessage(err));
          } finally {
            if (mounted.current) setEnding(false);
          }
        },
      },
    ]);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  if (phase === 'live' && session?.url) {
    return (
      <SafeAreaView style={styles.callSafe} edges={['top', 'bottom']}>
        <View style={styles.callBar}>
          <Pressable onPress={leave} hitSlop={12} accessibilityLabel="Leave call">
            <Icon name="arrow_back" size={22} color={colors.inverseOnSurface} />
          </Pressable>
          <View style={styles.flex}>
            <Text variant="labelMd" weight="semibold" color={colors.inverseOnSurface} numberOfLines={1}>
              {counterpartName ?? (role === 'DOCTOR' ? 'Patient' : 'Your doctor')}
            </Text>
            <Text variant="captionSm" color={colors.outlineVariant}>
              {mmss}
            </Text>
          </View>
          {role === 'DOCTOR' ? (
            <Button
              label="End"
              icon="call_end"
              size="sm"
              variant="danger"
              loading={ending}
              onPress={endForEveryone}
            />
          ) : null}
        </View>

        <WebView
          ref={webRef}
          source={{ uri: session.url }}
          style={styles.web}
          /* Everything below is what makes getUserMedia work inside a WebView. */
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          allowsProtectedMedia
          originWhitelist={['https://*']}
          onError={() => {
            setError('The consultation room could not be loaded.');
            setPhase('error');
          }}
          renderLoading={() => (
            <View style={styles.webLoading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
          startInLoadingState
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        {phase === 'joining' ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text variant="labelMd" weight="semibold" color={colors.headingDark}>
              Opening the room
            </Text>
          </>
        ) : phase === 'unavailable' ? (
          <>
            <View style={styles.iconAnchor}>
              <Icon name="videocam_off" size={34} color={colors.warningDark} />
            </View>
            <Text variant="headlineSm" weight="bold" color={colors.headingDark} center>
              Video is not set up yet
            </Text>
            <Text variant="bodyMd" color={colors.onSurfaceVariant} center>
              {session?.notice ??
                'No video provider is configured on this server, so there is no room to join.'}
            </Text>
            <Button label="Go back" variant="outline" onPress={leave} />
          </>
        ) : (
          <>
            <View style={styles.iconAnchor}>
              <Icon name="error" size={34} color={colors.error} />
            </View>
            <Text variant="headlineSm" weight="bold" color={colors.headingDark} center>
              Cannot join
            </Text>
            <Text variant="bodyMd" color={colors.onSurfaceVariant} center>
              {error}
            </Text>
            <View style={styles.actions}>
              <Button label="Try again" onPress={() => void start()} />
              {/*
                The browser is the fallback rather than the default: it does
                work, and on a device whose WebView cannot get camera access it
                is the difference between a consultation and none.
              */}
              {session?.url ? (
                <Button
                  label="Open in browser"
                  variant="outline"
                  onPress={() => void Linking.openURL(session.url!)}
                />
              ) : null}
              <Button label="Go back" variant="ghost" onPress={leave} />
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.background },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.insetPage,
    paddingHorizontal: spacing.xl,
  },
  iconAnchor: {
    width: 76,
    height: 76,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { gap: spacing.stackMedium, alignSelf: 'stretch' },
  callSafe: { flex: 1, backgroundColor: colors.inverseSurface },
  callBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.insetCard,
  },
  web: { flex: 1, backgroundColor: colors.inverseSurface },
  webLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inverseSurface,
  },
});
