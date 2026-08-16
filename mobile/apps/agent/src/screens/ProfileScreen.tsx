import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  colors,
  ErrorState,
  errorMessage,
  fetchMyAgentProfile,
  Icon,
  Input,
  ListRow,
  Loading,
  radius,
  Screen,
  SectionHeader,
  spacing,
  Text,
  TopBar,
  updateMyAgentProfile,
  useAsync,
  useAuth,
} from '@healthbuddy/shared';

const PINCODE = /^[1-9][0-9]{5}$/;

export const ProfileScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user, signOut } = useAuth();
  const profile = useAsync(fetchMyAgentProfile, []);
  const [pincode, setPincode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const save = async (pincodes: string[]) => {
    setSaving(true);
    try {
      const updated = await updateMyAgentProfile({ pincodes });
      profile.setData(updated);
      setPincode('');
      setError(undefined);
    } catch (err) {
      Alert.alert('Could not save', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const addArea = () => {
    const value = pincode.trim();
    if (!PINCODE.test(value)) {
      setError('Enter a valid 6-digit pincode.');
      return;
    }
    const current = profile.data?.serviceAreas ?? [];
    if (current.includes(value)) {
      setError('That area is already on your list.');
      return;
    }
    void save([...current, value]);
  };

  const removeArea = (area: string) => {
    const current = profile.data?.serviceAreas ?? [];
    // The pool is bounded by this list, so emptying it would silently stop all
    // work rather than widening it.
    if (current.length === 1) {
      Alert.alert('Keep at least one area', 'Without an area there are no jobs to offer you.');
      return;
    }
    void save(current.filter((a) => a !== area));
  };

  if (profile.loading) return <Loading label="Loading your profile" />;
  if (profile.error || !profile.data) {
    return <ErrorState message={profile.error ?? 'Profile unavailable.'} onRetry={profile.reload} />;
  }

  const agent = profile.data;

  return (
    <Screen scroll refreshing={profile.refreshing} onRefresh={profile.refresh}>
      <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

      <Card style={styles.header}>
        <View style={styles.iconBox}>
          <Icon name="two_wheeler" size={28} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
            {agent.name}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            Delivery agent · {user?.phoneNumber}
          </Text>
          <View style={styles.badges}>
            {agent.verifiedAt ? (
              <Badge label="Verified" tint="success" icon="verified" />
            ) : (
              <Badge label="Being verified" tint="warning" icon="hourglass_top" />
            )}
            <Badge
              label={agent.isAvailable ? 'On shift' : 'Off shift'}
              tint={agent.isAvailable ? 'info' : 'neutral'}
            />
            {/* Sample work is an entitlement, so it is worth showing plainly. */}
            {agent.labPartner ? <Badge label="Sample collection" tint="info" icon="science" /> : null}
          </View>
        </View>
      </Card>

      {agent.labPartner ? (
        <Card style={styles.row}>
          <Icon name="science" size={18} color={colors.primary} />
          <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
            You collect samples for {agent.labPartner.name}. Those jobs are assigned to you by the
            lab rather than picked from the pool.
          </Text>
        </Card>
      ) : null}

      <SectionHeader title="Your details" />
      <Card padded={false}>
        <ListRow icon="person" title="Name" value={agent.name} />
        <ListRow icon="two_wheeler" title="Vehicle" value={agent.vehicleNumber ?? '—'} last />
      </Card>

      <SectionHeader title="Where you deliver" />
      <Card style={styles.form}>
        <View style={styles.areas}>
          {agent.serviceAreas.map((area) => (
            <Chip key={area} label={area} selected onPress={() => removeArea(area)} />
          ))}
        </View>
        <Text variant="captionSm" color={colors.captionGray}>
          Tap an area to remove it. Only parcels going to these areas are offered to you.
        </Text>

        <Input
          label="Add an area"
          icon="location_on"
          placeholder="400058"
          value={pincode}
          onChangeText={(t) => {
            setPincode(t);
            setError(undefined);
          }}
          keyboardType="number-pad"
          maxLength={6}
          error={error}
        />
        <Button
          label="Add area"
          icon="add"
          variant="outline"
          loading={saving}
          onPress={addArea}
          fullWidth
        />
      </Card>

      <SectionHeader title="Account" />
      <Card padded={false}>
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
            Alert.alert('Sign out', 'Sign out of Health Buddy Agent?', [
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
  iconBox: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.stackMedium, marginTop: spacing.base },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.insetCard },
  form: { gap: spacing.insetPage },
  areas: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.stackMedium },
});
