/**
 * Stands in for `expo-constants`.
 *
 * The real module loads `expo-modules-core`, which reaches for the native
 * bridge at import time and throws in Node before any test runs. The API client
 * reads exactly two fields off it, both used only to guess the dev server's
 * host — irrelevant under test, where the base URL is whatever the client
 * resolved and requests are intercepted anyway.
 */
export default {
  expoConfig: undefined as { hostUri?: string } | undefined,
  expoGoConfig: undefined as { debuggerHost?: string } | undefined,
};
