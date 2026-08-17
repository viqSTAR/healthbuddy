import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  colors,
  endConsultation,
  errorMessage,
  ErrorState,
  fetchDoctorQueue,
  Icon,
  ListRow,
  Loading,
  Screen,
  SectionHeader,
  spacing,
  StatusPill,
  Text,
  TopBar,
  useAsync,
} from '@healthbuddy/shared';

/**
 * The consultation record a doctor works from: who the patient is, what they
 * reported, and the two things that decide prescribing scope — whether this is
 * a video consult and whether it is a follow-up.
 */
export const ConsultationScreen: React.FC<{ route: any; navigation: any }> = ({
  route,
  navigation,
}) => {
  const { appointmentId } = route.params as { appointmentId: string };

  const queue = useAsync(fetchDoctorQueue, []);
  const appointment = (queue.data ?? []).find((a) => a.id === appointmentId);


  /**
   * The doctor opening the room is what starts the consultation, so the join
   * call also flips the appointment to in progress server-side. That happens
   * on the call screen rather than here, so a grant is not spent by a tap that
   * then fails to reach the room.
   *
   * The room used to open in the system browser; it now runs inside the app,
   * with the browser kept as a fallback on the call screen itself.
   */
  const startCall = () => {
    navigation.navigate('VideoCall', {
      appointmentId,
      counterpartName: appointment?.patient?.fullName,
    });
  };

  const endCall = () =>
    Alert.alert('End this consultation?', 'It will be marked completed.', [
      { text: 'Keep open', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: async () => {
          try {
            await endConsultation(appointmentId);
            queue.reload();
          } catch (err) {
            Alert.alert('Could not end it', errorMessage(err));
          }
        },
      },
    ]);

  if (queue.loading) return <Loading label="Loading consultation" />;
  if (queue.error) return <ErrorState message={queue.error} onRetry={queue.reload} />;
  if (!appointment) {
    return <ErrorState message="This appointment is no longer in your queue." />;
  }

  const isVideo = appointment.type === 'VIDEO';
  const canPrescribe = appointment.status !== 'CANCELLED' && appointment.status !== 'COMPLETED';

  return (
    <Screen scroll refreshing={queue.refreshing} onRefresh={queue.refresh}>
      <TopBar title="Consultation" onBack={() => navigation.goBack()} />

      <Card style={styles.patient}>
        <Avatar name={appointment.patient?.fullName ?? 'Patient'} size={56} />
        <View style={styles.flex}>
          <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
            {appointment.patient?.fullName ?? 'Patient'}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {appointment.slot?.date} · {appointment.slot?.startTime}–{appointment.slot?.endTime}
          </Text>
        </View>
        <StatusPill status={appointment.status} />
      </Card>

      {/*
        Surfaced prominently because these two facts determine which drug lists
        are available downstream — the doctor should not discover the constraint
        only when a prescription is refused.
      */}
      <Card
        background={appointment.isFollowUp ? colors.successLight : colors.warningLight}
        style={styles.context}
      >
        <Icon
          name={appointment.isFollowUp ? 'event_repeat' : 'fiber_new'}
          size={20}
          color={appointment.isFollowUp ? colors.successDark : colors.warningDark}
        />
        <View style={styles.flex}>
          <Text
            variant="labelMd"
            weight="bold"
            color={appointment.isFollowUp ? colors.successDark : colors.warningDark}
          >
            {appointment.isFollowUp ? 'Follow-up consultation' : 'First consultation'}
            {isVideo ? ' · Video' : ' · In person'}
          </Text>
          <Text variant="captionSm" color={colors.onSurface}>
            {appointment.isFollowUp
              ? 'List O, A and B medicines are available.'
              : isVideo
                ? 'List O and A medicines are available. List B needs a follow-up.'
                : 'In-person consultation — telemedicine drug lists do not apply.'}
          </Text>
        </View>
      </Card>

      <SectionHeader title="Reported symptoms" />
      <Card>
        <Text variant="bodyMd" color={colors.onSurface}>
          {appointment.symptoms || 'The patient did not describe any symptoms when booking.'}
        </Text>
      </Card>

      {isVideo && canPrescribe ? (
        <>
          <SectionHeader title="Video consultation" />
          <Card style={styles.videoCard}>
            <View style={styles.roomRow}>
              <Icon name="videocam" size={20} color={colors.primary} />
              <View style={styles.flex}>
                <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                  {appointment.slot?.startTime
                    ? `Scheduled for ${appointment.slot.startTime}`
                    : 'Video visit'}
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  Starting the call marks this consultation in progress.
                </Text>
              </View>
            </View>

            <Button
              label="Start video consultation"
              icon="videocam"
              onPress={startCall}
              fullWidth
            />
            <Button
              label="End consultation"
              icon="call_end"
              variant="outline"
              onPress={endCall}
              fullWidth
            />
          </Card>
        </>
      ) : null}

      <SectionHeader title="Actions" />
      <Card padded={false}>
        <ListRow
          icon="prescriptions"
          iconTint="success"
          title="Write prescription"
          subtitle={
            canPrescribe
              ? 'Diagnosis, medicines and advice'
              : 'This consultation is already closed'
          }
          onPress={
            canPrescribe
              ? () => navigation.navigate('Prescribe', { appointmentId: appointment.id })
              : undefined
          }
          showChevron={canPrescribe}
        />
        <ListRow
          icon="history"
          iconTint="info"
          title="Consultation type"
          value={isVideo ? 'Video' : 'In person'}
          last
        />
      </Card>

      {appointment.status === 'COMPLETED' ? (
        <View style={styles.done}>
          <Badge label="Prescription issued" tint="success" icon="check_circle" />
        </View>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  patient: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  context: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.insetCard,
    marginTop: spacing.insetCard,
  },
  videoCard: { gap: spacing.insetPage },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  done: { alignItems: 'center', marginTop: spacing.insetPage },
});
