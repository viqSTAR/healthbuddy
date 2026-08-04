import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { Button } from './Button';
import { Card } from './Card';
import { Screen, TopBar } from './Screen';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/typography';
import type { ProviderApplication } from '../services/endpoints';

/**
 * What a provider sees between submitting an application and being approved.
 *
 * This gap is where partner drop-off happens, so it is a real screen rather
 * than a spinner: it names the current stage, lists what was submitted, and on
 * rejection shows the reviewer's reason with a way back into the form.
 */
export const VerificationStatus: React.FC<{
  application: ProviderApplication;
  onEdit: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  refreshing?: boolean;
}> = ({ application, onEdit, onRefresh, onSignOut, refreshing }) => {
  const rejected = application.status === 'REJECTED';

  const stages = [
    { key: 'SUBMITTED', label: 'Application submitted' },
    { key: 'UNDER_REVIEW', label: 'Documents under review' },
    { key: 'APPROVED', label: 'Verified and live' },
  ] as const;

  const reachedIndex = rejected
    ? 0
    : stages.findIndex((s) => s.key === application.status) === -1
      ? 0
      : stages.findIndex((s) => s.key === application.status);

  return (
    <Screen scroll refreshing={refreshing} onRefresh={onRefresh}>
      <TopBar brand right={<Button label="Sign out" variant="ghost" size="sm" onPress={onSignOut} />} />

      <View style={styles.hero}>
        <View style={[styles.iconAnchor, rejected && styles.iconAnchorDanger]}>
          <Icon
            name={rejected ? 'error' : 'hourglass_top'}
            size={34}
            color={rejected ? colors.error : colors.primary}
          />
        </View>
        <Text variant="displayBold" color={colors.headingDark} center>
          {rejected ? 'Changes needed' : 'Verification in progress'}
        </Text>
        <Text variant="bodyMd" color={colors.captionGray} center>
          {rejected
            ? 'Our team reviewed your application and needs something corrected.'
            : 'Our team is checking your registration and licence documents. This usually takes 1–2 working days.'}
        </Text>
      </View>

      {rejected && application.rejectionReason ? (
        <Card background={colors.dangerLight} style={styles.reason}>
          <Text variant="labelMd" weight="bold" color={colors.error}>
            Reviewer note
          </Text>
          <Text variant="bodyMd" color={colors.onSurface}>
            {application.rejectionReason}
          </Text>
        </Card>
      ) : (
        <Card style={styles.timeline}>
          {stages.map((stage, index) => {
            const done = index <= reachedIndex;
            return (
              <View key={stage.key} style={styles.stage}>
                <View style={[styles.dot, done && styles.dotDone]}>
                  {done ? <Icon name="check" size={12} color={colors.onPrimary} /> : null}
                </View>
                <Text
                  variant="labelMd"
                  weight={index === reachedIndex ? 'bold' : 'regular'}
                  color={done ? colors.onSurface : colors.captionGray}
                >
                  {stage.label}
                </Text>
              </View>
            );
          })}
        </Card>
      )}

      <Card style={styles.summary}>
        <Text variant="labelMd" weight="bold" color={colors.onSurface}>
          {application.displayName}
        </Text>
        <Text variant="captionSm" color={colors.captionGray}>
          {application.type === 'DOCTOR' ? 'Medical practitioner' : null}
          {application.type === 'PHARMACY' ? 'Pharmacy' : null}
          {application.type === 'LAB' ? 'Diagnostic lab' : null}
          {' · '}
          {application.address}
        </Text>
        <Text variant="captionSm" color={colors.captionGray}>
          {application.documents.length} document(s) attached
        </Text>
      </Card>

      <View style={styles.actions}>
        {rejected ? (
          <Button label="Update application" icon="edit" onPress={onEdit} fullWidth />
        ) : (
          <Button label="Check status" icon="refresh" variant="outline" onPress={onRefresh} fullWidth />
        )}
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.base, paddingVertical: spacing.xl },
  iconAnchor: {
    width: 76,
    height: 76,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
  },
  iconAnchorDanger: { backgroundColor: colors.dangerLight },
  reason: { gap: spacing.base },
  timeline: { gap: spacing.insetCard },
  stage: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  dot: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.primary },
  summary: { gap: spacing.stackTight, marginTop: spacing.insetCard },
  actions: { marginTop: spacing.xl },
});
