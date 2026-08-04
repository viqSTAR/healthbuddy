import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Switch } from 'react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  ListRow,
  Loading,
  Screen,
  SectionHeader,
  Text,
  TopBar,
  colors,
  errorMessage,
  fetchMyDoctorProfile,
  spacing,
  updateMyDoctorProfile,
  useAsync,
  useAuth,
} from '@healthbuddy/shared';

export const ProfileScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { signOut } = useAuth();
  const profile = useAsync(fetchMyDoctorProfile, []);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    consultationFee: '',
    about: '',
    languages: '',
    clinicAddress: '',
  });

  useEffect(() => {
    if (!profile.data) return;
    setForm({
      consultationFee: profile.data.consultationFee?.toString() ?? '',
      about: profile.data.about ?? '',
      languages: profile.data.languages ?? '',
      clinicAddress: profile.data.clinicAddress ?? '',
    });
  }, [profile.data]);

  const save = async () => {
    setSaving(true);
    try {
      await updateMyDoctorProfile({
        consultationFee: Number(form.consultationFee) || 0,
        about: form.about,
        languages: form.languages,
        clinicAddress: form.clinicAddress,
      });
      profile.reload();
      setEditing(false);
    } catch (err) {
      Alert.alert('Could not save', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailability = async (isAvailable: boolean) => {
    // Optimistic: flipping this is the most frequent action on the screen and
    // waiting on a round trip makes the switch feel broken.
    profile.setData((prev) => ({ ...prev!, isAvailable }));
    try {
      await updateMyDoctorProfile({ isAvailable });
    } catch (err) {
      profile.setData((prev) => ({ ...prev!, isAvailable: !isAvailable }));
      Alert.alert('Could not update', errorMessage(err));
    }
  };

  if (profile.loading) return <Loading label="Loading profile" />;
  if (profile.error) return <ErrorState message={profile.error} onRetry={profile.reload} />;

  const doctor = profile.data!;

  return (
    <Screen scroll refreshing={profile.refreshing} onRefresh={profile.refresh}>
      <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

      <Card style={styles.header}>
        <Avatar name={doctor.name} size={64} />
        <View style={styles.flex}>
          <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
            {doctor.name}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {doctor.qualification ?? doctor.specialty}
          </Text>
          {doctor.verifiedAt ? (
            <View style={styles.badgeRow}>
              <Badge label="Verified practitioner" tint="success" icon="verified" />
            </View>
          ) : null}
        </View>
      </Card>

      <Card style={styles.availability}>
        <View style={styles.flex}>
          <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
            Accepting bookings
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            Turn this off to hide your remaining slots from patients.
          </Text>
        </View>
        <Switch
          value={doctor.isAvailable}
          onValueChange={(v) => void toggleAvailability(v)}
          trackColor={{ true: colors.primary, false: colors.outlineVariant }}
          thumbColor={colors.surfaceContainerLowest}
        />
      </Card>

      <SectionHeader
        title="Practice details"
        actionLabel={editing ? 'Cancel' : 'Edit'}
        onActionPress={() => setEditing((e) => !e)}
      />

      {editing ? (
        <Card style={styles.form}>
          <Input
            label="Consultation fee (₹)"
            icon="payments"
            value={form.consultationFee}
            onChangeText={(v) => setForm((f) => ({ ...f, consultationFee: v }))}
            keyboardType="decimal-pad"
          />
          <Input
            label="Languages"
            icon="translate"
            placeholder="English, Hindi, Marathi"
            value={form.languages}
            onChangeText={(v) => setForm((f) => ({ ...f, languages: v }))}
          />
          <Input
            label="Clinic address"
            icon="location_on"
            value={form.clinicAddress}
            onChangeText={(v) => setForm((f) => ({ ...f, clinicAddress: v }))}
            multiline
          />
          <Input
            label="About"
            icon="info"
            placeholder="A short introduction patients will see."
            value={form.about}
            onChangeText={(v) => setForm((f) => ({ ...f, about: v }))}
            multiline
          />
          <Button label="Save changes" onPress={() => void save()} loading={saving} fullWidth />
        </Card>
      ) : (
        <Card padded={false}>
          <ListRow icon="payments" title="Consultation fee" value={`₹${doctor.consultationFee}`} />
          <ListRow icon="medical_services" title="Specialty" value={doctor.specialty} />
          <ListRow
            icon="timeline"
            title="Experience"
            value={`${doctor.experienceYears} years`}
          />
          <ListRow icon="translate" title="Languages" value={doctor.languages ?? '—'} />
          {/*
            Registration number and council are read-only: they were verified at
            approval and are stamped onto every prescription. Changing them is an
            admin action, not a profile edit.
          */}
          <ListRow
            icon="badge"
            title="Council registration"
            value={doctor.councilRegistrationNumber ?? '—'}
          />
          <ListRow icon="account_balance" title="Council" value={doctor.councilName ?? '—'} last />
        </Card>
      )}

      <SectionHeader title="Account" />
      <Card padded={false}>
        <ListRow
          icon="calendar_month"
          iconTint="info"
          title="Manage availability"
          onPress={() => navigation.navigate('Schedule')}
          showChevron
        />
        <ListRow
          icon="notifications"
          iconTint="warning"
          title="Notifications"
          onPress={() => navigation.navigate('Notifications')}
          showChevron
        />
        <ListRow
          icon="logout"
          title="Sign out"
          danger
          onPress={() =>
            Alert.alert('Sign out', 'Sign out of Health Buddy?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
            ])
          }
          last
        />
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  badgeRow: { flexDirection: 'row', marginTop: spacing.base },
  availability: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    marginTop: spacing.insetCard,
  },
  form: { gap: spacing.insetPage },
});
