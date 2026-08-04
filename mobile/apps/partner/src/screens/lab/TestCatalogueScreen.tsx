import React, { useState } from 'react';
import { View, StyleSheet, Alert, Modal, Pressable } from 'react-native';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  Loading,
  Screen,
  SearchBar,
  SectionHeader,
  Text,
  TopBar,
  colors,
  errorMessage,
  fetchLabOfferings,
  fetchLabPackages,
  radius,
  removeLabOffering,
  spacing,
  upsertLabOffering,
  useAsync,
  type LabPackage,
} from '@healthbuddy/shared';

/**
 * The tests this lab offers, and what it charges for them.
 *
 * Prices are per lab — the catalogue price is only a reference — so two labs
 * can compete on the same test, which is what the patient-facing comparison
 * relies on.
 */
export const TestCatalogueScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const offerings = useAsync(
    () => fetchLabOfferings({ search: search.trim() || undefined, limit: 100 }),
    [search]
  );

  const remove = (labPackageId: string, name: string) => {
    Alert.alert('Remove test', `Stop offering ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeLabOffering(labPackageId);
            offerings.reload();
          } catch (err) {
            Alert.alert('Could not remove', errorMessage(err));
          }
        },
      },
    ]);
  };

  if (offerings.loading) return <Loading label="Loading your tests" />;
  if (offerings.error) return <ErrorState message={offerings.error} onRetry={offerings.reload} />;

  const items = offerings.data?.items ?? [];

  return (
    <>
      <Screen scroll refreshing={offerings.refreshing} onRefresh={offerings.refresh}>
        <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

        <SearchBar value={search} onChangeText={setSearch} placeholder="Search your tests" />

        <SectionHeader
          title={`Tests offered (${items.length})`}
          actionLabel="Add test"
          onActionPress={() => setAdding(true)}
        />

        {items.length === 0 ? (
          <EmptyState
            icon="science"
            title="No tests listed"
            message="Add tests from the catalogue and set your own pricing."
            actionLabel="Add test"
            onActionPress={() => setAdding(true)}
          />
        ) : (
          <View style={styles.list}>
            {items.map((offering) => (
              <Card key={offering.id} style={styles.row}>
                <View style={styles.flex}>
                  <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                    {offering.labPackage.testName}
                  </Text>
                  <Text variant="captionSm" color={colors.captionGray}>
                    {offering.labPackage.sampleType} · {offering.turnaroundHours}h turnaround
                  </Text>
                  <View style={styles.tags}>
                    {offering.labPackage.fastingReq ? (
                      <Badge label="Fasting" tint="warning" icon="no_food" />
                    ) : null}
                    {offering.homeCollectionFee > 0 ? (
                      <Badge label={`+₹${offering.homeCollectionFee} collection`} tint="info" />
                    ) : (
                      <Badge label="Free collection" tint="success" />
                    )}
                  </View>
                </View>

                <View style={styles.priceBlock}>
                  <Text variant="headlineSm" weight="bold" color={colors.primary}>
                    ₹{offering.price}
                  </Text>
                  <Pressable
                    onPress={() => remove(offering.labPackageId, offering.labPackage.testName)}
                    hitSlop={8}
                  >
                    <Icon name="delete" size={18} color={colors.error} />
                  </Pressable>
                </View>
              </Card>
            ))}
          </View>
        )}
      </Screen>

      <AddTestSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          offerings.reload();
        }}
      />
    </>
  );
};

const AddTestSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
}> = ({ visible, onClose, onAdded }) => {
  const catalogue = useAsync(
    () => (visible ? fetchLabPackages() : Promise.resolve(null)),
    [visible]
  );

  const [selected, setSelected] = useState<LabPackage | null>(null);
  const [price, setPrice] = useState('');
  const [collectionFee, setCollectionFee] = useState('0');
  const [turnaround, setTurnaround] = useState('24');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await upsertLabOffering({
        labPackageId: selected.id,
        price: Number(price) || selected.price,
        homeCollectionFee: Number(collectionFee) || 0,
        turnaroundHours: Number(turnaround) || 24,
      });
      setSelected(null);
      onAdded();
    } catch (err) {
      Alert.alert('Could not add test', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen scroll>
        <TopBar title="Add a test" onBack={onClose} />

        {selected ? (
          <Card style={styles.form}>
            <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
              {selected.testName}
            </Text>
            <Text variant="captionSm" color={colors.captionGray}>
              {selected.category} · {selected.sampleType}
            </Text>

            <Input
              label="Your price (₹)"
              icon="payments"
              value={price}
              onChangeText={setPrice}
              placeholder={String(selected.price)}
              keyboardType="decimal-pad"
            />
            <Input
              label="Home collection fee (₹)"
              icon="home_pin"
              value={collectionFee}
              onChangeText={setCollectionFee}
              keyboardType="decimal-pad"
              hint="Set 0 to advertise free collection."
            />
            <Input
              label="Turnaround (hours)"
              icon="schedule"
              value={turnaround}
              onChangeText={setTurnaround}
              keyboardType="number-pad"
            />

            <View style={styles.formActions}>
              <Button
                label="Back"
                variant="outline"
                onPress={() => setSelected(null)}
                style={styles.flex}
              />
              <Button
                label="Add test"
                onPress={() => void save()}
                loading={saving}
                style={styles.flex}
              />
            </View>
          </Card>
        ) : catalogue.loading ? (
          <Loading />
        ) : (
          <View style={styles.list}>
            {(catalogue.data?.packages ?? []).map((pkg) => (
              <Pressable
                key={pkg.id}
                onPress={() => {
                  setSelected(pkg);
                  setPrice(String(pkg.price));
                }}
                style={({ pressed }) => [styles.catalogueRow, pressed && styles.pressed]}
              >
                <View style={styles.flex}>
                  <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                    {pkg.testName}
                  </Text>
                  <Text variant="captionSm" color={colors.captionGray}>
                    {pkg.category} · reference ₹{pkg.price}
                  </Text>
                </View>
                <Icon name="add_circle" size={20} color={colors.primary} />
              </Pressable>
            ))}
          </View>
        )}
      </Screen>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.insetCard },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.stackMedium, marginTop: spacing.base },
  priceBlock: { alignItems: 'flex-end', gap: spacing.base },
  form: { gap: spacing.insetPage },
  formActions: { flexDirection: 'row', gap: spacing.insetCard },
  catalogueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    padding: spacing.insetCard,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  pressed: { opacity: 0.8 },
});
