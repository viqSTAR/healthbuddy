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

  const id = projectId();
  const { data: token } = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : {});

  await registerDevice({
    token,
    appId,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });

  return token;
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
