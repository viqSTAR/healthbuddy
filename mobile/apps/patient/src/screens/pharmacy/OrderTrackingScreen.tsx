import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Card,
  ErrorState,
  Icon,
  Loading,
  Screen,
  StatusPill,
  Text,
  TopBar,
  colors,
  fetchMedicineOrder,
  radius,
  spacing,
  useAsync,
  type MedicineOrder,
} from '@healthbuddy/shared';

const STAGES: { status: MedicineOrder['status']; label: string; icon: string; caption: string }[] = [
  { status: 'PLACED', label: 'Order placed', icon: 'receipt_long', caption: 'We received your order' },
  { status: 'PROCESSING', label: 'Processing', icon: 'inventory_2', caption: 'Pharmacy is packing it' },
  { status: 'DISPATCHED', label: 'Dispatched', icon: 'local_shipping', caption: 'On the way to you' },
  { status: 'DELIVERED', label: 'Delivered', icon: 'check_circle', caption: 'Order complete' },
];

/** Mirrors `order_details_tracking`: vertical progress timeline + item breakdown. */
export const OrderTrackingScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { orderId } = route.params;
  const { data: order, loading, error, reload, refreshing, refresh } = useAsync(
    () => fetchMedicineOrder(orderId),
    [orderId]
  );

  if (loading) {
    return (
      <Screen scroll={false}>
        <TopBar title="Order" onBack={navigation.goBack} />
        <Loading />
      </Screen>
    );
  }

  if (error || !order) {
    return (
      <Screen scroll={false}>
        <TopBar title="Order" onBack={navigation.goBack} />
        <ErrorState message={error ?? 'Order not found.'} onRetry={reload} />
      </Screen>
    );
  }

  const cancelled = order.status === 'CANCELLED';
  const currentIndex = STAGES.findIndex((s) => s.status === order.status);

  return (
    <Screen padded={false} refreshing={refreshing} onRefresh={refresh} bottomInset={spacing.xxl}>
      <TopBar title="Order Tracking" onBack={navigation.goBack} />

      <View style={styles.page}>
        <Card style={styles.summary}>
          <View style={styles.summaryHead}>
            <View style={styles.flex}>
              <Text variant="captionSm" color={colors.captionGray}>
                Order ID
              </Text>
              <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
                #{order.id.slice(0, 8).toUpperCase()}
              </Text>
            </View>
            <StatusPill status={order.status} />
          </View>

          <View style={styles.addressRow}>
            <Icon name="location_on" size={16} color={colors.primary} />
            <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
              {order.address}
            </Text>
          </View>
        </Card>

        {cancelled ? (
          <Card background={colors.dangerLight} style={styles.cancelled}>
            <Icon name="cancel" size={20} color={colors.error} />
            <Text variant="bodyMd" weight="medium" color={colors.onErrorContainer} style={styles.flex}>
              This order was cancelled.
            </Text>
          </Card>
        ) : (
          <Card style={styles.timeline}>
            <Text variant="headlineSmMobile" color={colors.headingDark}>
              Delivery Progress
            </Text>

            {STAGES.map((stage, i) => {
              const done = i <= currentIndex;
              const isLast = i === STAGES.length - 1;

              return (
                <View key={stage.status} style={styles.stage}>
                  <View style={styles.stageRail}>
                    <View style={[styles.stageDot, done && styles.stageDotDone]}>
                      <Icon
                        name={stage.icon}
                        size={16}
                        color={done ? colors.onPrimary : colors.captionGray}
                      />
                    </View>
                    {!isLast ? (
                      <View style={[styles.stageLine, i < currentIndex && styles.stageLineDone]} />
                    ) : null}
                  </View>

                  <View style={styles.stageBody}>
                    <Text
                      variant="bodyMd"
                      weight={done ? 'semibold' : 'regular'}
                      color={done ? colors.headingDark : colors.captionGray}
                    >
                      {stage.label}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      {stage.caption}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>
        )}

        <Card style={styles.items}>
          <Text variant="headlineSmMobile" color={colors.headingDark}>
            Items
          </Text>

          {order.items.map((item) => (
            <View key={item.medicineId} style={styles.itemRow}>
              <View style={styles.itemThumb}>
                <Icon name="pill" size={18} color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <Text variant="bodyMd" color={colors.headingDark} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  {item.quantity} × ${item.price.toFixed(2)}
                </Text>
              </View>
              <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
                ${item.itemTotal.toFixed(2)}
              </Text>
            </View>
          ))}

          <View style={styles.rule} />

          <View style={styles.itemRow}>
            <Text variant="bodyMd" weight="semibold" color={colors.headingDark} style={styles.flex}>
              Total paid
            </Text>
            <Text variant="displayBold" color={colors.primary}>
              ${order.totalAmount.toFixed(2)}
            </Text>
          </View>
        </Card>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.insetPage },
  summary: { gap: spacing.insetCard },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  flex: { flex: 1 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.base },
  cancelled: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  timeline: { gap: spacing.insetPage },
  stage: { flexDirection: 'row', gap: spacing.insetCard },
  stageRail: { alignItems: 'center', width: 32 },
  stageDot: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageDotDone: { backgroundColor: colors.primary },
  stageLine: { width: 2, flex: 1, minHeight: 24, backgroundColor: colors.outlineVariant },
  stageLineDone: { backgroundColor: colors.primary },
  stageBody: { flex: 1, paddingBottom: spacing.insetPage, gap: spacing.stackTight },
  items: { gap: spacing.insetCard },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  itemThumb: {
    width: 36,
    height: 36,
    borderRadius: radius.base,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rule: { height: 1, backgroundColor: colors.outlineVariant },
});
