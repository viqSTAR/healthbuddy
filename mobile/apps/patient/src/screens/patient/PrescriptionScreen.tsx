import React from 'react';
import { View, StyleSheet, Share } from 'react-native';
import {
  Avatar,
  Button,
  Card,
  ErrorState,
  Icon,
  Loading,
  Screen,
  Text,
  TopBar,
  colors,
  fetchPrescription,
  radius,
  spacing,
  useAsync,
} from '@healthbuddy/shared';

/** Mirrors `digital_prescription`: letterhead, patient block, medicine table. */
export const PrescriptionScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { prescriptionId } = route.params;
  const { data, loading, error, reload } = useAsync(
    () => fetchPrescription(prescriptionId),
    [prescriptionId]
  );

  const share = async () => {
    if (!data) return;
    const body = [
      `Health Buddy — Digital Prescription`,
      `Diagnosis: ${data.diagnosis}`,
      '',
      ...data.medicines.map(
        (m, i) =>
          `${i + 1}. ${m.name} — ${m.dosage}, ${m.frequency}${
            m.durationDays ? ` for ${m.durationDays} days` : ''
          }`
      ),
      data.notes ? `\nNotes: ${data.notes}` : '',
    ].join('\n');

    await Share.share({ message: body });
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <TopBar title="Prescription" onBack={navigation.goBack} />
        <Loading />
      </Screen>
    );
  }

  if (error || !data) {
    return (
      <Screen scroll={false}>
        <TopBar title="Prescription" onBack={navigation.goBack} />
        <ErrorState message={error ?? 'Prescription not found.'} onRetry={reload} />
      </Screen>
    );
  }

  return (
    <Screen padded={false} bottomInset={spacing.xxl}>
      <TopBar title="Digital Prescription" onBack={navigation.goBack} />

      <View style={styles.page}>
        <Card style={styles.letterhead}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Icon name="spa" size={22} color={colors.onPrimary} />
            </View>
            <View style={styles.flex}>
              <Text variant="headlineSmMobile" color={colors.primary}>
                Health Buddy
              </Text>
              <Text variant="captionSm" color={colors.captionGray}>
                Verified digital prescription
              </Text>
            </View>
            <Icon name="verified" size={22} color={colors.successDark} />
          </View>

          <View style={styles.rule} />

          <View style={styles.doctorRow}>
            <Avatar name={data.doctor?.name} size={44} tint="success" />
            <View style={styles.flex}>
              <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
                {data.doctor?.name}
              </Text>
              <Text variant="captionSm" color={colors.captionGray}>
                {data.doctor?.specialty}
              </Text>
            </View>
            <View style={styles.dateBlock}>
              <Text variant="captionSm" color={colors.captionGray}>
                Issued
              </Text>
              <Text variant="captionSm" weight="medium" color={colors.headingDark}>
                {new Date(data.createdAt).toLocaleDateString()}
              </Text>
            </View>
          </View>
        </Card>

        <Card style={styles.block}>
          <Text variant="captionSm" weight="medium" color={colors.primary} uppercase>
            Patient
          </Text>
          <Text variant="headlineSmMobile" color={colors.headingDark}>
            {data.patient?.fullName ?? 'Patient'}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {[data.patient?.age ? `${data.patient.age} yrs` : null, data.patient?.gender]
              .filter(Boolean)
              .join(' · ') || 'Details on file'}
          </Text>
        </Card>

        <Card style={styles.block}>
          <Text variant="captionSm" weight="medium" color={colors.primary} uppercase>
            Diagnosis
          </Text>
          <Text variant="bodyMd" color={colors.headingDark}>
            {data.diagnosis}
          </Text>
        </Card>

        <Card style={styles.block}>
          <Text variant="captionSm" weight="medium" color={colors.primary} uppercase>
            Medicines
          </Text>

          {data.medicines.map((m, i) => (
            <View key={`${m.name}-${i}`} style={styles.medicineRow}>
              <View style={styles.medicineIndex}>
                <Text variant="captionSm" weight="bold" color={colors.primary}>
                  {i + 1}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
                  {m.name}
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  {m.dosage} · {m.frequency}
                  {m.durationDays ? ` · ${m.durationDays} days` : ''}
                </Text>
              </View>
            </View>
          ))}
        </Card>

        {data.notes ? (
          <Card background={colors.infoLight} style={styles.notes}>
            <Icon name="sticky_note_2" size={18} color={colors.secondary} />
            <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
              {data.notes}
            </Text>
          </Card>
        ) : null}

        <View style={styles.actions}>
          <Button label="Share" icon="share" variant="outline" onPress={share} style={styles.flex} />
          <Button
            label="Order medicines"
            icon="shopping_cart"
            onPress={() => navigation.navigate('Pharmacy')}
            style={styles.flex}
          />
        </View>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.insetPage },
  letterhead: { gap: spacing.insetPage },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  brandMark: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  rule: { height: 1, backgroundColor: colors.outlineVariant },
  doctorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  dateBlock: { alignItems: 'flex-end' },
  block: { gap: spacing.base },
  medicineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard, marginTop: spacing.base },
  medicineIndex: {
    width: 26,
    height: 26,
    borderRadius: radius.base,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notes: { flexDirection: 'row', gap: spacing.insetCard, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', gap: spacing.insetCard },
});
