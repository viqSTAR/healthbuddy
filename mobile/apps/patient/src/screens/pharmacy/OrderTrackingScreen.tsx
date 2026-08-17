import React, { useEffect } from 'react';
import { AppState, View, StyleSheet } from 'react-native';
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
  rupees,
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
  const { data: order, loading, error, reload, refreshing, refresh, setData } = useAsync(
    () => fetchMedicineOrder(orderId),
    [orderId]
  );

  /**
   * Keeps a moving parcel moving on screen.
   *
   * This is the screen someone sits on while waiting for the door, and the two
   * things it shows — the stage line and the places passed through — both change
   * without any action from them, so leaving it to pull-to-refresh means a
   * parcel that has already reached the next suburb looks stuck.
   *
   * Deliberately quiet: it writes straight to the data rather than going through
   * `refresh`, so no spinner appears and nothing blanks. It only runs while the
   * order is actually in motion and the app is in front, so a delivered order or
   * a pocketed phone costs nothing.
   */
  const settled = order?.status === 'DELIVERED' || order?.status === 'CANCELLED';
  useEffect(() => {
    if (settled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const poll = async () => {
      try {
        const fresh = await fetchMedicineOrder(orderId);
        if (!cancelled) setData(fresh);
      } catch {
        // A missed poll is invisible and the next is 20 seconds away; showing an
        // error over a screen that is already displaying the truth would be worse.
      }
    };

    const start = () => {
      if (!timer) timer = setInterval(() => void poll(), 20_000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return stop();
      void poll();
      start();
    });

    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
  }, [orderId, settled, setData]);

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

  /**
   * Orders placed before shipments existed have none, so the order stands in as
   * a single parcel. Without this those rows would render an empty screen.
   */
  const parcels =
    order.shipments && order.shipments.length > 0
      ? order.shipments.map((sh) => ({
          id: sh.id,
          pharmacyName: sh.pharmacy.name,
          status: sh.status,
          speed: sh.speed,
          items: sh.items,
          cancelReason: sh.cancelReason,
          /** Plain English for what is happening, decided server-side. */
          stageText: sh.stageText,
          riderOnBoard: sh.riderOnBoard,
          /**
           * Place names the parcel has passed through. Names, never a position
           * — the rider's coordinates go to the dispatch board and not here.
           */
          journey: sh.journey ?? [],
        }))
      : [
          {
            id: order.id,
            pharmacyName: 'Pharmacy',
            status: order.status,
            speed: 'STANDARD' as const,
            items: order.items,
            cancelReason: order.cancelReason,
            stageText: undefined,
            riderOnBoard: false,
            journey: [] as { place: string; at: string }[],
          },
        ];

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
              {order.cancelReason ? ` ${order.cancelReason}` : ''}
            </Text>
          </Card>
        ) : null}

        {/*
          One block per parcel, each with its own timeline and its own items.
          An order filled by two shops has two independent journeys, and a
          single merged progress bar would have to pick one of them to show —
          telling the patient their order is "dispatched" while half of it is
          still being packed.
        */}
        {parcels.map((parcel, index) => {
          const stageIndex = STAGES.findIndex((st) => st.status === parcel.status);
          const parcelCancelled = parcel.status === 'CANCELLED';

          return (
            <Card key={parcel.id} style={styles.timeline}>
              <View style={styles.parcelHead}>
                <View style={styles.flex}>
                  <Text variant="headlineSmMobile" color={colors.headingDark}>
                    {parcels.length > 1 ? `Parcel ${index + 1} of ${parcels.length}` : 'Delivery'}
                  </Text>
                  <Text variant="captionSm" color={colors.captionGray}>
                    {parcel.pharmacyName}
                  </Text>
                </View>
                <StatusPill status={parcel.status} />
              </View>

              <View style={[styles.speed, parcel.speed === 'EXPRESS' && styles.speedExpress]}>
                <Icon
                  name={parcel.speed === 'EXPRESS' ? 'bolt' : 'local_shipping'}
                  size={14}
                  color={parcel.speed === 'EXPRESS' ? colors.successDark : colors.captionGray}
                />
                <Text
                  variant="captionSm"
                  weight="medium"
                  color={parcel.speed === 'EXPRESS' ? colors.successDark : colors.captionGray}
                >
                  {parcel.speed === 'EXPRESS' ? 'Express · under 30 min' : 'Standard · 2 days'}
                </Text>
              </View>

              {parcelCancelled ? (
                <Text variant="captionSm" color={colors.error}>
                  {parcel.cancelReason ?? 'This parcel was cancelled.'}
                </Text>
              ) : (
                STAGES.map((stage, i) => {
                  const done = i <= stageIndex;
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
                          <View style={[styles.stageLine, i < stageIndex && styles.stageLineDone]} />
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
                        {/*
                          The row the parcel is actually on says what is
                          happening now; the rest keep their fixed caption.

                          The server tells six stages apart where this timeline
                          has four dots — packed-and-waiting from rider-coming,
                          out-for-delivery from arriving-soon. Reading the
                          server's line here is what makes that difference
                          visible, instead of a parcel two streets away sharing
                          "On the way to you" with one that just left the shop.
                        */}
                        <Text
                          variant="captionSm"
                          weight={i === stageIndex ? 'medium' : 'regular'}
                          color={i === stageIndex ? colors.onSurface : colors.captionGray}
                        >
                          {i === stageIndex ? parcel.stageText ?? stage.caption : stage.caption}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}

              {/*
                Where it has got to, in place names.
                Only present once a rider is carrying it and has moved through
                somewhere worth naming, so it stays absent on a local hop.
              */}
              {parcel.journey.length > 0 ? (
                <>
                  <View style={styles.rule} />
                  <View style={styles.journey}>
                    <Text variant="labelMd" weight="semibold" color={colors.headingDark}>
                      Where it has reached
                    </Text>
                    {parcel.journey
                      .slice()
                      .reverse()
                      .slice(0, 4)
                      .map((leg, i) => (
                        <View key={`${leg.place}-${leg.at}`} style={styles.legRow}>
                          <Icon
                            name={i === 0 ? 'my_location' : 'place'}
                            size={14}
                            color={i === 0 ? colors.primary : colors.captionGray}
                          />
                          <Text
                            variant="captionSm"
                            weight={i === 0 ? 'semibold' : 'regular'}
                            color={i === 0 ? colors.onSurface : colors.captionGray}
                            style={styles.flex}
                          >
                            {leg.place}
                          </Text>
                          <Text variant="captionSm" color={colors.captionGray}>
                            {new Date(leg.at).toLocaleTimeString(undefined, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Text>
                        </View>
                      ))}
                  </View>
                </>
              ) : null}

              <View style={styles.rule} />

              {parcel.items.map((item) => (
                <View key={item.medicineId} style={styles.itemRow}>
                  <View style={styles.itemThumb}>
                    <Icon name="pill" size={18} color={colors.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text variant="bodyMd" color={colors.headingDark} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      {item.quantity} × {rupees(item.price)}
                    </Text>
                  </View>
                  <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
                    {rupees(item.itemTotal)}
                  </Text>
                </View>
              ))}
            </Card>
          );
        })}

        <Card style={styles.items}>
          <View style={styles.itemRow}>
            <Text variant="bodyMd" weight="semibold" color={colors.headingDark} style={styles.flex}>
              Order total
            </Text>
            <Text variant="displayBold" color={colors.primary}>
              {rupees(order.totalAmount)}
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
  parcelHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.insetCard },
  speed: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.inlineSm,
    paddingHorizontal: spacing.base,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceContainerHigh,
  },
  speedExpress: { backgroundColor: colors.successLight },
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
  journey: { gap: 6 },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rule: { height: 1, backgroundColor: colors.outlineVariant },
});
