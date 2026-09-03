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
 * Entry point for riders and sample collectors.
 *
 * One sign-in serves both jobs. What separates them is entitlement, not
 * identity: anyone verified may carry a sealed parcel, and only someone a lab
 * has taken on may collect a sample. Signing up creates an unverified account,
 * because taking a job is what discloses a patient's address.
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
              <Icon name="two_wheeler" size={36} color={colors.primary} />
            </View>
            <Text variant="displayBold" color={colors.primary}>
              Health Buddy
            </Text>
            <Text variant="labelMd" weight="semibold" color={colors.captionGray} uppercase>
              For Agents
            </Text>
          </View>

          <Card padding={spacing.xl} style={styles.card}>
            <View style={styles.headings}>
              <Text variant="displayBold" color={colors.headingDark}>
                Sign in
              </Text>
              <Text variant="bodyMd" color={colors.captionGray}>
                Pick up jobs near you and get them delivered.
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
              // iOS reads this, not `autoComplete`, to offer the number from
              // Contacts. Without it the field is the one place in the app a
              // provider has to type their own phone number from memory.
              textContentType="telephoneNumber"
              error={error}
              hint={error ? undefined : "We'll text you a one-time code."}
              onSubmitEditing={submit}
              returnKeyType="go"
            />

            <Button label="Continue" onPress={submit} loading={loading} fullWidth />
          </Card>

          <View style={styles.footnote}>
            <Icon name="verified_user" size={14} color={colors.successDark} />
            <Text variant="captionSm" color={colors.successDark}>
              New here? Sign in and we'll get you set up.
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
