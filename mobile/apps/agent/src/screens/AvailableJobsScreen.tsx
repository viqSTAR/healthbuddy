import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Alert,
  Badge,
  Button,
  Card,
  claimJob,
  colors,
  EmptyState,
  errorMessage,
  ErrorState,
  fetchAvailableJobs,
  fetchMyAgentProfile,
  Icon,
  Loading,
  radius,
  rupees,
  Screen,
  SectionHeader,
  spacing,
  StatTile,
  Text,
  TopBar,
  updateMyAgentProfile,
  useAsync,
  type AvailableJob,
} from '@healthbuddy/shared';

const waitingFor = (iso: string) => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

/**
 * The open pool.
 *
 * Every card here is a parcel nobody has taken. It says which shop to collect
 * from, roughly where it is going, what it is worth and what to collect at the
 * door — and deliberately says nothing about who is waiting for it. The name,
 * the phone number and the street address arrive with the job once it is
 * claimed, so this screen cannot be read as a list of who is expecting
 * medicine and where they live.
 */
export const AvailableJobsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const profile = useAsync(fetchMyAgentProfile, []);
  const pool = useAsync(fetchAvailableJobs, []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const goOnShift = async (isAvailable: boolean) => {
    setSwitching(true);
    profile.setData((prev) => ({ ...prev!, isAvailable }));
    try {
      await updateMyAgentProfile({ isAvailable });
      pool.reload();
    } catch (err) {
      profile.setData((prev) => ({ ...prev!, isAvailable: !isAvailable }));
      Alert.alert('Could not change your shift', errorMessage(err));
    } finally {
      setSwitching(false);
    }
  };

  const take = async (job: AvailableJob) => {
    setBusyId(job.id);
    try {
      const claimed = await claimJob(job.id);
      pool.reload();
      navigation.navigate('JobDetail', { jobId: claimed.id });
    } catch (err) {
      // Losing a race is ordinary, so refresh rather than leaving a job on
      // screen that somebody else is already riding to collect.
      Alert.alert('Could not take this job', errorMessage(err));
      pool.reload();
    } finally {
      setBusyId(null);
    }
  };

  if (profile.loading) return <Loading label="Loading your day" />;

  const agent = profile.data;

  /**
   * Verification is refused as an error by the server rather than an empty
   * list, so it is worth saying plainly instead of showing "no jobs" to
   * someone who is waiting to be approved.
   */
  if (agent && !agent.verifiedAt) {
    return (
      /*
        Refreshable, because being verified is the one thing this screen is
        waiting for. Without it an agent approved while the app was open sat
        here indefinitely with no way forward but killing the app.
      */
      <Screen scroll refreshing={profile.refreshing} onRefresh={profile.refresh}>
        <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />
        <EmptyState
          icon="hourglass_top"
          title="We are checking your details"
          message="A job shows you someone's home address, so we verify every agent before the first one. Pull down to check again — jobs appear here as soon as it is done."
          actionLabel="Check now"
          onActionPress={profile.reload}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll refreshing={pool.refreshing} onRefresh={pool.refresh}>
      <TopBar brand onNotificationsPress={() => navigation.navigate('Notifications')} />

      <Card style={styles.shift}>
        <View style={styles.flex}>
          <Text variant="labelMd" weight="bold" color={colors.headingDark}>
            {agent?.isAvailable ? 'You are on shift' : 'You are off shift'}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {agent?.isAvailable
              ? `Showing parcels for ${agent.serviceAreas.join(', ')}`
              : 'Go on shift to start taking jobs.'}
          </Text>
        </View>
        <Button
          label={agent?.isAvailable ? 'End shift' : 'Go on shift'}
          size="sm"
          variant={agent?.isAvailable ? 'outline' : 'primary'}
          loading={switching}
          onPress={() => void goOnShift(!agent?.isAvailable)}
        />
      </Card>

      {pool.loading ? (
        <Loading label="Looking for jobs" />
      ) : pool.error ? (
        <ErrorState message={pool.error} onRetry={pool.reload} />
      ) : (
        <>
          <View style={styles.stats}>
            <StatTile value={String(pool.data?.length ?? 0)} label="Available" icon="explore" emphasis />
            <StatTile
              value={String((pool.data ?? []).filter((j) => j.express).length)}
              label="Express"
              icon="bolt"
            />
            <StatTile
              value={String((pool.data ?? []).filter((j) => j.cashToCollect !== null).length)}
              label="Cash jobs"
              icon="payments"
            />
          </View>

          <SectionHeader title={`Jobs near you (${pool.data?.length ?? 0})`} />

          {(pool.data ?? []).length === 0 ? (
            <EmptyState
              icon="explore_off"
              title="Nothing waiting right now"
              message="Parcels packed and ready in your areas will show up here. Pull down to check again."
            />
          ) : (
            <View style={styles.list}>
              {(pool.data ?? []).map((job) => (
                <Card key={job.id} style={styles.job}>
                  <View style={styles.jobHead}>
                    <View style={styles.flex}>
                      <Text variant="labelMd" weight="bold" color={colors.onSurface}>
                        {job.collectFrom.name}
                      </Text>
                      <Text variant="captionSm" color={colors.captionGray}>
                        {job.itemCount} item(s) · packed {waitingFor(job.waitingSince)}
                      </Text>
                    </View>
                    {job.express ? <Badge label="Express" tint="warning" icon="bolt" /> : null}
                  </View>

                  <View style={styles.leg}>
                    <Icon name="storefront" size={16} color={colors.primary} />
                    <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
                      Collect from {job.collectFrom.address}
                      {job.collectFrom.pincode ? ` · ${job.collectFrom.pincode}` : ''}
                    </Text>
                  </View>

                  {/* An area, not an address — that comes with the job. */}
                  <View style={styles.leg}>
                    <Icon name="location_on" size={16} color={colors.successDark} />
                    <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
                      Deliver to {job.deliverToPincode ?? 'nearby'} · full address once you take it
                    </Text>
                  </View>

                  {job.cashToCollect !== null ? (
                    <View style={styles.leg}>
                      <Icon name="payments" size={16} color={colors.warningDark} />
                      <Text variant="captionSm" weight="semibold" color={colors.warningDark}>
                        Collect {rupees(job.cashToCollect)} at the door
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.leg}>
                      <Icon name="check_circle" size={16} color={colors.successDark} />
                      <Text variant="captionSm" color={colors.successDark}>
                        Already paid — nothing to collect
                      </Text>
                    </View>
                  )}

                  {job.partOfSplitOrder ? (
                    <Text variant="captionSm" color={colors.captionGray}>
                      Part of a larger order — another rider carries the rest.
                    </Text>
                  ) : null}

                  <View style={styles.footer}>
                    <Text variant="headlineSm" weight="bold" color={colors.primary}>
                      {rupees(job.parcelValue)}
                    </Text>
                    <Button
                      label="Take this job"
                      size="sm"
                      loading={busyId === job.id}
                      disabled={!agent?.isAvailable}
                      onPress={() => void take(job)}
                    />
                  </View>
                </Card>
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shift: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  stats: { flexDirection: 'row', gap: spacing.insetCard, marginVertical: spacing.insetPage },
  list: { gap: spacing.insetCard },
  job: { gap: spacing.stackMedium },
  jobHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.base },
  leg: { flexDirection: 'row', alignItems: 'center', gap: spacing.stackMedium },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.base,
    paddingTop: spacing.insetCard,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant,
    borderRadius: radius.sm,
  },
});
