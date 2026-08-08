import { Alert as RNAlert, Platform } from 'react-native';

/**
 * A dialog that actually appears on every platform.
 *
 * `react-native-web` ships `Alert` as a literal no-op:
 *
 *     class Alert { static alert() {} }
 *
 * So on web every error message is silently discarded and every confirmation
 * never resolves — the destructive button's `onPress` is simply never called.
 * The symptom is a button that looks broken: you tap Remove, nothing happens,
 * and there is nothing in the console to explain it.
 *
 * This keeps React Native's exact signature so call sites are unchanged, and
 * maps to the browser's own dialogs on web.
 */

export interface AlertButton {
  text?: string;
  onPress?: (() => void) | undefined;
  style?: 'default' | 'cancel' | 'destructive';
}

const webAlert = (title: string, message?: string, buttons?: AlertButton[]): void => {
  const body = [title, message].filter(Boolean).join('\n\n');

  // Nothing to choose between — inform, then run the single handler if given.
  if (!buttons || buttons.length === 0) {
    window.alert(body);
    return;
  }
  if (buttons.length === 1) {
    window.alert(body);
    buttons[0]?.onPress?.();
    return;
  }

  /**
   * Two or more buttons become a confirm. The affirmative one is whichever is
   * not the cancel — matching how these are written in practice, where cancel
   * comes first and the real action second.
   */
  const cancel = buttons.find((b) => b.style === 'cancel') ?? buttons[0];
  const affirm =
    buttons.find((b) => b.style === 'destructive') ??
    buttons.find((b) => b !== cancel) ??
    buttons[buttons.length - 1];

  if (window.confirm(body)) affirm?.onPress?.();
  else cancel?.onPress?.();
};

export const Alert = {
  alert: (title: string, message?: string, buttons?: AlertButton[]): void => {
    if (Platform.OS === 'web') {
      webAlert(title, message, buttons);
      return;
    }
    // Bound through a wrapper: RNAlert.alert relies on its receiver.
    RNAlert.alert(title, message, buttons);
  },
};
