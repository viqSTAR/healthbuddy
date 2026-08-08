import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, Linking, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  colors,
  errorMessage,
  fetchDoctors,
  Icon,
  radius,
  Screen,
  SectionHeader,
  spacing,
  Text,
  TopBar,
  triggerSOS,
  useAsync,
  type EmergencySOS,
} from '@healthbuddy/shared';
import { EmergencyDirectory } from '../../components/EmergencyDirectory';

const CONTROL_NUMBER = '+18005559111';

/**
 * Mirrors `emergency_services`: big SOS button, ambulance card, service tiles,
 * nearby facilities and doctors.
 *
 * The device's real GPS position is used. The original implementation posted a
 * hardcoded San Francisco coordinate pair, which would have dispatched help to
 * the wrong place for every user.
 */
export const EmergencySosScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [dispatching, setDispatching] = useState(false);
  const [sos, setSos] = useState<EmergencySOS | null>(null);
  /** Kept so the directory below can rank services by real distance. */
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const doctors = useAsync(() => fetchDoctors(), []);

  const resolvePosition = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error(
        'Location permission is required so responders can find you. Enable it in Settings.'
      );
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return position.coords;
  }, []);

  const trigger = useCallback(async () => {
    setDispatching(true);
    try {
      const position = await resolvePosition();
      setCoords({ latitude: position.latitude, longitude: position.longitude });
      const created = await triggerSOS(position.latitude, position.longitude);
      setSos(created);
    } catch (err) {
      Alert.alert(
        'SOS failed',
        err instanceof Error && err.message.includes('permission')
          ? err.message
          : errorMessage(err, 'Could not dispatch emergency services.')
      );
    } finally {
      setDispatching(false);
    }
  }, [resolvePosition]);

  const confirmTrigger = () =>
    Alert.alert(
      'Send emergency SOS?',
      'This shares your live location with emergency responders.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send SOS', style: 'destructive', onPress: () => void trigger() },
      ]
    );

  const call = () => Linking.openURL(`tel:${CONTROL_NUMBER}`);

  return (
    <Screen padded={false} bottomInset={spacing.xxl}>
      <TopBar title="Emergency Services" onBack={navigation.canGoBack() ? navigation.goBack : undefined} />

      <View style={styles.page}>
        {sos ? (
          <Card style={styles.activeCard}>
            <Badge label="Ambulance en route" tint="danger" icon="ambulance" />
            <Text variant="displayBold" color={colors.headingDark} center>
              Help is on the way
            </Text>
            <Text variant="bodyMd" color={colors.captionGray} center>
              Your live location has been shared with the dispatch team.
            </Text>

            <View style={styles.coords}>
              <Icon name="fmd_good" size={16} color={colors.primary} />
              <Text variant="captionSm" weight="medium" color={colors.primary}>
                {sos.latitude.toFixed(4)}, {sos.longitude.toFixed(4)}
              </Text>
            </View>

            <Button label="Call dispatch control" icon="phone" fullWidth onPress={call} />
          </Card>
        ) : (
          <View style={styles.sosWrap}>
            <Pressable
              onPress={confirmTrigger}
              disabled={dispatching}
              accessibilityRole="button"
              accessibilityLabel="Send emergency SOS"
              style={({ pressed }) => [styles.sosButton, pressed && styles.sosPressed]}
            >
              {dispatching ? (
                <ActivityIndicator size="large" color={colors.onError} />
              ) : (
                <>
                  <Icon name="emergency" size={60} color={colors.onError} />
                  <Text variant="displayBold" color={colors.onError}>
                    SOS
                  </Text>
                </>
              )}
            </Pressable>
            <Text variant="captionSm" color={colors.captionGray} center>
              Press and confirm for immediate assistance
            </Text>
          </View>
        )}

        <Card padding={spacing.insetCard} style={styles.ambulanceCard}>
          <View style={styles.ambulanceIcon}>
            <Icon name="ambulance" size={22} color={colors.error} />
          </View>
          <View style={styles.flex}>
            <Text variant="headlineSmMobile" color={colors.headingDark}>
              Book Ambulance
            </Text>
            <Text variant="captionSm" color={colors.captionGray}>
              24/7 Priority Support
            </Text>
          </View>
          <Button label="Call Now" size="md" onPress={call} />
        </Card>

        {/*
          Real, area-aware numbers replacing the hardcoded US 911 tiles and the
          decorative map. National numbers always render, so this is never empty.
        */}
        <EmergencyDirectory
          latitude={coords?.latitude}
          longitude={coords?.longitude}
        />

        <View style={styles.doctorList}>
          <SectionHeader title="Doctors Nearby" />
          {(doctors.data?.doctors ?? []).slice(0, 3).map((doctor) => (
            <Card key={doctor.id} padding={spacing.insetCard} style={styles.doctorRow}>
              <Avatar name={doctor.name} size={48} tint="success" />
              <View style={styles.flex}>
                <Text variant="captionSm" weight="bold" color={colors.successDark} uppercase>
                  {doctor.isAvailable ? 'Available now' : 'Verified'}
                </Text>
                <Text variant="headlineSmMobile" color={colors.headingDark} numberOfLines={1}>
                  {doctor.name}
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  {doctor.specialty}
                </Text>
              </View>
              <Pressable
                onPress={() => navigation.navigate('DoctorProfile', { doctorId: doctor.id })}
                style={styles.callButton}
                accessibilityLabel={`Contact ${doctor.name}`}
              >
                <Icon name="phone" size={20} color={colors.successDark} />
              </Pressable>
            </Card>
          ))}
        </View>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.lg },
  sosWrap: { alignItems: 'center', gap: spacing.insetPage, paddingVertical: spacing.lg },
  sosButton: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.base,
  },
  sosPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  activeCard: { alignItems: 'center', gap: spacing.insetCard },
  coords: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.stackMedium,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.insetCard,
    paddingVertical: spacing.base,
    borderRadius: radius.base,
  },
  ambulanceCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  ambulanceIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  serviceRow: { flexDirection: 'row', gap: spacing.insetCard },
  serviceTile: { flex: 1, alignItems: 'center', gap: spacing.base },
  serviceIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPlaceholder: {
    height: 180,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPill: {
    position: 'absolute',
    left: spacing.insetPage,
    bottom: spacing.insetPage,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.stackMedium,
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: spacing.insetCard,
    paddingVertical: spacing.base,
    borderRadius: radius.full,
  },
  mapDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  doctorList: { gap: spacing.insetCard },
  doctorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  callButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
