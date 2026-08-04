import React, { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
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
 * Mirrors the `login` reference screen: brand header, circular icon anchor,
 * "Welcome Back", white card, social divider, and sign-up footer.
 *
 * The reference shows a password field, but this backend authenticates by
 * phone + one-time code — there are no passwords to collect. The single
 * identifier field submits into the OTP step instead.
 */
export const LoginScreen: React.FC<{ onSignUp?: () => void }> = ({ onSignUp }) => {
  const { requestOtp } = useAuth();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const trimmed = phone.trim();
    if (trimmed.replace(/\D/g, '').length < 8) {
      setError('Enter a valid mobile number including country code.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await requestOtp(trimmed);
    } catch (err) {
      setError(errorMessage(err, 'Could not send the verification code.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Icon name="health_and_safety" size={26} color={colors.primary} />
        <Text variant="displayBold" color={colors.primary}>
          Health Buddy
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <View style={styles.identity}>
            <View style={styles.iconAnchor}>
              <Icon name="medical_services" size={34} color={colors.primary} />
            </View>
            <Text variant="displayBold" color={colors.headingDark} style={styles.welcome}>
              Welcome Back
            </Text>
            <Text variant="bodyMd" color={colors.captionGray} center>
              Your wellness journey continues here.
            </Text>
          </View>

          <Card padding={spacing.xl} style={styles.card}>
            <Input
              label="Mobile Number"
              icon="person"
              placeholder="e.g. +1 234 567 890"
              value={phone}
              onChangeText={(t) => {
                setPhone(t);
                setError(null);
              }}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              error={error ?? undefined}
              hint={error ? undefined : "We'll text you a one-time code."}
              onSubmitEditing={submit}
              returnKeyType="go"
            />

            <Button
              label="Continue"
              onPress={submit}
              loading={loading}
              fullWidth
              style={styles.cta}
            />

            <View style={styles.dividerRow}>
              <View style={styles.rule} />
              <Text variant="captionSm" weight="medium" color={colors.captionGray} uppercase>
                Or continue with
              </Text>
              <View style={styles.rule} />
            </View>

            <View style={styles.socialRow}>
              <SocialButton icon="public" label="Google" />
              <SocialButton icon="apps" label="Apple" />
            </View>
          </Card>

          <View style={styles.signupRow}>
            <Text variant="bodyMd" color={colors.onSurfaceVariant}>
              Don't have an account?{' '}
            </Text>
            <Pressable onPress={onSignUp} hitSlop={8}>
              <Text variant="bodyMd" weight="bold" color={colors.primary}>
                Sign Up
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.support}>
          <Icon name="help" size={16} color={colors.captionGray} />
          <Text variant="labelMd" color={colors.captionGray}>
            Support &amp; Help
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

/** Present in the reference design; no federated provider is wired up yet. */
const SocialButton: React.FC<{ icon: string; label: string }> = ({ icon, label }) => (
  <View style={styles.social} accessibilityState={{ disabled: true }}>
    <Icon name={icon} size={18} color={colors.onSurfaceVariant} />
    <Text variant="labelMd" weight="medium" color={colors.onSurfaceVariant}>
      {label}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.insetCard,
  },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.insetPage },
  identity: { alignItems: 'center', marginBottom: spacing.xl },
  iconAnchor: {
    width: 88,
    height: 88,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  welcome: { fontSize: 30, lineHeight: 38, marginBottom: spacing.base },
  card: { gap: spacing.lg },
  cta: { marginTop: spacing.inlineSm },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.insetCard },
  rule: { flex: 1, height: 1, backgroundColor: colors.outlineVariant },
  socialRow: { flexDirection: 'row', gap: spacing.insetCard },
  social: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.base,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    opacity: 0.55,
  },
  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  support: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.stackMedium,
    paddingBottom: spacing.lg,
  },
});
