import React, { useState } from 'react';
import { View, StyleSheet, Switch, Alert } from 'react-native';
import {
  Button,
  Card,
  colors,
  ErrorState,
  errorMessage,
  Icon,
  Input,
  Loading,
  Screen,
  spacing,
  Text,
  TopBar,
  useAsync,
  useAuth,
  fetchMyConsents,
  grantConsent,
  withdrawConsent,
  exportMyData,
  closeMyAccount,
  type ConsentPurpose,
  type ConsentState,
} from '@healthbuddy/shared';

/**
 * What the platform holds, what you agreed to, and how to leave.
 *
 * The backend gained consent records, a data export and account erasure, and
 * for a while none of them had a way in — which for consent in particular means
 * they did not really exist. Consent that is never asked for is not consent,
 * and a right to erasure reachable only by emailing support is a right most
 * people will not exercise.
 *
 * Deliberately one screen. These three things are the same question from a
 * patient's side — "what do you have on me, and can I stop you" — and splitting
 * them across a settings tree is how they become undiscoverable.
 */

const COPY: Record<ConsentPurpose, { title: string; body: string }> = {
  TERMS_OF_SERVICE: {
    title: 'Terms of use',
    body: 'The rules for using Health Buddy. Required to hold an account.',
  },
  PRIVACY_POLICY: {
    title: 'Health data processing',
    body:
      'Permission to store and use your health information to provide care. ' +
      'Required — without it we have no lawful basis to keep a medical record.',
  },
  TELECONSULTATION: {
    title: 'Consultations by video and chat',
    body:
      'Being treated remotely rather than in person. You can still book in-person ' +
      'appointments without this.',
  },
  MARKETING_MESSAGES: {
    title: 'Health tips and offers',
    body: 'Optional. Turning this off changes nothing about the care available to you.',
  },
};

export const PrivacyScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user, signOut } = useAuth();
  const consents = useAsync(() => fetchMyConsents(), []);

  const [busy, setBusy] = useState<ConsentPurpose | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [confirmPhone, setConfirmPhone] = useState('');
  const [exporting, setExporting] = useState(false);

  const toggle = async (consent: ConsentState, next: boolean) => {
    setBusy(consent.purpose);
    setError(null);
    try {
      if (next) {
        await grantConsent(consent.purpose, consent.currentVersion);
      } else {
        const result = await withdrawConsent(consent.purpose);
        // Essential consents can be withdrawn — refusing would make them not
        // consent at all — but the person has to be told what it costs.
        if (result.essential) Alert.alert('Withdrawn', result.message);
      }
      consents.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Shows a summary rather than dumping JSON.
   *
   * A phone cannot usefully display a full export, and the question someone
   * actually has is "what categories do you hold". The complete payload is
   * available from the API for anyone who wants it.
   */
  const showExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const data = (await exportMyData()) as Record<string, unknown>;
      const count = (key: string) => {
        const rows = data[key];
        return Array.isArray(rows) ? rows.length : 0;
      };

      Alert.alert(
        'What we hold about you',
        [
          `Consultations: ${count('appointments')}`,
          `Prescriptions: ${count('prescriptions')}`,
          `Medicine orders: ${count('medicineOrders')}`,
          `Lab bookings: ${count('labOrders')}`,
          `Payments: ${count('payments')}`,
          `Documents: ${count('documents')}`,
          `Emergency records: ${count('emergencies')}`,
          '',
          'Plus your profile and saved addresses.',
          '',
          'Ask support for the full copy as a file.',
        ].join('\n')
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const confirmClose = async () => {
    setError(null);
    try {
      const result = await closeMyAccount(confirmPhone.trim());
      Alert.alert(
        'Account closed',
        'Your name, contact details, addresses and devices have been deleted. Your ' +
          'consultation and prescription records are kept — they are medical records ' +
          'with their own retention period.\n\n' +
          `Removed: ${result.removed.addresses} address(es), ${result.removed.devices} device(s).`,
        [{ text: 'OK', onPress: () => void signOut() }]
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Screen padded={false} refreshing={consents.refreshing} onRefresh={consents.refresh}>
      <TopBar title="Privacy & data" onBack={() => navigation.goBack()} />

      {error ? (
        <Text variant="captionSm" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {consents.loading ? (
        <Loading />
      ) : consents.error ? (
        <ErrorState message={consents.error} onRetry={consents.reload} />
      ) : (
        <View style={styles.page}>
          <Card style={styles.card}>
            <Text variant="headlineSm">What you have agreed to</Text>
            <Text variant="captionSm" style={styles.hint}>
              Each of these is separate. Agreeing to be treated is not agreeing to be
              marketed at, and you can change any of them at any time.
            </Text>

            {consents.data!.map((consent) => (
              <View key={consent.purpose} style={styles.consentRow}>
                <View style={styles.consentText}>
                  <Text variant="labelMd">
                    {COPY[consent.purpose].title}
                    {consent.essential ? '  (required)' : ''}
                  </Text>
                  <Text variant="captionSm" style={styles.hint}>
                    {COPY[consent.purpose].body}
                  </Text>
                  {consent.stale ? (
                    <Text variant="captionSm" style={styles.stale}>
                      The wording has changed since you agreed. Please review it.
                    </Text>
                  ) : null}
                </View>
                <Switch
                  value={consent.granted && !consent.stale}
                  disabled={busy === consent.purpose}
                  onValueChange={(next) => void toggle(consent, next)}
                />
              </View>
            ))}
          </Card>

          <Card style={styles.card}>
            <Text variant="headlineSm">Your data</Text>
            <Text variant="captionSm" style={styles.hint}>
              You can ask for a copy of everything we hold about you.
            </Text>
            <Button
              label={exporting ? 'Gathering…' : 'See what we hold'}
              variant="secondary"
              disabled={exporting}
              onPress={() => void showExport()}
            />
          </Card>

          <Card style={styles.card}>
            <View style={styles.dangerHead}>
              <Icon name="warning" color={colors.error} size={20} />
              <Text variant="headlineSm">Close your account</Text>
            </View>

            <Text variant="captionSm" style={styles.hint}>
              Your name, phone number, saved addresses and devices are deleted. Your
              consultation, prescription and payment records are kept — they are medical
              and accounting records with their own retention periods, and a doctor
              remains accountable for what they prescribed.
            </Text>
            <Text variant="captionSm" style={styles.warn}>
              This cannot be undone.
            </Text>

            {closing ? (
              <View style={styles.confirm}>
                <Input
                  label={`Type ${user?.phoneNumber ?? 'your number'} to confirm`}
                  value={confirmPhone}
                  onChangeText={setConfirmPhone}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                />
                <Button
                  label="Close my account for good"
                  variant="danger"
                  onPress={() => void confirmClose()}
                />
                <Button
                  label="Cancel"
                  variant="ghost"
                  onPress={() => {
                    setClosing(false);
                    setConfirmPhone('');
                    setError(null);
                  }}
                />
              </View>
            ) : (
              <Button label="Close my account" variant="danger" onPress={() => setClosing(true)} />
            )}
          </Card>
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg },
  card: { gap: spacing.insetCard },
  hint: { color: colors.onSurfaceVariant },
  warn: { color: colors.error },
  error: { color: colors.error, paddingHorizontal: spacing.lg, paddingTop: spacing.insetCard },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    paddingVertical: spacing.base,
  },
  consentText: { flex: 1, gap: 2 },
  stale: { color: colors.warningDark },
  dangerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  confirm: { gap: spacing.insetCard },
});
