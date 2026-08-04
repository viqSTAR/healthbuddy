import React from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import {
  Button,
  Card,
  ErrorState,
  Icon,
  Loading,
  Screen,
  StatusPill,
  Text,
  TopBar,
  colors,
  fetchMyLabOrders,
  radius,
  spacing,
  useAsync,
  type LabOrder,
} from '@healthbuddy/shared';

const STAGES: LabOrder['status'][] = ['BOOKED', 'SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED'];

const STAGE_META: Record<string, { label: string; icon: string }> = {
  BOOKED: { label: 'Test booked', icon: 'event' },
  SAMPLE_COLLECTED: { label: 'Sample collected', icon: 'science' },
  PROCESSING: { label: 'In the lab', icon: 'biotech' },
  COMPLETED: { label: 'Report ready', icon: 'fact_check' },
};

/** Mirrors `lab_test_results` / `lab_test_report`. */
export const LabResultScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { orderId } = route.params;

  // The API exposes the patient's orders as a list; select the one requested.
  const { data, loading, error, reload, refreshing, refresh } = useAsync(
    () => fetchMyLabOrders(),
    []
  );
  const order = data?.find((o) => o.id === orderId) ?? null;

  if (loading) {
    return (
      <Screen scroll={false}>
        <TopBar title="Lab Test" onBack={navigation.goBack} />
        <Loading />
      </Screen>
    );
  }

  if (error || !order) {
    return (
      <Screen scroll={false}>
        <TopBar title="Lab Test" onBack={navigation.goBack} />
        <ErrorState message={error ?? 'Lab order not found.'} onRetry={reload} />
      </Screen>
    );
  }

  const currentIndex = STAGES.indexOf(order.status);
  const cancelled = order.status === 'CANCELLED';

  return (
    <Screen padded={false} refreshing={refreshing} onRefresh={refresh} bottomInset={spacing.xxl}>
      <TopBar title="Lab Test" onBack={navigation.goBack} />

      <View style={styles.page}>
        <Card style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.iconTile}>
              <Icon name="biotech" size={24} color={colors.warningDark} />
            </View>
            <View style={styles.flex}>
              <Text variant="headlineSmMobile" color={colors.headingDark}>
                {order.testName}
              </Text>
              <Text variant="captionSm" color={colors.captionGray}>
                Booked {new Date(order.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <StatusPill status={order.status} />
          </View>

          {order.address ? (
            <View style={styles.addressRow}>
              <Icon name="location_on" size={16} color={colors.primary} />
              <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
                {order.address}
              </Text>
            </View>
          ) : null}
        </Card>

        {!cancelled ? (
          <Card style={styles.timeline}>
            <Text variant="headlineSmMobile" color={colors.headingDark}>
              Progress
            </Text>

            {STAGES.map((stage, i) => {
              const done = i <= currentIndex;
              const isLast = i === STAGES.length - 1;
              const meta = STAGE_META[stage]!;

              return (
                <View key={stage} style={styles.stage}>
                  <View style={styles.rail}>
                    <View style={[styles.dot, done && styles.dotDone]}>
                      <Icon
                        name={meta.icon}
                        size={16}
                        color={done ? colors.onPrimary : colors.captionGray}
                      />
                    </View>
                    {!isLast ? (
                      <View style={[styles.line, i < currentIndex && styles.lineDone]} />
                    ) : null}
                  </View>

                  <View style={styles.stageBody}>
                    <Text
                      variant="bodyMd"
                      weight={done ? 'semibold' : 'regular'}
                      color={done ? colors.headingDark : colors.captionGray}
                    >
                      {meta.label}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>
        ) : null}

        <Card style={styles.reportCard}>
          <Text variant="headlineSmMobile" color={colors.headingDark}>
            Report
          </Text>

          {order.reportUrl ? (
            <>
              <View style={styles.reportRow}>
                <View style={styles.pdfTile}>
                  <Icon name="picture_as_pdf" size={22} color={colors.error} />
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyMd" weight="medium" color={colors.headingDark}>
                    {order.testName} report
                  </Text>
                  <Text variant="captionSm" color={colors.captionGray}>
                    Issued by your lab partner
                  </Text>
                </View>
              </View>
              <Button
                label="Open report"
                icon="open_in_new"
                fullWidth
                onPress={() => Linking.openURL(order.reportUrl!)}
              />
            </>
          ) : (
            <View style={styles.pending}>
              <Icon name="hourglass_empty" size={22} color={colors.captionGray} />
              <Text variant="bodyMd" color={colors.captionGray} style={styles.flex}>
                Your report will appear here once the lab completes processing.
              </Text>
            </View>
          )}
        </Card>

        <Card style={styles.priceCard}>
          <Text variant="bodyMd" color={colors.onSurfaceVariant} style={styles.flex}>
            Amount paid
          </Text>
          <Text variant="displayBold" color={colors.primary}>
            ${order.price.toFixed(2)}
          </Text>
        </Card>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.insetPage },
  header: { gap: spacing.insetCard },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.warningLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.base },
  timeline: { gap: spacing.insetPage },
  stage: { flexDirection: 'row', gap: spacing.insetCard },
  rail: { alignItems: 'center', width: 32 },
  dot: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.primary },
  line: { width: 2, flex: 1, minHeight: 20, backgroundColor: colors.outlineVariant },
  lineDone: { backgroundColor: colors.primary },
  stageBody: { flex: 1, paddingBottom: spacing.insetPage },
  reportCard: { gap: spacing.insetCard },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  pdfTile: {
    width: 44,
    height: 44,
    borderRadius: radius.base,
    backgroundColor: colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pending: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  priceCard: { flexDirection: 'row', alignItems: 'center' },
});
