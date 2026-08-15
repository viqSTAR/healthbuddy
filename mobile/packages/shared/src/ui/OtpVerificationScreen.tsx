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
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  const hiddenInput = useRef<TextInput | null>(null);

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
        setCode('');
        hiddenInput.current?.focus();
      } finally {
        setLoading(false);
      }
    },
    [verifyOtp]
  );

  /**
   * One handler, one value. Non-digits are stripped because a number pad can
   * still emit them, and the code is capped rather than truncated silently
   * mid-burst.
   */
  const onCodeChange = (value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(cleaned);
    if (cleaned) setError(null);
    // Only ever submit a complete code.
    if (cleaned.length === OTP_LENGTH) void submit(cleaned);
  };

  const resend = async () => {
    try {
      await resendOtp();
      setSecondsLeft(RESEND_SECONDS);
      setCode('');
      setError(null);
      hiddenInput.current?.focus();
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

          {/*
            One real input, six boxes that only draw it.

            Six separate inputs with focus hopping between them cannot be made
            reliable: `focus()` is asynchronous, so when digits arrive faster
            than a frame — an SMS autofill, or anyone typing quickly — some land
            in the box that still has focus and overwrite each other. Fixing the
            state race alone was not enough; a six-digit burst still came out as
            five, with a hole in the middle, because the race that remained was
            the caret rather than the value.

            The boxes are now presentation. There is one field, it holds the
            whole code, and the row underneath renders its characters. Nothing
            has to move, so nothing can arrive before the move finishes.
          */}
          <Pressable onPress={() => hiddenInput.current?.focus()} style={styles.otpRow}>
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.otpBox,
                  styles.otpBoxDisplay,
                  code[i] ? styles.otpBoxFilled : null,
                  error ? styles.otpBoxError : null,
                ]}
              >
                <Text variant="displayBold" color={colors.headingDark}>
                  {code[i] ?? ''}
                </Text>
              </View>
            ))}

            <TextInput
              ref={hiddenInput}
              style={styles.hiddenInput}
              value={code}
              onChangeText={onCodeChange}
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
              autoFocus
              accessibilityLabel="Verification code"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              caretHidden
            />
          </Pressable>

          {error ? (
            <Text variant="captionSm" color={colors.error} center>
              {error}
            </Text>
          ) : null}

          <Button
            label="Verify"
            icon="check_circle"
            iconPosition="right"
            onPress={() => void submit(code)}
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
  otpBoxDisplay: { alignItems: 'center', justifyContent: 'center' },
  /**
   * Covers the row and is invisible: tapping anywhere on the boxes focuses it,
   * and the caret is hidden so the illusion holds.
   */
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
  },
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
