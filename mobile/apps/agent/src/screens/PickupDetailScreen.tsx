import React, { useState } from 'react';
import { View, StyleSheet, Linking, Platform } from 'react-native';
import {
  Alert,
  Badge,
  Button,
  Card,
  colors,
  ErrorState,
  errorMessage,
  fetchMyJobs,
  Icon,
  Loading,
  markSampleCollected,
  Screen,
  SectionHeader,
  spacing,
  Text,
  TopBar,
  useAsync,
} from '@healthbuddy/shared';

/**
 * A sample collection.
 *
 * Kept separate from a delivery on purpose: this is a visit to draw something
 * from a person, not a parcel handover, and the confirmation says so. Only
 * collectors a lab has taken on ever reach this screen — the server refuses
 * the transition for anyone else.
 */
export const PickupDetailScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { pickupId } = route.params as { pickupId: string };
  const jobs = useAsync(fetchMyJobs, []);
  const [busy, setBusy] = useState(false);

  const pickup = (jobs.data?.pickups ?? []).find((p) => p.id === pickupId);

  const navigateTo = (address: string) => {
    const query = encodeURIComponent(address);
    const url = Platform.select({ ios: `maps:0,0?q=${query}`, default: `geo:0,0?q=${query}` });
    void Linking.openURL(url!).catch(() =>
      void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`)
    );
  };

  const collect = () =>
    Alert.alert(
      'Sample collected?',
      'Confirm once the sample is labelled and with you. The patient is told it is on the way to the lab.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Collected',
          onPress: async () => {
            setBusy(true);
            try {
              await markSampleCollected(pickupId);
              navigation.goBack();
            } catch (err) {
              Alert.alert('Could not update', errorMessage(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );

  if (jobs.loading) return <Loading label="Loading pickup" />;
  if (jobs.error) return <ErrorState message={jobs.error} onRetry={jobs.reload} />;
  if (!pickup) {
    return <ErrorState message="This pickup is no longer assigned to you." />;
  }

  return (
    <Screen scroll refreshing={jobs.refreshing} onRefresh={jobs.refresh}>
      <TopBar title="Sample pickup" onBack={navigation.goBack} />

      <Card style={styles.header}>
        <View style={styles.flex}>
          <Text variant="headlineSm" weight="bold" color={colors.headingDark}>
            {pickup.testName}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {pickup.patientName ?? 'Patient'}
          </Text>
        </View>
        <Badge
          label={pickup.status === 'ACCEPTED' ? 'To collect' : 'Collected'}
          tint={pickup.status === 'ACCEPTED' ? 'warning' : 'success'}
        />
      </Card>

      {pickup.scheduledAt ? (
        <Card style={styles.row}>
          <Icon name="schedule" size={18} color={colors.primary} />
          <Text variant="labelMd" weight="semibold" color={colors.onSurface} style={styles.flex}>
            {new Date(pickup.scheduledAt).toLocaleString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </Card>
      ) : null}

      <SectionHeader title="Collect from" />
      <Card style={styles.leg}>
        <View style={styles.legRow}>
          <Icon name="location_on" size={18} color={colors.successDark} />
          <Text variant="bodyMd" color={colors.onSurface} style={styles.flex}>
            {pickup.address ?? 'Address is with the booking — call the patient.'}
          </Text>
        </View>
        <View style={styles.actions}>
          <Button
            label="Call"
            icon="call"
            variant="outline"
            size="sm"
            onPress={() => void Linking.openURL(`tel:${pickup.patientPhone}`)}
          />
          {pickup.address ? (
            <Button
              label="Directions"
              icon="navigation"
              variant="outline"
              size="sm"
              onPress={() => navigateTo(pickup.address!)}
            />
          ) : null}
        </View>
      </Card>

      {pickup.labPartner ? (
        <>
          <SectionHeader title="Drop at" />
          <Card style={styles.legRow}>
            <Icon name="science" size={18} color={colors.primary} />
            <View style={styles.flex}>
              <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                {pickup.labPartner.name}
              </Text>
              {pickup.labPartner.address ? (
                <Text variant="captionSm" color={colors.captionGray}>
                  {pickup.labPartner.address}
                </Text>
              ) : null}
            </View>
          </Card>
        </>
      ) : null}

      {pickup.status === 'ACCEPTED' ? (
        <View style={styles.primary}>
          <Button
            label="Sample collected"
            icon="science"
            loading={busy}
            onPress={collect}
            fullWidth
          />
        </View>
      ) : (
        <View style={styles.primary}>
          <Card background={colors.successLight} style={styles.row}>
            <Icon name="check_circle" size={20} color={colors.successDark} />
            <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
              Collected. Take it to the lab — they publish the report from there.
            </Text>
          </Card>
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.insetCard },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  leg: { gap: spacing.insetCard },
  legRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.insetCard },
  actions: { flexDirection: 'row', gap: spacing.insetCard },
  primary: { marginTop: spacing.insetPage },
});
