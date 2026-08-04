import React from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorState,
  Icon,
  ListRow,
  Loading,
  Screen,
  SectionHeader,
  StatusPill,
  Text,
  TopBar,
  colors,
  fetchDoctorQueue,
  spacing,
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

      {isVideo && appointment.meetingRoomId ? (
        <>
          <SectionHeader title="Video consultation" />
          <Card style={styles.videoCard}>
            <View style={styles.roomRow}>
              <Icon name="videocam" size={20} color={colors.primary} />
              <View style={styles.flex}>
                <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                  Room {appointment.meetingRoomId.slice(-8)}
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  Video calling is not yet connected to a media server.
                </Text>
              </View>
            </View>
            {/*
              Deliberately honest rather than a fake "Join" button: there is no
              WebRTC transport wired up yet, so the room id is shown and a phone
              fallback offered instead of pretending to place a call.
            */}
            <Button
              label="Call patient instead"
              icon="call"
              variant="outline"
              onPress={() => void Linking.openURL('tel:')}
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
