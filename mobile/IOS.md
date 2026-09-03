# Running and shipping on iOS

The four apps are one React Native codebase and have always been buildable for
iOS in principle. This documents what had to be true for that to actually work,
what you still have to supply, and the one thing that is a real difference
rather than a bug.

---

## 1. Why nothing shipped before

iOS refuses to run code that asks for a permission it has not declared. Not a
rejected promise — the OS terminates the process. Every purpose string lives in
`Info.plist`, which Expo generates from `app.json` at prebuild time, and none of
the four apps declared any.

That is not a subtle failure. The patient app reads the device location during
launch to work out which pharmacies serve you, so the first launch on an iPhone
would have been a crash to the home screen, every time, with nothing in the app
to explain it. Android has no equivalent: a missing permission there is a denied
request, and the app carries on.

The fix is in each app's `app.json`, under `ios.infoPlist` and in the config
plugins that write those keys:

| Key | Asked for by |
| --- | --- |
| `NSLocationWhenInUseUsageDescription` | patient (serviceability, SOS), agent (live job tracking) |
| `NSCameraUsageDescription` | video consultations, photographing a licence or prescription |
| `NSMicrophoneUsageDescription` | video consultations |
| `NSPhotoLibraryUsageDescription` | attaching a document already saved on the phone |

All four apps declare all four keys. Every app imports the shared UI barrel, and
that barrel pulls in the document uploader and the consultation screen, so every
binary links PhotoKit, AVFoundation and CoreLocation whether or not that app
routes to those screens. Apple's automated check (`ITMS-90683`) rejects a linked
framework with no purpose string, so a string that is never shown is still
required. The wording is per app and describes only what that app can do.

### App Transport Security

iOS blocks cleartext HTTP outright. The development API is
`http://<lan-ip>:5000`, so without an exception a physical iPhone reaches
nothing while the same build works fine on Android.

`NSAllowsLocalNetworking` permits cleartext to private-range and `.local` hosts
only. Production traffic is HTTPS and unaffected, and Apple does not ask for a
justification for this key at review. `NSAllowsArbitraryLoads` — the blunt
version that does need justifying — is deliberately not set.

---

## 2. Running one on a Simulator

Requires macOS and Xcode. There is no way around that; Apple does not license
the toolchain elsewhere.

```bash
cd mobile/apps/patient && npm run ios
```

That is Expo Go, which is enough for everything except push notifications.
Remote push needs a development build:

```bash
cd mobile/apps/patient && npx eas build --profile development --platform ios
```

The `development` profile builds for the Simulator, so it needs no paid Apple
account. Note that a Simulator still cannot receive a real push — APNs will not
issue it a token. The app handles that: token minting is wrapped, and a failure
returns `null` rather than taking the sign-in callback down with it.

---

## 2b. Testing from Windows, without a Mac or an iPhone

The Simulator itself is macOS-only and there is no way around that — a macOS VM
on Windows cannot run it, because the Simulator needs Metal and neither
VirtualBox's emulated adapter nor any NVIDIA card has a macOS driver. What does
work is building on Apple hardware in the cloud and running the result in a
browser.

The `simulator` profile produces a **standalone** iOS Simulator build: the JS is
bundled in, so it boots with no Metro to connect to, and — unlike a device build
— it needs **no Apple Developer account**.

```bash
cd mobile/apps/patient && npx eas build --profile simulator --platform ios
```

Upload the resulting archive to a browser-hosted Simulator service such as
Appetize.io, which has a free tier. Unlike Expo Go this is *your* binary, so it
exercises the real `Info.plist` purpose strings and the ATS configuration —
neither of which Expo Go can show you, because it substitutes its own.

Its API URL is loopback, so on a hosted simulator the app reports that it cannot
reach the server. That is deliberate: the login screen, safe areas, Dynamic
Island clearance, keyboard behaviour and Contacts autofill are all testable
without a backend, and pointing this profile at a public URL would mean exposing
a development database to the internet. Change it only to a real staging host.

**What no Simulator can test, on any Mac:** there is no camera. Video
consultations, photographing a prescription or a licence, and live delivery
tracking all need a physical device. Budget for one — or the Developer account
and TestFlight — before those features reach a real patient.

---

## 3. What you still have to supply

`eas.json` in each app carries two placeholders that a build will happily
consume and produce something broken from:

- `REPLACE_WITH_STAGING_API_URL`
- `REPLACE_WITH_PRODUCTION_API_URL`

A device build cannot reach the machine that built it, so these must be real
reachable HTTPS hosts before a TestFlight or store build means anything.

Beyond that, all of it is account work that cannot be done from this repository:

| Needed | For |
| --- | --- |
| Apple Developer Program membership | any build that leaves the Simulator |
| App Store Connect app records ×4 | one per bundle id, listed below |
| APNs key (`.p8`) uploaded to EAS | push notifications |
| `ascAppId` + `appleTeamId` in `eas.json` `submit` | automated submission |

Bundle identifiers: `com.healthbuddy.patient`, `.doctor`, `.partner`, `.agent`.

### Payments and Apple's cut

Consultations and medicines are real-world services and physical goods, which
Apple's guidelines put outside In-App Purchase (3.1.3(e), 3.1.5). Razorpay's
hosted checkout is allowed, and no 30% applies. This is worth knowing before
someone assumes otherwise and re-architects the payment flow.

---

## 4. Decisions worth revisiting

**`supportsTablet` is now `false` on all four apps.** Every layout here is a
single portrait column built around a phone bottom nav. Claiming iPad support
means Apple reviews the app at 1024pt wide, where that column is a stripe of
text in a field of background — a routine Guideline 4.0 rejection. With it off,
an iPad user can still install and run the app in compatibility mode, which
looks like what it is. Flip it back if and when there are iPad layouts.

**Expo patch versions drift.** `npx expo-doctor` reports `expo` and
`expo-constants` a patch behind. Do not fix this with `npm update expo` — in
this workspace that nests an entire second Expo SDK under the first and adds a
hundred lockfile entries. Update one leaf at a time with `npx expo install`.
