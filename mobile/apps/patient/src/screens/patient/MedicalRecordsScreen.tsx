import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Icon,
  Loading,
  Screen,
  StatusPill,
  Text,
  TopBar,
  colors,
  fetchMyLabOrders,
  fetchVisits,
  radius,
  rupees,
  spacing,
  useAsync,
  type JoinState,
  type VisitSummary,
} from '@healthbuddy/shared';

type Tab = 'visits' | 'reports';

const formatDay = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * "Opens in 3435 minutes" is a true statement nobody can act on. Rounded to the
 * largest useful unit, because the only decision it informs is whether to wait
 * or come back later.
 */
const countdown = (minutes: number): string => {
  if (minutes < 60) return `Opens in ${minutes} min`;
  if (minutes < 60 * 24) return `Opens in ${Math.round(minutes / 60)} h`;
  const days = Math.round(minutes / (60 * 24));
  return `Opens in ${days} ${days === 1 ? 'day' : 'days'}`;
};

const joinLabel = (join: JoinState): string =>
  join.available
    ? 'Join now'
    : join.opensInMinutes !== null
      ? countdown(join.opensInMinutes)
      : (join.reason ?? 'Unavailable');

/**
 * The patient's history, organised around the consultation.
 *
 * Prescriptions do not get their own tab: every prescription belongs to exactly
 * one appointment, so listing them separately would show the same things twice
 * under two names. Reports keep a tab because a patient can book a test without
 * ever seeing a doctor, and those belong to nothing else.
 */
/**
 * The filters each tab offers.
 *
 * Deliberately few, and named for what the patient is looking for rather than
 * for the statuses underneath. Someone opening this screen is nearly always
 * after one of two things — the consultation they had last week, or the test
 * result they are still waiting on — and a filter per database status would
 * bury both behind a list of words like ACCEPTED and SAMPLE_COLLECTED.
 *
 * Both lists arrive newest-first from the server and stay that way: filtering
 * only removes rows, it never reorders them.
 */
type VisitFilter = 'all' | 'upcoming' | 'completed' | 'cancelled';
type ReportFilter = 'all' | 'awaiting' | 'ready';

const VISIT_FILTERS: { value: VisitFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const REPORT_FILTERS: { value: ReportFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'awaiting', label: 'In progress' },
  { value: 'ready', label: 'Ready' },
];

export const MedicalRecordsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [tab, setTab] = useState<Tab>('visits');
  const [visitFilter, setVisitFilter] = useState<VisitFilter>('all');
  const [reportFilter, setReportFilter] = useState<ReportFilter>('all');

  const visits = useAsync(() => fetchVisits(), []);
  const reports = useAsync(() => fetchMyLabOrders(), []);

  const active = tab === 'visits' ? visits : reports;

  /**
   * Re-read on every focus.
   *
   * useAsync fetches on mount, and a tab screen mounts once — so booking a
   * consultation and coming straight back here showed "No visits yet" over a
   * record that already existed, until the list was pulled down by hand. The
   * whole point of this screen is to show what just happened.
   */
  useFocusEffect(
    useCallback(() => {
      visits.refresh();
      reports.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const visibleVisits = (visits.data ?? []).filter((v) => {
    if (visitFilter === 'all') return true;
    if (visitFilter === 'upcoming') return v.status === 'SCHEDULED' || v.status === 'IN_PROGRESS';
    if (visitFilter === 'completed') return v.status === 'COMPLETED';
    return v.status === 'CANCELLED';
  });

  /**
   * "Ready" is the only thing worth separating on a report: everything before it
   * is the same wait from the patient's side, whether the sample is still in
   * the van or already on a bench.
   */
  const visibleReports = (reports.data ?? []).filter((r) => {
    if (reportFilter === 'all') return true;
    if (reportFilter === 'ready') return r.status === 'COMPLETED';
    return r.status !== 'COMPLETED' && r.status !== 'CANCELLED';
  });

  return (
    <Screen
      padded={false}
      refreshing={active.refreshing}
      onRefresh={active.refresh}
      bottomInset={spacing.xxl}
    >
      <TopBar title="Medical Records" />

      <View style={styles.tabs}>
        <Chip
          label="Visits"
          icon="event"
          tint="info"
          selected={tab === 'visits'}
          onPress={() => setTab('visits')}
        />
        <Chip
          label="Reports"
          icon="biotech"
          tint="warning"
          selected={tab === 'reports'}
          onPress={() => setTab('reports')}
        />
      </View>

      {/* Newest first, always — the filter narrows the list, never reorders it. */}
      <ChipRow>
        {tab === 'visits'
          ? VISIT_FILTERS.map((f) => (
              <Chip
                key={f.value}
                label={f.label}
                selected={visitFilter === f.value}
                onPress={() => setVisitFilter(f.value)}
              />
            ))
          : REPORT_FILTERS.map((f) => (
              <Chip
                key={f.value}
                label={f.label}
                selected={reportFilter === f.value}
                onPress={() => setReportFilter(f.value)}
              />
            ))}
      </ChipRow>

      <View style={styles.page}>
        {active.loading ? (
          <Loading />
        ) : active.error ? (
          <ErrorState message={active.error} onRetry={active.reload} />
        ) : tab === 'visits' ? (
          visibleVisits.length ? (
            visibleVisits.map((visit) => (
              <VisitCard
                key={visit.id}
                visit={visit}
                onOpen={() => navigation.navigate('VisitDetail', { visitId: visit.id })}
                onJoin={() => navigation.navigate('JoinLobby', { appointmentId: visit.id })}
              />
            ))
          ) : visitFilter !== 'all' ? (
            // A filtered-out list is not an empty record — saying "no visits
            // yet" to someone with ten of them just reads as a bug.
            <EmptyState
              icon="filter_alt_off"
              title="Nothing matches this filter"
              message="You have visits, just none in this state."
              actionLabel="Show all"
              onActionPress={() => setVisitFilter('all')}
            />
          ) : (
            <EmptyState
              icon="event"
              title="No visits yet"
              message="Consultations you book will appear here, along with everything that comes out of them."
              actionLabel="Find a doctor"
              onActionPress={() => navigation.navigate('Doctors')}
            />
          )
        ) : visibleReports.length ? (
          visibleReports.map((order) => (
            <Card
              key={order.id}
              style={styles.card}
              onPress={() => navigation.navigate('LabResult', { orderId: order.id })}
            >
              <View style={styles.cardHead}>
                <View style={[styles.iconTile, { backgroundColor: colors.warningLight }]}>
                  <Icon name="biotech" size={20} color={colors.warningDark} />
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyMd" weight="semibold" color={colors.headingDark} numberOfLines={1}>
                    {order.testName}
                  </Text>
                  <Text variant="captionSm" color={colors.captionGray}>
                    {formatDate(order.createdAt)}
                  </Text>
                </View>
                <StatusPill status={order.status} />
              </View>

              <View style={styles.cardFoot}>
                <Text variant="captionSm" color={colors.captionGray}>
                  {order.reportUrl ? 'Report available' : 'Report pending'}
                </Text>
                <Text variant="bodyMd" weight="semibold" color={colors.primary}>
                  {rupees(order.price)}
                </Text>
              </View>
            </Card>
          ))
        ) : reportFilter !== 'all' ? (
          <EmptyState
            icon="filter_alt_off"
            title="Nothing matches this filter"
            message="You have reports, just none in this state."
            actionLabel="Show all"
            onActionPress={() => setReportFilter('all')}
          />
        ) : (
          <EmptyState
            icon="biotech"
            title="No reports yet"
            message="Lab results will appear here once a test is complete."
            actionLabel="Book a test"
            onActionPress={() => navigation.navigate('Labs')}
          />
        )}
      </View>
    </Screen>
  );
};

const VisitCard: React.FC<{
  visit: VisitSummary;
  onOpen: () => void;
  onJoin: () => void;
}> = ({ visit, onOpen, onJoin }) => {
  const { counts, prescription, join } = visit;

  // Only render the strip when there is something in it. A row of three zeroes
  // is noise that trains people to stop reading the row.
  const chips = [
    prescription ? { icon: 'description', label: 'Prescription' } : null,
    counts.medicineOrders > 0
      ? { icon: 'pill', label: `${counts.medicineOrders} medicine order${counts.medicineOrders === 1 ? '' : 's'}` }
      : null,
    counts.labOrders > 0
      ? { icon: 'biotech', label: `${counts.labOrders} lab test${counts.labOrders === 1 ? '' : 's'}` }
      : null,
    counts.attachments > 0
      ? { icon: 'photo', label: `${counts.attachments} photo${counts.attachments === 1 ? '' : 's'}` }
      : null,
  ].filter((c): c is { icon: string; label: string } => c !== null);

  return (
    <Card style={styles.card} onPress={onOpen}>
      <View style={styles.cardHead}>
        <View style={styles.iconTile}>
          <Icon
            name={visit.type === 'VIDEO' ? 'videocam' : 'local_hospital'}
            size={20}
            color={colors.secondary}
          />
        </View>

        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <Text variant="bodyMd" weight="semibold" color={colors.headingDark} numberOfLines={1}>
              {visit.doctor.name}
            </Text>
            {visit.isFollowUp ? <Badge label="Follow-up" /> : null}
          </View>
          <Text variant="captionSm" color={colors.captionGray}>
            {visit.doctor.specialty} · {formatDay(visit.slot.date)}, {visit.slot.startTime}
          </Text>
        </View>

        <StatusPill status={visit.status} />
      </View>

      {visit.symptoms ? (
        <Text variant="captionSm" color={colors.onSurfaceVariant} numberOfLines={2}>
          {visit.symptoms}
        </Text>
      ) : null}

      {chips.length > 0 ? (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <View key={chip.label} style={styles.chip}>
              <Icon name={chip.icon} size={12} color={colors.captionGray} />
              <Text variant="captionSm" color={colors.captionGray}>
                {chip.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/*
        The join control is only drawn for video visits that could still happen.
        A permanently disabled button on a finished consultation is clutter that
        implies something is broken.
      */}
      {visit.type === 'VIDEO' && visit.status !== 'COMPLETED' && visit.status !== 'CANCELLED' ? (
        <Button
          label={joinLabel(join)}
          icon={join.available ? 'videocam' : 'schedule'}
          size="sm"
          variant={join.available ? 'primary' : 'secondary'}
          disabled={!join.available}
          onPress={onJoin}
        />
      ) : null}
    </Card>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.infoLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.base },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inlineSm,
    paddingHorizontal: spacing.base,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceContainerHigh,
  },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
