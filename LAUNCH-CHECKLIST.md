# Launch checklist

Everything still standing between this repo and a real patient, in the order it
should be done, with who has to do it.

The engineering is finished and tested. What remains is procurement, legal and
deployment — none of it hard, but some of it has weeks of lead time, and the
order matters more than the effort. This exists because the same items were
scattered across four documents, which is how a launch slips on the one thing
nobody realised had to start in week one.

**Legend:** ⏳ has lead time — start it now, it blocks nothing else while it
runs. 🔒 blocks launch. 💡 do it before real traffic but it will not stop you.

---

## Week 1 — start the slow things immediately

These have external turnaround. Nothing else depends on them, so starting them
late is the only way they become the critical path.

- [ ] ⏳🔒 **Brief a lawyer.** Ask for a review of [DATA-POLICY.md](DATA-POLICY.md)
      and the customer-facing privacy notice against the DPDP Act 2023 and the
      Telemedicine Practice Guidelines. Two specific questions worth putting in
      the brief: whether the retention floors in §2 are right, and whether the
      consent purposes in §6 are separable enough. *Typically 2–4 weeks.*

- [ ] ⏳🔒 **Apply for Razorpay Route.** Not plain Razorpay — Route is what
      splits a payment between the platform and the pharmacy or lab. Onboarding
      involves KYC and takes longer than a normal account. *Typically 1–3 weeks.*

- [ ] ⏳ **Open a Twilio account** and buy an Indian sending number. DLT
      registration for transactional SMS in India is its own queue. *Days to
      weeks.*

- [ ] 🔒 **Name two people.** They go in
      [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) §0 — there are 14 blanks in
      that file and none of them can be filled by an engineer:
      - a **Data Protection Officer** with a published contact route, which the
        DPDP Act requires
      - an **incident lead** with standing authority to take the platform
        offline without asking anyone

---

## Week 2 — wire up what has arrived

Each of these is minutes of work once the account exists. `npm run preflight`
verifies every one.

- [ ] 🔒 **SMS.** `SMS_PROVIDER=twilio` plus the SID, auth token and number.
      **Nobody can sign in without this** — it is the single hardest blocker,
      because OTP is the only way into all five apps.
- [ ] 🔒 **Payments.** `PAYMENT_PROVIDER=razorpay`, key, secret, and
      `RAZORPAY_WEBHOOK_SECRET`. Register the webhook URL in the dashboard.
- [ ] 🔒 **`PUBLIC_BASE_URL`** to the real https origin. It is printed on every
      prescription as the address a pharmacist visits to verify it; the app
      refuses to boot in production if this is still localhost.
- [ ] 🔒 **Redis.** Production refuses to serve on the in-memory fallback.
- [ ] 💡 **Sentry.** `SENTRY_DSN`. Ten minutes, and without it you find out
      about failures from patients.
- [ ] 💡 **Video.** `meet.jit.si` is fine for a demo and not for clinical calls
      at volume — it requires the first participant to sign in with Google or
      GitHub. Use a Daily key or host your own Jitsi.
- [x] ~~**Object storage.**~~ Already live — R2 is configured and round-trips
      correctly. Confirm the bucket is still private with `npm run storage:check`.

Then:

```bash
npm run preflight     # must exit 0 with no ✗ rows
```

---

## Week 2 — deployment plumbing

- [ ] 🔒 **Install the schedulers.** Configs are written for cron, systemd and
      Kubernetes in [deploy/README.md](deploy/README.md). The retention sweep is
      the one that matters — without it the real retention period for everything
      is "forever", and DATA-POLICY.md becomes a claim that would not survive
      being checked.
- [ ] 🔒 **Set `TZ=Asia/Kolkata`** on the server. Slot times are stored as local
      `HH:mm`, so a host on UTC opens a 10:00 consultation at the wrong hour.
- [ ] 🔒 **Run the migrations**: `npm run prisma:deploy`. If the database
      already has these tables, mark the baseline applied first — see
      [prisma/migrations/README.md](prisma/migrations/README.md).
- [ ] 🔒 **Prove the backup restores.** Take a real nightly dump, then
      `npm run restore:drill -- --dump <file>`. It compares row counts across 14
      critical tables. An untested backup is a hope.
- [ ] 💡 **Re-run the load test against staging** with Redis attached — see
      [PERFORMANCE.md](PERFORMANCE.md). Compare the *shape*, not the absolute
      numbers; the recorded run was on a laptop over loopback.

---

## Before the first real patient

- [ ] 🔒 **Put ₹1 through checkout end to end** on the live gateway. The whole
      payment path is built and tested against the mock provider, and has never
      settled a real rupee.
- [ ] 🔒 **Onboard each partner as a linked account.** Until a pharmacy or lab
      has a `payoutAccountId`, their share is recorded as owed but stays in the
      platform's balance rather than being split out.
- [ ] 🔒 **Sign data-processing agreements** with every processor you actually
      ended up using: SMS, payments, object storage, push notifications, error
      tracking.
- [ ] 💡 **Send one real OTP** to a real handset. Preflight checks the
      credentials exist, not that a message arrives.
- [ ] 💡 **Rotate every secret** so nothing that ever sat in a shared channel or
      a git history is live. `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
      derive the OTP, document-link and mock-payment keys, so rotating those two
      rotates all of it — see `utils/secrets.ts`.

---

## What is already done

Not a to-do list — a list of things not to redo, because each was verified
rather than assumed:

- Sessions are revocable. Suspending, signing out or changing a role ends every
  token on the account immediately, on every device.
- Erasure destroys the identity and keeps the medical record, and refuses while
  work is in flight or for provider accounts.
- Consent is per purpose, versioned and append-only, with a screen in the
  patient app that actually asks for it.
- Retention is enforced by a job, and anything under a statutory floor is
  reported rather than deleted.
- 266 tests, all passing. CI runs them against a real Postgres and Redis.
- The restore drill has been run and passes.
- Backend and admin production dependencies carry zero advisories.

---

## The honest summary

Roughly a week of someone's working time, spread across three to four weeks of
waiting on other people. The long poles are the lawyer and Razorpay Route —
start both on day one and the rest fits around them.

Nothing on this list requires an engineer except the deployment plumbing, and
that is a few hours.
