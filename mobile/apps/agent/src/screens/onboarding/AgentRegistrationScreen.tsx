import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Alert,
  Button,
  Card,
  Chip,
  colors,
  errorMessage,
  Icon,
  Input,
  registerAgent,
  Screen,
  SectionHeader,
  spacing,
  Text,
  TopBar,
} from '@healthbuddy/shared';

const PINCODE = /^[1-9][0-9]{5}$/;

/**
 * Signing up to carry jobs.
 *
 * Areas are declared rather than taken from the phone's position: where
 * somebody happens to be standing when they install the app says nothing about
 * how far they are willing to ride. It is also the only thing that bounds the
 * pool, so an agent with no areas is not "available everywhere" — they are not
 * set up yet, and the form insists on at least one.
 */
export const AgentRegistrationScreen: React.FC<{ onRegistered: () => void }> = ({
  onRegistered,
}) => {
  const [name, setName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [pincode, setPincode] = useState('');
  const [areas, setAreas] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ name?: string; pincode?: string }>({});
  const [saving, setSaving] = useState(false);

  const addArea = () => {
    const value = pincode.trim();
    if (!PINCODE.test(value)) {
      setErrors((e) => ({ ...e, pincode: 'Enter a valid 6-digit pincode.' }));
      return;
    }
    if (areas.includes(value)) {
      setErrors((e) => ({ ...e, pincode: 'That area is already on the list.' }));
      return;
    }
    setAreas((prev) => [...prev, value]);
    setPincode('');
    setErrors((e) => ({ ...e, pincode: undefined }));
  };

  const submit = async () => {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Enter your full name.';
    if (areas.length === 0) next.pincode = 'Add at least one area you will travel to.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      await registerAgent({
        name: name.trim(),
        ...(vehicle.trim() ? { vehicleNumber: vehicle.trim() } : {}),
        pincodes: areas,
      });
      onRegistered();
    } catch (err) {
      Alert.alert('Could not register', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll>
      <TopBar title="Set up your account" />

      <Card style={styles.intro}>
        <Icon name="two_wheeler" size={22} color={colors.primary} />
        <View style={styles.flex}>
          <Text variant="labelMd" weight="bold" color={colors.headingDark}>
            Carry jobs near you
          </Text>
          <Text variant="captionSm" color={colors.onSurfaceVariant}>
            Tell us where you ride. You will only be offered parcels going to those areas.
          </Text>
        </View>
      </Card>

      <SectionHeader title="About you" />
      <Card style={styles.form}>
        <Input
          label="Full name"
          icon="person"
          placeholder="As printed on your ID"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setErrors((e) => ({ ...e, name: undefined }));
          }}
          error={errors.name}
        />
        <Input
          label="Vehicle number (optional)"
          icon="two_wheeler"
          placeholder="MH 01 AB 1234"
          value={vehicle}
          onChangeText={setVehicle}
          autoCapitalize="characters"
        />
      </Card>

      <SectionHeader title="Where you deliver" />
      <Card style={styles.form}>
        <Input
          label="Add a pincode"
          icon="location_on"
          placeholder="400058"
          value={pincode}
          onChangeText={(t) => {
            setPincode(t);
            setErrors((e) => ({ ...e, pincode: undefined }));
          }}
          keyboardType="number-pad"
          maxLength={6}
          error={errors.pincode}
          hint={errors.pincode ? undefined : 'Add every area you are happy to ride to.'}
        />
        <Button label="Add area" icon="add" variant="outline" onPress={addArea} fullWidth />

        {areas.length > 0 ? (
          <View style={styles.areas}>
            {areas.map((area) => (
              <Chip
                key={area}
                label={area}
                selected
                onPress={() => setAreas((prev) => prev.filter((a) => a !== area))}
              />
            ))}
          </View>
        ) : null}
        {areas.length > 0 ? (
          <Text variant="captionSm" color={colors.captionGray}>
            Tap an area to remove it.
          </Text>
        ) : null}
      </Card>

      <Card background={colors.warningLight} style={styles.notice}>
        <Icon name="verified_user" size={20} color={colors.warningDark} />
        <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
          Your account is checked before you can take jobs — a job shows you someone&apos;s home
          address, so we verify who is asking first.
        </Text>
      </Card>

      <Button
        label="Create my account"
        onPress={() => void submit()}
        loading={saving}
        fullWidth
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.insetCard },
  form: { gap: spacing.insetPage },
  areas: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.stackMedium },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.insetCard,
    marginVertical: spacing.insetPage,
  },
});
