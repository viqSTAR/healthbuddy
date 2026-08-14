import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  acceptShipment,
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
  fetchShipmentQueue,
  Icon,
  Loading,
  markCodCollected,
  radius,
  rupees,
  Screen,
  SectionHeader,
  spacing,
  StatTile,
  StatusPill,
  Text,
  TopBar,
  updateShipmentStatus,
  useAsync,
  type PharmacyShipment,
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
  /**
   * Shipments, not orders. A basket can be filled by several shops, and this
   * shop is only responsible for — and only allowed to see — its own parcel.
   */
  const queue = useAsync(() => fetchShipmentQueue(filter), [filter]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const shipments = queue.data ?? [];
    return {
      open: shipments.filter((s) => s.status === 'PLACED').length,
      active: shipments.filter((s) => ['ACCEPTED', 'PROCESSING', 'DISPATCHED'].includes(s.status))
        .length,
      delivered: shipments.filter((s) => s.status === 'DELIVERED').length,
    };
  }, [queue.data]);

  const accept = async (shipment: PharmacyShipment) => {
    setBusyId(shipment.id);
    try {
      await acceptShipment(shipment.id);
      queue.reload();
    } catch (err) {
      // A 409 means it already moved on — refresh so the queue stops offering
      // an action this shop can no longer take.
      Alert.alert('Could not accept', errorMessage(err));
      queue.reload();
    } finally {
      setBusyId(null);
    }
  };

  const advance = async (shipment: PharmacyShipment, status: OrderStatus) => {
    setBusyId(shipment.id);
    try {
      await updateShipmentStatus(shipment.id, status);
      // Marking a cash order delivered is also the moment the money arrived, so
      // settle it in the same step rather than leaving a debt open that someone
      // has to remember to clear. Only on the last parcel — the rider collects
      // the whole order's cash once, not once per box.
      if (
        status === 'DELIVERED' &&
        shipment.order.payment?.method === 'COD' &&
        shipment.order.shipmentCount === 1
      ) {
        await markCodCollected(shipment.order.id).catch(() => undefined);
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

  const shipments = queue.data ?? [];

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

      <SectionHeader title={`To fulfil (${shipments.length})`} />

      {shipments.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="Nothing to fulfil"
          message="Parcels routed to this pharmacy will appear here as soon as they are placed."
        />
      ) : (
        <View style={styles.list}>
          {shipments.map((shipment) => {
            const next = NEXT_STATUS[shipment.status];
            const unclaimed = shipment.status === 'PLACED';
            const { order } = shipment;
            // Say so when this is part of a larger order, otherwise the item
            // count looks wrong against what the patient says they bought.
            const partOfMore = order.shipmentCount > 1;

            return (
              <Card key={shipment.id} style={styles.order}>
                <View style={styles.orderHeader}>
                  <View style={styles.flex}>
                    <Text variant="labelMd" weight="bold" color={colors.onSurface}>
                      {order.patient?.fullName ?? 'Patient'}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      #{order.id.slice(0, 8)} · {shipment.items.length} item(s)
                      {partOfMore ? ` · your part of ${order.shipmentCount}` : ''}
                    </Text>
                  </View>
                  <StatusPill status={shipment.status} />
                </View>

                {shipment.speed === 'EXPRESS' ? (
                  <View style={styles.address}>
                    <Icon name="bolt" size={14} color={colors.successDark} />
                    <Text variant="captionSm" weight="semibold" color={colors.successDark}>
                      Express · promised under 30 minutes
                    </Text>
                  </View>
                ) : null}

                <View style={styles.items}>
                  {shipment.items.slice(0, 3).map((item) => (
                    <View key={item.medicineId} style={styles.item}>
                      <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
                        {item.quantity} × {item.name}
                      </Text>
                      <Text variant="captionSm" weight="semibold" color={colors.onSurface}>
                        {rupees(item.itemTotal)}
                      </Text>
                    </View>
                  ))}
                  {shipment.items.length > 3 ? (
                    <Text variant="captionSm" color={colors.captionGray}>
                      +{shipment.items.length - 3} more
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
                  see that before setting off — not after. The amount is the
                  whole order's, and on a split order only one rider collects
                  it, so it is labelled rather than shown as this parcel's due.
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
                          : partOfMore
                            ? `Order total ${rupees(order.payment.amount)} — cash collected once, across all parcels`
                            : `Collect ${rupees(order.payment.amount)} on delivery`
                        : `Paid online · ${rupees(order.payment.amount)}`}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.footer}>
                  {/* This parcel's subtotal — what this shop is owed for, not
                      the order total, which includes another shop's goods. */}
                  <Text variant="headlineSm" weight="bold" color={colors.primary}>
                    {rupees(shipment.subtotal)}
                  </Text>

                  {unclaimed ? (
                    <Button
                      label="Accept"
                      size="sm"
                      onPress={() => void accept(shipment)}
                      loading={busyId === shipment.id}
                    />
                  ) : next ? (
                    <Button
                      label={next.label}
                      size="sm"
                      onPress={() => void advance(shipment, next.status)}
                      loading={busyId === shipment.id}
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
