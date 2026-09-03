import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { registerDevice, unregisterDevice, type AppId } from './endpoints';

/**
 * Push registration.
 *
 * Three apps coordinate through this backend — a doctor has to learn a patient
 * booked, a pharmacy that an order landed — so the token is registered against
 * the user AND the app. One person may hold both a patient and a provider
 * identity, and an alert meant for the partner app must not surface in the
 * patient app.
 *
 * `expo-notifications` is imported lazily rather than at module scope. Expo Go
 * removed remote push on Android in SDK 53, and merely loading the module there
 * logs an error on every launch. Deferring the import means Expo Go never
 * touches it, and the in-app notification feed — which is the durable record
 * anyway — keeps working everywhere.
 */

type NotificationsModule = typeof import('expo-notifications');

/** Expo Go cannot deliver remote push; a development build can. */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Web has no push transport in this stack. */
const pushUnavailable = isExpoGo || Platform.OS === 'web';

let cached: NotificationsModule | null = null;
let handlerInstalled = false;

const loadNotifications = async (): Promise<NotificationsModule | null> => {
  if (pushUnavailable) return null;

  if (!cached) {
    cached = await import('expo-notifications');
  }

  if (!handlerInstalled) {
    cached.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
    handlerInstalled = true;
  }

  return cached;
};

/** Expo push tokens require the EAS project id once the app is built. */
const projectId = (): string | undefined =>
  Constants.expoConfig?.extra?.eas?.projectId ??
  (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;

/**
 * Asks for permission and registers the resulting token with the backend.
 *
 * Returns null when push is unavailable (Expo Go, web, simulator) or the user
 * declines. Callers treat that as normal, not as an error — notifications are
 * an enhancement, never a precondition for using the app.
 */
export const registerForPushNotifications = async (appId: AppId): Promise<string | null> => {
  const Notifications = await loadNotifications();
  if (!Notifications) return null;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Health Buddy',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  /**
   * Minting the token is the step that can fail for reasons that are not the
   * caller's problem.
   *
   * On the iOS Simulator there is no APNs registration to hand out, and this
   * throws rather than returning nothing — the doc comment above already
   * promised a null for that case, and the code did not deliver one, so every
   * simulator login rejected out of `registerForPushNotifications` and took the
   * rest of the sign-in callback with it. A missing EAS project id and a
   * device that cannot reach Apple or Google fail the same way.
   *
   * Push is an enhancement. Failing to arrange it is not a failed login.
   */
  let token: string;
  try {
    const id = projectId();
    ({ data: token } = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : {}));
  } catch {
    return null;
  }

  await registerDevice({
    token,
    appId,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });

  return token;
};

/**
 * Points the springboard badge at what the server actually holds unread.
 *
 * iOS keeps whatever number the last push set until the app takes it down
 * itself. Android's channel badge follows the shade, so nobody noticed this was
 * never wired up — on an iPhone it means a red "3" sitting over an app whose
 * feed you read yesterday, and after enough of those the badge stops meaning
 * anything.
 *
 * Setting the count rather than clearing it keeps the two in step in both
 * directions: read three of five and the badge says two.
 */
export const syncNotificationBadge = async (unread: number): Promise<void> => {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.trunc(unread)));
  } catch {
    // A badge is decoration. Nothing here is worth surfacing to the user.
  }
};

export const unregisterPushToken = (token: string) => unregisterDevice(token);

/**
 * Subscribes to taps on a notification. Returns an unsubscribe function
 * synchronously so callers can use it directly in a `useEffect` cleanup, even
 * though the module loads asynchronously underneath.
 */
export const onNotificationTapped = (
  handler: (data: Record<string, unknown>) => void
): (() => void) => {
  let subscription: { remove: () => void } | null = null;
  let cancelled = false;

  void loadNotifications().then((Notifications) => {
    if (!Notifications || cancelled) return;
    subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handler((response.notification.request.content.data ?? {}) as Record<string, unknown>);
    });
  });

  return () => {
    cancelled = true;
    subscription?.remove();
  };
};
