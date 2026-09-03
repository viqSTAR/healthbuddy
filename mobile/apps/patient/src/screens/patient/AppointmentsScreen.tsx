import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  colors,
  EmptyState,
  ErrorState,
  errorMessage,
  Loading,
  Screen,
  spacing,
  Text,
  TopBar,
  useAsync,
  cancelAppointment,
  fetchMyAppointments,
  type Appointment,
} from '@healthbuddy/shared';

/**
 * A patient's consultations, and the ability to call one off.
 *
 * Cancelling had a route, a service that frees the slot and issues a refund,
 * and a client function — and no screen anywhere that called it. So a patient
 * who could not attend had no way to say so: the slot stayed booked, the doctor
 * waited, and the money stayed taken. The backend was complete and the feature
 * did not exist.
 *
 * Appointments were previously visible only as a count on Home and Profile,
 * which is enough to know you have one and not enough to do anything about it.
 */

type Filter = 'upcoming' | 'past' | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

const STATUS_TINT = {
  SCHEDULED: 'info',
  IN_PROGRESS: 'success',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
} as const;

const when = (appointment: Appointment) => {
  if (!appointment.slot) return 'Time to be confirmed';
  const today = new Date().toISOString().slice(0, 10);
  const day = appointment.slot.date === today ? 'Today' : appointment.slot.date;
  return `${day} · ${appointment.slot.startTime}`;
};

/**
 * Whether this consultation is still ahead.
 *
 * Compared on the slot's own date and time rather than `createdAt`: an
 * appointment booked last week for tomorrow is upcoming, and one booked an hour
 * ago for this morning is not.
 */
const isUpcoming = (appointment: Appointment) => {
  if (appointment.status === 'CANCELLED' || appointment.status === 'COMPLETED') return false;
  if (!appointment.slot) return true;
  return `${appointment.slot.date} ${appointment.slot.startTime}` >= new Date()
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
};

export const AppointmentsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const appointments = useAsync(() => fetchMyAppointments(), []);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [cancelling, setCancelling] = useState<string | null>(null);

  const confirmCancel = (appointment: Appointment) => {
    Alert.alert(
      'Cancel this consultation?',
      `${appointment.doctor?.name ?? 'Your doctor'} — ${when(appointment)}.\n\n` +
        'The slot is released for someone else and anything you paid is refunded.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel it',
          style: 'destructive',
          onPress: async () => {
            setCancelling(appointment.id);
            try {
              await cancelAppointment(appointment.id);
              appointments.reload();
            } catch (err) {
              Alert.alert('Could not cancel', errorMessage(err));
            } finally {
              setCancelling(null);
            }
          },
        },
      ]
    );
  };

  const all = appointments.data ?? [];
  const shown = all.filter((a) =>
    filter === 'all' ? true : filter === 'upcoming' ? isUpcoming(a) : !isUpcoming(a)
  );

  return (
    <Screen
      padded={false}
      refreshing={appointments.refreshing}
      onRefresh={appointments.refresh}
      bottomInset={spacing.xxl}
    >
      <TopBar title="My consultations" onBack={() => navigation.goBack()} />

      <View style={styles.filters}>
        <ChipRow>
          {FILTERS.map((f) => (
            <Chip
              key={f.value}
              label={f.label}
              selected={filter === f.value}
              onPress={() => setFilter(f.value)}
            />
          ))}
        </ChipRow>
      </View>

      {appointments.loading ? (
        <Loading />
      ) : appointments.error ? (
        <ErrorState message={appointments.error} onRetry={appointments.reload} />
      ) : shown.length === 0 ? (
        <EmptyState
          title={filter === 'upcoming' ? 'Nothing booked' : 'Nothing here yet'}
          message={
            filter === 'upcoming'
              ? 'When you book a consultation it will appear here.'
              : 'Your past consultations will appear here.'
          }
        />
      ) : (
        <View style={styles.list}>
          {shown.map((appointment) => {
            const upcoming = isUpcoming(appointment);

            return (
              <Card key={appointment.id} style={styles.card}>
                <View style={styles.head}>
                  <View style={styles.headText}>
                    <Text variant="labelMd" numberOfLines={1}>
                      {appointment.doctor?.name ?? 'Doctor'}
                    </Text>
                    <Text variant="captionSm" style={styles.muted}>
                      {appointment.doctor?.specialty ?? ''}
                    </Text>
                  </View>
                  <Badge
                    label={appointment.status.replace('_', ' ')}
                    tint={STATUS_TINT[appointment.status]}
                  />
                </View>

                <View style={styles.meta}>
                  <Badge label={when(appointment)} tint="info" icon="schedule" />
                  <Badge
                    label={appointment.type === 'VIDEO' ? 'Video' : 'In person'}
                    tint="neutral"
                    icon={appointment.type === 'VIDEO' ? 'videocam' : 'local_hospital'}
                  />
                  {appointment.isFollowUp ? <Badge label="Follow-up" tint="success" /> : null}
                </View>

                {appointment.symptoms ? (
                  <Text variant="captionSm" style={styles.muted} numberOfLines={2}>
                    {appointment.symptoms}
                  </Text>
                ) : null}

                <View style={styles.actions}>
                  {/*
                    Joining is only offered for video consultations that are
                    actually live — the server enforces a join window either way,
                    and a button that reliably fails is worse than no button.
                  */}
                  {upcoming && appointment.type === 'VIDEO' ? (
                    <Button
                      label="Join"
                      size="sm"
                      onPress={() =>
                        navigation.navigate('JoinLobby', { appointmentId: appointment.id })
                      }
                    />
                  ) : null}

                  {appointment.status === 'COMPLETED' ? (
                    <Button
                      label="View visit"
                      size="sm"
                      variant="outline"
                      onPress={() => navigation.navigate('VisitDetail', { id: appointment.id })}
                    />
                  ) : null}

                  {upcoming ? (
                    <Button
                      label={cancelling === appointment.id ? 'Cancelling…' : 'Cancel'}
                      size="sm"
                      variant="ghost"
                      disabled={cancelling === appointment.id}
                      onPress={() => confirmCancel(appointment)}
                    />
                  ) : null}
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  filters: { paddingHorizontal: spacing.lg, paddingTop: spacing.insetCard },
  list: { padding: spacing.lg, gap: spacing.insetCard },
  card: { gap: spacing.base },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.base },
  headText: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.inlineSm },
  muted: { color: colors.onSurfaceVariant },
  actions: { flexDirection: 'row', gap: spacing.base, marginTop: spacing.inlineSm },
});
