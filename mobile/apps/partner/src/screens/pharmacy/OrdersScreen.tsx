import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Icon,
  Loading,
  Screen,
  SectionHeader,
  StatTile,
  StatusPill,
  Text,
  TopBar,
  acceptMedicineOrder,
  colors,
  errorMessage,
  fetchPharmacyQueue,
  markCodCollected,
  radius,
  spacing,
  updateMedicineOrderStatus,
  useAsync,
  type MedicineOrder,
  type OrderStatus,
} from '@healthbuddy/shared';

const FILTERS: { label: string; value?: OrderStatus }[] = [
  { label: 'All' },
  { label: 'New', value: 'PLACED' },
  { label: 'Accepted', value: 'ACCEPTED' },
  { label: 'Packing', value: 'PROCESSING' },
  { label: 'Out for delivery', value: 'DISPATCHED' },
  { label: 'Delivered', value: 'DELIVERED' },
];

/** The next step for each state, so the primary action is always one tap. */
const NEXT_STATUS: Partial<Record<OrderStatus, { label: string; status: OrderStatus }>> = {
  ACCEPTED: { label: 'Start packing', status: 'PROCESSING' },
  PROCESSING: { label: 'Mark dispatched', status: 'DISPATCHED' },
  DISPATCHED: { label: 'Mark delivered', status: 'DELIVERED' },
};

export const OrdersScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [filter, setFilter] = useState<OrderStatus | undefined>(undefined);
  const queue = useAsync(() => fetchPharmacyQueue(filter), [filter]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const orders = queue.data ?? [];
    return {
      open: orders.filter((o) => o.status === 'PLACED').length,
      active: orders.filter((o) => ['ACCEPTED', 'PROCESSING', 'DISPATCHED'].includes(o.status))
        .length,
      delivered: orders.filter((o) => o.status === 'DELIVERED').length,
    };
  }, [queue.data]);

  const accept = async (order: MedicineOrder) => {
    setBusyId(order.id);
    try {
      await acceptMedicineOrder(order.id);
      queue.reload();
    } catch (err) {
      // A 409 here means another pharmacy won the race — refresh so the queue
      // stops showing an order this shop can no longer act on.
      Alert.alert('Could not accept', errorMessage(err));
      queue.reload();
    } finally {
      setBusyId(null);
    }
  };

  const advance = async (order: MedicineOrder, status: OrderStatus) => {
    setBusyId(order.id);
    try {
      await updateMedicineOrderStatus(order.id, status);
      // Marking a cash order delivered is also the moment the money arrived,
      // so settle it in the same step rather than leaving a debt open that
      // someone has to remember to clear.
      if (status === 'DELIVERED' && order.payment?.method === 'COD') {
        await markCodCollected(order.id).catch(() => undefined);
      }
      queue.reload();
    } catch (err) {
      Alert.alert('Could not update', errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  if (queue.loading) return <Loading label="Loading orders" />;
  if (queue.error) return <ErrorState message={queue.error} onRetry={queue.reload} />;

  const orders = queue.data ?? [];

  return (
    <Screen scroll refreshing={queue.refreshing} onRefresh={queue.refresh}>
      <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

      <View style={styles.stats}>
        <StatTile value={String(counts.open)} label="New" icon="inbox" emphasis />
        <StatTile value={String(counts.active)} label="In progress" icon="local_shipping" />
        <StatTile value={String(counts.delivered)} label="Delivered" icon="task_alt" />
      </View>

      <ChipRow>
        {FILTERS.map((f) => (
          <Chip
            key={f.label}
            label={f.label}
            selected={filter === f.value}
            onPress={() => setFilter(f.value)}
          />
        ))}
      </ChipRow>

      <SectionHeader title={`Orders (${orders.length})`} />

      {orders.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No orders here"
          message="New patient orders will appear as soon as they are placed."
        />
      ) : (
        <View style={styles.list}>
          {orders.map((order) => {
            const next = NEXT_STATUS[order.status];
            const unclaimed = order.status === 'PLACED' && !order.pharmacyId;

            return (
              <Card key={order.id} style={styles.order}>
                <View style={styles.orderHeader}>
                  <View style={styles.flex}>
                    <Text variant="labelMd" weight="bold" color={colors.onSurface}>
                      {order.patient?.fullName ?? 'Patient'}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      #{order.id.slice(0, 8)} · {order.items.length} item(s)
                    </Text>
                  </View>
                  <StatusPill status={order.status} />
                </View>

                <View style={styles.items}>
                  {order.items.slice(0, 3).map((item) => (
                    <View key={item.medicineId} style={styles.item}>
                      <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
                        {item.quantity} × {item.name}
                      </Text>
                      <Text variant="captionSm" weight="semibold" color={colors.onSurface}>
                        ₹{item.itemTotal}
                      </Text>
                    </View>
                  ))}
                  {order.items.length > 3 ? (
                    <Text variant="captionSm" color={colors.captionGray}>
                      +{order.items.length - 3} more
                    </Text>
                  ) : null}
                </View>

                <View style={styles.address}>
                  <Icon name="location_on" size={14} color={colors.captionGray} />
                  <Text variant="captionSm" color={colors.captionGray} style={styles.flex}>
                    {order.address}
                  </Text>
                </View>

                {/*
                  Cash orders need collecting at the door, so the rider has to
                  see that before setting off — not after.
                */}
                {order.payment ? (
                  <View style={styles.address}>
                    <Icon
                      name={order.payment.method === 'COD' ? 'payments' : 'check_circle'}
                      size={14}
                      color={
                        order.payment.method === 'COD' ? colors.warningDark : colors.successDark
                      }
                    />
                    <Text
                      variant="captionSm"
                      weight="semibold"
                      color={
                        order.payment.method === 'COD' ? colors.warningDark : colors.successDark
                      }
                      style={styles.flex}
                    >
                      {order.payment.method === 'COD'
                        ? order.payment.status === 'PAID'
                          ? 'Cash collected'
                          : `Collect ₹${order.payment.amount.toFixed(0)} on delivery`
                        : `Paid online · ₹${order.payment.amount.toFixed(0)}`}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.footer}>
                  <Text variant="headlineSm" weight="bold" color={colors.primary}>
                    ₹{order.totalAmount}
                  </Text>

                  {unclaimed ? (
                    <Button
                      label="Accept order"
                      size="sm"
                      onPress={() => void accept(order)}
                      loading={busyId === order.id}
                    />
                  ) : next ? (
                    <Button
                      label={next.label}
                      size="sm"
                      onPress={() => void advance(order, next.status)}
                      loading={busyId === order.id}
                    />
                  ) : (
                    <Badge label="Closed" tint="neutral" />
                  )}
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stats: { flexDirection: 'row', gap: spacing.insetCard, marginBottom: spacing.insetPage },
  list: { gap: spacing.insetCard },
  order: { gap: spacing.insetCard },
  orderHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.base },
  items: {
    gap: spacing.stackTight,
    padding: spacing.insetCard,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  address: { flexDirection: 'row', alignItems: 'center', gap: spacing.stackMedium },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
