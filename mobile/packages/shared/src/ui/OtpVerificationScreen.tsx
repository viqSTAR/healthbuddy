import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, TextInput, Pressable, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './Button';
import { Card } from './Card';
import { Icon } from './Icon';
import { Text } from './Text';
import { colors } from '../theme/colors';
import { radius, spacing, typography } from '../theme/typography';
import { errorMessage } from '../services/api';
import { useAuth } from '../services/auth';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

export interface OtpVerificationScreenProps {
  /** Wordmark in the header — each app carries its own. */
  brand?: string;
}

/**
 * Mirrors the `otp_verification` reference: illustration panel with a floating
 * shield tile, white verification card, boxed code inputs, resend countdown and
 * the trust badge.
 *
 * The reference draws four boxes; this backend issues six-digit codes, so the
 * row renders six.
 *
 * Lives in the shared package because all three apps authenticate identically —
 * only the wordmark differs.
 */
export const OtpVerificationScreen: React.FC<OtpVerificationScreenProps> = ({
  brand = 'Health Buddy',
}) => {
  const { pendingPhone, devOtp, verifyOtp, resendOtp, cancelOtp } = useAuth();
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  const inputs = useRef<(TextInput | null)[]>([]);

  /**
   * A mirror of `digits` that is correct *now* rather than as of the last
   * render.
   *
   * Each box fires its own onChangeText, and when they arrive faster than React
   * re-renders — a fast typist, an SMS autofill delivering a digit at a time —
   * every handler in that burst reads the same stale `digits` array and writes
   * over the one before it. Six digits went in and two came out, which then
   * auto-submitted as a wrong code and burned one of the five attempts the
   * server allows. Building each update from the ref makes the writes additive
   * regardless of when React catches up.
   */
  const digitsRef = useRef<string[]>(Array(OTP_LENGTH).fill(''));

  const commit = useCallback((next: string[]) => {
    digitsRef.current = next;
    setDigits(next);
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  const submit = useCallback(
    async (code: string) => {
      if (code.length !== OTP_LENGTH) {
        setError(`Enter all ${OTP_LENGTH} digits.`);
        return;
      }

      Keyboard.dismiss();
      setError(null);
      setLoading(true);
      try {
        await verifyOtp(code);
        // On success the navigator swaps to the authenticated stack.
      } catch (err) {
        setError(errorMessage(err, 'Verification failed.'));
        digitsRef.current = Array(OTP_LENGTH).fill('');
        setDigits(Array(OTP_LENGTH).fill(''));
        inputs.current[0]?.focus();
      } finally {
        setLoading(false);
      }
    },
    [verifyOtp]
  );

  const setDigit = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '');

    // Handle a pasted or autofilled full code landing in one box.
    if (cleaned.length > 1) {
      const spread = cleaned.slice(0, OTP_LENGTH).split('');
      const next = Array(OTP_LENGTH)
        .fill('')
        .map((_, i) => spread[i] ?? '');
      commit(next);
      inputs.current[Math.min(spread.length, OTP_LENGTH - 1)]?.focus();
      if (spread.length === OTP_LENGTH) void submit(spread.join(''));
      return;
    }

    const next = [...digitsRef.current];
    next[index] = cleaned;
    commit(next);
    setError(null);

    if (cleaned && index < OTP_LENGTH - 1) inputs.current[index + 1]?.focus();
    // Only ever submit a full code. A burst that has not finished arriving
    // must not be sent as a short one.
    if (next.every((d) => d)) void submit(next.join(''));
  };

  const onKeyPress = (index: number, key: string) => {
    if (key === 'Backspace' && !digitsRef.current[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      const next = [...digitsRef.current];
      next[index - 1] = '';
      commit(next);
    }
  };

  const resend = async () => {
    try {
      await resendOtp();
      setSecondsLeft(RESEND_SECONDS);
      commit(Array(OTP_LENGTH).fill(''));
      setError(null);
      inputs.current[0]?.focus();
    } catch (err) {
      setError(errorMessage(err, 'Could not resend the code.'));
    }
  };

  const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(
    secondsLeft % 60
  ).padStart(2, '0')}`;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={cancelOtp} hitSlop={12} accessibilityLabel="Go back">
          <Icon name="arrow_back" size={24} color={colors.primary} />
        </Pressable>
        <Text variant="displayBold" color={colors.primary}>
          {brand}
        </Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.body}>
        <View style={styles.illustration}>
          <View style={styles.shieldTile}>
            <Icon name="security" size={40} color={colors.primary} />
          </View>
        </View>

        <Card padding={spacing.xl} style={styles.card}>
          <View style={styles.headings}>
            <Text variant="displayBold" color={colors.headingDark} center>
              Verify OTP
            </Text>
            <Text variant="bodyMd" color={colors.captionGray} center>
              Enter the {OTP_LENGTH}-digit code sent to {pendingPhone ?? 'your mobile'}
            </Text>
          </View>

          {devOtp ? (
            <View style={styles.devBanner}>
              <Icon name="key" size={14} color={colors.successDark} />
              <Text variant="captionSm" weight="bold" color={colors.successDark}>
                Dev code: {devOtp}
              </Text>
            </View>
          ) : null}

          <View style={styles.otpRow}>
            {digits.map((digit, i) => (
              <TextInput
                key={i}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                style={[
                  styles.otpBox,
                  digit ? styles.otpBoxFilled : null,
                  error ? styles.otpBoxError : null,
                ]}
                value={digit}
                onChangeText={(v) => setDigit(i, v)}
                onKeyPress={({ nativeEvent }) => onKeyPress(i, nativeEvent.key)}
                keyboardType="number-pad"
                maxLength={OTP_LENGTH}
                textAlign="center"
                autoFocus={i === 0}
                accessibilityLabel={`Digit ${i + 1}`}
                textContentType={i === 0 ? 'oneTimeCode' : 'none'}
                autoComplete={i === 0 ? 'sms-otp' : 'off'}
              />
            ))}
          </View>

          {error ? (
            <Text variant="captionSm" color={colors.error} center>
              {error}
            </Text>
          ) : null}

          <Button
            label="Verify"
            icon="check_circle"
            iconPosition="right"
            onPress={() => submit(digits.join(''))}
            loading={loading}
            fullWidth
          />

          <View style={styles.resendBlock}>
            <Text variant="bodyMd" color={colors.onSurfaceVariant} center>
              Didn't receive the code?
            </Text>
            <Pressable onPress={resend} disabled={secondsLeft > 0} hitSlop={8}>
              <Text
                variant="bodyMd"
                weight="semibold"
                color={secondsLeft > 0 ? colors.captionGray : colors.primary}
                center
              >
                Resend Code
              </Text>
            </Pressable>
            {secondsLeft > 0 ? (
              <Text variant="captionSm" color={colors.captionGray} center style={styles.wait}>
                Wait {mmss}
              </Text>
            ) : null}
          </View>
        </Card>

        <View style={styles.trustBadge}>
          <Icon name="verified_user" size={14} color={colors.successDark} />
          <Text variant="captionSm" weight="medium" color={colors.successDark} uppercase>
            Secure Health Authentication
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.insetCard,
  },
  spacer: { width: 24 },
  body: { flex: 1, paddingHorizontal: spacing.insetPage, justifyContent: 'center' },
  illustration: {
    height: 200,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  shieldTile: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: spacing.lg },
  headings: { gap: spacing.stackMedium },
  devBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.stackMedium,
    backgroundColor: colors.successLight,
    paddingVertical: spacing.base,
    borderRadius: radius.base,
  },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.base },
  otpBox: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: 'transparent',
    ...typography.headlineSm,
    color: colors.headingDark,
  },
  otpBoxFilled: { borderColor: colors.primary, backgroundColor: colors.surfaceContainerLowest },
  otpBoxError: { borderColor: colors.error },
  resendBlock: { gap: spacing.inlineSm },
  wait: { fontStyle: 'italic' },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.stackMedium,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.base,
    backgroundColor: colors.successLight,
    borderRadius: radius.full,
  },
});
