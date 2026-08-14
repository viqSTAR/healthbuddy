import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Modal, Pressable } from 'react-native';
import {
  Alert,
  Badge,
  Button,
  Card,
  colors,
  EmptyState,
  errorMessage,
  ErrorState,
  fetchLabOfferings,
  fetchLabPackages,
  fetchTestPrices,
  Icon,
  Input,
  Loading,
  radius,
  removeLabOffering,
  rupees,
  Screen,
  SearchBar,
  SectionHeader,
  spacing,
  Text,
  TopBar,
  upsertLabOffering,
  useAsync,
  type LabPackage,
  type TestPriceBand,
} from '@healthbuddy/shared';

/**
 * The tests this lab can run.
 *
 * Which tests appear here is genuinely the lab's decision — equipment differs,
 * and a lab that cannot run a histopathology panel should not be offered one.
 * What a test *costs* is not: the platform sets one price per test per area, so
 * a patient pays the same wherever the sample goes.
 *
 * That is deliberate. A patient cannot judge sample handling the way they can
 * judge a restaurant, so free price competition on an invisible quality selects
 * for the cheapest handling rather than the best. Labs compete here on
 * turnaround and accreditation instead.
 */
export const TestCatalogueScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const offerings = useAsync(
    () => fetchLabOfferings({ search: search.trim() || undefined, limit: 100 }),
    [search]
  );
  const prices = useAsync(() => fetchTestPrices(), []);

  // The band that applies to this lab is resolved server-side at booking time;
  // here we show every band for the test so the lab can see the area rates.
  const bandsByPackage = useMemo(() => {
    const map = new Map<string, TestPriceBand[]>();
    for (const band of prices.data ?? []) {
      if (!band.isActive) continue;
      map.set(band.labPackageId, [...(map.get(band.labPackageId) ?? []), band]);
    }
    return map;
  }, [prices.data]);

  const remove = (labPackageId: string, name: string) => {
    Alert.alert('Remove test', `Stop offering ${name}? Patients will no longer be routed to you for it.`, [
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

  const toggle = async (labPackageId: string, isActive: boolean) => {
    try {
      await upsertLabOffering({ labPackageId, isActive });
      offerings.reload();
    } catch (err) {
      Alert.alert('Could not update', errorMessage(err));
    }
  };

  if (offerings.loading) return <Loading label="Loading your tests" />;
  if (offerings.error) return <ErrorState message={offerings.error} onRetry={offerings.reload} />;

  const items = offerings.data?.items ?? [];

  return (
    <>
      <Screen scroll refreshing={offerings.refreshing} onRefresh={offerings.refresh}>
        <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

        <SearchBar value={search} onChangeText={setSearch} placeholder="Search your tests" />

        <Card background={colors.infoLight} style={styles.notice}>
          <Icon name="info" size={18} color={colors.secondary} />
          <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
            Prices are set per area by Health Buddy, so every lab in your city quotes the same. You
            choose which tests you can run and how fast you turn them around.
          </Text>
        </Card>

        <SectionHeader
          title={`Tests offered (${items.length})`}
          actionLabel="Add test"
          onActionPress={() => setAdding(true)}
        />

        {items.length === 0 ? (
          <EmptyState
            icon="science"
            title="No tests listed"
            message="Add the tests your lab is equipped to run."
            actionLabel="Add test"
            onActionPress={() => setAdding(true)}
          />
        ) : (
          <View style={styles.list}>
            {items.map((offering) => {
              const bands = bandsByPackage.get(offering.labPackageId) ?? [];
              // Prefer a city band as the illustrative rate; fall back to the
              // broadest one so there is always a number to show.
              const band = bands.find((b) => b.city) ?? bands[0];

              return (
                <Card key={offering.id} style={[styles.row, !offering.isActive && styles.inactive]}>
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
                      {!offering.isActive ? <Badge label="Paused" tint="neutral" /> : null}
                      {band ? <Badge label={band.scope} tint="info" icon="location_on" /> : null}
                    </View>
                  </View>

                  <View style={styles.priceBlock}>
                    <Text variant="headlineSm" weight="bold" color={colors.primary}>
                      {rupees(band?.price ?? offering.labPackage.price)}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      set by area
                    </Text>

                    <View style={styles.rowActions}>
                      <Pressable
                        onPress={() => void toggle(offering.labPackageId, !offering.isActive)}
                        hitSlop={8}
                        accessibilityLabel={offering.isActive ? 'Pause this test' : 'Resume this test'}
                      >
                        <Icon
                          name={offering.isActive ? 'pause_circle' : 'play_circle'}
                          size={20}
                          color={colors.onSurfaceVariant}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => remove(offering.labPackageId, offering.labPackage.testName)}
                        hitSlop={8}
                        accessibilityLabel="Remove this test"
                      >
                        <Icon name="delete" size={18} color={colors.error} />
                      </Pressable>
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </Screen>

      <AddTestSheet
        visible={adding}
        existing={new Set(items.map((i) => i.labPackageId))}
        bandsByPackage={bandsByPackage}
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
  existing: Set<string>;
  bandsByPackage: Map<string, TestPriceBand[]>;
  onClose: () => void;
  onAdded: () => void;
}> = ({ visible, existing, bandsByPackage, onClose, onAdded }) => {
  const catalogue = useAsync(
    () => (visible ? fetchLabPackages() : Promise.resolve(null)),
    [visible]
  );

  const [selected, setSelected] = useState<LabPackage | null>(null);
  const [turnaround, setTurnaround] = useState('24');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await upsertLabOffering({
        labPackageId: selected.id,
        turnaroundHours: Number(turnaround) || 24,
      });
      setSelected(null);
      setTurnaround('24');
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

            <Card background={colors.surfaceContainerLow} style={styles.priceCard}>
              <Text variant="captionSm" color={colors.captionGray}>
                Price in your area
              </Text>
              {(bandsByPackage.get(selected.id) ?? []).length === 0 ? (
                <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                  {rupees(selected.price)} · standard rate
                </Text>
              ) : (
                (bandsByPackage.get(selected.id) ?? []).map((band) => (
                  <View key={band.id} style={styles.bandRow}>
                    <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
                      {band.scope}
                    </Text>
                    <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                      {rupees(band.price)}
                      {band.homeCollectionFee > 0 ? ` + ${rupees(band.homeCollectionFee)}` : ' · free pickup'}
                    </Text>
                  </View>
                ))
              )}
              <Text variant="captionSm" color={colors.captionGray}>
                Set by Health Buddy. Contact support if a rate looks wrong for your area.
              </Text>
            </Card>

            <Input
              label="Turnaround (hours)"
              icon="schedule"
              value={turnaround}
              onChangeText={setTurnaround}
              keyboardType="number-pad"
              hint="How long until the report is ready. Faster labs get routed first."
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
            {(catalogue.data?.packages ?? []).map((pkg) => {
              const already = existing.has(pkg.id);
              const band = (bandsByPackage.get(pkg.id) ?? []).find((b) => b.city);

              return (
                <Pressable
                  key={pkg.id}
                  onPress={() =>
                    already
                      ? Alert.alert('Already offered', `${pkg.testName} is already on your list.`)
                      : setSelected(pkg)
                  }
                  style={({ pressed }) => [
                    styles.catalogueRow,
                    already && styles.inactive,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.flex}>
                    <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                      {pkg.testName}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      {pkg.category} · {rupees(band?.price ?? pkg.price)}
                    </Text>
                  </View>
                  <Icon
                    name={already ? 'check_circle' : 'add_circle'}
                    size={20}
                    color={already ? colors.successDark : colors.primary}
                  />
                </Pressable>
              );
            })}
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
  inactive: { opacity: 0.6 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.insetCard,
    marginTop: spacing.insetCard,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.stackMedium, marginTop: spacing.base },
  priceBlock: { alignItems: 'flex-end', gap: spacing.stackTight },
  rowActions: { flexDirection: 'row', gap: spacing.insetCard, marginTop: spacing.base },
  priceCard: { gap: spacing.base },
  bandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
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
