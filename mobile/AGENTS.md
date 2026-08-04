# Health Buddy — mobile monorepo

Three Expo apps over one shared package.

```
mobile/
├── packages/shared/     @healthbuddy/shared — tokens, UI, API client, auth
└── apps/
    ├── patient/         Health Buddy            (com.healthbuddy.patient)
    ├── doctor/          Health Buddy Doctor     (com.healthbuddy.doctor)
    └── partner/         Health Buddy Partner    (com.healthbuddy.partner)
```

Expo SDK **54** (`expo ~54.0.8`, React Native 0.76.7, React 18.3.1).
Docs: https://docs.expo.dev/versions/v54.0.0/

## Running

```bash
npm install          # once, at mobile/ — npm workspaces hoists everything

npm run all          # all three dev servers side by side
npm run all:web      # …and open each in a browser

npm run patient      # or just one: doctor / partner
```

Each app owns a fixed port so all three can run simultaneously —
patient **8081**, doctor **8082**, partner **8083**. Don't remove the `--port`
flags from the app `start` scripts; without them Expo prompts interactively for
a free port and the URLs stop being predictable.

**Do not hand-configure Metro.** Expo has handled monorepo resolution itself
since SDK 52, so each `metro.config.js` is just `getDefaultConfig(__dirname)`.
Re-adding `watchFolders`, `resolver.nodeModulesPaths`, `extraNodeModules` or
`disableHierarchicalLookup` — the pre-SDK-52 recipe you will find in older blog
posts — replaces Expo's defaults, forces a full crawl of the monorepo on every
start, and fails `expo-doctor`. After changing anything there, run
`npx expo start --clear` once to drop the stale cache.

## Dependency versions

Pinned to what Expo SDK 54 expects: **React Native 0.81.5, React 19.1.0**. Never
hand-edit these — run `npx expo install --check` to see drift and
`npx expo install --fix` to correct it, and `npx expo-doctor` for the wider
health check (all three apps should report 18/18).

Because npm hoists, the three apps must move together: leaving one on an older
`@types/react` blocks the whole workspace from resolving. Update all three, then
`rm -rf node_modules package-lock.json && npm install` at `mobile/`.

## Where code goes

**`packages/shared`** — anything more than one app needs. Design tokens, every
UI primitive, the axios client, `AuthProvider`, push registration, and the
screens that are genuinely identical across apps (`OtpVerificationScreen`,
`NotificationsScreen`, `VerificationStatus`, `DocumentUploader`).

**`apps/*/src`** — only what is specific to that app. If you find yourself
copying a component between apps, move it to `shared` instead.

Apps import from `@healthbuddy/shared` and never reach into its paths directly.

## Design system

A direct port of the Stitch design system in
`stitch_health_buddy_design_system/health_buddy/DESIGN.md`. Tokens live in
`packages/shared/src/theme/` and are transcribed verbatim — **do not hand-tune
colours, radii or the type scale**; change `DESIGN.md` first, then mirror it.

Key invariants:

- `colors.surface` is the mint page background (`#e7fff2`). Cards use
  `colors.surfaceContainerLowest` (pure white).
- Depth comes from **tonal layering**, not shadows. Only the bottom nav lifts.
- Hierarchy is carried by font **weight**, not size. The 10px `captionSm` style
  is load-bearing (ratings, nav labels, metadata).
- Icons are Material Symbols names in snake_case (`water_drop`), mapped onto
  `@expo/vector-icons` by `packages/shared/src/ui/Icon.tsx`. **A name with no
  glyph renders as an empty box and nothing catches it** — neither TypeScript
  nor the bundler. Add an entry to `ALIASES` when the plain kebab-case swap has
  no match in Material Icons.

## Conventions

- Compose screens from shared primitives; add to `packages/shared/src/ui/`
  rather than restyling inline.
- All network access goes through `packages/shared/src/services/endpoints.ts`.
  Never call `axios` directly from a screen.
- Tokens are stored in `expo-secure-store` via `tokenStore`, never React state.
- Run `npx tsc --noEmit` in each app before committing; `strict` is on.

## The role boundary

The doctor and partner apps gate on `useProviderApplication`, which derives
`approved` from the **server-issued role** — never from an application row. An
applicant submits a `ProviderApplication` describing what they want to be; an
admin approves it and only then does the backend create the provider profile and
change the user's role.

Never add a client-side path that grants capability based on what the user
selected. Every provider endpoint enforces the role independently, so a
navigator bug cannot become a privilege escalation — keep it that way.
