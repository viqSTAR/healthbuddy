/**
 * The sliver of `react-native` the shared services touch.
 *
 * Only `Platform.OS` is read outside components, and it decides whether the
 * token store uses the keychain or falls back to localStorage — a branch worth
 * being able to drive from a test.
 */
export const Platform = {
  OS: 'ios' as 'ios' | 'android' | 'web',
  select: <T,>(spec: Record<string, T>): T | undefined => spec[Platform.OS] ?? spec.default,
};
