import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  Loading,
  Screen,
  StatusPill,
  Text,
  TopBar,
  colors,
  fetchMyLabOrders,
  fetchMyMedicineOrders,
  radius,
  rupees,
  spacing,
  useAsync,
} from '@healthbuddy/shared';

type Tab = 'medicines' | 'labs';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Mirrors `my_orders_activity`: tabbed medicine and lab order history. */
export const MyOrdersScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [tab, setTab] = useState<Tab>('medicines');

  const medicineOrders = useAsync(() => fetchMyMedicineOrders(), []);
  const labOrders = useAsync(() => fetchMyLabOrders(), []);

  const active = tab === 'medicines' ? medicineOrders : labOrders;

  return (
    <Screen
      padded={false}
      refreshing={active.refreshing}
      onRefresh={active.refresh}
      bottomInset={spacing.xxl}
    >
      <TopBar title="My Orders" />

      <View style={styles.tabs}>
        <Chip
          label="Medicines"
          icon="pill"
          tint="info"
          selected={tab === 'medicines'}
          onPress={() => setTab('medicines')}
        />
        <Chip
          label="Lab Tests"
          icon="biotech"
          tint="warning"
          selected={tab === 'labs'}
          onPress={() => setTab('labs')}
        />
      </View>

      <View style={styles.page}>
        {active.loading ? (
          <Loading />
        ) : active.error ? (
          <ErrorState message={active.error} onRetry={active.reload} />
        ) : tab === 'medicines' ? (
          medicineOrders.data?.length ? (
            medicineOrders.data.map((order) => (
              <Card
                key={order.id}
                style={styles.card}
                onPress={() => navigation.navigate('OrderTracking', { orderId: order.id })}
              >
                <View style={styles.cardHead}>
                  <View style={styles.iconTile}>
                    <Icon name="pill" size={20} color={colors.secondary} />
                  </View>
                  <View style={styles.flex}>
                    <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
                      {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      {formatDate(order.createdAt)}
                    </Text>
                  </View>
                  <StatusPill status={order.status} />
                </View>

                <Text variant="captionSm" color={colors.onSurfaceVariant} numberOfLines={1}>
                  {order.items.map((i) => i.name).join(', ')}
                </Text>

                {/* One row per parcel when there is more than one. An order in
                    two halves whose statuses differ is exactly the case a
                    single order-level pill cannot describe honestly. */}
                {(order.shipments?.length ?? 0) > 1 ? (
                  <View style={styles.parcels}>
                    {order.shipments?.map((shipment, index) => (
                      <View key={shipment.id} style={styles.parcelRow}>
                        <Icon
                          name={shipment.speed === 'EXPRESS' ? 'bolt' : 'local_shipping'}
                          size={14}
                          color={
                            shipment.speed === 'EXPRESS' ? colors.successDark : colors.captionGray
                          }
                        />
                        <Text variant="captionSm" color={colors.captionGray} style={styles.flex}>
                          Parcel {index + 1} of {order.shipments?.length} ·{' '}
                          {shipment.pharmacy.name}
                        </Text>
                        <StatusPill status={shipment.status} />
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.cardFoot}>
                  {/* The address gives up space, never the total. A long one
                      used to squeeze the price until it read "₹212.0(". */}
                  <Text
                    variant="captionSm"
                    color={colors.captionGray}
                    numberOfLines={1}
                    style={styles.footAddress}
                  >
                    {order.address}
                  </Text>
                  <Text variant="bodyMd" weight="semibold" color={colors.primary}>
                    {rupees(order.totalAmount)}
                  </Text>
                </View>
              </Card>
            ))
          ) : (
            <EmptyState
              icon="shopping_bag"
              title="No medicine orders"
              message="Your pharmacy orders will appear here."
              actionLabel="Browse store"
              onActionPress={() => navigation.navigate('Pharmacy')}
            />
          )
        ) : labOrders.data?.length ? (
          labOrders.data.map((order) => (
            <Card
              key={order.id}
              style={styles.card}
              onPress={() => navigation.navigate('LabResult', { orderId: order.id })}
            >
              <View style={styles.cardHead}>
                <View style={[styles.iconTile, { backgroundColor: colors.warningLight }]}>
                  <Icon name="biotech" size={20} color={colors.warningDark} />
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyMd" weight="semibold" color={colors.headingDark} numberOfLines={1}>
                    {order.testName}
                  </Text>
                  <Text variant="captionSm" color={colors.captionGray}>
                    {formatDate(order.createdAt)}
                  </Text>
                </View>
                <StatusPill status={order.status} />
              </View>

              <View style={styles.cardFoot}>
                <Text variant="captionSm" color={colors.captionGray}>
                  {order.reportUrl ? 'Report available' : 'Report pending'}
                </Text>
                <Text variant="bodyMd" weight="semibold" color={colors.primary}>
                  {rupees(order.price)}
                </Text>
              </View>
            </Card>
          ))
        ) : (
          <EmptyState
            icon="biotech"
            title="No lab orders"
            message="Booked tests and results will appear here."
            actionLabel="Book a test"
            onActionPress={() => navigation.navigate('Labs')}
          />
        )}
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: spacing.base, paddingHorizontal: spacing.insetPage, paddingBottom: spacing.insetPage },
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.insetCard },
  card: { gap: spacing.insetCard },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.infoLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  parcels: {
    gap: spacing.base,
    paddingTop: spacing.base,
    marginTop: spacing.stackMedium,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHigh,
  },
  parcelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  cardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.insetCard },
  footAddress: { flex: 1 },
});
