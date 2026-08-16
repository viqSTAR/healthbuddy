import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Badge,
  Card,
  colors,
  EmptyState,
  ErrorState,
  fetchMyJobs,
  Icon,
  Loading,
  rupees,
  Screen,
  SectionHeader,
  spacing,
  StatusPill,
  Text,
  TopBar,
  useAsync,
} from '@healthbuddy/shared';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

/**
 * What this agent is carrying right now.
 *
 * Parcels and sample collections in one list because they are one person's
 * afternoon. Pickups only appear at all for a collector a lab has taken on —
 * for everyone else the section is simply absent rather than empty, since an
 * empty "Pickups" heading reads like a fault.
 */
export const MyJobsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const jobs = useAsync(fetchMyJobs, []);

  if (jobs.loading) return <Loading label="Loading your jobs" />;
  if (jobs.error) return <ErrorState message={jobs.error} onRetry={jobs.reload} />;

  const deliveries = jobs.data?.deliveries ?? [];
  const pickups = jobs.data?.pickups ?? [];

  return (
    <Screen scroll refreshing={jobs.refreshing} onRefresh={jobs.refresh}>
      <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

      <SectionHeader title={`Deliveries (${deliveries.length})`} />

      {deliveries.length === 0 ? (
        <EmptyState
          icon="local_shipping"
          title="Nothing in hand"
          message="Take a job from the Available tab and it will show up here."
          actionLabel="Find jobs"
          onActionPress={() => navigation.navigate('Available')}
        />
      ) : (
        <View style={styles.list}>
          {deliveries.map((job) => (
            <Card
              key={job.id}
              onPress={() => navigation.navigate('JobDetail', { jobId: job.id })}
              style={styles.job}
            >
              <View style={styles.head}>
                <View style={styles.flex}>
                  <Text variant="labelMd" weight="bold" color={colors.onSurface}>
                    {job.order.patientName ?? 'Patient'}
                  </Text>
                  <Text variant="captionSm" color={colors.captionGray} numberOfLines={1}>
                    {job.order.address}
                  </Text>
                </View>
                <StatusPill status={job.status} />
              </View>

              <View style={styles.row}>
                <Icon name="storefront" size={14} color={colors.captionGray} />
                <Text variant="captionSm" color={colors.captionGray} style={styles.flex}>
                  {job.status === 'PROCESSING'
                    ? `Collect from ${job.pharmacy.name}`
                    : `Collected from ${job.pharmacy.name}`}
                </Text>
              </View>

              <View style={styles.footer}>
                {job.cashToCollect !== null ? (
                  <Badge
                    label={`Collect ${rupees(job.cashToCollect)}`}
                    tint="warning"
                    icon="payments"
                  />
                ) : (
                  <Badge label="Prepaid" tint="success" icon="check_circle" />
                )}
                <Icon name="chevron_right" size={20} color={colors.captionGray} />
              </View>
            </Card>
          ))}
        </View>
      )}

      {pickups.length > 0 ? (
        <>
          <SectionHeader title={`Sample pickups (${pickups.length})`} />
          <View style={styles.list}>
            {pickups.map((pickup) => (
              <Card
                key={pickup.id}
                onPress={() => navigation.navigate('PickupDetail', { pickupId: pickup.id })}
                style={styles.job}
              >
                <View style={styles.head}>
                  <View style={styles.flex}>
                    <Text variant="labelMd" weight="bold" color={colors.onSurface}>
                      {pickup.testName}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      {pickup.patientName ?? 'Patient'}
                      {when(pickup.scheduledAt) ? ` · ${when(pickup.scheduledAt)}` : ''}
                    </Text>
                  </View>
                  <Badge
                    label={pickup.status === 'ACCEPTED' ? 'To collect' : 'Collected'}
                    tint={pickup.status === 'ACCEPTED' ? 'warning' : 'success'}
                  />
                </View>
                <View style={styles.row}>
                  <Icon name="location_on" size={14} color={colors.captionGray} />
                  <Text variant="captionSm" color={colors.captionGray} style={styles.flex}>
                    {pickup.address ?? 'Address with the booking'}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.insetCard },
  job: { gap: spacing.stackMedium },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.base },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.stackMedium },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
