# Personal data breach — response runbook

**This document has blanks in it. Fill them in before launch.** A runbook that
names no one is not a runbook; the point of writing it now is that the decisions
get made calmly rather than at 2am by whoever happens to be awake.

> Drafted by engineering from what the system can actually do. The notification
> obligations below are the DPDP Act's as understood at the time of writing —
> **have a lawyer confirm the wording and the timelines before relying on them.**

---

## 0. Fill these in

| Role | Who | Contact |
| --- | --- | --- |
| Incident lead — runs the response, makes the call | ☐ | ☐ |
| Data Protection Officer — required by the DPDP Act | ☐ | ☐ |
| Engineering on-call | ☐ | ☐ |
| Legal counsel | ☐ | ☐ |
| Named contact at the payment aggregator | ☐ | ☐ |
| Named contact at the SMS provider | ☐ | ☐ |
| Named contact at the object-storage provider | ☐ | ☐ |

Also decide in advance, because deciding under pressure goes badly:

- ☐ Who may take the platform offline, without asking anyone else
- ☐ Where incident notes are kept (not in a channel that logs to a third party)
- ☐ Whether a holding statement is pre-approved, and by whom

---

## 1. What counts

A personal data breach is any unauthorised access to, disclosure of, or loss of
personal data. On this platform that includes:

- A leaked or stolen **admin session** — an admin can read every patient record
- A leaked **database credential**, dump, or backup
- The **object storage bucket** becoming publicly readable, which exposes lab
  reports and licence documents
- A **provider account** used to reach patients outside their own queue
- Loss of data with no restorable backup
- A dependency compromise that could have exfiltrated any of the above

It is a breach whether or not anyone can prove data was taken. "We could not
confirm access" is not "no access occurred", and the obligation attaches to the
former.

---

## 2. First hour

**Contain first. Investigate second.** The instinct to understand before acting
is what turns a contained incident into a long one.

### Stop the access

| Situation | Do this | Effect |
| --- | --- | --- |
| A compromised account | Suspend it in the admin panel | Raises `tokenVersion` — every session on that account dies immediately, on every device |
| Many accounts, or unsure which | Suspend the known ones, then rotate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` and redeploy | Invalidates **every** token platform-wide. Everyone is signed out. Also rotates the derived OTP, document-link and mock-payment keys — see `utils/secrets.ts` |
| A leaked database credential | Rotate it at the provider, redeploy | — |
| A public storage bucket | Make it private, then rotate the S3/R2 API token | `npm run storage:check` confirms it is no longer public |
| A leaked webhook secret | Rotate `RAZORPAY_WEBHOOK_SECRET` in the dashboard and the environment | Forged "payment succeeded" callbacks stop verifying |

Rotating the JWT secrets signs out every user on the platform, including every
patient mid-consultation. That cost is worth paying when the alternative is a
live credential in someone else's hands — but it is a decision for the incident
lead, not a reflex.

### Preserve what happened

Before anything is redeployed or rolled back:

```bash
# The audit log is the record of who did what. Snapshot it before it ages out.
psql "$DATABASE_URL" -c "\copy (SELECT * FROM \"AuditLog\" WHERE \"createdAt\" > now() - interval '30 days') TO 'audit-snapshot.csv' CSV HEADER"
```

Also capture: application logs for the window, the storage provider's access
logs, and the gateway's dashboard if money is involved.

### Establish scope

The audit log answers most of the questions that matter:

```sql
-- What did this account do?
SELECT * FROM "AuditLog" WHERE "actorUserId" = '<id>' ORDER BY "createdAt" DESC;

-- Whose records were read, and by whom?
SELECT * FROM "AuditLog" WHERE action IN ('patient.record_read', 'patient.searched', 'document.read')
  AND "createdAt" > '<when>' ORDER BY "createdAt";

-- Anything destructive?
SELECT * FROM "AuditLog" WHERE action IN ('user.erased', 'user.suspended', 'retention.swept')
  AND "createdAt" > '<when>';
```

This is why read-access logging exists. Without it the honest answer to "whose
data was exposed" is "we cannot tell", and the honest answer forces you to
notify everyone.

---

## 3. Notification

Under the DPDP Act, a breach is reported to the **Data Protection Board of
India** and to **each affected Data Principal**. Confirm the current timelines
with counsel — they are short, and being late is its own violation.

**Do not wait for certainty.** The obligation is triggered by a breach having
occurred, not by the investigation finishing.

What each affected person is told, in plain language:

- What happened, and when
- What data of theirs was involved — specifically, not "some personal data"
- What has been done about it
- What they should do, if anything
- Who to contact (the DPO)

Health data raises the stakes on tone. Someone learning that their consultation
history was exposed is not reassured by a paragraph about our commitment to
security. Say what happened.

**Who to notify beyond that:**

- ☐ The payment aggregator, if payment data or order records are involved
- ☐ Insurers, if the policy requires it
- ☐ Affected partner pharmacies and labs — their records are in there too
- ☐ Medical councils, if a doctor's registration credentials were exposed

---

## 4. Recovery

1. Confirm the hole is actually closed — re-test the specific vector
2. `npm run preflight` — proves the rotated credentials reach working services
3. `npm run restore:drill` if any data was lost or is suspect
4. Watch the audit log and error reporting for the same pattern recurring
5. Restore normal access only once the above is done, not before

---

## 5. Afterwards

Within two weeks, written down and circulated:

- Timeline: when it started, when it was noticed, when it was contained
- How it was noticed — and if that was a user rather than monitoring, why
- What made it possible
- What has changed so that it cannot happen the same way again
- What would have made it smaller: better detection, tighter scope, faster
  containment

Blameless. The engineer who made the change is not the reason a single mistake
was able to become an incident.

---

## 6. What the platform already gives you

Worth knowing before you need it:

- **Immediate revocation.** Suspension raises `tokenVersion`; every token on
  that account stops working at once, not when it expires (`sessionService.ts`)
- **An audit trail of reads, not just writes.** `patient.record_read`,
  `patient.searched`, `document.read`
- **Privileged actions are attributed** — role grants, application decisions,
  erasures, retention sweeps, all with actor and IP
- **Documents are never public.** Opaque storage keys, authorised per request,
  short-lived signed links
- **Secrets are domain-separated.** Rotating the JWT secret rotates the OTP,
  document-link and mock-payment keys with it (`utils/secrets.ts`)
- **Erasure is one-way and audited**, so a "delete everything" request cannot be
  used to destroy evidence quietly

And what it does not:

- **No alerting.** Error reporting needs a `SENTRY_DSN`; without one, nothing
  tells you an incident is happening
- **No anomaly detection.** Nothing notices an admin reading a thousand patient
  records at 3am — the log records it, but only if someone looks
- **No IP allowlist on the admin panel.** Worth considering; it is the highest-
  value target on the platform
