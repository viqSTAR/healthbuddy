import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Badge,
  Card,
  colors,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
  spacing,
  Text,
  TopBar,
  useAsync,
  fetchMyHealthTips,
  refreshHealthTips,
  type HealthTipEntry,
} from '@healthbuddy/shared';

/**
 * Health guidance matched to what this patient actually has.
 *
 * The platform generates these against a patient's recorded conditions and
 * delivers them as push notifications — which works right up until someone
 * clears the notification, at which point advice about their own diabetes is
 * gone for good. `fetchMyHealthTips` existed to answer that and nothing called
 * it, so the whole feature was write-only.
 *
 * Grouped by category rather than listed by date. Someone opening this is
 * looking for guidance on a condition, not reading a feed.
 */

const groupByCategory = (tips: HealthTipEntry[]) => {
  const groups = new Map<string, HealthTipEntry[]>();
  for (const tip of tips) {
    groups.set(tip.category, [...(groups.get(tip.category) ?? []), tip]);
  }
  return [...groups.entries()];
};

export const HealthTipsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  /**
   * Asks the server to match new guidance before reading the list.
   *
   * The endpoint that generates tips against a patient's conditions is separate
   * from the one that lists them, and nothing was calling it — so the list only
   * ever grew when a scheduled job happened to run. Pulling to refresh should
   * mean "look again", not "re-read the same rows".
   *
   * Best-effort: if matching fails the existing tips are still worth showing,
   * so the read goes ahead either way.
   */
  const load = async () => {
    await refreshHealthTips().catch(() => undefined);
    return fetchMyHealthTips();
  };

  const tips = useAsync(load, []);
  const groups = groupByCategory(tips.data ?? []);

  return (
    <Screen
      padded={false}
      refreshing={tips.refreshing}
      onRefresh={tips.refresh}
      bottomInset={spacing.xxl}
    >
      <TopBar title="Health guidance" onBack={() => navigation.goBack()} />

      {tips.loading ? (
        <Loading />
      ) : tips.error ? (
        <ErrorState message={tips.error} onRetry={tips.reload} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          message={
            'Guidance is matched to the conditions on your profile. Add your allergies ' +
            'and any long-term conditions and it will start appearing here.'
          }
        />
      ) : (
        <View style={styles.page}>
          {groups.map(([category, entries]) => (
            <View key={category} style={styles.group}>
              <View style={styles.groupHead}>
                <Text variant="headlineSmMobile" color={colors.headingDark}>
                  {category}
                </Text>
                <Badge label={`${entries.length}`} tint="neutral" />
              </View>

              {entries.map((tip) => (
                <Card key={tip.id} style={styles.card}>
                  <Text variant="labelMd">{tip.title}</Text>
                  <Text variant="captionSm" style={styles.body}>
                    {tip.body}
                  </Text>
                  <Text variant="captionSm" style={styles.muted}>
                    {new Date(tip.receivedAt).toLocaleDateString()}
                  </Text>
                </Card>
              ))}
            </View>
          ))}

          <Text variant="captionSm" style={styles.footer}>
            This is general guidance, not a diagnosis. Book a consultation if something
            is worrying you.
          </Text>
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg },
  group: { gap: spacing.base },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  card: { gap: spacing.inlineSm },
  body: { color: colors.onSurface },
  muted: { color: colors.onSurfaceVariant },
  footer: { color: colors.onSurfaceVariant, textAlign: 'center', paddingTop: spacing.base },
});
