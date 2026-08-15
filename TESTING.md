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

**1. Create the bucket.** Cloudflare dashboard → **R2** → *Create bucket*. Name
it something like `healthbuddy-documents` and pick a location near your users
(APAC for India). Leave the public `r2.dev` URL **off** — more on that below.

**2. Create an API token.** R2 → *Manage API Tokens* → *Create API token*:

| Field | Value |
| --- | --- |
| Permissions | **Object Read & Write** |
| Specify bucket | your bucket only, not "all buckets" |
| TTL | leave as forever, or rotate on a schedule |

It shows an **Access Key ID** and a **Secret Access Key** once. Copy both now.

**3. Find your account id.** It is in the R2 overview page, and in the endpoint
Cloudflare shows you: `https://<account-id>.r2.cloudflarestorage.com`.

**4. Put it in `.env`.**

```
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=<the account id from step 3>
S3_BUCKET=<your bucket name>
S3_ACCESS_KEY_ID=<Access Key ID from step 2>
S3_SECRET_ACCESS_KEY=<Secret Access Key from step 2>
```

Leave `S3_REGION` and `S3_ENDPOINT` blank — both are derived from the account
id. The app refuses to boot if any of the five is missing, rather than starting
up and losing files later.

**5. Prove it works.**

```bash
npm run storage:check
```

It writes an object, reads it back byte for byte, checks the traversal guards,
confirms the bucket is not publicly readable, then deletes it. Run this before
a real licence document depends on it — a driver that can write but not read is
worse than one that fails outright, because the failure only surfaces when
someone asks for their lab report.

**6. Restart the backend** and upload a lab report as the lab partner, then open
it as the patient. The object appears in your bucket; the patient never sees a
bucket URL.

#### Keep the bucket private

Do **not** enable the `r2.dev` public URL, and do not attach a custom domain to
this bucket. `npm run storage:check` fails loudly if it finds one.

Reads go through the API: `documentService` authorises the caller, then streams
the bytes. Nothing hands out a bucket URL. A public bucket would make every
stored lab report and drug licence readable by anyone who obtains or guesses
the link — with no login, forever, including after the patient deletes their
account.

R2 charges nothing for egress, so streaming through the API costs no more than
a public URL would.

#### Migrating what is already in `./uploads`

Files written by the local driver are not copied automatically. In development
the simplest path is to re-upload the few documents you care about. If you have
real data, upload the directory with `rclone` or the Cloudflare dashboard,
preserving the exact key paths (`<userId>/<uuid><ext>`) — `Document.storageKey`
in the database points at them.

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

### On an Android emulator

You need the Android SDK (Android Studio, or the command-line tools) and one
virtual device. Check what you already have:

```bash
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -list-avds
```

Nothing listed? Create a device in Android Studio → *Device Manager*. Any recent
Pixel image works.

Then, in three terminals:

```bash
npm run dev                                          # 1 — backend

"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd <YOUR_AVD>   # 2 — emulator

cd mobile/apps/patient && npm run android            # 3 — the app
```

Start the emulator **before** the app. `npm run android` looks for a running
device, installs Expo Go into it if it isn't there, and opens the project — the
first run downloads Expo Go, so give it a minute.

Once it's up, in the Expo terminal: `r` reloads, `j` opens the debugger, `m`
toggles the dev menu. Shake gestures are `Ctrl+M` on the emulator.

### Getting the API URL right

| Where you run the app | What it needs |
| --- | --- |
| Web / iOS simulator | works as-is (`localhost:5000`) |
| Android emulator | works as-is (`10.0.2.2` is detected and used) |
| **Physical device** | your machine's LAN IP |

> **Why the emulator is a special case.** Expo serves the bundle from your LAN
> address, and the app normally reuses that host for the API — which is right
> for a physical phone. An emulator, though, sits behind its own NAT: traffic
> aimed at your LAN address leaves that NAT and arrives back at Windows as
> *external* traffic, which the firewall drops. So the app detects an emulator
> and uses `10.0.2.2` (the emulator's alias for your machine) regardless of the
> bundle host. If you see "cannot reach the server at `http://192.168.x.x:5000`"
> on an emulator, that detection failed — force it:
>
> ```bash
> EXPO_PUBLIC_API_URL=http://10.0.2.2:5000/api/v1 npm run android
> ```

For a physical device the app already tries the Expo host automatically. If it
can't reach the API, set it explicitly:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:5000/api/v1 npm run patient
```

Your machine and phone must be on the same Wi-Fi, and your firewall must allow
port 5000. On Windows that means allowing `node.exe` on private networks — the
prompt appears the first time, and if you dismissed it once, no later request
gets through until you add the rule by hand.

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

### The three seeded pharmacies

Which shop serves which pincode is what makes the store open or stay shut, and
the overlap on `400058` is what makes an order split into two parcels.

| Pharmacy | Login | Delivers to | Stocks |
| --- | --- | --- | --- |
| Health Buddy Central | `+15552000001` | 400058, 400053, 400061, 400076 | everything |
| CarePlus Chemists | `+15552000002` | 110009, 110007, 110033 | everything |
| QuickMeds Andheri | `+15552000003` | 400058, 400053 | fast-moving OTC only, cheapest |

Doctors are spread across cities to match their council registrations, so an
**in-person** search from `400058` finds Mumbai clinics only — while a **video**
search still lists all six. Dr Priya Sharma's clinic is in Delhi, so she appears
for video from anywhere but not for an in-person visit in Mumbai.

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

### B2. The visit is the spine

Records is organised around the consultation, not the table each artefact lives
in. Everything a visit produced hangs off it.

1. **Patient app** → *Records* → *Visits*. Each card names the doctor, the day
   and time, and — for a video visit not yet held — a **Join** button.
2. The join button is **time-gated by the server**, not the device: it reads
   *"Opens in 8 h"* until `VIDEO_JOIN_LEAD_MINUTES` before the slot. A phone
   with a wrong clock cannot talk its way in early.
3. Open the completed visit. It reads top to bottom as the episode happened:
   what you reported → diagnosis → medicines with dosage and duration → tests
   advised → advice → who issued it and under which registration number.
4. Medicines ordered and tests booked from that prescription appear under the
   same visit, each with its own status.

There is deliberately **no Prescriptions tab**. Every prescription belongs to
exactly one appointment, so a separate list would show the same things twice
under two names. Reports keep their own tab because a patient can book a test
without ever seeing a doctor.

### B3. A prescription you can print and check

1. On a completed visit → **Print or save as PDF**. A page opens carrying the
   diagnosis, every drug with dosage and duration, the tests advised, the
   advice, the issuing doctor and their council registration number.
2. At the bottom is an 8-character code and a verification address.
3. Open `/api/v1/prescriptions/verify/<CODE>` in a browser — **no login**.

What to confirm: the check answers *who* issued it and *when*, and **nothing
clinical**. No diagnosis, no drug names, no patient name. The code travels on a
piece of paper that anyone might pick up, so it must not be a key to a medical
record.

> **The doctor owns the letterhead; the platform owns the body.** Clinic name,
> address, phone, logo and signature come from the doctor's profile. The
> mandatory fields cannot be moved or removed — full customisation would let a
> prescription be styled into something that is no longer one.

Two things to try that should fail:

- Print another patient's prescription → **404**, not 403
- Verify a made-up code → `200 {"valid": false}`, not a 404 that confirms which
  codes exist

### C. Pharmacy: stock and orders

1. **Partner app** as `+15552000001` → *Stock*.
2. **Add item** → search the catalogue. Try adding **Alprazolam** (Schedule X) →
   refused: cannot be sold online.
3. Add an OTC medicine, set your price, opening stock, batch and expiry. Pricing
   above the printed MRP is refused.
4. **Patient app** → order that medicine.
5. Partner app → *Orders* → **Accept order** → advance it through packing →
   dispatched → delivered.
6. Patient app → *Orders* → the status tracks along.

Per-partner pricing: sign in as `+15552000002` (the second pharmacy) and set a
different price for the same medicine. Both are valid simultaneously.

### C1. Where you are decides what you see

The patient app asks for a delivery address before it will sell anything, and
the pincode on that address drives the catalogue, the prices and the arrival
times.

1. **Patient app** → the location chip under the brand bar → **Add an address**.
2. Try **Use my current location** — on an emulator this returns whatever
   position the AVD is set to, so also try typing a pincode.
3. Enter `560001` (Bengaluru). As soon as the sixth digit lands the field turns
   red: *"We don't deliver here yet."* Save it anyway — it is still a valid
   address for consultations.
4. Now enter `400058` (Mumbai) → *"Delivering in Mumbai · express available"*.
5. Open the store on the Bengaluru address → the store does not open at all.
   Switch to Mumbai → the catalogue appears.

What to confirm: **the prices are not the catalogue MRP.** Cetirizine lists at
₹28.00 struck against ₹32.00, because QuickMeds Andheri undercuts the reference
price. That is the price you will actually be charged.

### C1b. One order, several parcels

The seed puts two Mumbai pharmacies on `400058` and gives them different
shelves, so a mixed basket has to be filled by both.

1. Store at `400058` → add **Cetirizine 10mg** (⚡ under 30 min) and
   **Amoxicillin 250mg** (🚚 2 days).
2. The bar above the tab bar reads **2 items · ₹140.00 · 2 parcels**.
3. Open the cart → an amber note: *"This order will arrive in 2 separate
   parcels, from 2 pharmacies."*
4. **Place Order** → tracking shows **Parcel 1 of 2** (QuickMeds, Express) and
   **Parcel 2 of 2** (Central, Standard), each with its own timeline.
5. **Partner app** as `+15552000003` (QuickMeds) → it sees *only* the Cetirizine
   parcel. Sign in as `+15552000001` → only the Amoxicillin one.
6. Advance one parcel to dispatched. The other stays where it is, and the
   order's own status stays at the slower of the two.

> **Why this matters beyond the UI.** Each line was already reserved against a
> specific shop's shelf, but the whole order used to be assigned to whichever
> pharmacy supplied the most lines — so a partner saw items it had never
> stocked, and at settlement that one pharmacy was credited for the other's
> goods. Check it in the admin panel: *Payments* → the order now has **one
> settlement leg per pharmacy**, and they still sum to exactly what was charged.

Two things to try that should fail:

- Order to the `560001` address → **400**, *"We don't deliver to 560001 yet."*
- In the store, try to add more of something than the local shop has — the
  stepper stops at the shop's sellable count, not the catalogue's.

### C2. The stock ledger

**Stock is never a number you type over.** Tap any medicine in *Stock* and the
modal opens with four tabs.

**Record** — pick what happened, then type the quantity as a number. Forty
expired strips is one entry, not forty taps on a minus button.

| Reason | Direction |
| --- | --- |
| Stock received | adds |
| Customer return | adds |
| Sold at the counter | removes |
| Expired | removes |
| Damaged | removes |

The reason decides the direction, so "expired: 25" can never be entered as +25
and invent stock that was never on the shelf.

**Recount** — enter what you physically counted. The *difference* is recorded,
not an overwrite, so a shortfall of 12 stays visible instead of being erased.

**History** — every movement with its reason and the balance it left behind.
This is the point of the whole thing: "we are 40 short" now has an answer.

Worth checking:

- Three numbers at the top: **on the shelf**, **reserved**, **sellable**
- Place an order as a patient → the shop's *reserved* goes up but *on the shelf*
  does not. The boxes are still there; they are just promised to someone
- With units reserved, try to recount to zero → refused. You cannot make the
  numbers work by cancelling someone's paid order
- Mark the order dispatched → reserved drops and stock drops together, logged as
  a sale
- Cancel it instead → the reservation is released and the units are sellable again
- **Expiring** filter shows anything within 90 days. Expired stock is never
  offered to a patient, regardless of what the count says

### C3. Lab pricing is uniform per area

Sign in to the **partner app** as a lab (`+15553000001`, Mumbai) → *Tests*.

There is **no price field**. A lab chooses which tests it can run and how fast
it turns them around; the price is set per area by the platform. That is
deliberate — a patient cannot judge sample handling the way they can judge a
restaurant, so free price competition on an invisible quality selects for the
cheapest handling rather than the best.

Check it:

1. Patient app → *Labs* → open a test → both Mumbai labs quote the **same**
   price
2. Sign in as `+15553000002` (Delhi) → the same test, a **different** price,
   because Delhi is a different band
3. Admin panel → **Lab pricing** → add a band for your own city. Most specific
   wins: city → state → national → catalogue reference
4. A city band without a state is refused — there is more than one Hyderabad

Admin panel → **Stock ledger** shows write-offs across every pharmacy, which is
where shrinkage would otherwise hide.

### D. Lab: booking → sample → report

1. **Patient app** → *Labs* → book a test.
2. **Partner app** as `+15553000001` → *Bookings* → **Accept**.
3. Advance to **Sample collected** → **Start processing**.
4. Upload a report (any PDF or photo) → **Publish report**.
5. Patient app → the report is available.

Then check the access control: the report is served only to that patient, the
lab that produced it, a treating doctor, or an admin. It is **not** a public URL.

### D2. Not every test ends in a PDF

A lab package declares what it actually owes at the end, and whether a
phlebotomist can come to the patient at all.

| Test | Delivers | Collected at home? |
| --- | --- | --- |
| Complete Blood Count | `DIGITAL_REPORT` — a PDF | yes |
| CT Scan — Abdomen | `DIGITAL_IMAGING` — report **plus** an image study | no |
| Chest X-Ray | `PHYSICAL` — a film that has to travel | no |

1. **Patient app** → *Labs*. The cards say which is which: *Home collection* or
   *Visit the lab*, plus *Film delivered* / *Report + images* where relevant.
2. Book the CBC → it asks for an address if you have not set one, then confirms
   collection from that address.
3. Book the Chest X-Ray → it books as a lab visit and says so, without asking
   for an address.

Two things to try that should fail:

- Book an X-ray with `homeCollection: true` → **400**, *"has to be done at the
  lab"*
- Book a CBC with `homeCollection: true` and no address → **400**, *"A
  collection address is required"*

> **Why the delivery mode is copied onto the order.** Re-classifying a test in
> the catalogue tomorrow must not rewrite what an order placed today promised
> the patient. Same reason the price is copied, and the same reason a medicine
> order snapshots its address rather than pointing at the address book.

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

Sign in at http://localhost:5173 as `+15559000001`. The sidebar is grouped by
what you are doing rather than by which table a page reads.

**Overview**

- *Dashboard* — the top block is only what needs a person: open emergencies,
  unreviewed applications, unprocessed webhooks, licences and stock about to
  lapse. It is empty when nothing is wrong, and every tile navigates to the
  filtered list behind it. Money and population counts sit below it.
- *Verification queue* — approve or reject a provider application.
- *Emergency* — trigger an SOS from the patient app and watch it appear.

**People** — each row opens a drawer beside the list, so you keep your filter
and your place in the queue.

- *Patients* — search by **phone number**, which is all a caller can give you.
  The drawer tabs through consults, orders, lab tests and payments. It shows no
  diagnosis, prescription or result, and the endpoint behind it does not read
  them.
- *Doctors* — take one offline, change the fee or commission, link a payout
  account, mark verified. Qualification, specialty and council number are
  **not** editable: they came from reviewed documents.
- *Pharmacies* — licence number and expiry (with days remaining), delivery
  radius, commission, payout account. The *Stock* tab is read-only — stock only
  moves through the ledger. The *write-offs* summary breaks out expiry, damage,
  recounts and offline sales.
- *Labs* — accreditation, home collection, terms, and the tests they offer.
  Suspend an offering when a machine is down. Price is **not** here: one price
  per test per area lives under *Lab pricing*.

**Operations**

- *Consultations* — who saw whom, whether it started, whether it was paid for
  and whether a prescription came out. A video room shows as "Room created"
  and never prints its id, because a room name is a bearer credential.
- *Medicine orders* — filter by status, or by "nobody carrying it". Opening one
  shows items, payment with its settlement legs, and the stock movements it
  caused. **Cancelling refunds the customer, releases the reservation and
  notifies them** — the same path a pharmacy's own cancellation takes, and it
  requires a reason.
- *Lab bookings* — the column worth watching is *Report*: a booking marked
  COMPLETED with no document attached shows red.
- *Deliveries* — the dispatch board. Four lanes with age-in-stage, and anything
  unaccepted for over half an hour turns red. Click a job to hand it to an
  account. See the note below about riders.

**Money**

- *Payments* — every charge, filterable by status, purpose and method. The
  detail view leads with **reconciliation**: the settlement legs must add up to
  exactly what the payer was charged. Splits are computed in whole paise with
  the platform absorbing the remainder, so a difference is a defect, not
  rounding, and it renders as a red banner.
- *Gateway webhooks* — defaults to showing only unprocessed or errored events.
  An unprocessed row means money moved at the gateway and did not move here.

**Catalogue**

- *Medicines & tests* — adding or reclassifying a drug is audited **with its
  previous schedule and telemedicine list**, because "who reclassified this as
  OTC" is a question that will eventually be asked by someone who is not an
  engineer. Selecting a non-OTC schedule forces "requires prescription" on;
  Schedule X and narcotics show a blocking warning.
- *Lab pricing* — one price per test per area, resolved most-specific-first.
- *Stock ledger* — write-offs across every pharmacy.

**Governance**

- *Audit log* — every approval, suspension, cancellation, reclassification and
  document read, with the actor and their reason.

> **On riders.** There is no rider account type on the platform. Orders carry an
> `assignedAgentUserId`, which is what the partner apps already write to, so the
> *Deliveries* board tracks delivery **work** and derives its roster from who is
> actually carrying orders. A real rider role is a product, not a screen — a
> registration and verification flow, a rider app with live location, cash-on-
> delivery reconciliation, and shift and payout rules. Building the roster UI
> first would give you an empty list that looks broken and buttons that write to
> nothing.

**Two things to try that should fail:**

1. Sign in to the panel as a patient or a partner — you get the login screen,
   and every endpoint refuses the token with a 403 independently.
2. Save a doctor's form without changing anything — rejected, because an empty
   patch usually means the form serialised nothing and you think you saved.

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
