import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  DocumentUploader,
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
  acceptLabOrder,
  attachLabReport,
  colors,
  errorMessage,
  fetchLabQueue,
  radius,
  spacing,
  updateLabOrderStatus,
  useAsync,
  type LabOrder,
  type LabOrderStatus,
} from '@healthbuddy/shared';

const FILTERS: { label: string; value?: LabOrderStatus }[] = [
  { label: 'All' },
  { label: 'New', value: 'BOOKED' },
  { label: 'Accepted', value: 'ACCEPTED' },
  { label: 'Collected', value: 'SAMPLE_COLLECTED' },
  { label: 'Processing', value: 'PROCESSING' },
  { label: 'Completed', value: 'COMPLETED' },
];

const NEXT_STATUS: Partial<Record<LabOrderStatus, { label: string; status: LabOrderStatus }>> = {
  ACCEPTED: { label: 'Sample collected', status: 'SAMPLE_COLLECTED' },
  SAMPLE_COLLECTED: { label: 'Start processing', status: 'PROCESSING' },
};

/**
 * The lab's working queue: accept a booking, collect the sample, then upload
 * the report.
 *
 * Reports are uploaded as private documents and attached to the order — never
 * written as a public URL, because anyone holding that URL would be able to
 * read a patient's results without logging in.
 */
export const BookingsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [filter, setFilter] = useState<LabOrderStatus | undefined>(undefined);
  const queue = useAsync(() => fetchLabQueue(filter), [filter]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const orders = queue.data ?? [];
    return {
      open: orders.filter((o) => o.status === 'BOOKED').length,
      active: orders.filter((o) =>
        ['ACCEPTED', 'SAMPLE_COLLECTED', 'PROCESSING'].includes(o.status)
      ).length,
      done: orders.filter((o) => o.status === 'COMPLETED').length,
    };
  }, [queue.data]);

  const accept = async (order: LabOrder) => {
    setBusyId(order.id);
    try {
      await acceptLabOrder(order.id);
      queue.reload();
    } catch (err) {
      Alert.alert('Could not accept', errorMessage(err));
      queue.reload();
    } finally {
      setBusyId(null);
    }
  };

  const advance = async (order: LabOrder, status: LabOrderStatus) => {
    setBusyId(order.id);
    try {
      await updateLabOrderStatus(order.id, status);
      queue.reload();
    } catch (err) {
      Alert.alert('Could not update', errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  /** Publishing the report is what completes the order and notifies the patient. */
  const publish = async (order: LabOrder) => {
    const report = order.documents?.find((d) => d.kind === 'LAB_REPORT');
    if (!report) {
      Alert.alert('No report attached', 'Upload the report file before completing this booking.');
      return;
    }

    setBusyId(order.id);
    try {
      await attachLabReport(order.id, report.id);
      queue.reload();
    } catch (err) {
      Alert.alert('Could not publish report', errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  if (queue.loading) return <Loading label="Loading bookings" />;
  if (queue.error) return <ErrorState message={queue.error} onRetry={queue.reload} />;

  const orders = queue.data ?? [];

  return (
    <Screen scroll refreshing={queue.refreshing} onRefresh={queue.refresh}>
      <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

      <View style={styles.stats}>
        <StatTile value={String(counts.open)} label="New" icon="inbox" emphasis />
        <StatTile value={String(counts.active)} label="In progress" icon="science" />
        <StatTile value={String(counts.done)} label="Completed" icon="task_alt" />
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

      <SectionHeader title={`Bookings (${orders.length})`} />

      {orders.length === 0 ? (
        <EmptyState
          icon="science"
          title="No bookings here"
          message="New test bookings from patients will appear as soon as they are placed."
        />
      ) : (
        <View style={styles.list}>
          {orders.map((order) => {
            const next = NEXT_STATUS[order.status];
            const unclaimed = order.status === 'BOOKED' && !order.labPartnerId;
            const readyForReport = order.status === 'PROCESSING';

            return (
              <Card key={order.id} style={styles.order}>
                <View style={styles.orderHeader}>
                  <View style={styles.flex}>
                    <Text variant="labelMd" weight="bold" color={colors.onSurface}>
                      {order.testName}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      {order.patient?.fullName ?? 'Patient'}
                      {order.patient?.age ? ` · ${order.patient.age}y` : ''}
                      {order.patient?.gender ? ` · ${order.patient.gender}` : ''}
                    </Text>
                  </View>
                  <StatusPill status={order.status} />
                </View>

                {order.address ? (
                  <View style={styles.address}>
                    <Icon name="home_pin" size={14} color={colors.captionGray} />
                    <Text variant="captionSm" color={colors.captionGray} style={styles.flex}>
                      {order.address}
                    </Text>
                  </View>
                ) : null}

                {readyForReport ? (
                  <DocumentUploader
                    label="Test report"
                    hint="PDF or a clear photo. Only the patient and their treating doctor can open it."
                    kind="LAB_REPORT"
                    labOrderId={order.id}
                    documents={order.documents?.filter((d) => d.kind === 'LAB_REPORT') ?? []}
                    onChange={queue.reload}
                    required
                  />
                ) : null}

                <View style={styles.footer}>
                  <Text variant="headlineSm" weight="bold" color={colors.primary}>
                    ₹{order.price}
                  </Text>

                  {unclaimed ? (
                    <Button
                      label="Accept booking"
                      size="sm"
                      onPress={() => void accept(order)}
                      loading={busyId === order.id}
                    />
                  ) : readyForReport ? (
                    <Button
                      label="Publish report"
                      size="sm"
                      icon="send"
                      onPress={() => void publish(order)}
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
                    <Badge
                      label={order.status === 'COMPLETED' ? 'Report sent' : 'Closed'}
                      tint={order.status === 'COMPLETED' ? 'success' : 'neutral'}
                    />
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
  address: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.stackMedium,
    padding: spacing.insetCard,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
