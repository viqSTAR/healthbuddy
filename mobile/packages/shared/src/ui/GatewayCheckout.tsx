import React from 'react';
import { Modal, View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Button } from './Button';
import { Text } from './Text';
import { TopBar } from './Screen';
import { colors } from '../theme/colors';
import { spacing } from '../theme/typography';
import type { Checkout } from '../services/endpoints';

/**
 * The payment gateway's own checkout, in a WebView.
 *
 * Until this existed the app could only take money under `PAYMENT_PROVIDER=mock`:
 * the payment screen called `simulatePayment`, a development stand-in that 404s
 * the moment a real provider is configured. So the entire prepaid path — the
 * one that actually collects money — did not work in production, and the only
 * usable method was cash on delivery.
 *
 * Razorpay's *standard* checkout is used rather than the native SDK on purpose.
 * The native module needs a development build, which would end the ability to
 * run these apps in Expo Go; the hosted script runs anywhere a WebView does and
 * is the same checkout the merchant dashboard shows.
 *
 * **The result from the page is not trusted.** The WebView reports what the
 * gateway told the browser, which is a message from a client and could be
 * anything. It is handed straight to `confirmPayment`, which verifies the
 * signature server-side against the key secret before a single order moves.
 * This component decides nothing about whether a payment succeeded.
 */

export interface GatewayResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface Props {
  checkout: Checkout;
  /** Shown on the gateway sheet so the payer recognises the charge. */
  description: string;
  prefill?: { name?: string; contact?: string; email?: string };
  onSuccess: (result: GatewayResult) => void;
  /** Dismissed, failed, or closed by the payer. */
  onCancel: (reason?: string) => void;
}

/**
 * Serialises a value into a `<script>` safely.
 *
 * `</script>` inside a JSON string ends the block early and everything after it
 * becomes markup — the classic way an innocuous field turns into script
 * injection. None of these values are attacker-controlled today; escaping them
 * means that stays true when someone later passes a name through.
 */
const embed = (value: unknown) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

const page = (props: Props) => `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; height: 100%; background: ${colors.surface}; }
    </style>
  </head>
  <body>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <script>
      var post = function (payload) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      };

      try {
        var rzp = new Razorpay({
          key: ${embed(props.checkout.publicKey)},
          order_id: ${embed(props.checkout.gatewayOrderId)},
          // Paise. The gateway is authoritative on the figure; this is only
          // what the sheet displays, and the server priced the order already.
          amount: ${embed(Math.round(props.checkout.amount * 100))},
          currency: ${embed(props.checkout.currency)},
          name: 'Health Buddy',
          description: ${embed(props.description)},
          prefill: ${embed(props.prefill ?? {})},
          theme: { color: ${embed(colors.primary)} },
          handler: function (response) {
            post({ type: 'success', response: response });
          },
          modal: {
            ondismiss: function () {
              post({ type: 'cancel' });
            },
          },
        });

        rzp.on('payment.failed', function (response) {
          post({
            type: 'failed',
            reason: (response && response.error && response.error.description) || 'Payment failed.',
          });
        });

        rzp.open();
      } catch (err) {
        post({ type: 'failed', reason: String((err && err.message) || err) });
      }
    </script>
  </body>
</html>`;

export const GatewayCheckout: React.FC<Props> = (props) => {
  const { checkout, onCancel, onSuccess } = props;

  /**
   * Refuses to open on an incomplete checkout.
   *
   * A missing order id or public key means the server could not reach the
   * gateway. Opening the sheet anyway shows the payer a broken modal and tells
   * them nothing; saying so is more useful and keeps them out of a flow that
   * cannot complete.
   */
  if (!checkout.gatewayOrderId || !checkout.publicKey) {
    return (
      <Modal visible animationType="slide" onRequestClose={() => onCancel()}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.fallback} edges={['top', 'bottom']}>
            <TopBar title="Payment" onBack={() => onCancel()} />
            <View style={styles.fallbackBody}>
              <Text variant="headlineSm">Payments are unavailable right now</Text>
              <Text variant="captionSm" style={styles.muted}>
                We could not reach the payment provider, so nothing has been charged. Try
                again shortly, or choose cash on delivery if it is offered.
              </Text>
              <Button label="Go back" onPress={() => onCancel()} fullWidth />
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={() => onCancel()}>
      {/*
        A nested provider, because a React Native Modal is its own native view
        hierarchy and does not inherit the app's insets. Without it the back
        arrow below renders under the Dynamic Island — on the one screen where
        leaving is the only thing a payer can safely do if something looks wrong.
      */}
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <TopBar title="Payment" onBack={() => onCancel()} />
          <WebView
            originWhitelist={['*']}
            source={{ html: page(props), baseUrl: 'https://checkout.razorpay.com' }}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            )}
            onMessage={(event) => {
              let message: { type?: string; response?: GatewayResult; reason?: string };
              try {
                message = JSON.parse(event.nativeEvent.data);
              } catch {
                onCancel('The payment page sent something unreadable.');
                return;
              }

              if (message.type === 'success' && message.response) {
                onSuccess(message.response);
              } else if (message.type === 'failed') {
                onCancel(message.reason ?? 'Payment failed.');
              } else {
                onCancel();
              }
            }}
            onError={() => onCancel('Could not load the payment page.')}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  fallback: { flex: 1, backgroundColor: colors.surface },
  fallbackBody: { padding: spacing.lg, gap: spacing.insetCard },
  muted: { color: colors.onSurfaceVariant },
});
