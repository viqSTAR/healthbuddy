import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  Screen,
  Text,
  colors,
  radius,
  spacing,
  type Appointment,
} from '@healthbuddy/shared';

/** Confirmation shown after a successful booking. */
export const AppointmentConfirmedScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const appointment: Appointment = route.params.appointment;

  return (
    <Screen padded={false} bottomInset={spacing.xxl}>
      <View style={styles.page}>
        <View style={styles.successIcon}>
          <Icon name="check_circle" size={56} color={colors.primary} />
        </View>

        <Text variant="displayBold" color={colors.headingDark} center style={styles.title}>
          Appointment Confirmed
        </Text>
        <Text variant="bodyMd" color={colors.captionGray} center>
          We've reserved your slot. You'll get a reminder before it starts.
        </Text>

        <Card style={styles.card}>
          <View style={styles.doctorRow}>
            <Avatar name={appointment.doctor?.name} size={52} tint="success" />
            <View style={styles.flex}>
              <Text variant="headlineSmMobile" color={colors.headingDark}>
                {appointment.doctor?.name}
              </Text>
              <Text variant="captionSm" color={colors.captionGray}>
                {appointment.doctor?.specialty}
              </Text>
            </View>
            <Badge
              label={appointment.type === 'VIDEO' ? 'Video' : 'In person'}
              tint="info"
              icon={appointment.type === 'VIDEO' ? 'videocam' : 'hospital_building'}
            />
          </View>

          <View style={styles.rule} />

          <Row
            icon="calendar_month"
            label="Date"
            value={appointment.slot?.date ?? '—'}
          />
          <Row
            icon="schedule"
            label="Time"
            value={
              appointment.slot ? `${appointment.slot.startTime} – ${appointment.slot.endTime}` : '—'
            }
          />
          <Row
            icon="payments"
            label="Fee"
            value={
              appointment.doctor ? `$${appointment.doctor.consultationFee.toFixed(2)}` : '—'
            }
          />
          {appointment.meetingRoomId ? (
            <Row
              icon="meeting_room"
              label="Room"
              value={appointment.meetingRoomId.slice(-8)}
            />
          ) : null}
        </Card>

        <View style={styles.actions}>
          {appointment.type === 'VIDEO' ? (
            <Button
              label="Join lobby"
              icon="videocam"
              fullWidth
              onPress={() => navigation.replace('JoinLobby', { appointment })}
            />
          ) : null}
          <Button
            label="Back to home"
            variant="outline"
            fullWidth
            onPress={() => navigation.navigate('Tabs', { screen: 'Home' })}
          />
        </View>
      </View>
    </Screen>
  );
};

const Row: React.FC<{ icon: string; label: string; value: string }> = ({ icon, label, value }) => (
  <View style={styles.row}>
    <View style={styles.rowIcon}>
      <Icon name={icon} size={18} color={colors.primary} />
    </View>
    <Text variant="bodyMd" color={colors.onSurfaceVariant} style={styles.flex}>
      {label}
    </Text>
    <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, paddingTop: spacing.xxl, gap: spacing.insetCard },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: radius.full,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.base,
  },
  title: { fontSize: 24, lineHeight: 30 },
  card: { gap: spacing.insetCard, marginTop: spacing.lg },
  doctorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  flex: { flex: 1 },
  rule: { height: 1, backgroundColor: colors.outlineVariant },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.base,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { gap: spacing.insetCard, marginTop: spacing.lg },
});
