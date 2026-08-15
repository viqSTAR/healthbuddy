import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Alert,
  Avatar,
  Badge,
  Card,
  colors,
  ErrorState,
  fetchMyAppointments,
  fetchMyProfile,
  ListRow,
  Loading,
  Screen,
  spacing,
  StatTile,
  Text,
  TopBar,
  useAsync,
  useAuth,
} from '@healthbuddy/shared';
import { useLocation } from '../../services/location';

/** Mirrors `profile`: identity hero, stat row, grouped settings, sign-out. */
export const ProfileScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user, signOut } = useAuth();
  const { selected } = useLocation();
  const profile = useAsync(() => fetchMyProfile(), []);
  const appointments = useAsync(() => fetchMyAppointments(), []);

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'You will need to verify your number again to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  const completed = appointments.data?.filter((a) => a.status === 'COMPLETED').length ?? 0;
  const upcoming = appointments.data?.filter((a) => a.status === 'SCHEDULED').length ?? 0;

  return (
    <Screen padded={false} refreshing={profile.refreshing} onRefresh={profile.refresh} bottomInset={spacing.xxl}>
      <TopBar title="Profile" />

      {profile.loading ? (
        <Loading />
      ) : profile.error ? (
        <ErrorState message={profile.error} onRetry={profile.reload} />
      ) : (
        <View style={styles.page}>
          <Card style={styles.hero}>
            <Avatar name={profile.data?.fullName ?? user?.fullName ?? undefined} size={88} tint="success" verified />
            <Text variant="displayBold" color={colors.headingDark} center>
              {profile.data?.fullName ?? 'Health Buddy User'}
            </Text>
            <Text variant="bodyMd" color={colors.captionGray}>
              {profile.data?.user?.phoneNumber ?? user?.phoneNumber}
            </Text>
            <Badge label={user?.role ?? 'PATIENT'} tint="success" icon="verified" />
          </Card>

          <View style={styles.stats}>
            <StatTile value={String(completed)} label="Consultations" />
            <StatTile value={String(upcoming)} label="Upcoming" />
            <StatTile value={profile.data?.bloodGroup ?? '—'} label="Blood group" />
          </View>

          <View style={styles.group}>
            <Text variant="headlineSmMobile" color={colors.headingDark} style={styles.groupTitle}>
              Personal Details
            </Text>
            <Card padded={false}>
              <ListRow
                icon="person"
                title="Full name"
                subtitle={profile.data?.fullName ?? 'Not set'}
                onPress={() => navigation.navigate('EditProfile')}
              />
              <ListRow
                icon="mail"
                iconTint="info"
                title="Email"
                subtitle={profile.data?.email ?? 'Not set'}
                onPress={() => navigation.navigate('EditProfile')}
              />
              <ListRow
                icon="bloodtype"
                iconTint="danger"
                title="Blood group"
                subtitle={profile.data?.bloodGroup ?? 'Not set'}
                onPress={() => navigation.navigate('EditProfile')}
              />
              <ListRow
                icon="location_on"
                iconTint="warning"
                title="Address"
                /*
                 * The address book is the truth, not the legacy free-text field
                 * on the patient row. This said "Not set" to people with a
                 * default address saved and orders already delivered to it,
                 * because it was reading the one place the app stopped writing.
                 */
                subtitle={
                  selected
                    ? [selected.line1, selected.city, selected.pincode].filter(Boolean).join(', ')
                    : (profile.data?.address ?? 'Not set')
                }
                onPress={() => navigation.navigate('AddressBook')}
                last
              />
            </Card>
          </View>

          <View style={styles.group}>
            <Text variant="headlineSmMobile" color={colors.headingDark} style={styles.groupTitle}>
              Health
            </Text>
            <Card padded={false}>
              <ListRow
                icon="description"
                title="Medical records"
                subtitle="Visits, prescriptions and reports"
                onPress={() => navigation.navigate('Records')}
              />
              <ListRow
                icon="receipt_long"
                iconTint="info"
                title="My orders"
                subtitle="Medicines and lab tests"
                onPress={() => navigation.navigate('Orders')}
              />
              <ListRow
                icon="emergency"
                iconTint="danger"
                title="Emergency contact"
                subtitle={profile.data?.emergencyContact ?? 'Not set'}
                onPress={() => navigation.navigate('EditProfile')}
                last
              />
            </Card>
          </View>

          <View style={styles.group}>
            <Text variant="headlineSmMobile" color={colors.headingDark} style={styles.groupTitle}>
              General
            </Text>
            <Card padded={false}>
              <ListRow icon="notifications" title="Notifications" onPress={() => {}} />
              <ListRow icon="shield" iconTint="info" title="Security & Privacy" onPress={() => {}} />
              <ListRow icon="help" iconTint="neutral" title="Help Center" onPress={() => {}} last />
            </Card>
          </View>

          <Card padded={false} background={colors.dangerLight}>
            <ListRow
              icon="logout"
              title="Sign out"
              danger
              showChevron={false}
              onPress={confirmSignOut}
              last
            />
          </Card>
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.lg },
  hero: { alignItems: 'center', gap: spacing.base, paddingVertical: spacing.xl },
  stats: { flexDirection: 'row', gap: spacing.insetCard },
  group: { gap: spacing.base },
  groupTitle: { marginLeft: spacing.inlineSm },
});
