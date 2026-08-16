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
   *
   * Fetched once, unfiltered, and narrowed below in memory. Re-fetching per
   * chip made the three tiles count only what was on screen: filtering to
   * Delivered showed "New 0" while parcels were sitting unaccepted, which is
   * the one number a shop opens this screen to read.
   */
  const queue = useAsync(fetchShipmentQueue, []);
  const [busyId, setBusyId] = useState<string | null>(null);

  const all = useMemo(() => queue.data ?? [], [queue.data]);

  const counts = useMemo(
    () => ({
      open: all.filter((s) => s.status === 'PLACED').length,
      active: all.filter((s) => ['ACCEPTED', 'PROCESSING', 'DISPATCHED'].includes(s.status)).length,
      delivered: all.filter((s) => s.status === 'DELIVERED').length,
    }),
    [all]
  );

  const shipments = useMemo(
    () => (filter ? all.filter((s) => s.status === filter) : all),
    [all, filter]
  );

  /** What still needs doing — a delivered parcel is not "to fulfil". */
  const outstanding = useMemo(
    () => shipments.filter((s) => s.status !== 'DELIVERED' && s.status !== 'CANCELLED').length,
    [shipments]
  );

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
      /*
        Cash settlement is the server's to do, not this screen's.

        This used to call markCodCollected itself, guarded on the order having
        exactly one parcel — which is not the same as this being the last
        parcel. Split cash orders were delivered in full and never settled by
        anyone. The server now settles when the last parcel lands, which is the
        only place that can see all of them.
      */
      await updateShipmentStatus(shipment.id, status);
      queue.reload();
    } catch (err) {
      Alert.alert('Could not update', errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  if (queue.loading) return <Loading label="Loading orders" />;
  if (queue.error) return <ErrorState message={queue.error} onRetry={queue.reload} />;

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

      <SectionHeader
        title={filter ? `Showing (${shipments.length})` : `To fulfil (${outstanding})`}
      />

      {shipments.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={filter ? 'Nothing here' : 'Nothing to fulfil'}
          message={
            filter
              ? 'No parcels of this shop are in that state right now.'
              : 'Parcels routed to this pharmacy will appear here as soon as they are placed.'
          }
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
