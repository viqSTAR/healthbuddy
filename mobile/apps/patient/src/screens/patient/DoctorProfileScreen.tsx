import React from 'react';
import { View, StyleSheet } from 'react-native';
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
  StatTile,
  Text,
  TopBar,
  colors,
  fetchDoctor,
  radius,
  spacing,
  useAsync,
} from '@healthbuddy/shared';

/** Mirrors `doctor_profile_1`: hero card, stat row, detail groups, sticky CTA. */
export const DoctorProfileScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { doctorId } = route.params;
  const { data: doctor, loading, error, reload } = useAsync(() => fetchDoctor(doctorId), [doctorId]);

  if (loading) {
    return (
      <Screen scroll={false}>
        <TopBar title="Doctor" onBack={navigation.goBack} />
        <Loading />
      </Screen>
    );
  }

  if (error || !doctor) {
    return (
      <Screen scroll={false}>
        <TopBar title="Doctor" onBack={navigation.goBack} />
        <ErrorState message={error ?? 'Doctor not found.'} onRetry={reload} />
      </Screen>
    );
  }

  return (
    <>
      <Screen padded={false} bottomInset={100}>
        <TopBar title="Doctor Profile" onBack={navigation.goBack} />

        <View style={styles.page}>
          <Card style={styles.hero}>
            <Avatar name={doctor.name} size={96} tint="success" verified />
            <Text variant="displayBold" color={colors.headingDark} center>
              {doctor.name}
            </Text>
            <Text variant="bodyMd" color={colors.captionGray} center>
              {doctor.specialty}
            </Text>
            <Badge label="Verified Professional" icon="verified" tint="success" />
          </Card>

          <View style={styles.stats}>
            <StatTile value={`${doctor.experienceYears}+`} label="Exp. Years" />
            <StatTile value={doctor.rating.toFixed(1)} label="Rating" icon="star" />
            <StatTile value={`$${doctor.consultationFee.toFixed(0)}`} label="Per session" />
          </View>

          <View style={styles.group}>
            <Text variant="headlineSmMobile" color={colors.headingDark} style={styles.groupTitle}>
              Professional Details
            </Text>
            <Card padded={false}>
              <ListRow
                icon="school"
                title="Qualifications"
                subtitle="MD, MBBS, Board Certified"
                showChevron={false}
              />
              <ListRow
                icon="stethoscope"
                title="Specialization"
                subtitle={doctor.specialty}
                showChevron={false}
              />
              <ListRow
                icon="hospital_building"
                iconTint="info"
                title="Clinic"
                subtitle={doctor.clinicAddress ?? 'Health Buddy Network'}
                showChevron={false}
                last
              />
            </Card>
          </View>

          <View style={styles.group}>
            <Text variant="headlineSmMobile" color={colors.headingDark} style={styles.groupTitle}>
              Consultation
            </Text>
            <Card padded={false}>
              <ListRow
                icon="payments"
                title="Consultation Fee"
                subtitle={`$${doctor.consultationFee.toFixed(2)} per session`}
                showChevron={false}
              />
              <ListRow
                icon="calendar_month"
                title="Availability"
                subtitle={doctor.isAvailable ? 'Accepting appointments' : 'Currently unavailable'}
                showChevron={false}
              />
              <ListRow
                icon="videocam"
                iconTint="info"
                title="Service Types"
                subtitle="Video & in-person enabled"
                showChevron={false}
                last
              />
            </Card>
          </View>

          <Card background={colors.infoLight} style={styles.note}>
            <Icon name="info" size={18} color={colors.secondary} />
            <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
              Consultations are end-to-end scheduled through Health Buddy. You'll get a video room
              link once your booking is confirmed.
            </Text>
          </Card>
        </View>
      </Screen>

      <View style={styles.footer}>
        <Button
          label={`Book Consultation · $${doctor.consultationFee.toFixed(2)}`}
          fullWidth
          disabled={!doctor.isAvailable}
          onPress={() => navigation.navigate('BookConsultation', { doctorId: doctor.id })}
        />
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.lg },
  hero: { alignItems: 'center', gap: spacing.base, paddingVertical: spacing.xl },
  stats: { flexDirection: 'row', gap: spacing.insetCard },
  group: { gap: spacing.base },
  groupTitle: { marginLeft: spacing.inlineSm },
  note: { flexDirection: 'row', gap: spacing.insetCard, alignItems: 'flex-start' },
  flex: { flex: 1 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.insetPage,
    paddingBottom: spacing.xl,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
});
