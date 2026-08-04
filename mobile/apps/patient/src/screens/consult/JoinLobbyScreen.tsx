import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  Screen,
  Text,
  TopBar,
  colors,
  radius,
  spacing,
} from '@healthbuddy/shared';

/** Mirrors `join_meeting_lobby`: preview tile, device toggles, join CTA. */
export const JoinLobbyScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { appointment } = route.params ?? {};
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);

  return (
    <Screen padded={false} bottomInset={spacing.xxl}>
      <TopBar title="Join Consultation" onBack={navigation.goBack} />

      <View style={styles.page}>
        <View style={styles.preview}>
          {cameraOn ? (
            <Avatar name="You" size={88} tint="success" />
          ) : (
            <View style={styles.cameraOff}>
              <Icon name="videocam_off" size={32} color={colors.inverseOnSurface} />
              <Text variant="captionSm" color={colors.inverseOnSurface}>
                Camera is off
              </Text>
            </View>
          )}

          <View style={styles.previewControls}>
            <Toggle
              active={micOn}
              onPress={() => setMicOn((v) => !v)}
              onIcon="mic"
              offIcon="mic_off"
              label="Microphone"
            />
            <Toggle
              active={cameraOn}
              onPress={() => setCameraOn((v) => !v)}
              onIcon="videocam"
              offIcon="videocam_off"
              label="Camera"
            />
          </View>
        </View>

        <Card style={styles.details}>
          <Badge label="Ready to join" tint="success" icon="check_circle" />
          <Text variant="headlineSmMobile" color={colors.headingDark}>
            {appointment?.doctor?.name ?? 'Your consultation'}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {appointment?.doctor?.specialty ?? 'Video visit'}
            {appointment?.slot ? ` · ${appointment.slot.date} at ${appointment.slot.startTime}` : ''}
          </Text>

          {appointment?.meetingRoomId ? (
            <View style={styles.roomRow}>
              <Icon name="meeting_room" size={16} color={colors.primary} />
              <Text variant="captionSm" weight="medium" color={colors.primary} numberOfLines={1}>
                Room {appointment.meetingRoomId.slice(-8)}
              </Text>
            </View>
          ) : null}
        </Card>

        <Card background={colors.infoLight} style={styles.tip}>
          <Icon name="info" size={18} color={colors.secondary} />
          <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
            Find a quiet, well-lit spot. Your doctor will be notified once you join.
          </Text>
        </Card>

        <Button
          label="Join now"
          icon="videocam"
          fullWidth
          onPress={() =>
            navigation.replace('VideoConsultation', { appointment, micOn, cameraOn })
          }
        />
      </View>
    </Screen>
  );
};

const Toggle: React.FC<{
  active: boolean;
  onPress: () => void;
  onIcon: string;
  offIcon: string;
  label: string;
}> = ({ active, onPress, onIcon, offIcon, label }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="switch"
    accessibilityState={{ checked: active }}
    accessibilityLabel={label}
    style={[styles.toggle, !active && styles.toggleOff]}
  >
    <Icon
      name={active ? onIcon : offIcon}
      size={22}
      color={active ? colors.headingDark : colors.onError}
    />
  </Pressable>
);

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.insetPage },
  preview: {
    height: 320,
    borderRadius: radius.card,
    backgroundColor: colors.inverseSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraOff: { alignItems: 'center', gap: spacing.base },
  previewControls: {
    position: 'absolute',
    bottom: spacing.insetPage,
    flexDirection: 'row',
    gap: spacing.insetPage,
  },
  toggle: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOff: { backgroundColor: colors.error },
  details: { gap: spacing.base },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.stackMedium },
  tip: { flexDirection: 'row', gap: spacing.insetCard, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
