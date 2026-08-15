import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Loading,
  Screen,
  SectionHeader,
  StatTile,
  StatusPill,
  Text,
  TopBar,
  colors,
  fetchDoctorQueue,
  fetchMyDoctorProfile,
  radius,
  spacing,
  useAsync,
  type Appointment,
} from '@healthbuddy/shared';

const today = () => new Date().toISOString().slice(0, 10);

/** Upcoming first, then by time — a doctor reads this list top-down all day. */
const byWhen = (a: Appointment, b: Appointment) =>
  `${a.slot?.date ?? ''}${a.slot?.startTime ?? ''}`.localeCompare(
    `${b.slot?.date ?? ''}${b.slot?.startTime ?? ''}`
  );

export const DashboardScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const profile = useAsync(fetchMyDoctorProfile, []);
  const queue = useAsync(fetchDoctorQueue, []);

  const { todays, upcoming, completedToday } = useMemo(() => {
    const all = queue.data ?? [];
    const date = today();
    const active = all.filter((a) => a.status === 'SCHEDULED' || a.status === 'IN_PROGRESS');

    return {
      todays: active.filter((a) => a.slot?.date === date).sort(byWhen),
      upcoming: active.filter((a) => (a.slot?.date ?? '') > date).sort(byWhen),
      completedToday: all.filter((a) => a.status === 'COMPLETED' && a.slot?.date === date).length,
    };
  }, [queue.data]);

  if (queue.loading || profile.loading) return <Loading label="Loading your day" />;
  if (queue.error) return <ErrorState message={queue.error} onRetry={queue.reload} />;

  const doctor = profile.data;

  return (
    <Screen scroll refreshing={queue.refreshing} onRefresh={queue.refresh}>
      <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

      <Card style={styles.greeting}>
        <Avatar name={doctor?.name ?? 'Doctor'} size={52} />
        <View style={styles.flex}>
          <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
            {doctor?.name ?? 'Doctor'}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {doctor?.specialty}
            {doctor?.councilRegistrationNumber ? ` · ${doctor.councilRegistrationNumber}` : ''}
          </Text>
        </View>
        {doctor?.verifiedAt ? <Badge label="Verified" tint="success" icon="verified" /> : null}
      </Card>

      <View style={styles.stats}>
        <StatTile value={String(todays.length)} label="Today" icon="event" emphasis />
        <StatTile value={String(completedToday)} label="Completed" icon="task_alt" />
        <StatTile value={String(upcoming.length)} label="Upcoming" icon="schedule" />
      </View>

      <SectionHeader
        title="Today's consultations"
        actionLabel="Manage availability"
        onActionPress={() => navigation.navigate('Schedule')}
      />

      {todays.length === 0 ? (
        <EmptyState
          icon="event_available"
          title="Nothing booked today"
          message="Open more slots so patients can find you."
          actionLabel="Set availability"
          onActionPress={() => navigation.navigate('Schedule')}
        />
      ) : (
        <View style={styles.list}>
          {todays.map((appointment) => (
            <AppointmentRow
              key={appointment.id}
              appointment={appointment}
              onPress={() => navigation.navigate('Consultation', { appointmentId: appointment.id })}
            />
          ))}
        </View>
      )}

      {upcoming.length > 0 ? (
        <>
          <SectionHeader title="Coming up" />
          <View style={styles.list}>
            {upcoming.slice(0, 5).map((appointment) => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                onPress={() =>
                  navigation.navigate('Consultation', { appointmentId: appointment.id })
                }
              />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
};

const AppointmentRow: React.FC<{ appointment: Appointment; onPress: () => void }> = ({
  appointment,
  onPress,
}) => (
  <Card onPress={onPress} style={styles.row}>
    <View style={styles.time}>
      <Text variant="labelMd" weight="bold" color={colors.primary}>
        {appointment.slot?.startTime ?? '--:--'}
      </Text>
      <Text variant="captionSm" color={colors.captionGray}>
        {appointment.slot?.date?.slice(5) ?? ''}
      </Text>
    </View>

    <View style={styles.flex}>
      <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
        {appointment.patient?.fullName ?? 'Patient'}
      </Text>
      <Text variant="captionSm" color={colors.captionGray} numberOfLines={1}>
        {appointment.symptoms || 'No symptoms noted'}
      </Text>
      <View style={styles.tags}>
        <Badge
          label={appointment.type === 'VIDEO' ? 'Video' : 'In person'}
          tint={appointment.type === 'VIDEO' ? 'info' : 'neutral'}
          icon={appointment.type === 'VIDEO' ? 'videocam' : 'location_on'}
        />
        {/* Follow-up status changes which drug lists may be prescribed. */}
        <Badge
          label={appointment.isFollowUp ? 'Follow-up' : 'First consult'}
          tint={appointment.isFollowUp ? 'success' : 'warning'}
        />
        <StatusPill status={appointment.status} />
      </View>
    </View>

    <Icon name="chevron_right" size={20} color={colors.captionGray} />
  </Card>
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  greeting: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  stats: { flexDirection: 'row', gap: spacing.insetCard, marginVertical: spacing.insetPage },
  list: { gap: spacing.insetCard },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  time: {
    width: 56,
    alignItems: 'center',
    paddingVertical: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.stackMedium, marginTop: spacing.base },
});
