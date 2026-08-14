import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  Icon,
  QuickAction,
  Screen,
  SearchBar,
  SectionHeader,
  Text,
  TopBar,
  colors,
  fetchDoctors,
  fetchMyAppointments,
  radius,
  spacing,
  useAsync,
  useAuth,
  type Appointment,
} from '@healthbuddy/shared';
import { DoctorTile } from '../../components/DoctorCard';
import { LocationChip } from '../../components/LocationChip';

const CATEGORIES = [
  { label: 'Physician', icon: 'stethoscope', tint: 'success' as const, specialty: 'General Physician' },
  { label: 'Pediatrician', icon: 'child_care', tint: 'info' as const, specialty: 'Pediatrician' },
  { label: 'Dermatology', icon: 'face', tint: 'warning' as const, specialty: 'Dermatologist' },
  { label: 'Cardiology', icon: 'monitor_heart', tint: 'danger' as const, specialty: 'Cardiologist' },
];

const formatSlot = (appointment: Appointment) => {
  if (!appointment.slot) return 'Scheduled';
  const today = new Date().toISOString().slice(0, 10);
  const day = appointment.slot.date === today ? 'Today' : appointment.slot.date;
  return `${day}, ${appointment.slot.startTime}`;
};

/** Mirrors the `home_screen` reference, top to bottom. */
export const HomeScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const doctors = useAsync(() => fetchDoctors(), []);
  const appointments = useAsync(() => fetchMyAppointments(), []);

  const upcoming = appointments.data?.find((a) => a.status === 'SCHEDULED') ?? null;
  const topDoctor = doctors.data?.doctors[0] ?? null;

  const refreshing = doctors.refreshing || appointments.refreshing;
  const onRefresh = () => {
    doctors.refresh();
    appointments.refresh();
  };

  return (
    <Screen
      scroll
      padded={false}
      refreshing={refreshing}
      onRefresh={onRefresh}
      bottomInset={spacing.xxl}
    >
      <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

      {/* Directly under the brand bar, matching the store: the delivery address
          is context for everything below it, not a setting. */}
      <View style={styles.locationWrap}>
        <LocationChip onPress={() => navigation.navigate('AddressBook')} />
      </View>

      <View style={styles.page}>
        <SearchBar onSubmit={() => navigation.navigate('Doctors')} />

        <View style={styles.quickActions}>
          <QuickAction
            icon="calendar_month"
            label="Book consultation"
            tint="success"
            onPress={() => navigation.navigate('Doctors')}
          />
          <QuickAction
            icon="pill"
            label="Medicines"
            tint="info"
            onPress={() => navigation.navigate('Pharmacy')}
          />
          <QuickAction
            icon="biotech"
            label="Lab tests"
            tint="warning"
            onPress={() => navigation.navigate('Labs')}
          />
          <QuickAction
            icon="emergency"
            label="Emergency"
            tint="danger"
            onPress={() => navigation.navigate('Emergency')}
          />
        </View>

        {upcoming ? (
          <Card style={styles.appointmentCard}>
            <View style={styles.appointmentHead}>
              <Text variant="captionSm" weight="medium" color={colors.primary} uppercase>
                Upcoming Appointment
              </Text>
              <Badge label={formatSlot(upcoming)} tint="info" icon="schedule" />
            </View>

            <View style={styles.appointmentBody}>
              <Avatar name={upcoming.doctor?.name} size={42} tint="success" />
              <View style={styles.appointmentText}>
                <Text variant="headlineSmMobile" color={colors.headingDark} numberOfLines={1}>
                  {upcoming.doctor?.name ?? 'Your doctor'}
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  {upcoming.doctor?.specialty ?? 'Consultation'} ·{' '}
                  {upcoming.type === 'VIDEO' ? 'Video visit' : 'In-person'}
                </Text>
              </View>
              <Button
                label="Join"
                icon="videocam"
                size="sm"
                onPress={() =>
                  navigation.navigate('JoinLobby', { appointmentId: upcoming.id })
                }
              />
            </View>
          </Card>
        ) : (
          <Card style={styles.appointmentCard}>
            <Text variant="captionSm" weight="medium" color={colors.primary} uppercase>
              No upcoming appointment
            </Text>
            <View style={styles.appointmentBody}>
              <View style={styles.emptyIcon}>
                <Icon name="event_available" size={22} color={colors.primary} />
              </View>
              <View style={styles.appointmentText}>
                <Text variant="headlineSmMobile" color={colors.headingDark}>
                  Book a consultation
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  Talk to a verified doctor today
                </Text>
              </View>
              <Button label="Find" size="sm" onPress={() => navigation.navigate('Doctors')} />
            </View>
          </Card>
        )}

        <View>
          <SectionHeader
            title="Categories"
            actionLabel="See all"
            onActionPress={() => navigation.navigate('Doctors')}
          />
          <ChipRow>
            {CATEGORIES.map((c) => (
              <Chip
                key={c.label}
                label={c.label}
                icon={c.icon}
                tint={c.tint}
                onPress={() => navigation.navigate('Doctors', { specialty: c.specialty })}
              />
            ))}
          </ChipRow>
        </View>

        <View style={styles.bento}>
          {topDoctor ? (
            <DoctorTile
              doctor={topDoctor}
              onPress={() => navigation.navigate('DoctorProfile', { doctorId: topDoctor.id })}
            />
          ) : (
            <Card size="cardSm" padding={spacing.insetCard} style={styles.flex} />
          )}

          <Card
            size="cardSm"
            padding={spacing.insetCard}
            background={colors.infoLight}
            style={styles.tipCard}
          >
            <View style={styles.tipIcon}>
              <Icon name="water_drop" size={20} color={colors.secondary} />
            </View>
            <View>
              <Text variant="labelMd" weight="medium" color={colors.headingDark}>
                Hydration check
              </Text>
              <Text variant="captionSm" color={colors.onSurfaceVariant}>
                Small sips all day help.
              </Text>
            </View>
          </Card>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroOverlay}>
            <Text variant="captionSm" weight="bold" color={colors.onPrimary} uppercase>
              Healthcare Today
            </Text>
            <Text variant="headlineSm" color={colors.onPrimary}>
              Personalized Health Journey
            </Text>
          </View>
        </View>

        {user?.fullName ? (
          <Text variant="captionSm" color={colors.captionGray} center>
            Signed in as {user.fullName}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  locationWrap: { paddingHorizontal: spacing.insetPage, paddingBottom: spacing.insetCard },
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.xl },
  quickActions: { flexDirection: 'row', gap: spacing.base },
  appointmentCard: { gap: spacing.insetPage },
  appointmentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  appointmentBody: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  appointmentText: { flex: 1, gap: spacing.stackTight },
  emptyIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bento: { flexDirection: 'row', gap: spacing.insetPage },
  flex: { flex: 1 },
  tipCard: { flex: 1, gap: spacing.base },
  tipIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    height: 192,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceDim,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  heroOverlay: {
    padding: spacing.insetPage,
    backgroundColor: 'rgba(7, 32, 24, 0.55)',
    gap: spacing.stackTight,
  },
});
