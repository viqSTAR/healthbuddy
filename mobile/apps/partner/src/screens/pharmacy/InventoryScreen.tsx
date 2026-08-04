import React, { useState } from 'react';
import { View, StyleSheet, Alert, Modal, Pressable } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
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
  adjustStock,
  colors,
  errorMessage,
  fetchInventory,
  fetchMedicines,
  radius,
  spacing,
  upsertInventoryItem,
  useAsync,
  type InventoryItem,
  type Medicine,
} from '@healthbuddy/shared';

/**
 * Stock and pricing for THIS pharmacy.
 *
 * The catalogue is shared across the platform but price and stock are per shop,
 * so nothing here writes to the `Medicine` row — every change lands on this
 * pharmacy's own inventory record. The pharmacy id comes from the session
 * token, never from the request, so one shop cannot edit another's stock.
 */
export const InventoryScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  const inventory = useAsync(
    () => fetchInventory({ search: search.trim() || undefined, lowStockOnly, limit: 100 }),
    [search, lowStockOnly]
  );

  const adjust = async (item: InventoryItem, delta: number) => {
    // Optimistic: stock counting is repetitive and a round trip per tap makes
    // the control feel unresponsive.
    inventory.setData((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((i) =>
              i.id === item.id ? { ...i, stock: Math.max(0, i.stock + delta) } : i
            ),
          }
        : prev!
    );

    try {
      await adjustStock(item.medicineId, delta);
    } catch (err) {
      Alert.alert('Could not update stock', errorMessage(err));
      inventory.reload();
    }
  };

  if (inventory.loading) return <Loading label="Loading inventory" />;
  if (inventory.error) return <ErrorState message={inventory.error} onRetry={inventory.reload} />;

  const items = inventory.data?.items ?? [];

  return (
    <>
      <Screen scroll refreshing={inventory.refreshing} onRefresh={inventory.refresh}>
        <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

        <SearchBar value={search} onChangeText={setSearch} placeholder="Search your stock" />

        <ChipRow>
          <Chip label="All items" selected={!lowStockOnly} onPress={() => setLowStockOnly(false)} />
          <Chip
            label="Low stock"
            icon="warning"
            selected={lowStockOnly}
            onPress={() => setLowStockOnly(true)}
          />
        </ChipRow>

        <SectionHeader
          title={`Inventory (${items.length})`}
          actionLabel="Add item"
          onActionPress={() => setAdding(true)}
        />

        {items.length === 0 ? (
          <EmptyState
            icon="inventory_2"
            title={lowStockOnly ? 'Nothing running low' : 'No stock listed yet'}
            message={
              lowStockOnly
                ? 'Everything is above its reorder level.'
                : 'Add medicines from the catalogue and set your own prices.'
            }
            actionLabel={lowStockOnly ? undefined : 'Add item'}
            onActionPress={lowStockOnly ? undefined : () => setAdding(true)}
          />
        ) : (
          <View style={styles.list}>
            {items.map((item) => {
              const low = item.stock <= item.reorderLevel;
              return (
                <Card key={item.id} style={styles.row}>
                  <View style={styles.flex}>
                    <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                      {item.medicine.name}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      ₹{item.price} · {item.medicine.category}
                    </Text>
                    <View style={styles.tags}>
                      {item.medicine.requiresPrescription ? (
                        <Badge label="Rx only" tint="warning" icon="prescriptions" />
                      ) : null}
                      {low ? <Badge label="Low stock" tint="danger" icon="warning" /> : null}
                    </View>
                  </View>

                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => void adjust(item, -1)}
                      style={styles.stepButton}
                      hitSlop={6}
                    >
                      <Icon name="remove" size={18} color={colors.primary} />
                    </Pressable>
                    <Text variant="labelMd" weight="bold" color={colors.onSurface}>
                      {item.stock}
                    </Text>
                    <Pressable
                      onPress={() => void adjust(item, 1)}
                      style={styles.stepButton}
                      hitSlop={6}
                    >
                      <Icon name="add" size={18} color={colors.primary} />
                    </Pressable>
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </Screen>

      <AddItemSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          inventory.reload();
        }}
      />
    </>
  );
};

/**
 * Catalogue picker. Schedule X and narcotic drugs are refused by the server for
 * online sale, so they are marked here rather than silently failing on save.
 */
const AddItemSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
}> = ({ visible, onClose, onAdded }) => {
  const [query, setQuery] = useState('');
  const catalogue = useAsync(
    () => (visible ? fetchMedicines({ query: query.trim() || undefined }) : Promise.resolve(null)),
    [visible, query]
  );

  const [selected, setSelected] = useState<Medicine | null>(null);
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [saving, setSaving] = useState(false);

  const blocked = (m: Medicine) => m.schedule === 'SCHEDULE_X' || m.schedule === 'NARCOTIC';

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await upsertInventoryItem({
        medicineId: selected.id,
        price: Number(price) || selected.price,
        stock: Number(stock) || 0,
      });
      setSelected(null);
      setPrice('');
      setStock('');
      onAdded();
    } catch (err) {
      Alert.alert('Could not add item', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen scroll>
        <TopBar title="Add to inventory" onBack={onClose} />

        {selected ? (
          <Card style={styles.form}>
            <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
              {selected.name}
            </Text>
            <Text variant="captionSm" color={colors.captionGray}>
              {selected.composition ?? selected.category} · MRP ₹{selected.price}
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
              label="Stock on hand"
              icon="inventory"
              value={stock}
              onChangeText={setStock}
              placeholder="50"
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
                label="Add item"
                onPress={() => void save()}
                loading={saving}
                style={styles.flex}
              />
            </View>
          </Card>
        ) : (
          <>
            <SearchBar value={query} onChangeText={setQuery} placeholder="Search the catalogue" />

            {catalogue.loading ? (
              <Loading />
            ) : (
              <View style={styles.list}>
                {(catalogue.data?.medicines ?? []).map((medicine) => (
                  <Pressable
                    key={medicine.id}
                    onPress={() =>
                      blocked(medicine)
                        ? Alert.alert(
                            'Cannot be listed',
                            `${medicine.name} is a ${medicine.schedule === 'NARCOTIC' ? 'narcotic' : 'Schedule X'} drug and may not be sold online.`
                          )
                        : (setSelected(medicine), setPrice(String(medicine.price)))
                    }
                    style={({ pressed }) => [
                      styles.catalogueRow,
                      blocked(medicine) && styles.blocked,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.flex}>
                      <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                        {medicine.name}
                      </Text>
                      <Text variant="captionSm" color={colors.captionGray}>
                        {medicine.category} · MRP ₹{medicine.price}
                      </Text>
                    </View>
                    <Icon
                      name={blocked(medicine) ? 'block' : 'add_circle'}
                      size={20}
                      color={blocked(medicine) ? colors.error : colors.primary}
                    />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </Screen>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.insetCard },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  tags: { flexDirection: 'row', gap: spacing.stackMedium, marginTop: spacing.base },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  blocked: { opacity: 0.6, backgroundColor: colors.surfaceContainerLow },
  pressed: { opacity: 0.8 },
});
