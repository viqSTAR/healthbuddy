import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Badge,
  Card,
  colors,
  EmptyState,
  ErrorState,
  Loading,
  rupees,
  Screen,
  spacing,
  Text,
  TopBar,
  useAsync,
  fetchMyPayments,
  type PaymentRecord,
} from '@healthbuddy/shared';

/**
 * What you have paid, and what came back.
 *
 * `/payments/mine` existed with nothing calling it, so the app could take money
 * and then had no answer to "what was I charged for?" — the single most common
 * support question any platform that handles payments receives, and one the
 * data was already there to answer.
 *
 * Refunds are shown on the same row as the payment rather than as separate
 * entries. A partial refund on a cancelled line is not a second transaction; it
 * is this one, ending differently, and splitting them makes a statement that
 * does not reconcile against the bank.
 */

const PURPOSE_LABEL: Record<string, string> = {
  APPOINTMENT: 'Consultation',
  MEDICINE_ORDER: 'Medicines',
  LAB_ORDER: 'Lab test',
  PRESCRIPTION_BASKET: 'Prescription',
};

const METHOD_LABEL: Record<string, string> = {
  ONLINE: 'Paid online',
  COD: 'Cash on delivery',
};

const STATUS_TINT = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'info',
} as const;

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Awaiting payment',
  PAID: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partly refunded',
};

const on = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');

export const PaymentsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const payments = useAsync(() => fetchMyPayments(), []);

  const rows = payments.data ?? [];
  const spent = rows
    .filter((p) => p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED')
    .reduce((total, p) => total + p.amount - p.refundedAmount, 0);

  return (
    <Screen
      padded={false}
      refreshing={payments.refreshing}
      onRefresh={payments.refresh}
      bottomInset={spacing.xxl}
    >
      <TopBar title="Payments" onBack={() => navigation.goBack()} />

      {payments.loading ? (
        <Loading />
      ) : payments.error ? (
        <ErrorState message={payments.error} onRetry={payments.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No payments yet"
          message="Consultations, medicines and lab tests you pay for will appear here."
        />
      ) : (
        <View style={styles.list}>
          <Card style={styles.summary}>
            <Text variant="captionSm" style={styles.muted}>
              Total paid, after refunds
            </Text>
            <Text variant="displayBold">{rupees(spent)}</Text>
          </Card>

          {rows.map((payment: PaymentRecord) => (
            <Card key={payment.id} style={styles.card}>
              <View style={styles.head}>
                <View style={styles.headText}>
                  <Text variant="labelMd">
                    {PURPOSE_LABEL[payment.purpose] ?? payment.purpose}
                  </Text>
                  <Text variant="captionSm" style={styles.muted}>
                    {on(payment.paidAt ?? payment.createdAt)} ·{' '}
                    {METHOD_LABEL[payment.method] ?? payment.method}
                  </Text>
                </View>
                <View style={styles.amountBlock}>
                  <Text variant="labelMd">{rupees(payment.amount)}</Text>
                  <Badge
                    label={STATUS_LABEL[payment.status] ?? payment.status}
                    tint={STATUS_TINT[payment.status]}
                  />
                </View>
              </View>

              {payment.refundedAmount > 0 ? (
                <Text variant="captionSm" style={styles.refund}>
                  {rupees(payment.refundedAmount)} refunded
                  {payment.refundedAt ? ` on ${on(payment.refundedAt)}` : ''}
                </Text>
              ) : null}

              {/* A cash order sitting at PENDING has not been collected yet —
                  worth saying, because it looks like a failed payment. */}
              {payment.status === 'PENDING' && payment.method === 'COD' ? (
                <Text variant="captionSm" style={styles.muted}>
                  You will pay the rider when it arrives.
                </Text>
              ) : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.insetCard },
  summary: { gap: spacing.inlineSm },
  card: { gap: spacing.base },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.base },
  headText: { flex: 1, gap: 2 },
  amountBlock: { alignItems: 'flex-end', gap: spacing.inlineSm },
  muted: { color: colors.onSurfaceVariant },
  refund: { color: colors.primary },
});
