import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  errorMessage,
  Icon,
  Input,
  Loading,
  Screen,
  Text,
  TopBar,
  checkServiceability,
  colors,
  createAddress,
  deleteAddress,
  radius,
  setDefaultAddress,
  spacing,
  updateAddress,
  type Address,
  type AddressDraft,
  type AddressLabel,
} from '@healthbuddy/shared';
import { useLocation } from '../../services/location';

const LABELS: { value: AddressLabel; text: string; icon: string }[] = [
  { value: 'HOME', text: 'Home', icon: 'home' },
  { value: 'WORK', text: 'Work', icon: 'work' },
  { value: 'OTHER', text: 'Other', icon: 'location_on' },
];

const emptyDraft: AddressDraft = { label: 'HOME', line1: '', pincode: '' };

/**
 * The address book, and the picker.
 *
 * One screen rather than two because they are the same task: people open this
 * to switch where they are shopping from, and adding a new address is just the
 * case where the one they want is not in the list yet.
 */
export const AddressBookScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { addresses, selected, select, refresh, loading, locate, locating, locateError } =
    useLocation();

  const [editing, setEditing] = useState<Address | null>(null);
  const [draft, setDraft] = useState<AddressDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Checked as the pincode is typed, so a dead end is visible before saving. */
  const [pincodeNote, setPincodeNote] = useState<string | null>(null);
  const [pincodeOk, setPincodeOk] = useState<boolean | null>(null);

  const openNew = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setPincodeNote(null);
    setPincodeOk(null);
    setError(null);
  };

  const openEdit = (address: Address) => {
    setEditing(address);
    setDraft({
      label: address.label,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      landmark: address.landmark,
    });
    setPincodeNote(null);
    setPincodeOk(null);
    setError(null);
  };

  const close = () => {
    setDraft(null);
    setEditing(null);
  };

  const onPincode = useCallback((value: string) => {
    const pincode = value.replace(/[^0-9]/g, '').slice(0, 6);
    setDraft((d) => (d ? { ...d, pincode } : d));

    if (pincode.length < 6) {
      setPincodeNote(null);
      setPincodeOk(null);
      return;
    }

    void (async () => {
      try {
        const result = await checkServiceability(pincode);
        setPincodeOk(result.serviceable);
        setPincodeNote(
          result.serviceable
            ? `Delivering in ${result.city ?? 'this area'}${result.expressAvailable ? ' · express available' : ''}`
            : "We don't deliver here yet. You can still save it for consultations."
        );
      } catch {
        // A failed check must not block saving — the order path checks again.
        setPincodeNote(null);
        setPincodeOk(null);
      }
    })();
  }, []);

  const useMyLocation = async () => {
    const found = await locate();
    if (!found) return;

    setDraft((d) => ({
      ...(d ?? emptyDraft),
      ...(found.line1 ? { line1: found.line1 } : {}),
      ...(found.city ? { city: found.city } : {}),
      ...(found.state ? { state: found.state } : {}),
      latitude: found.latitude,
      longitude: found.longitude,
    }));

    if (found.pincode) onPincode(found.pincode);
  };

  const save = async () => {
    if (!draft) return;

    if (draft.line1.trim().length < 3) {
      setError('Enter the house and street.');
      return;
    }
    if (!/^[1-9][0-9]{5}$/.test(draft.pincode)) {
      setError('Enter a valid 6-digit pincode.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      if (editing) await updateAddress(editing.id, draft);
      else await createAddress(draft);
      await refresh();
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = (address: Address) => {
    Alert.alert('Remove this address?', [address.line1, address.city].filter(Boolean).join(', '), [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAddress(address.id);
            await refresh();
          } catch (err) {
            Alert.alert('Could not remove it', errorMessage(err));
          }
        },
      },
    ]);
  };

  const makeDefault = async (address: Address) => {
    try {
      await setDefaultAddress(address.id);
      await refresh();
    } catch (err) {
      Alert.alert('Could not set the default', errorMessage(err));
    }
  };

  const choose = (address: Address) => {
    select(address);
    navigation.goBack();
  };

  if (draft) {
    return (
      <Screen scroll={false}>
        <TopBar title={editing ? 'Edit address' : 'New address'} onBack={close} />
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Button
            label={locating ? 'Finding you…' : 'Use my current location'}
            variant="secondary"
            icon="my_location"
            loading={locating}
            onPress={useMyLocation}
          />
          {locateError ? (
            <Text variant="captionSm" color={colors.error}>
              {locateError}
            </Text>
          ) : null}

          <ChipRow>
            {LABELS.map((l) => (
              <Chip
                key={l.value}
                label={l.text}
                selected={draft.label === l.value}
                onPress={() => setDraft({ ...draft, label: l.value })}
              />
            ))}
          </ChipRow>

          <Input
            label="House / flat and street"
            icon="home"
            value={draft.line1}
            onChangeText={(line1) => setDraft({ ...draft, line1 })}
            placeholder="12 Lokhandwala Road"
          />
          <Input
            label="Area (optional)"
            icon="map"
            value={draft.line2 ?? ''}
            onChangeText={(line2) => setDraft({ ...draft, line2 })}
            placeholder="Andheri West"
          />
          <Input
            label="Landmark (optional)"
            icon="push_pin"
            value={draft.landmark ?? ''}
            onChangeText={(landmark) => setDraft({ ...draft, landmark })}
            placeholder="Opposite the metro station"
          />

          <View style={styles.row}>
            <Input
              containerStyle={styles.flex}
              label="City"
              icon="location_city"
              value={draft.city ?? ''}
              onChangeText={(city) => setDraft({ ...draft, city })}
            />
            <Input
              containerStyle={styles.flex}
              label="State"
              icon="public"
              value={draft.state ?? ''}
              onChangeText={(state) => setDraft({ ...draft, state })}
            />
          </View>

          <Input
            label="Pincode"
            icon="pin_drop"
            value={draft.pincode}
            onChangeText={onPincode}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="400058"
            {...(pincodeNote
              ? pincodeOk
                ? { hint: pincodeNote }
                : { error: pincodeNote }
              : {})}
          />

          {error ? (
            <Text variant="captionSm" color={colors.error}>
              {error}
            </Text>
          ) : null}

          <Button label="Save address" onPress={save} loading={saving} />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <TopBar title="Delivery address" onBack={navigation.goBack} />

      {loading && addresses.length === 0 ? (
        <Loading />
      ) : addresses.length === 0 ? (
        <EmptyState
          icon="location_off"
          title="No saved addresses"
          message="Add one so we can show what's available near you."
          actionLabel="Add an address"
          onActionPress={openNew}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {addresses.map((address) => {
            const isSelected = selected?.id === address.id;
            return (
              <Card key={address.id} style={isSelected ? styles.cardSelected : undefined}>
                <Pressable onPress={() => choose(address)} style={styles.cardHead}>
                  <Icon
                    name={LABELS.find((l) => l.value === address.label)?.icon ?? 'location_on'}
                    size={20}
                    color={isSelected ? colors.primary : colors.captionGray}
                  />
                  <View style={styles.flex}>
                    <View style={styles.topRow}>
                      <Text variant="labelMd" weight="semibold" color={colors.headingDark}>
                        {LABELS.find((l) => l.value === address.label)?.text ?? 'Saved'}
                      </Text>
                      {address.isDefault ? <Badge label="Default" emphasis="verified" /> : null}
                      {isSelected ? <Badge label="Selected" /> : null}
                    </View>
                    <Text variant="captionSm" color={colors.captionGray}>
                      {[address.line1, address.line2, address.city, address.pincode]
                        .filter(Boolean)
                        .join(', ')}
                    </Text>
                  </View>
                </Pressable>

                <View style={styles.actions}>
                  {!address.isDefault ? (
                    <Pressable onPress={() => makeDefault(address)} hitSlop={8}>
                      <Text variant="captionSm" weight="medium" color={colors.primary}>
                        Set as default
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => openEdit(address)} hitSlop={8}>
                    <Text variant="captionSm" weight="medium" color={colors.primary}>
                      Edit
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => remove(address)} hitSlop={8}>
                    <Text variant="captionSm" weight="medium" color={colors.error}>
                      Remove
                    </Text>
                  </Pressable>
                </View>
              </Card>
            );
          })}

          <Button label="Add another address" variant="secondary" icon="add" onPress={openNew} />
        </ScrollView>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  list: { padding: spacing.insetPage, gap: spacing.insetCard, paddingBottom: spacing.xxl },
  form: { padding: spacing.insetPage, gap: spacing.insetCard, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', gap: spacing.insetCard },
  flex: { flex: 1 },
  cardSelected: { borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.card },
  cardHead: { flexDirection: 'row', gap: spacing.insetCard, alignItems: 'flex-start' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base, flexWrap: 'wrap' },
  actions: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.insetCard,
    paddingTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHigh,
  },
});
