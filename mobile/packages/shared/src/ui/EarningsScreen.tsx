import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from './Card';
import { EmptyState, ErrorState, Loading } from './EmptyState';
import { Icon } from './Icon';
import { Screen, SectionHeader, TopBar } from './Screen';
import { StatTile } from './StatTile';
import { StatusPill } from './StatusPill';
import { Text } from './Text';
import { rupees } from '../format';
import { colors } from '../theme/colors';
import { spacing } from '../theme/typography';
import { useAsync } from '../hooks/useAsync';
import { fetchMyEarnings, type EarningsLine } from '../services/endpoints';

const PURPOSE_LABEL: Record<string, string> = {
  APPOINTMENT: 'Consultation',
  MEDICINE_ORDER: 'Medicine order',
  LAB_ORDER: 'Lab test',
  PRESCRIPTION_BASKET: 'Prescription order',
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * A partner's settlement statement.
 *
 * Shows only this partner's own legs, and shows the *net* amount — what they
 * actually receive after the platform's commission. Showing the gross would
 * make every payout look short.
 *
 * "Pending" here means the money is collected but the aggregator has not yet
 * settled the leg, which is normal and not an error state.
 */
export const EarningsScreen: React.FC<{ navigation?: any }> = ({ navigation }) => {
  const earnings = useAsync(fetchMyEarnings, []);

  if (earnings.loading) return <Loading label="Loading earnings" />;
  if (earnings.error) return <ErrorState message={earnings.error} onRetry={earnings.reload} />;

  const data = earnings.data;
  const lines = data?.lines ?? [];

  return (
    <Screen scroll refreshing={earnings.refreshing} onRefresh={earnings.refresh}>
      <TopBar title="Earnings" onBack={navigation ? () => navigation.goBack() : undefined} />

      <View style={styles.stats}>
        <StatTile
          value={rupees(data?.settledTotal ?? 0)}
          label="Settled"
          icon="account_balance"
          emphasis
        />
        <StatTile
          value={rupees(data?.pendingTotal ?? 0)}
          label="Awaiting settlement"
          icon="schedule"
        />
      </View>

      <Card background={colors.infoLight} style={styles.notice}>
        <Icon name="info" size={18} color={colors.secondary} />
        <Text variant="captionSm" color={colors.onSurface} style={styles.flex}>
          Amounts are net of platform commission. Settlement is handled by the payment provider, so
          funds reach your bank account on their payout schedule.
        </Text>
      </Card>

      <SectionHeader title={`Statement (${lines.length})`} />

      {lines.length === 0 ? (
        <EmptyState
          icon="receipt_long"
          title="Nothing yet"
          message="Your share of each completed order will appear here."
        />
      ) : (
        <View style={styles.list}>
          {lines.map((line: EarningsLine) => (
            <Card key={line.id} style={styles.row}>
              <View style={styles.flex}>
                <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
                  {PURPOSE_LABEL[line.purpose] ?? line.purpose}
                </Text>
                <Text variant="captionSm" color={colors.captionGray}>
                  {formatDate(line.createdAt)} ·{' '}
                  {line.method === 'COD' ? 'Cash on delivery' : 'Paid online'}
                </Text>
              </View>

              <View style={styles.amount}>
                <Text variant="labelMd" weight="bold" color={colors.primary}>
                  {rupees(line.amount)}
                </Text>
                <StatusPill status={line.status} />
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stats: { flexDirection: 'row', gap: spacing.insetCard, marginBottom: spacing.insetPage },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.insetCard },
  list: { gap: spacing.insetCard },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  amount: { alignItems: 'flex-end', gap: spacing.stackTight },
});
