import React, { useState } from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Icon,
  Loading,
  Screen,
  SectionHeader,
  StatusPill,
  Text,
  TopBar,
  colors,
  Alert,
  errorMessage,
  fetchVisit,
  prescriptionPrintUrl,
  reorderPrescription,
  radius,
  rupees,
  spacing,
  useAsync,
  type JoinState,
} from '@healthbuddy/shared';

const formatDay = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

const countdown = (minutes: number): string => {
  if (minutes < 60) return `Opens in ${minutes} min`;
  if (minutes < 60 * 24) return `Opens in ${Math.round(minutes / 60)} h`;
  const days = Math.round(minutes / (60 * 24));
  return `Opens in ${days} ${days === 1 ? 'day' : 'days'}`;
};

const joinLabel = (join: JoinState): string =>
  join.available
    ? 'Join consultation'
    : join.opensInMinutes !== null
      ? countdown(join.opensInMinutes)
      : (join.reason ?? 'Unavailable');

/**
 * One consultation, and everything that came out of it.
 *
 * The order of the page is the order the events happened in: what the patient
 * reported, what the doctor found and prescribed, then what was actually
 * ordered as a result. Reading top to bottom is reading the episode.
 */
export const VisitDetailScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { visitId } = route.params;
  const [reordering, setReordering] = useState(false);
  const { data: visit, loading, error, reload, refreshing, refresh } = useAsync(
    () => fetchVisit(visitId),
    [visitId]
  );

  if (loading) {
    return (
      <Screen scroll={false}>
        <TopBar title="Visit" onBack={navigation.goBack} />
        <Loading />
      </Screen>
    );
  }

  if (error || !visit) {
    return (
      <Screen scroll={false}>
        <TopBar title="Visit" onBack={navigation.goBack} />
        <ErrorState message={error ?? 'Visit not found.'} onRetry={reload} />
      </Screen>
    );
  }

  const rx = visit.prescription;
  const canJoin = visit.type === 'VIDEO' && visit.status !== 'COMPLETED' && visit.status !== 'CANCELLED';

  return (
    <Screen padded={false} refreshing={refreshing} onRefresh={refresh} bottomInset={spacing.xxl}>
      <TopBar title="Visit" onBack={navigation.goBack} />

      <View style={styles.page}>
        <Card style={styles.header}>
          <View style={styles.headRow}>
            <View style={styles.flex}>
              <View style={styles.titleRow}>
                <Text variant="headlineSmMobile" color={colors.headingDark}>
                  {visit.doctor.name}
                </Text>
                {visit.isFollowUp ? <Badge label="Follow-up" /> : null}
              </View>
              <Text variant="captionSm" color={colors.captionGray}>
                {visit.doctor.specialty}
              </Text>
            </View>
            <StatusPill status={visit.status} />
          </View>

          <View style={styles.metaRow}>
            <Icon
              name={visit.type === 'VIDEO' ? 'videocam' : 'local_hospital'}
              size={16}
              color={colors.primary}
            />
            <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
              {visit.type === 'VIDEO' ? 'Video consultation' : 'In-person visit'} ·{' '}
              {formatDay(visit.slot.date)}, {visit.slot.startTime}–{visit.slot.endTime}
            </Text>
          </View>

          {visit.type === 'IN_PERSON' && visit.doctor.clinicAddress ? (
            <View style={styles.metaRow}>
              <Icon name="location_on" size={16} color={colors.captionGray} />
              <Text variant="captionSm" color={colors.captionGray} style={styles.flex}>
                {visit.doctor.clinicAddress}
              </Text>
            </View>
          ) : null}

          {canJoin ? (
            <Button
              label={joinLabel(visit.join)}
              icon={visit.join.available ? 'videocam' : 'schedule'}
              variant={visit.join.available ? 'primary' : 'secondary'}
              disabled={!visit.join.available}
              onPress={() => navigation.navigate('JoinLobby', { appointmentId: visit.id })}
            />
          ) : null}
        </Card>

        {visit.symptoms ? (
          <Card style={styles.block}>
            <Text variant="labelMd" weight="semibold" color={colors.headingDark}>
              What you reported
            </Text>
            <Text variant="bodyMd" color={colors.onSurfaceVariant}>
              {visit.symptoms}
            </Text>
          </Card>
        ) : null}

        {visit.documents.length > 0 ? (
          <Card style={styles.block}>
            <Text variant="labelMd" weight="semibold" color={colors.headingDark}>
              Photos you attached
            </Text>
            {visit.documents.map((doc) => (
              <View key={doc.id} style={styles.metaRow}>
                <Icon name="photo" size={16} color={colors.captionGray} />
                <Text variant="captionSm" color={colors.captionGray} numberOfLines={1}>
                  {doc.fileName}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        {/* ---------- The prescription ---------- */}

        {rx ? (
          <Card style={styles.block}>
            <View style={styles.headRow}>
              <Text variant="labelMd" weight="semibold" color={colors.headingDark} style={styles.flex}>
                Prescription
              </Text>
              <Badge label={rx.wasFollowUp ? 'Follow-up' : 'First consult'} />
            </View>

            <View>
              <Text variant="captionSm" color={colors.captionGray}>
                Diagnosis
              </Text>
              <Text variant="bodyMd" color={colors.headingDark}>
                {rx.diagnosis}
              </Text>
            </View>

            {rx.items.length > 0 ? (
              <View style={styles.list}>
                {rx.items.map((item) => (
                  <View key={item.id} style={styles.rxRow}>
                    <View style={styles.rxDot} />
                    <View style={styles.flex}>
                      <Text variant="bodyMd" weight="medium" color={colors.headingDark}>
                        {item.name}
                      </Text>
                      <Text variant="captionSm" color={colors.captionGray}>
                        {[
                          item.dosage,
                          item.frequency,
                          item.durationDays ? `${item.durationDays} days` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                      {item.instructions ? (
                        <Text variant="captionSm" color={colors.onSurfaceVariant}>
                          {item.instructions}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {rx.labTests.length > 0 ? (
              <View style={styles.list}>
                <Text variant="captionSm" color={colors.captionGray}>
                  Tests advised
                </Text>
                {rx.labTests.map((test) => (
                  <View key={test.id} style={styles.metaRow}>
                    <Icon name="biotech" size={14} color={colors.warningDark} />
                    <Text variant="captionSm" color={colors.headingDark} style={styles.flex}>
                      {test.testName}
                    </Text>
                    {test.urgent ? <Badge label="Urgent" tint="danger" /> : null}
                  </View>
                ))}
              </View>
            ) : null}

            {rx.advice ? (
              <View>
                <Text variant="captionSm" color={colors.captionGray}>
                  Advice
                </Text>
                <Text variant="bodyMd" color={colors.onSurfaceVariant}>
                  {rx.advice}
                </Text>
              </View>
            ) : null}

            {rx.followUpDate ? (
              <View style={styles.metaRow}>
                <Icon name="event_repeat" size={16} color={colors.primary} />
                <Text variant="captionSm" color={colors.primary}>
                  Follow up on {rx.followUpDate}
                </Text>
              </View>
            ) : null}

            <Text variant="captionSm" color={colors.captionGray}>
              Issued by {visit.doctor.name}
              {rx.doctorRegistrationNumber ? ` · Reg ${rx.doctorRegistrationNumber}` : ''}
            </Text>

            {/*
              The offer expires, so acting on it is only offered while it is
              still live. A button that fails on tap is worse than no button.
            */}
            {/*
              A live offer goes straight to review. A lapsed or declined one is
              re-quoted first — the prescription is still valid, only the prices
              went stale, and re-pricing needs no clinical decision. Without
              this an expired basket is a dead end that sends the patient back
              to the doctor for arithmetic.
            */}
            {rx.fulfilment?.status === 'PENDING_CONSENT' ? (
              <Button
                label="Review and order"
                icon="shopping_cart"
                onPress={() =>
                  navigation.navigate('PrescriptionOrder', { fulfilmentId: rx.fulfilment!.id })
                }
              />
            ) : rx.fulfilment?.status === 'CONSENTED' ? null : rx.items.length > 0 ? (
              <Button
                label="Order these medicines"
                icon="shopping_cart"
                loading={reordering}
                onPress={async () => {
                  setReordering(true);
                  try {
                    const fresh = await reorderPrescription(rx.id);
                    navigation.navigate('PrescriptionOrder', { fulfilmentId: fresh.id });
                  } catch (err) {
                    Alert.alert('Could not price this prescription', errorMessage(err));
                  } finally {
                    setReordering(false);
                  }
                }}
              />
            ) : null}

            <Button
              label="View full prescription"
              variant="secondary"
              icon="description"
              onPress={() => navigation.navigate('Prescription', { prescriptionId: rx.id })}
            />

            {/* Opens the server-rendered sheet in a browser rather than
                re-laying it out here: the mandatory fields and their placement
                are the platform's responsibility, not the client's. */}
            <Button
              label="Print or save as PDF"
              variant="secondary"
              icon="print"
              onPress={() => void Linking.openURL(prescriptionPrintUrl(rx.id))}
            />
          </Card>
        ) : visit.status === 'COMPLETED' ? (
          <Card style={styles.block}>
            <Text variant="captionSm" color={colors.captionGray}>
              No prescription was issued for this consultation.
            </Text>
          </Card>
        ) : null}

        {/* ---------- What was ordered as a result ---------- */}

        {visit.medicineOrders.length > 0 ? (
          <View>
            <SectionHeader title="Medicines ordered" />
            <View style={styles.list}>
              {visit.medicineOrders.map((order) => (
                <Card
                  key={order.id}
                  style={styles.block}
                  onPress={() => navigation.navigate('OrderTracking', { orderId: order.id })}
                >
                  <View style={styles.headRow}>
                    <Text variant="bodyMd" weight="semibold" color={colors.headingDark} style={styles.flex}>
                      #{order.id.slice(0, 8).toUpperCase()}
                    </Text>
                    <StatusPill status={order.status} />
                  </View>

                  {order.shipments.map((parcel, index) => (
                    <View key={parcel.id} style={styles.metaRow}>
                      <Icon
                        name={parcel.speed === 'EXPRESS' ? 'bolt' : 'local_shipping'}
                        size={14}
                        color={parcel.speed === 'EXPRESS' ? colors.successDark : colors.captionGray}
                      />
                      <Text variant="captionSm" color={colors.captionGray} style={styles.flex}>
                        {order.shipments.length > 1
                          ? `Parcel ${index + 1} of ${order.shipments.length} · `
                          : ''}
                        {parcel.pharmacy.name}
                      </Text>
                      <StatusPill status={parcel.status} />
                    </View>
                  ))}

                  <Text variant="bodyMd" weight="semibold" color={colors.primary}>
                    {rupees(order.totalAmount)}
                  </Text>
                </Card>
              ))}
            </View>
          </View>
        ) : null}

        {visit.labOrders.length > 0 ? (
          <View>
            <SectionHeader title="Tests booked" />
            <View style={styles.list}>
              {visit.labOrders.map((order) => (
                <Card
                  key={order.id}
                  style={styles.block}
                  onPress={() => navigation.navigate('LabResult', { orderId: order.id })}
                >
                  <View style={styles.headRow}>
                    <Text variant="bodyMd" weight="semibold" color={colors.headingDark} style={styles.flex}>
                      {order.testName}
                    </Text>
                    <StatusPill status={order.status} />
                  </View>
                  <View style={styles.headRow}>
                    <Text variant="captionSm" color={colors.captionGray} style={styles.flex}>
                      {order.completedAt ? 'Report ready' : 'In progress'}
                    </Text>
                    <Text variant="bodyMd" weight="semibold" color={colors.primary}>
                      {rupees(order.price)}
                    </Text>
                  </View>
                </Card>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.insetCard },
  header: { gap: spacing.insetCard },
  block: { gap: spacing.insetCard },
  list: { gap: spacing.insetCard },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  flex: { flex: 1 },
  rxRow: { flexDirection: 'row', gap: spacing.insetCard, alignItems: 'flex-start' },
  rxDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    marginTop: 7,
  },
});
