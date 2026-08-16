import React, { useState } from 'react';
import { View, StyleSheet, Modal, Pressable } from 'react-native';
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  colors,
  EmptyState,
  errorMessage,
  ErrorState,
  fetchExpiringStock,
  fetchInventory,
  fetchMedicines,
  fetchStockMovements,
  Icon,
  Input,
  Loading,
  radius,
  recordStockMovement,
  rupees,
  Screen,
  SearchBar,
  SectionHeader,
  setStock as setStockApi,
  spacing,
  Text,
  TopBar,
  upsertInventoryItem,
  useAsync,
  type InventoryItem,
  type Medicine,
  type StockMovementReason,
} from '@healthbuddy/shared';

/**
 * Stock and pricing for THIS pharmacy.
 *
 * The catalogue is shared across the platform but price and stock are per shop,
 * so nothing here writes to the `Medicine` row. The pharmacy id comes from the
 * session token, never the request, so one shop cannot edit another's stock.
 *
 * Stock is not a number you nudge with + and −. Every change goes through the
 * ledger with a reason, because "we are 40 boxes short" needs an answer, and in
 * a pharmacy the answer matters: 25 expired, 10 sold at the counter, 5 damaged.
 */
export const InventoryScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'expiring'>('all');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);

  const inventory = useAsync(
    () =>
      fetchInventory({
        search: search.trim() || undefined,
        lowStockOnly: filter === 'low',
        limit: 100,
      }),
    [search, filter]
  );

  const expiring = useAsync(
    () => (filter === 'expiring' ? fetchExpiringStock(90) : Promise.resolve(null)),
    [filter]
  );

  if (inventory.loading) return <Loading label="Loading inventory" />;
  if (inventory.error) return <ErrorState message={inventory.error} onRetry={inventory.reload} />;

  const all = inventory.data?.items ?? [];
  const expiringIds = new Set((expiring.data ?? []).map((e) => e.medicineId));
  const items = filter === 'expiring' ? all.filter((i) => expiringIds.has(i.medicineId)) : all;

  return (
    <>
      <Screen scroll refreshing={inventory.refreshing} onRefresh={inventory.refresh}>
        <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

        <SearchBar value={search} onChangeText={setSearch} placeholder="Search your stock" />

        <ChipRow>
          <Chip label="All items" selected={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip
            label="Low stock"
            icon="warning"
            selected={filter === 'low'}
            onPress={() => setFilter('low')}
          />
          <Chip
            label="Expiring"
            icon="schedule"
            selected={filter === 'expiring'}
            onPress={() => setFilter('expiring')}
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
            title={
              filter === 'low'
                ? 'Nothing running low'
                : filter === 'expiring'
                  ? 'Nothing expiring soon'
                  : 'No stock listed yet'
            }
            message={
              filter === 'low'
                ? 'Everything is above its reorder level.'
                : filter === 'expiring'
                  ? 'No batch expires within 90 days.'
                  : 'Add medicines from the catalogue and set your own prices.'
            }
            actionLabel={filter === 'all' ? 'Add item' : undefined}
            onActionPress={filter === 'all' ? () => setAdding(true) : undefined}
          />
        ) : (
          <View style={styles.list}>
            {items.map((item) => (
              <InventoryRow key={item.id} item={item} onPress={() => setEditing(item)} />
            ))}
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

      <StockSheet
        item={editing}
        onClose={() => setEditing(null)}
        onChanged={() => {
          setEditing(null);
          inventory.reload();
        }}
      />
    </>
  );
};

const daysUntil = (iso: string | null): number | null =>
  iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null;

const InventoryRow: React.FC<{ item: InventoryItem; onPress: () => void }> = ({
  item,
  onPress,
}) => {
  // What a shop can actually sell — not what is on the shelf.
  const available = item.stock - item.reserved;
  const low = available <= item.reorderLevel;
  const expiresIn = daysUntil(item.expiryDate);

  return (
    <Pressable onPress={onPress} accessibilityLabel={`Manage stock for ${item.medicine.name}`}>
      <Card style={[styles.row, !item.isActive && styles.inactive]}>
        <View style={styles.flex}>
          <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
            {item.medicine.name}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {rupees(item.price)} · {item.medicine.category}
          </Text>

          <View style={styles.tags}>
            {item.medicine.requiresPrescription ? (
              <Badge label="Rx only" tint="warning" icon="prescriptions" />
            ) : null}
            {low ? <Badge label="Low stock" tint="danger" icon="warning" /> : null}
            {!item.isActive ? <Badge label="Delisted" tint="neutral" /> : null}
            {expiresIn !== null && expiresIn <= 0 ? (
              <Badge label="Expired" tint="danger" icon="block" />
            ) : expiresIn !== null && expiresIn <= 90 ? (
              <Badge label={`${expiresIn}d left`} tint="warning" icon="schedule" />
            ) : null}
          </View>
        </View>

        <View style={styles.counts}>
          <Text variant="headlineSm" weight="bold" color={low ? colors.error : colors.onSurface}>
            {available}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            available
          </Text>
          {item.reserved > 0 ? (
            <Text variant="captionSm" color={colors.warningDark}>
              {item.reserved} reserved
            </Text>
          ) : null}
        </View>

        <Icon name="chevron_right" size={20} color={colors.captionGray} />
      </Card>
    </Pressable>
  );
};

/* ------------------------------------------------------------------ *
 * The stock modal
 * ------------------------------------------------------------------ */

const REASONS: {
  value: Extract<StockMovementReason, 'PURCHASE' | 'SALE_OFFLINE' | 'RETURN' | 'EXPIRED' | 'DAMAGED'>;
  label: string;
  hint: string;
  icon: string;
  direction: 'in' | 'out';
}[] = [
  {
    value: 'PURCHASE',
    label: 'Stock received',
    hint: 'New delivery from a distributor',
    icon: 'local_shipping',
    direction: 'in',
  },
  {
    value: 'RETURN',
    label: 'Customer return',
    hint: 'Came back unopened',
    icon: 'undo',
    direction: 'in',
  },
  {
    value: 'SALE_OFFLINE',
    label: 'Sold at the counter',
    hint: 'Walk-in sale, off the app',
    icon: 'storefront',
    direction: 'out',
  },
  {
    value: 'EXPIRED',
    label: 'Expired',
    hint: 'Past its expiry date',
    icon: 'schedule',
    direction: 'out',
  },
  {
    value: 'DAMAGED',
    label: 'Damaged',
    hint: 'Broken, or a failed cold chain',
    icon: 'report',
    direction: 'out',
  },
];

/**
 * One medicine, everything you can do to it.
 *
 * Quantity is typed as a number — a shop writing off 40 expired strips should
 * not tap a minus button forty times. The reason is required and decides the
 * direction, so a write-off can never accidentally create stock.
 */
const StockSheet: React.FC<{
  item: InventoryItem | null;
  onClose: () => void;
  onChanged: () => void;
}> = ({ item, onClose, onChanged }) => {
  const [mode, setMode] = useState<'move' | 'count' | 'details' | 'history'>('move');
  const [reason, setReason] = useState<(typeof REASONS)[number]['value']>('PURCHASE');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [counted, setCounted] = useState('');
  const [price, setPrice] = useState('');
  const [reorderLevel, setReorderLevel] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [busy, setBusy] = useState(false);

  const history = useAsync(
    () =>
      item && mode === 'history'
        ? fetchStockMovements({ medicineId: item.medicineId, limit: 30 })
        : Promise.resolve(null),
    [item?.medicineId, mode]
  );

  // Reset each time a different medicine is opened.
  React.useEffect(() => {
    if (!item) return;
    setMode('move');
    setReason('PURCHASE');
    setQuantity('');
    setNote('');
    setCounted(String(item.stock));
    setPrice(String(item.price));
    setReorderLevel(String(item.reorderLevel));
    setBatchNumber(item.batchNumber ?? '');
    setExpiryDate(item.expiryDate ? item.expiryDate.slice(0, 10) : '');
  }, [item?.id]);

  if (!item) return null;

  const available = item.stock - item.reserved;
  const selected = REASONS.find((r) => r.value === reason)!;
  const qty = Number(quantity);

  const submitMovement = async () => {
    if (!Number.isFinite(qty) || qty <= 0) {
      Alert.alert('How many?', 'Enter the number of units as a positive whole number.');
      return;
    }
    if (selected.direction === 'out' && qty > available) {
      Alert.alert(
        'Not enough stock',
        item.reserved > 0
          ? `Only ${available} unit(s) are free — ${item.reserved} are reserved for paid orders.`
          : `Only ${available} unit(s) are on the shelf.`
      );
      return;
    }

    setBusy(true);
    try {
      await recordStockMovement(item.medicineId, {
        quantity: qty,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(batchNumber.trim() ? { batchNumber: batchNumber.trim() } : {}),
        ...(expiryDate.trim() ? { expiryDate: expiryDate.trim() } : {}),
      });
      onChanged();
    } catch (err) {
      Alert.alert('Could not record that', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCount = async () => {
    const n = Number(counted);
    if (!Number.isFinite(n) || n < 0) {
      Alert.alert('Invalid count', 'Enter the number of units you actually counted.');
      return;
    }

    setBusy(true);
    try {
      await setStockApi(item.medicineId, {
        countedQuantity: n,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onChanged();
    } catch (err) {
      Alert.alert('Could not save the count', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitDetails = async () => {
    setBusy(true);
    try {
      await upsertInventoryItem({
        medicineId: item.medicineId,
        price: Number(price) || item.price,
        reorderLevel: Number(reorderLevel) || item.reorderLevel,
        ...(batchNumber.trim() ? { batchNumber: batchNumber.trim() } : {}),
        ...(expiryDate.trim() ? { expiryDate: expiryDate.trim() } : {}),
      });
      onChanged();
    } catch (err) {
      Alert.alert('Could not save', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Screen scroll bottomInset={spacing.xxl}>
        <TopBar title={item.medicine.name} onBack={onClose} />

        <Card style={styles.summary}>
          <View style={styles.summaryCell}>
            <Text variant="headlineSm" weight="bold" color={colors.onSurface}>
              {item.stock}
            </Text>
            <Text variant="captionSm" color={colors.captionGray}>
              on the shelf
            </Text>
          </View>
          <View style={styles.summaryCell}>
            <Text variant="headlineSm" weight="bold" color={colors.warningDark}>
              {item.reserved}
            </Text>
            <Text variant="captionSm" color={colors.captionGray}>
              reserved
            </Text>
          </View>
          <View style={styles.summaryCell}>
            <Text variant="headlineSm" weight="bold" color={colors.primary}>
              {available}
            </Text>
            <Text variant="captionSm" color={colors.captionGray}>
              sellable
            </Text>
          </View>
        </Card>

        {item.reserved > 0 ? (
          <Card background={colors.warningLight} style={styles.notice}>
            <Icon name="info" size={18} color={colors.warningDark} />
            <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
              {item.reserved} unit(s) are promised to paid orders. They stay on your shelf until you
              dispatch, but cannot be sold to anyone else.
            </Text>
          </Card>
        ) : null}

        <ChipRow>
          <Chip label="Record" selected={mode === 'move'} onPress={() => setMode('move')} />
          <Chip label="Recount" selected={mode === 'count'} onPress={() => setMode('count')} />
          <Chip label="Details" selected={mode === 'details'} onPress={() => setMode('details')} />
          <Chip label="History" selected={mode === 'history'} onPress={() => setMode('history')} />
        </ChipRow>

        {mode === 'move' ? (
          <>
            <SectionHeader title="What happened?" />
            <View style={styles.list}>
              {REASONS.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setReason(option.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: reason === option.value }}
                >
                  <Card style={[styles.row, reason === option.value && styles.selected]}>
                    <Icon
                      name={option.icon}
                      size={20}
                      color={option.direction === 'in' ? colors.successDark : colors.error}
                    />
                    <View style={styles.flex}>
                      <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                        {option.label}
                      </Text>
                      <Text variant="captionSm" color={colors.captionGray}>
                        {option.hint}
                      </Text>
                    </View>
                    <Badge
                      label={option.direction === 'in' ? 'Adds' : 'Removes'}
                      tint={option.direction === 'in' ? 'success' : 'danger'}
                    />
                  </Card>
                </Pressable>
              ))}
            </View>

            <SectionHeader title="How many units?" />
            <Card style={styles.form}>
              <Input
                label="Quantity"
                icon="inventory"
                value={quantity}
                onChangeText={setQuantity}
                placeholder="e.g. 40"
                keyboardType="number-pad"
              />
              {Number.isFinite(qty) && qty > 0 ? (
                <Text
                  variant="captionSm"
                  weight="semibold"
                  color={selected.direction === 'in' ? colors.successDark : colors.error}
                >
                  {item.stock} → {selected.direction === 'in' ? item.stock + qty : item.stock - qty}{' '}
                  on the shelf
                </Text>
              ) : null}

              {reason === 'PURCHASE' ? (
                <>
                  <Input
                    label="Batch number (optional)"
                    icon="tag"
                    value={batchNumber}
                    onChangeText={setBatchNumber}
                    placeholder="e.g. B2411-A"
                  />
                  <Input
                    label="Expiry date (optional)"
                    icon="event"
                    value={expiryDate}
                    onChangeText={setExpiryDate}
                    placeholder="YYYY-MM-DD"
                  />
                </>
              ) : null}

              <Input
                label="Note (optional)"
                icon="edit_note"
                value={note}
                onChangeText={setNote}
                placeholder="Anything worth remembering"
                multiline
              />

              <Button
                label={`${selected.direction === 'in' ? 'Add' : 'Remove'} ${qty > 0 ? qty : ''} unit(s)`}
                icon="check_circle"
                onPress={() => void submitMovement()}
                loading={busy}
                fullWidth
              />
            </Card>
          </>
        ) : null}

        {mode === 'count' ? (
          <>
            <SectionHeader title="Physical recount" />
            <Card style={styles.form}>
              <Text variant="captionSm" color={colors.captionGray}>
                Enter what you actually counted. The difference is recorded as a correction, so a
                shortfall stays visible rather than being quietly written over.
              </Text>
              <Input
                label="Units counted"
                icon="inventory_2"
                value={counted}
                onChangeText={setCounted}
                keyboardType="number-pad"
              />
              {Number.isFinite(Number(counted)) && Number(counted) !== item.stock ? (
                <Text
                  variant="captionSm"
                  weight="semibold"
                  color={Number(counted) > item.stock ? colors.successDark : colors.error}
                >
                  {Number(counted) > item.stock ? '+' : ''}
                  {Number(counted) - item.stock} against the system count of {item.stock}
                </Text>
              ) : null}
              <Input
                label="Why the difference? (optional)"
                icon="edit_note"
                value={note}
                onChangeText={setNote}
                placeholder="e.g. miscount at last delivery"
                multiline
              />
              <Button
                label="Save count"
                icon="fact_check"
                onPress={() => void submitCount()}
                loading={busy}
                fullWidth
              />
            </Card>
          </>
        ) : null}

        {mode === 'details' ? (
          <>
            <SectionHeader title="Listing" />
            <Card style={styles.form}>
              <Input
                label={`Your price (₹) · MRP ${rupees(item.medicine.price)}`}
                icon="payments"
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
              />
              <Text variant="captionSm" color={colors.captionGray}>
                Cannot exceed the printed MRP.
              </Text>
              <Input
                label="Low-stock alert below"
                icon="warning"
                value={reorderLevel}
                onChangeText={setReorderLevel}
                keyboardType="number-pad"
              />
              <Input
                label="Batch number"
                icon="tag"
                value={batchNumber}
                onChangeText={setBatchNumber}
                placeholder="e.g. B2411-A"
              />
              <Input
                label="Expiry date"
                icon="event"
                value={expiryDate}
                onChangeText={setExpiryDate}
                placeholder="YYYY-MM-DD"
              />
              <Button
                label="Save details"
                icon="save"
                onPress={() => void submitDetails()}
                loading={busy}
                fullWidth
              />
            </Card>
          </>
        ) : null}

        {mode === 'history' ? (
          <>
            <SectionHeader title="Movement history" />
            {history.loading ? (
              <Loading />
            ) : (history.data?.movements ?? []).length === 0 ? (
              <EmptyState
                icon="history"
                title="No movements yet"
                message="Every change to this item will be listed here with its reason."
              />
            ) : (
              <View style={styles.list}>
                {(history.data?.movements ?? []).map((m) => (
                  <Card key={m.id} style={styles.row}>
                    <View style={styles.flex}>
                      <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                        {m.reason.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}
                      </Text>
                      <Text variant="captionSm" color={colors.captionGray}>
                        {new Date(m.createdAt).toLocaleString()} · balance {m.balanceAfter}
                      </Text>
                      {m.note ? (
                        <Text variant="captionSm" color={colors.captionGray}>
                          {m.note}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      variant="labelMd"
                      weight="bold"
                      color={m.delta > 0 ? colors.successDark : m.delta < 0 ? colors.error : colors.captionGray}
                    >
                      {m.delta > 0 ? '+' : ''}
                      {m.delta}
                    </Text>
                  </Card>
                ))}
              </View>
            )}
          </>
        ) : null}
      </Screen>
    </Modal>
  );
};

/* ------------------------------------------------------------------ *
 * Adding from the catalogue
 * ------------------------------------------------------------------ */

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
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [saving, setSaving] = useState(false);

  const blocked = (m: Medicine) => m.schedule === 'SCHEDULE_X' || m.schedule === 'NARCOTIC';

  const save = async () => {
    if (!selected) return;

    if (Number(price) > selected.price) {
      Alert.alert(
        'Above MRP',
        `${selected.name} cannot be listed above its printed MRP of ${rupees(selected.price)}.`
      );
      return;
    }

    setSaving(true);
    try {
      await upsertInventoryItem({
        medicineId: selected.id,
        price: Number(price) || selected.price,
        stock: Number(stock) || 0,
        ...(batchNumber.trim() ? { batchNumber: batchNumber.trim() } : {}),
        ...(expiryDate.trim() ? { expiryDate: expiryDate.trim() } : {}),
      });
      setSelected(null);
      setPrice('');
      setStock('');
      setBatchNumber('');
      setExpiryDate('');
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
              {selected.composition ?? selected.category} · MRP {rupees(selected.price)}
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
              label="Opening stock"
              icon="inventory"
              value={stock}
              onChangeText={setStock}
              placeholder="50"
              keyboardType="number-pad"
            />
            <Input
              label="Batch number (optional)"
              icon="tag"
              value={batchNumber}
              onChangeText={setBatchNumber}
              placeholder="e.g. B2411-A"
            />
            <Input
              label="Expiry date (optional)"
              icon="event"
              value={expiryDate}
              onChangeText={setExpiryDate}
              placeholder="YYYY-MM-DD"
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
                        {medicine.category} · MRP {rupees(medicine.price)}
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
  selected: { borderWidth: 1.5, borderColor: colors.primary },
  inactive: { opacity: 0.6 },
  tags: { flexDirection: 'row', gap: spacing.stackMedium, marginTop: spacing.base, flexWrap: 'wrap' },
  counts: { alignItems: 'flex-end' },
  summary: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryCell: { alignItems: 'center', flex: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.insetCard,
    marginTop: spacing.insetCard,
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
