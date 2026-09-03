import React, { useState } from 'react';
import { View, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Button,
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
 * Mirrors the `sign_up` reference: back header, brand anchor, "Create Account",
 * name / identity fields, terms consent and the primary action.
 *
 * The reference includes a password field; this backend has no password auth,
 * so the form completes through the same OTP step as login. The name is applied
 * to the patient profile once verification succeeds.
 */
export const SignUpScreen: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const { requestOtp } = useAuth();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; phone?: string; terms?: string }>({});
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const next: typeof errors = {};
    if (fullName.trim().length < 2) next.name = 'Enter your full name.';
    if (phone.replace(/\D/g, '').length < 8) next.phone = 'Enter a valid mobile number.';
    if (!accepted) next.terms = 'You must accept the terms to continue.';

    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      await requestOtp(phone.trim(), fullName.trim());
    } catch (err) {
      setErrors({ phone: errorMessage(err, 'Could not send the verification code.') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Go back">
          <Icon name="arrow_back" size={24} color={colors.primary} />
        </Pressable>
        <Text variant="displayBold" color={colors.primary}>
          Health Buddy
        </Text>
        <View style={styles.spacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <View style={styles.welcome}>
            <View style={styles.iconAnchor}>
              <Icon name="health_and_safety" size={32} color={colors.primary} />
            </View>
            <Text variant="displayBold" color={colors.headingDark} style={styles.title}>
              Create Account
            </Text>
            <Text variant="bodyMd" color={colors.captionGray} center>
              Join our health community and start your wellness journey today.
            </Text>
          </View>

          <View style={styles.form}>
            <Input
              label="Full Name"
              icon="person"
              placeholder="John Doe"
              value={fullName}
              onChangeText={(t) => {
                setFullName(t);
                setErrors((e) => ({ ...e, name: undefined }));
              }}
              autoCapitalize="words"
              maxLength={120}
              error={errors.name}
            />

            <Input
              label="Mobile Number"
              icon="phone"
              placeholder="+1 234 567 890"
              value={phone}
              onChangeText={(t) => {
                setPhone(t);
                setErrors((e) => ({ ...e, phone: undefined }));
              }}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              error={errors.phone}
              hint={errors.phone ? undefined : "We'll text you a one-time code."}
            />

            <Pressable
              onPress={() => {
                setAccepted((a) => !a);
                setErrors((e) => ({ ...e, terms: undefined }));
              }}
              style={styles.termsRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accepted }}
            >
              <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
                {accepted ? <Icon name="check" size={14} color={colors.onPrimary} /> : null}
              </View>
              <Text variant="captionSm" color={colors.onSurfaceVariant} style={styles.flex}>
                I agree to the{' '}
                <Text variant="captionSm" weight="semibold" color={colors.primary}>
                  Terms &amp; Conditions
                </Text>{' '}
                and{' '}
                <Text variant="captionSm" weight="semibold" color={colors.primary}>
                  Privacy Policy
                </Text>{' '}
                regarding my health data.
              </Text>
            </Pressable>

            {errors.terms ? (
              <Text variant="captionSm" color={colors.error}>
                {errors.terms}
              </Text>
            ) : null}

            <Button label="Sign Up" onPress={submit} loading={loading} fullWidth />
          </View>

          <View style={styles.loginRow}>
            <Text variant="bodyMd" color={colors.onSurfaceVariant}>
              Already have an account?{' '}
            </Text>
            <Pressable onPress={onBack} hitSlop={8}>
              <Text variant="bodyMd" weight="bold" color={colors.primary}>
                Log In
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.insetCard,
  },
  spacer: { width: 24 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.insetPage },
  welcome: { alignItems: 'center', marginBottom: spacing.xl },
  iconAnchor: {
    width: 76,
    height: 76,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.insetPage,
  },
  title: { fontSize: 26, lineHeight: 32, marginBottom: spacing.base },
  form: { gap: spacing.insetPage },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.insetCard },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
});
