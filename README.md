# Health Buddy

Telehealth marketplace: an Express + Prisma + PostgreSQL backend behind four
client surfaces — three React Native apps and a web admin panel.

```
src/                Express API (routes → controllers → services)
prisma/             Schema + seed
tests/              Regression tests (node:test via tsx)
mobile/             Expo monorepo (npm workspaces)
  packages/shared/    @healthbuddy/shared — tokens, UI, API client, auth
  apps/patient/       Health Buddy            — book, order, track
  apps/doctor/        Health Buddy Doctor     — consult, prescribe, availability
  apps/partner/       Health Buddy Partner    — pharmacy + lab, in one binary
admin/              Vite + React admin panel — verification, users, audit
public/             Static web portal
```

**Why four surfaces rather than one role-switching app:** each has different
store listings, permission prompts, review scrutiny and release cadence. A
pharmacy account should never carry the patient app's location permission, and a
doctor's clinical workflow is not a variation on a consumer booking flow. The
admin panel is web because document review and dense tables do not fit a phone.

> **Going live?** [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) is the ordered list
> of what remains — legal, accounts and deployment — with the two long-lead
> items flagged so they do not become the critical path.

## Getting started

```bash
# Backend
npm install
cp .env.example .env          # then fill in the required values
npm run prisma:migrate        # apply migrations (use prisma:deploy in production)
npm run seed                  # catalogue + demo provider accounts
npm run dev                   # http://localhost:5000
```

```bash
# Mobile apps (one install covers all three)
cd mobile && npm install
npm run all                   # all three, or: npm run patient / doctor / partner
```

```bash
# Admin panel
cd admin && npm install && npm run dev
```

## Going live

```bash
npm run preflight        # every external dependency, actually exercised
npm run restore:drill    # prove a backup restores
npm run loadtest         # find what gives way first
npm run retention        # what the retention policy would remove (dry run)
```

The go/no-go list is [ARCHITECTURE.md §12](ARCHITECTURE.md#12-production-cutover).
Nothing in the codebase blocks launch; the remaining items are a legal review,
two named people, and three service accounts.

| Service | URL |
| --- | --- |
| Backend API | http://localhost:5000 |
| Patient app | http://localhost:8081 |
| Doctor app | http://localhost:8082 |
| Partner app | http://localhost:8083 |
| Admin panel | http://localhost:5173 |

See **[TESTING.md](TESTING.md)** for demo logins and the flows worth walking.

### Required configuration

Boot **fails loudly** on invalid configuration rather than starting insecurely.

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Min 32 chars, no defaults. `openssl rand -hex 32` |
| `REDIS_*` | OTP storage, rate limits |
| `EXPOSE_DEV_OTP` | Returns the OTP in the response. Rejected when `NODE_ENV=production` |
| `SMS_PROVIDER` | `mock` is rejected in production |
| `CORS_ORIGINS` | Explicit allowlist; required in production |
| `STORAGE_DRIVER` | `local` for development; rejected in production — uploads must be durable |
| `MAX_UPLOAD_MB` | Per-file cap (default 10) |

The mobile apps resolve their API URL from `EXPO_PUBLIC_API_URL`, falling back
to the Expo host (so physical devices reach your dev machine), then to platform
loopback defaults. The admin panel proxies `/api` to the backend in development.

## Authentication and roles

Phone number + 6-digit OTP, identical across all four surfaces.

**A role is a grant, never a claim.** A caller who has never been provisioned is
registered as a `PATIENT`. To become a provider, a user submits a
`ProviderApplication` describing what they want to be — an admin reviews the
uploaded licence documents and approves, and *approval* is what creates the
`Doctor` / `Pharmacy` / `LabPartner` row and changes `User.role`.

Nothing in a request body decides a role. `ProviderApplication.type` selects a
registration form and a post-approval dashboard; it is never consulted for
authorisation.

Seeded demo logins (OTP is returned in the response when `EXPOSE_DEV_OTP=true`):

| Role | Number |
| --- | --- |
| Admin | `+15559000001` |
| Doctor | `+15551000001` |
| Pharmacy | `+15552000001` / `+15552000002` |
| Lab partner | `+15553000001` / `+15553000002` |

## Regulatory controls in the code

These are enforced in the backend, not left to the UI:

- **Telemedicine drug lists.** `Medicine.teleList` (List O / A / B / Prohibited)
  plus the appointment's mode and follow-up status decide what a doctor may
  prescribe. The doctor app greys out refused drugs *and* the server re-checks
  on submit — see `prescribingRefusal` in `src/services/prescriptionService.ts`.
- **Schedule X and narcotics** cannot be stocked or prescribed at all.
- **Prescription-only medicine** cannot be dispatched without a prescription on
  the order.
- **Licence expiry** suspends a pharmacy automatically; the admin panel warns
  60 days ahead.
- **Doctor registration number** is stamped onto each prescription at issue
  time, as the guidelines require, rather than joined from the profile later.
- **Audit log** records role grants, application decisions, prescription
  issuance and every read of a patient document.

## Testing

```bash
npm test
```

`tests/testEnv.mjs` pins `NODE_ENV=test` before any app module loads — without
it the suite runs as `development` and the per-IP OTP limiter fails unrelated
tests once the whole suite shares one source IP.

Runs against a live database, namespacing fixtures per run and cleaning up
afterwards. The suite is primarily **regression tests for previously exploitable
defects** — privilege escalation, cross-patient data access, OTP brute force,
token confusion, the slot-booking race, and the self-registration role boundary.
If one fails, a real vulnerability has been reintroduced.

## Security notes

- OTPs are generated with `crypto.randomInt`, stored HMAC-hashed, compared in
  constant time, capped per phone and per IP, and single-use.
- Access and refresh tokens are typed (`typ`), so a refresh token cannot
  authenticate a request. Refresh re-reads the role from the database, which is
  how a newly approved provider picks up their role.
- Provider queues and report upload are role-gated; per-record endpoints check
  ownership and return 404 rather than 403 so ids cannot be probed.
- **Uploaded files are private.** Documents are addressed by opaque storage key,
  never a public URL. Reads pass an authorisation check — the patient, the
  fulfilling lab, a treating doctor, or an admin — and are served either through
  an authenticated stream or a short-lived signed link. A public bucket would
  mean anyone holding the link reads a patient's results with no login.
- Slot booking, order acceptance and lab-booking acceptance are all atomic
  conditional `UPDATE`s, so concurrent partners cannot both win the same job.
- Every request body, query and route param is validated with zod.

> The secrets previously committed in `.env.example` are treated as compromised
> and rejected at boot. Rotate the Neon and Upstash credentials in `.env` if
> this repository was ever shared.

## Not built yet

- **Payments.** In India, collecting from patients and settling to providers
  makes you a payment aggregator, which needs RBI authorisation. The intended
  path is a licensed aggregator's split-settlement product so funds never touch
  the platform. `Payment` models that flow but nothing writes to it yet.
- **Video consultation transport.** The doctor app shows the room id and offers
  a phone fallback rather than a Join button that does nothing.
- **ABDM registry checks.** `hprId` / `hfrId` are captured and shown to the
  reviewer; the automated lookup against HPR/HFR is not wired up.
