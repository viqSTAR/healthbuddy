import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import {
  Alert,
  Badge,
  Button,
  Card,
  colors,
  ErrorState,
  errorMessage,
  fetchAgentJob,
  Icon,
  Loading,
  radius,
  releaseJob,
  rupees,
  Screen,
  SectionHeader,
  spacing,
  StatusPill,
  Text,
  TopBar,
  updateAgentJobStatus,
  useAsync,
} from '@healthbuddy/shared';

import { useJobLocation } from '../services/useJobLocation';

/**
 * One job, end to end.
 *
 * The two things a rider actually needs are a way to reach the person and a
 * way to get to the door, so the phone number and the address are both one tap
 * — dialling and maps are handed to the OS rather than reimplemented.
 */
export const JobDetailScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { jobId } = route.params as { jobId: string };
  const job = useAsync(() => fetchAgentJob(jobId), [jobId]);
  const [busy, setBusy] = useState(false);

  /**
   * Position is reported only once the parcel is in the bag.
   *
   * Passing null before collection is what stops this being a tracker on a
   * person: there is nothing to follow until they are carrying something, and
   * the server refuses those reports too.
   */
  const carrying = job.data?.status === 'DISPATCHED';
  useJobLocation(carrying ? jobId : null);

  // Asked when it first becomes relevant, rather than on app launch, so the
  // prompt arrives with an obvious reason attached.
  useEffect(() => {
    if (!carrying) return;
    void Location.requestForegroundPermissionsAsync();
  }, [carrying]);

  const call = (phone: string) => void Linking.openURL(`tel:${phone}`);

  const navigate = (address: string) => {
    const query = encodeURIComponent(address);
    const url = Platform.select({
      ios: `maps:0,0?q=${query}`,
      default: `geo:0,0?q=${query}`,
    });
    void Linking.openURL(url!).catch(() =>
      void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`)
    );
  };

  const advance = async (status: 'DISPATCHED' | 'DELIVERED', codCollected?: boolean) => {
    setBusy(true);
    try {
      await updateAgentJobStatus(jobId, status, codCollected);
      if (status === 'DELIVERED') {
        navigation.goBack();
        return;
      }
      job.reload();
    } catch (err) {
      Alert.alert('Could not update', errorMessage(err));
      job.reload();
    } finally {
      setBusy(false);
    }
  };

  const hand = async () => {
    setBusy(true);
    try {
      await releaseJob(jobId);
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not hand it back', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Cash is confirmed out loud, not implied by a tap.
   *
   * Marking a cash order delivered is what settles it, so if the rider has not
   * actually been paid the shop would be recorded as settled against money
   * nobody is holding. The server refuses without this; the dialog is where it
   * is asked.
   */
  const deliver = () => {
    const owed = job.data?.cashToCollect;
    if (owed === null || owed === undefined) {
      void advance('DELIVERED');
      return;
    }

    Alert.alert(
      `Did you collect ${rupees(owed)}?`,
      'Only confirm once the cash is in your hand. This marks the order paid.',
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Yes, collected', onPress: () => void advance('DELIVERED', true) },
      ]
    );
  };

  if (job.loading) return <Loading label="Loading job" />;
  if (job.error || !job.data) {
    return <ErrorState message={job.error ?? 'This job is no longer yours.'} onRetry={job.reload} />;
  }

  const data = job.data;
  const collected = data.status !== 'PROCESSING';

  return (
    <Screen scroll refreshing={job.refreshing} onRefresh={job.refresh}>
      <TopBar title="Job" onBack={navigation.goBack} />

      <Card style={styles.header}>
        <View style={styles.flex}>
          <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
            {data.order.patientName ?? 'Patient'}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            #{data.order.id.slice(0, 8)} · {data.items.length} item(s)
            {data.order.shipmentCount > 1 ? ` · your part of ${data.order.shipmentCount}` : ''}
          </Text>
        </View>
        <StatusPill status={data.status} />
      </Card>

      {data.cashToCollect !== null ? (
        <Card background={colors.warningLight} style={styles.cash}>
          <Icon name="payments" size={22} color={colors.warningDark} />
          <View style={styles.flex}>
            <Text variant="headlineSm" weight="bold" color={colors.warningDark}>
              Collect {rupees(data.cashToCollect)}
            </Text>
            <Text variant="captionSm" color={colors.onSurface}>
              {data.order.shipmentCount > 1
                ? 'This is the whole order. Only one rider collects it — check with the shop if another parcel is coming.'
                : 'Cash on delivery. Collect before handing the parcel over.'}
            </Text>
          </View>
        </Card>
      ) : (
        <Card background={colors.successLight} style={styles.cash}>
          <Icon name="check_circle" size={22} color={colors.successDark} />
          <Text variant="labelMd" weight="semibold" color={colors.successDark} style={styles.flex}>
            Already paid — collect nothing at the door
          </Text>
        </Card>
      )}

      <SectionHeader title={collected ? 'Collected from' : 'Collect from'} />
      <Card style={styles.leg}>
        <View style={styles.legRow}>
          <Icon name="storefront" size={18} color={colors.primary} />
          <View style={styles.flex}>
            <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
              {data.pharmacy.name}
            </Text>
            <Text variant="captionSm" color={colors.captionGray}>
              {data.pharmacy.address}
              {data.pharmacy.pincode ? ` · ${data.pharmacy.pincode}` : ''}
            </Text>
          </View>
        </View>
        {!collected ? (
          <Button
            label="Directions to the shop"
            icon="navigation"
            variant="outline"
            size="sm"
            onPress={() => navigate(`${data.pharmacy.name}, ${data.pharmacy.address}`)}
            fullWidth
          />
        ) : null}
      </Card>

      <SectionHeader title="Deliver to" />
      <Card style={styles.leg}>
        <View style={styles.legRow}>
          <Icon name="location_on" size={18} color={colors.successDark} />
          <Text variant="bodyMd" color={colors.onSurface} style={styles.flex}>
            {data.order.address}
          </Text>
        </View>
        <View style={styles.actions}>
          <Button
            label="Call"
            icon="call"
            variant="outline"
            size="sm"
            onPress={() => call(data.order.patientPhone)}
          />
          <Button
            label="Directions"
            icon="navigation"
            variant="outline"
            size="sm"
            onPress={() => navigate(data.order.address)}
          />
        </View>
      </Card>

      <SectionHeader title="What you are carrying" />
      <Card padded={false}>
        <View style={styles.items}>
          {data.items.map((item) => (
            <View key={item.medicineId} style={styles.item}>
              <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
                {item.quantity} × {item.name}
              </Text>
              <Text variant="captionSm" weight="semibold" color={colors.onSurface}>
                {rupees(item.itemTotal)}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <View style={styles.primary}>
        {!collected ? (
          <>
            <Button
              label="I have collected the parcel"
              icon="inventory_2"
              loading={busy}
              onPress={() => void advance('DISPATCHED')}
              fullWidth
            />
            {/* Only before pickup — once it is in the bag, handing the job back
                would leave the shop's stock riding around the city. */}
            <Button
              label="Hand this job back"
              variant="ghost"
              size="sm"
              onPress={() =>
                Alert.alert('Hand this job back?', 'It returns to the pool for another rider.', [
                  { text: 'Keep it', style: 'cancel' },
                  { text: 'Hand back', style: 'destructive', onPress: () => void hand() },
                ])
              }
              fullWidth
            />
          </>
        ) : (
          <Button
            label="Mark delivered"
            icon="task_alt"
            loading={busy}
            onPress={deliver}
            fullWidth
          />
        )}
      </View>

      {data.status === 'DISPATCHED' ? (
        <View style={styles.hint}>
          <Badge label="On the way" tint="info" icon="local_shipping" />
        </View>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.insetCard },
  cash: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    marginTop: spacing.insetCard,
  },
  leg: { gap: spacing.insetCard },
  legRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.insetCard },
  actions: { flexDirection: 'row', gap: spacing.insetCard },
  items: {
    gap: spacing.stackTight,
    padding: spacing.insetCard,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  primary: { gap: spacing.stackMedium, marginTop: spacing.insetPage },
  hint: { alignItems: 'center', marginTop: spacing.insetCard },
});
