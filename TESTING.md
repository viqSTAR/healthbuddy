# Testing Health Buddy

Four surfaces over one backend. Start the backend first — nothing else works
without it.

---

## 0. One-time setup

```bash
# Backend
npm install
npm run prisma:push
npm run seed

# Mobile (one install covers all three apps)
cd mobile && npm install && cd ..

# Admin panel
cd admin && npm install && cd ..
```

Make sure `.env` has:

```
NODE_ENV=development
EXPOSE_DEV_OTP=true     # returns the OTP in the response — dev only
SMS_PROVIDER=mock
PAYMENT_PROVIDER=mock   # simulates a gateway, signatures and all
VIDEO_PROVIDER=mock     # call shell only, until you configure a real one
STORAGE_DRIVER=local
```

`EXPOSE_DEV_OTP=true` is what lets you log in without real SMS. Every one of
these `mock` values is rejected outright when `NODE_ENV=production` — `mock`
payments would mark orders paid without collecting anything, and `local` storage
would lose every licence and lab report on the next redeploy.

### Switching on Cloudflare R2

```
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=<your Cloudflare account id>
S3_BUCKET=<bucket name>
S3_ACCESS_KEY_ID=<from an R2 API token>
S3_SECRET_ACCESS_KEY=<from the same token>
```

Create the token under **R2 → Manage API Tokens** with *Object Read & Write* on
that bucket. Two things to get right:

- **Keep the bucket private.** Do not enable the `r2.dev` public URL. Reads are
  authorised per request and streamed through the API; a public bucket only
  creates a way to reach a patient's lab report with no login at all.
- Nothing else changes. R2 speaks the S3 API, so the same driver serves both;
  only the endpoint and region differ, and both are derived from the account id.

---

## 1. Automated checks

Run these before touching a phone — they catch most breakage in seconds.

```bash
# Backend: 59 regression tests against a live database
npm test

# Backend types
npx tsc --noEmit

# Every app's types
cd mobile && npm run typecheck

# Every app matches Expo SDK 54, and its config is sane
cd mobile/apps/patient && npx expo-doctor     # expect 18/18
cd ../doctor  && npx expo-doctor
cd ../partner && npx expo-doctor

# Proves every import resolves (bundling is the only thing that catches
# a bad import path — typecheck does not)
cd mobile/apps/patient && npx expo export --platform web

# Admin
cd admin && npm run build
```

The test suite is mostly **regression tests for real exploits**: privilege
escalation, cross-patient data access, OTP brute force, token confusion, the
slot-booking race, and the self-registration role boundary. A failure means a
vulnerability came back, not that a test is flaky.

---

## 2. Start everything

Each app is pinned to its own port, so all three can run at once without the
"port 8081 is already in use" prompt.

| Service | URL |
| --- | --- |
| Backend API | http://localhost:5000 |
| Patient app | http://localhost:8081 |
| Doctor app | http://localhost:8082 |
| Partner app | http://localhost:8083 |
| Admin panel | http://localhost:5173 |

### Three terminals

```bash
# 1 — backend
npm run dev

# 2 — all three apps at once
cd mobile && npm run all

# 3 — admin panel
cd admin && npm run dev
```

`npm run all` starts the three Expo dev servers side by side with colour-coded,
prefixed output. Then press `w` in that terminal (or just open the URLs above)
for web, `a` for Android, `i` for iOS.

To go straight to browsers without the interactive menu:

```bash
cd mobile && npm run all:web
```

### One app at a time

Running three Metro bundlers is heavy. If your machine struggles, or you only
care about one app:

```bash
cd mobile
npm run patient      # or: npm run doctor / npm run partner
```

### Clearing a stale bundler cache

After editing anything in `packages/shared`, if a change doesn't show up:

```bash
cd mobile/apps/patient && npm run start:clear
```

**Web is the fastest way to click through screens.** Use a real device for
camera, location and push — web cannot do those.

> On Windows the dev servers bind to `localhost`, not `127.0.0.1`. If a health
> check fails, use `http://localhost:...`.

### Getting the API URL right

| Where you run the app | What it needs |
| --- | --- |
| Web / iOS simulator | works as-is (`localhost:5000`) |
| Android emulator | works as-is (`10.0.2.2` is handled) |
| **Physical device** | your machine's LAN IP |

For a physical device the app already tries the Expo host automatically. If it
can't reach the API, set it explicitly:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:5000/api/v1 npm run patient
```

Your machine and phone must be on the same Wi-Fi, and your firewall must allow
port 5000.

---

## 3. Signing in

Every app uses phone + 6-digit OTP. With `EXPOSE_DEV_OTP=true` the code is shown
on the OTP screen itself — you don't need SMS.

| Account | Number | Use in |
| --- | --- | --- |
| Admin | `+15559000001` | Admin panel |
| Doctor | `+15551000001` | Doctor app |
| Pharmacy | `+15552000001` | Partner app |
| Lab | `+15553000001` | Partner app |
| Patient | **any unused number**, e.g. `+15550001234` | Patient app |

Any number that isn't already provisioned becomes a `PATIENT` automatically.

---

## 4. The flows worth walking

### A. Provider onboarding — the important one

This is the security boundary, so test it end to end.

1. Open the **partner app**, sign in with a **fresh number**.
2. You land on "What do you run?" → pick **Pharmacy**.
3. Fill the form. Note the fields are pharmacy-specific (drug licence, expiry,
   pharmacist). Pick **Lab** instead and the form changes — different regulator,
   different fields.
4. **Save and continue**, then attach a drug licence (camera or file).
5. Try **Submit** without the licence attached → refused.
6. Submit properly → you land on the verification-pending screen.
7. Open the **admin panel** → *Verification* → the application is queued.
8. Click **Review** → the uploaded licence renders inline. Click it to enlarge.
9. Try **Reject** with no reason → refused.
10. **Approve**.
11. Back in the partner app, pull to refresh → the dashboard appears.

What to confirm: **the role did not exist until step 10.** Before approval the
account is still a `PATIENT`; the pharmacy queue returns 403.

### B. Doctor: availability → consult → prescribe

1. **Doctor app**, sign in as `+15551000001`.
2. *Schedule* tab → pick a day, set hours, choose a slot length → **Generate
   slots**.
3. **Patient app**, sign in as a patient → book one of those slots (choose
   **Video**).
4. Back in the doctor app → the booking appears under Today.
5. Open it → note the banner: **First consultation · Video**.
6. **Write prescription** → in the drug picker, a **List B** drug (Amoxicillin,
   Metformin, Aspirin) is greyed out with the reason "may only be prescribed in
   a follow-up consultation".
7. List O and List A drugs add fine. Issue the prescription.
8. Patient app → *Records* → the prescription is there, stamped with the
   doctor's council registration number.

To see List B unlock: book a **second** appointment with the same doctor. It is
flagged as a follow-up and List B becomes available.

### C. Pharmacy: stock and orders

1. **Partner app** as `+15552000001` → *Stock*.
2. **Add item** → search the catalogue. Try adding **Alprazolam** (Schedule X) →
   refused: cannot be sold online.
3. Add an OTC medicine, set your own price and stock.
4. **Patient app** → order that medicine.
5. Partner app → *Orders* → **Accept order** → advance it through packing →
   dispatched → delivered.
6. Patient app → *Orders* → the status tracks along.

Per-partner pricing: sign in as `+15552000002` (the second pharmacy) and set a
different price for the same medicine. Both are valid simultaneously.

### D. Lab: booking → sample → report

1. **Patient app** → *Labs* → book a test.
2. **Partner app** as `+15553000001` → *Bookings* → **Accept**.
3. Advance to **Sample collected** → **Start processing**.
4. Upload a report (any PDF or photo) → **Publish report**.
5. Patient app → the report is available.

Then check the access control: the report is served only to that patient, the
lab that produced it, a treating doctor, or an admin. It is **not** a public URL.

### E. Paying for a prescription basket

Everything below works with **no gateway account**: `PAYMENT_PROVIDER=mock`
simulates a real gateway, signatures and all.

1. Follow flow **B** so a doctor issues a prescription — add a **lab test** to it
   as well as medicines.
2. **Patient app** → the "prescription is ready to order" notification → it opens
   the consent screen with a priced basket.
3. Untick anything you already have. The total updates live.
4. Choose **UPI** → **Pay ₹… and order**.
5. Before the payment clears, look at the **partner app** → the order is **not
   there**. That is the point: a shop must never pick and pack an order nobody
   has paid for.
6. The mock gateway settles immediately, then the order appears in the pharmacy
   queue and the booking in the lab queue.

Now try **cash on delivery**: repeat with **COD** selected. The order goes
straight to the pharmacy queue, tagged *Collect ₹… on delivery*. Marking it
delivered settles the cash in the same step.

Then try a **refund**: as the pharmacy, cancel a prepaid order. The patient's
payment flips to `REFUNDED` and they are notified.

Partner earnings: *Profile → Earnings* in the partner or doctor app shows each
settlement leg, **net of commission**.

### F. Video consultation

Out of the box `VIDEO_PROVIDER=mock`, so *Join* shows the call shell and says
plainly that no transport is configured — it does not pretend to be connected.

For a real call, free, in a few minutes:

```bash
# Option 1 — Jitsi. No account, but meet.jit.si makes the FIRST participant
# sign in with Google/GitHub/Facebook. Point at your own host to avoid that.
VIDEO_PROVIDER=jitsi

# Option 2 — Daily. Free key, ~10,000 participant-minutes a month, and rooms
# are created private so the URL alone will not get anyone in.
VIDEO_PROVIDER=daily
DAILY_API_KEY=...
DAILY_SUBDOMAIN=your-subdomain
```

Then: doctor app → the appointment → **Start video consultation**. The room
opens in your browser, which is why this works in Expo Go — no native build
needed. The patient taps *Join now* and lands in the same room.

Worth checking:

- Joining more than `VIDEO_JOIN_LEAD_MINUTES` early is refused, with the time it
  opens
- A patient who is not on the appointment gets a 404, not a 403
- The room id is 128 bits of randomness, never the appointment id — on every
  hosted video service a room name is a bearer credential

### G. Admin panel

- *Overview* — live counts, pending queue, licences expiring within 60 days
- *Users* — suspend a partner and watch their shop deactivate
- *Emergency* — trigger an SOS from the patient app and watch it appear
- *Audit* — every approval, suspension and document read is recorded

---

## 5. Expo Go vs a development build

**Expo Go is fine for almost everything** — every screen, the whole onboarding
and verification flow, orders, prescriptions, document upload.

The one thing it cannot do is **remote push notifications**. Expo removed them
from Expo Go on Android in SDK 53. The apps detect Expo Go and skip push
registration rather than erroring, and the Notifications screen says so — the
in-app feed is the durable record and keeps working.

To test push for real you need a development build:

```bash
cd mobile/apps/partner
npx expo run:android          # local build; needs Android Studio + a JDK
```

or via EAS, without local Android tooling:

```bash
npm install -g eas-cli
eas login
eas build --profile development --platform android
```

Then start the dev server as usual and open the build instead of Expo Go.

> **If you already have an `android/` folder**, it was generated by
> `expo run:android` and is build output, not source — it's gitignored.
> JS changes reach it immediately, but **native config changes (splash, icons,
> plugins, permissions) do not**. After any `app.json` change, re-sync it:
>
> ```bash
> cd mobile/apps/partner
> npx expo prebuild --platform android --clean
> npx expo run:android
> ```
>
> `expo-doctor` will report "app config fields that may not be synced" while
> that folder exists. That is expected for a prebuilt project, not a defect.

### Also unavailable on web

- **Camera** for document upload — falls back to the file picker
- **Location** for emergency SOS

---

## 6. When something breaks

| Symptom | Cause |
| --- | --- |
| "Cannot reach the server at …" | Backend not running, or wrong `EXPO_PUBLIC_API_URL` for a physical device |
| Stale screens after editing shared code | `npx expo start --clear` |
| "No available slot — run `npm run seed`" during tests | Slots consumed by earlier runs; re-seed |
| 429 on login | OTP rate limit — 5 per number per 15 min. Use a different number |
| Blank square where an icon should be | Icon name has no glyph. Add an alias in `mobile/packages/shared/src/ui/Icon.tsx` |
| Dependency version warnings | `npx expo install --check`, then `--fix`. Update all three apps together |

---

## 7. Resetting

```bash
npm run seed        # idempotent — safe to re-run any time
```

The test suite namespaces its own fixtures and cleans up after itself, so
`npm test` does not pollute your data.
