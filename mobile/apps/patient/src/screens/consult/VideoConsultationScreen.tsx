import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Alert,
  Avatar,
  colors,
  Icon,
  radius,
  spacing,
  Text,
} from '@healthbuddy/shared';

const mmss = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/**
 * Mirrors `video_consultation` / `video_consultation_interface`.
 *
 * This is the call *shell* — controls, timer, participant tiles. No WebRTC
 * transport is wired up yet, so the media surfaces render as placeholders
 * rather than pretending a stream exists.
 */
export const VideoConsultationScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const {
    appointment,
    micOn: initialMic = true,
    cameraOn: initialCamera = true,
    notice,
  } = route.params ?? {};

  const [micOn, setMicOn] = useState(initialMic);
  const [cameraOn, setCameraOn] = useState(initialCamera);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const end = () =>
    Alert.alert('End consultation?', 'The call will be disconnected.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'End call', style: 'destructive', onPress: () => navigation.goBack() },
    ]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.stage}>
        <View style={styles.remote}>
          <Avatar name={appointment?.doctor?.name ?? 'Doctor'} size={104} tint="success" />
          <Text variant="displayBold" color={colors.inverseOnSurface}>
            {appointment?.doctor?.name ?? 'Your doctor'}
          </Text>
          <Text variant="captionSm" color={colors.outlineVariant}>
            {appointment?.doctor?.specialty ?? 'Consultation'}
          </Text>

          <View style={styles.timerPill}>
            <View style={[styles.liveDot, notice ? styles.idleDot : null]} />
            <Text variant="captionSm" weight="medium" color={colors.inverseOnSurface}>
              {notice ? 'Preview' : 'Connected'} · {mmss(seconds)}
            </Text>
          </View>

          {/* Say plainly that there is no stream rather than let the timer
              imply a call is running. */}
          {notice ? (
            <Text variant="captionSm" color={colors.outlineVariant} style={styles.notice}>
              {notice}
            </Text>
          ) : null}
        </View>

        <View style={styles.pip}>
          {cameraOn ? (
            <Avatar name="You" size={44} tint="info" />
          ) : (
            <Icon name="videocam_off" size={22} color={colors.inverseOnSurface} />
          )}
          <Text variant="captionSm" color={colors.inverseOnSurface}>
            You
          </Text>
        </View>

        {/*
          No chat button during the call.

          Messaging here is the follow-up channel, and the server opens that
          thread only once the consultation completes — mid-call there is
          nothing to open. What stood here was a local-only mock that kept a
          patient's messages on the device and delivered none of them, which is
          worse than no button at all when someone is describing a symptom.
        */}
      </View>

      <View style={styles.controls}>
        <Control
          icon={micOn ? 'mic' : 'mic_off'}
          active={micOn}
          onPress={() => setMicOn((v: boolean) => !v)}
          label="Toggle microphone"
        />
        <Control
          icon={cameraOn ? 'videocam' : 'videocam_off'}
          active={cameraOn}
          onPress={() => setCameraOn((v: boolean) => !v)}
          label="Toggle camera"
        />
        <Control
          icon={speakerOn ? 'volume_up' : 'volume-off'}
          active={speakerOn}
          onPress={() => setSpeakerOn((v) => !v)}
          label="Toggle speaker"
        />
        <Control icon="flip_camera_ios" active onPress={() => {}} label="Switch camera" />

        <Pressable onPress={end} style={styles.endButton} accessibilityLabel="End call">
          <Icon name="call_end" size={24} color={colors.onError} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const Control: React.FC<{
  icon: string;
  active: boolean;
  onPress: () => void;
  label: string;
}> = ({ icon, active, onPress, label }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ selected: active }}
    style={[styles.control, !active && styles.controlOff]}
  >
    <Icon name={icon} size={22} color={active ? colors.inverseOnSurface : colors.headingDark} />
  </Pressable>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.inverseSurface },
  stage: { flex: 1, margin: spacing.insetCard, borderRadius: radius.card, overflow: 'hidden' },
  remote: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.base,
    backgroundColor: '#0E2A21',
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.stackMedium,
    marginTop: spacing.insetCard,
    paddingHorizontal: spacing.insetCard,
    paddingVertical: spacing.stackMedium,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  idleDot: { backgroundColor: colors.outlineVariant },
  notice: {
    marginTop: spacing.base,
    paddingHorizontal: spacing.xl,
    textAlign: 'center',
  },
  pip: {
    position: 'absolute',
    top: spacing.insetPage,
    right: spacing.insetPage,
    width: 92,
    height: 124,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.inlineSm,
  },
  chatFab: {
    position: 'absolute',
    left: spacing.insetPage,
    bottom: spacing.insetPage,
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.insetCard,
    paddingVertical: spacing.lg,
  },
  control: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlOff: { backgroundColor: colors.surfaceContainerLowest },
  endButton: {
    width: 60,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
