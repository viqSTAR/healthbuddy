import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import {
  Alert,
  Button,
  Card,
  colors,
  errorMessage,
  ErrorState,
  fetchMyProfile,
  Input,
  Loading,
  radius,
  Screen,
  spacing,
  Text,
  TopBar,
  updateMyProfile,
  useAsync,
} from '@healthbuddy/shared';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;

export const EditProfileScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { data, loading, error, reload } = useAsync(() => fetchMyProfile(), []);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<string | null>(null);
  const [bloodGroup, setBloodGroup] = useState<string | null>(null);
  const [emergencyContact, setEmergencyContact] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setFullName(data.fullName ?? '');
    setEmail(data.email ?? '');
    setAge(data.age != null ? String(data.age) : '');
    setGender(data.gender ?? null);
    setBloodGroup(data.bloodGroup ?? null);
    setEmergencyContact(data.emergencyContact ?? '');
    setAddress(data.address ?? '');
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      // Send only the whitelisted fields the API accepts; empty strings become
      // null so a cleared field actually clears server-side.
      await updateMyProfile({
        fullName: fullName.trim() || undefined,
        email: email.trim() || null,
        age: age.trim() ? Number(age) : null,
        gender: (gender as any) ?? null,
        bloodGroup: (bloodGroup as any) ?? null,
        emergencyContact: emergencyContact.trim() || null,
        address: address.trim() || null,
      });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <TopBar title="Edit Profile" onBack={navigation.goBack} />
        <Loading />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen scroll={false}>
        <TopBar title="Edit Profile" onBack={navigation.goBack} />
        <ErrorState message={error} onRetry={reload} />
      </Screen>
    );
  }

  return (
    <Screen padded={false} bottomInset={spacing.xxl}>
      <TopBar title="Edit Profile" onBack={navigation.goBack} />

      <View style={styles.page}>
        <Card style={styles.group}>
          <Input label="Full name" icon="person" value={fullName} onChangeText={setFullName} maxLength={120} />
          <Input
            label="Email"
            icon="mail"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Input
            label="Age"
            icon="cake"
            value={age}
            onChangeText={(t) => setAge(t.replace(/\D/g, '').slice(0, 3))}
            keyboardType="number-pad"
          />
        </Card>

        <Card style={styles.group}>
          <Text variant="bodyMd" weight="medium" color={colors.onSurfaceVariant}>
            Gender
          </Text>
          <View style={styles.optionRow}>
            {GENDERS.map((g) => (
              <Option key={g} label={g[0] + g.slice(1).toLowerCase()} selected={gender === g} onPress={() => setGender(gender === g ? null : g)} />
            ))}
          </View>

          <Text variant="bodyMd" weight="medium" color={colors.onSurfaceVariant}>
            Blood group
          </Text>
          <View style={styles.optionRow}>
            {BLOOD_GROUPS.map((b) => (
              <Option key={b} label={b} selected={bloodGroup === b} onPress={() => setBloodGroup(bloodGroup === b ? null : b)} />
            ))}
          </View>
        </Card>

        <Card style={styles.group}>
          <Input
            label="Emergency contact"
            icon="emergency"
            value={emergencyContact}
            onChangeText={setEmergencyContact}
            keyboardType="phone-pad"
            maxLength={20}
          />
          <Input label="Address" icon="location_on" value={address} onChangeText={setAddress} maxLength={300} />
        </Card>

        <Button label="Save changes" fullWidth loading={saving} onPress={save} />
      </View>
    </Screen>
  );
};

const Option: React.FC<{ label: string; selected: boolean; onPress: () => void }> = ({
  label,
  selected,
  onPress,
}) => (
  <Pressable onPress={onPress} style={[styles.option, selected && styles.optionActive]}>
    <Text variant="labelMd" weight="medium" color={selected ? colors.onPrimary : colors.onSurfaceVariant}>
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.insetPage },
  group: { gap: spacing.insetPage },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.base },
  option: {
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
  },
  optionActive: { backgroundColor: colors.primary },
});
