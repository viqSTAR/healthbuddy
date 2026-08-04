import React, { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  Icon,
  Input,
  Text,
  colors,
  errorMessage,
  radius,
  spacing,
  useAuth,
} from '@healthbuddy/shared';

/**
 * Entry point for practitioners.
 *
 * There is no "create account" split here as in the patient app: a doctor signs
 * in with their number and, if no verified practice is attached, lands in the
 * registration flow. Registering is an application, not an account type — the
 * role only exists once an admin approves it.
 */
export const LoginScreen: React.FC = () => {
  const { requestOtp } = useAuth();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (phone.replace(/\D/g, '').length < 8) {
      setError('Enter a valid mobile number.');
      return;
    }

    setLoading(true);
    setError(undefined);
    try {
      await requestOtp(phone.trim());
    } catch (err) {
      setError(errorMessage(err, 'Could not send the verification code.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <View style={styles.brand}>
            <View style={styles.iconAnchor}>
              <Icon name="stethoscope" size={36} color={colors.primary} />
            </View>
            <Text variant="displayBold" color={colors.primary}>
              Health Buddy
            </Text>
            <Text variant="labelMd" weight="semibold" color={colors.captionGray} uppercase>
              For Doctors
            </Text>
          </View>

          <Card padding={spacing.xl} style={styles.card}>
            <View style={styles.headings}>
              <Text variant="displayBold" color={colors.headingDark}>
                Sign in
              </Text>
              <Text variant="bodyMd" color={colors.captionGray}>
                Manage your consultations, availability and prescriptions.
              </Text>
            </View>

            <Input
              label="Registered mobile number"
              icon="phone"
              placeholder="+91 98765 43210"
              value={phone}
              onChangeText={(t) => {
                setPhone(t);
                setError(undefined);
              }}
              keyboardType="phone-pad"
              autoComplete="tel"
              error={error}
              hint={error ? undefined : "We'll text you a one-time code."}
            />

            <Button label="Continue" onPress={submit} loading={loading} fullWidth />
          </Card>

          <View style={styles.footnote}>
            <Icon name="verified_user" size={14} color={colors.successDark} />
            <Text variant="captionSm" color={colors.successDark}>
              New here? Sign in and we'll walk you through practice verification.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.insetPage },
  brand: { alignItems: 'center', gap: spacing.stackTight, marginBottom: spacing.xl },
  iconAnchor: {
    width: 84,
    height: 84,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
  },
  card: { gap: spacing.lg },
  headings: { gap: spacing.stackMedium },
  footnote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.stackMedium,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.insetPage,
  },
});
