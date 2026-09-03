import { defineConfig } from 'vitest/config';

/**
 * Tests for the shared package only — the API client, the token store and the
 * auth logic every app depends on.
 *
 * Deliberately not React Native component tests. Rendering RN components off a
 * device needs a preset that mocks the whole native bridge, and what it proves
 * is that a view tree matches a snapshot. The bugs that matter here are in
 * session handling: a token written to the wrong place, a refresh that loops, a
 * sign-out that does not reach the server. Those are plain TypeScript and can be
 * tested honestly.
 *
 * `expo-secure-store` and `react-native` are aliased to local fakes because
 * they are native modules with no Node implementation — importing them outside
 * a device throws before a single assertion runs.
 */
export default defineConfig({
  /**
   * Metro injects `__DEV__` at build time; Node does not. Anything reaching
   * into `expo-modules-core` — which `expo-constants` does, transitively, from
   * the API base-URL lookup — reads it at import and throws without it.
   */
  define: { __DEV__: 'false' },

  resolve: {
    alias: {
      'expo-secure-store': new URL('./src/testing/secureStoreFake.ts', import.meta.url).pathname,
      'react-native': new URL('./src/testing/reactNativeFake.ts', import.meta.url).pathname,
      'expo-constants': new URL('./src/testing/expoConstantsFake.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
});
