// Expo configures Metro for monorepos automatically from SDK 52 onwards, so
// this file deliberately overrides nothing.
//
// Do NOT re-add `watchFolders`, `resolver.nodeModulesPaths`,
// `resolver.extraNodeModules` or `resolver.disableHierarchicalLookup` here.
// That was the pre-SDK-52 recipe; `expo/metro-config` now handles workspace
// resolution itself, and setting them again replaces Expo's defaults, forces a
// full crawl of the monorepo on every start, and is flagged by `expo-doctor`.
// See https://docs.expo.dev/guides/monorepos/
//
// If you ever change this file, run `npx expo start --clear` once to drop the
// stale Metro cache.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
