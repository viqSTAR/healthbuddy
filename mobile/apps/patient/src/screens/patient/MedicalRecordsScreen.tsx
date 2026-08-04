import React, { useState } from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  Loading,
  Screen,
  StatusPill,
  Text,
  TopBar,
  colors,
  fetchMedicalRecords,
  radius,
  spacing,
  useAsync,
} from '@healthbuddy/shared';

type Tab = 'visits' | 'prescriptions' | 'reports';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Mirrors `medical_records` / `patient_history_prescriptions`. */
export const MedicalRecordsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [tab, setTab] = useState<Tab>('visits');
  const { data, loading, error, reload, refreshing, refresh } = useAsync(
    () => fetchMedicalRecords(),
    []
  );

  return (
    <Screen padded={false} refreshing={refreshing} onRefresh={refresh} bottomInset={spacing.xxl}>
      <TopBar title="Medical Records" />

      <View style={styles.tabs}>
        <Chip label="Visits" icon="event" tint="info" selected={tab === 'visits'} onPress={() => setTab('visits')} />
        <Chip
          label="Prescriptions"
          icon="description"
          tint="success"
          selected={tab === 'prescriptions'}
          onPress={() => setTab('prescriptions')}
        />
        <Chip
          label="Reports"
          icon="biotech"
          tint="warning"
          selected={tab === 'reports'}
          onPress={() => setTab('reports')}
        />
      </View>

      <View style={styles.page}>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : tab === 'visits' ? (
          data?.appointments.length ? (
            data.appointments.map((a) => (
              <Card key={a.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={styles.iconTile}>
                    <Icon name="stethoscope" size={20} color={colors.successDark} />
                  </View>
                  <View style={styles.flex}>
                    <Text variant="bodyMd" weight="semibold" color={colors.headingDark}>
                      {a.doctor?.name ?? 'Consultation'}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      {a.doctor?.specialty} · {a.slot ? `${a.slot.date} ${a.slot.startTime}` : formatDate(a.createdAt)}
                    </Text>
                  </View>
                  <StatusPill status={a.status} />
                </View>
                {a.symptoms ? (
                  <Text variant="captionSm" color={colors.onSurfaceVariant} numberOfLines={2}>
                    {a.symptoms}
                  </Text>
                ) : null}
              </Card>
            ))
          ) : (
            <EmptyState icon="event_busy" title="No visits yet" message="Your consultations will appear here." />
          )
        ) : tab === 'prescriptions' ? (
          data?.prescriptions.length ? (
            data.prescriptions.map((p) => (
              <Card
                key={p.id}
                style={styles.card}
                onPress={() => navigation.navigate('Prescription', { prescriptionId: p.id })}
              >
                <View style={styles.cardHead}>
                  <View style={[styles.iconTile, { backgroundColor: colors.successLight }]}>
                    <Icon name="description" size={20} color={colors.successDark} />
                  </View>
                  <View style={styles.flex}>
                    <Text variant="bodyMd" weight="semibold" color={colors.headingDark} numberOfLines={1}>
                      {p.diagnosis}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      {p.doctor?.name} · {formatDate(p.createdAt)}
                    </Text>
                  </View>
                  <Icon name="chevron_right" size={20} color={colors.captionGray} />
                </View>
                <Text variant="captionSm" color={colors.onSurfaceVariant}>
                  {p.medicines.length} {p.medicines.length === 1 ? 'medicine' : 'medicines'} prescribed
                </Text>
              </Card>
            ))
          ) : (
            <EmptyState icon="description" title="No prescriptions" message="Prescriptions from your doctors appear here." />
          )
        ) : data?.labOrders.length ? (
          data.labOrders.map((o) => (
            <Card
              key={o.id}
              style={styles.card}
              onPress={o.reportUrl ? () => Linking.openURL(o.reportUrl!) : undefined}
            >
              <View style={styles.cardHead}>
                <View style={[styles.iconTile, { backgroundColor: colors.warningLight }]}>
                  <Icon name="biotech" size={20} color={colors.warningDark} />
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyMd" weight="semibold" color={colors.headingDark} numberOfLines={1}>
                    {o.testName}
                  </Text>
                  <Text variant="captionSm" color={colors.captionGray}>
                    {formatDate(o.createdAt)}
                  </Text>
                </View>
                {o.reportUrl ? (
                  <Icon name="file_download" size={20} color={colors.primary} />
                ) : (
                  <StatusPill status={o.status} />
                )}
              </View>
            </Card>
          ))
        ) : (
          <EmptyState icon="biotech" title="No reports" message="Completed lab reports appear here." />
        )}
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: spacing.base,
    paddingHorizontal: spacing.insetPage,
    paddingBottom: spacing.insetPage,
  },
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.insetCard },
  card: { gap: spacing.insetCard },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.infoLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
});
