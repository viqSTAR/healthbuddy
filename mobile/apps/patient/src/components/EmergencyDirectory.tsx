import React from 'react';
import { View, StyleSheet, Linking, Pressable, Alert } from 'react-native';
import {
  Badge,
  Card,
  Icon,
  Loading,
  SectionHeader,
  Text,
  colors,
  fetchEmergencyServices,
  radius,
  spacing,
  useAsync,
  type EmergencyServiceEntry,
  type EmergencyServiceType,
} from '@healthbuddy/shared';

const ICONS: Record<EmergencyServiceType, string> = {
  AMBULANCE: 'ambulance',
  HOSPITAL: 'hospital_building',
  BLOOD_BANK: 'bloodtype',
  POISON_CONTROL: 'health_and_safety',
  MENTAL_HEALTH: 'support_agent',
};

const LABELS: Record<EmergencyServiceType, string> = {
  AMBULANCE: 'Ambulance',
  HOSPITAL: 'Hospital',
  BLOOD_BANK: 'Blood bank',
  POISON_CONTROL: 'Health helpline',
  MENTAL_HEALTH: 'Mental health',
};

/**
 * Ambulance and hospital numbers, nearest first.
 *
 * One tap dials. This is deliberately a directory rather than a dispatch
 * integration — calling an ambulance is a phone call, and the useful thing an
 * app can do in an emergency is put the right number one tap away instead of
 * pretending to send a vehicle.
 *
 * National numbers always render, so the panel is never empty somewhere with no
 * local listings.
 */
export const EmergencyDirectory: React.FC<{
  latitude?: number | undefined;
  longitude?: number | undefined;
}> = ({ latitude, longitude }) => {
  const directory = useAsync(
    () =>
      fetchEmergencyServices({
        ...(latitude !== undefined ? { latitude } : {}),
        ...(longitude !== undefined ? { longitude } : {}),
      }),
    [latitude, longitude]
  );

  const call = (service: EmergencyServiceEntry) => {
    const number = service.phone.replace(/\s/g, '');
    Linking.openURL(`tel:${number}`).catch(() =>
      Alert.alert('Could not open the dialler', `Call ${service.phone} manually.`)
    );
  };

  if (directory.loading) return <Loading label="Finding help nearby" />;

  // A failure here must not blank the SOS screen — the national numbers are the
  // point, and they are worth showing even offline.
  const nearby = directory.data?.nearby ?? [];
  const national = directory.data?.national ?? [];

  return (
    <>
      {nearby.length > 0 ? (
        <>
          <SectionHeader title="Nearest to you" />
          <View style={styles.list}>
            {nearby.slice(0, 6).map((service) => (
              <ServiceRow key={service.id} service={service} onCall={() => call(service)} />
            ))}
          </View>
        </>
      ) : null}

      <SectionHeader title="Emergency numbers" />
      <View style={styles.list}>
        {national.map((service) => (
          <ServiceRow key={service.id} service={service} onCall={() => call(service)} />
        ))}
      </View>

      {directory.error ? (
        <Text variant="captionSm" color={colors.captionGray} center style={styles.offline}>
          Could not load nearby services. The numbers above still work.
        </Text>
      ) : null}
    </>
  );
};

const ServiceRow: React.FC<{ service: EmergencyServiceEntry; onCall: () => void }> = ({
  service,
  onCall,
}) => (
  <Pressable onPress={onCall}>
    <Card style={styles.row}>
      <View style={styles.iconBox}>
        <Icon name={ICONS[service.type]} size={22} color={colors.error} />
      </View>

      <View style={styles.flex}>
        <Text variant="labelMd" weight="bold" color={colors.onSurface}>
          {service.name}
        </Text>
        <Text variant="captionSm" color={colors.captionGray}>
          {LABELS[service.type]}
          {service.distanceKm !== null ? ` · ${service.distanceKm} km` : ''}
          {service.is24x7 ? ' · 24×7' : ''}
        </Text>
        {service.notes ? (
          <Text variant="captionSm" color={colors.captionGray} numberOfLines={2}>
            {service.notes}
          </Text>
        ) : null}
      </View>

      <View style={styles.callBlock}>
        <Text variant="labelMd" weight="bold" color={colors.error}>
          {service.phone}
        </Text>
        <Badge label="Call" tint="danger" icon="call" />
      </View>
    </Card>
  </Pressable>
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.insetCard },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBlock: { alignItems: 'flex-end', gap: spacing.stackTight },
  offline: { marginTop: spacing.insetCard },
});
