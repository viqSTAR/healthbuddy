/**
 * The surface every Health Buddy app builds on: design tokens, UI primitives,
 * the API client and auth. Apps import from `@healthbuddy/shared` and never
 * reach into these paths directly.
 */

/* Design tokens */
export { colors, tints } from './theme/colors';
export type { TintName } from './theme/colors';
export { typography, radius, spacing, elevation } from './theme/typography';
export { useAppFonts } from './theme/useAppFonts';

/* UI primitives */
export * from './ui';

/* Formatting */
export { rupees } from './format';

/* Hooks */
export { useAsync } from './hooks/useAsync';
export { useBottomActionInset } from './hooks/useBottomActionInset';
export { useProviderApplication } from './hooks/useProviderApplication';
export type { ProviderGate } from './hooks/useProviderApplication';

/* Networking */
export { api, API_BASE_URL, errorMessage, setSessionExpiredHandler } from './services/api';
/**
 * Import Alert from here, never from 'react-native': react-native-web ships it
 * as a no-op, so on web every message is discarded and every confirmation
 * silently does nothing.
 */
export { Alert, type AlertButton } from './services/alert';
export * from './services/endpoints';

/* Auth */
export { AuthProvider, useAuth } from './services/auth';
export type { AuthUser } from './services/auth';

/* Push notifications */
export {
  registerForPushNotifications,
  unregisterPushToken,
  onNotificationTapped,
  syncNotificationBadge,
  isExpoGo,
} from './services/notifications';

/* Token storage — exposed for apps that need to read session state directly */
export * as tokenStore from './services/tokenStore';
