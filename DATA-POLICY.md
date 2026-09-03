# Data retention and erasure

What Health Buddy keeps, for how long, and what happens when someone asks for it
to be deleted.

This document exists because the code already makes these decisions. Erasure
keeps clinical records and destroys identity; consent is recorded per purpose
and versioned. Those are policy choices sitting in `userLifecycleService.ts` and
`consentService.ts`, and a policy that lives only in code is one nobody can
review, answer a regulator with, or hold the platform to.

> This is an engineering document describing implemented behaviour. It is not
> legal advice and it is not the customer-facing privacy notice. Have a lawyer
> familiar with the DPDP Act and the telemedicine rules review both before the
> platform takes a real patient.

---

## 1. The two obligations, and why they conflict

**A person may ask for their personal data to be erased.** The Digital Personal
Data Protection Act 2023 gives a Data Principal that right, and satisfying it
means the data is gone — not hidden, not flagged.

**A medical record is not the patient's to delete.** A prescription is evidence
of a clinical decision that a doctor is accountable for and a pharmacy dispensed
against. A settled payment is an accounting record and a partner's statement has
to still reconcile next year.

Both are real, and they point in opposite directions. The resolution used here
is the standard one: **erase the identity, keep the record, and sever the link
between them.** After erasure the consultation still happened, the prescription
still says what was prescribed, and nothing in either points at a person.

---

## 2. What is kept, and for how long

| Data | Retained | Why |
| --- | --- | --- |
| Consultation records (appointments, notes, symptoms) | 3 years from the consultation | Telemedicine Practice Guidelines treat these as medical records |
| Prescriptions, including the drugs and doses | 3 years from issue | The prescribing doctor is accountable for it; a pharmacist may need to verify it |
| Dispensing records held against a pharmacy | 3 years | Drugs and Cosmetics Rules — the shop's own obligation, not ours to waive |
| Lab orders and results | 3 years | Medical record |
| Payments, refunds and settlement legs | 8 years | Income-tax record retention |
| Audit log of privileged actions | 8 years | An audit log with holes in it is not an audit log |
| Consent records, including withdrawals | Life of the account + 3 years | The record of *why* processing was lawful has to outlive the processing |
| Uploaded lab reports and prescription images | With the record they belong to | They *are* the record |
| Identity: name, phone, email, addresses, devices | Until erasure is requested | No reason to hold it beyond the relationship |
| Profile photos and ID scans | Until erasure is requested | Convenience and verification, not clinical |
| Push notification history | 90 days | A copy of information held properly elsewhere |
| Server logs | 30 days | Operational, and deliberately short — see §5 |

Retention periods above the identity line are **floors set by other people's
rules**, not choices. Where a period is not externally mandated, the answer is
"until the relationship ends".

---

## 3. What erasure actually does

Triggered by the patient (`DELETE /api/v1/patients/me`, confirmed by typing the
account's phone number) or by an administrator on request
(`POST /api/v1/admin/users/:id/erase`). Implemented in
`services/userLifecycleService.ts`.

**Destroyed:**

- Name, email, age, gender, blood group, emergency contact
- Free-text allergies and chronic conditions — the patient's own description of
  themselves, which is not a clinician's finding
- Every saved address, and the coordinates on them
- Every registered device token
- Every notification
- Profile photos and ID scans, blob and row
- The phone number, which is replaced with an opaque placeholder and thereby
  **released** — signing up with it again produces a genuinely new account

**Kept, now pointing at a subject with no identity:**

- Consultations, prescriptions, lab orders, dispensing records
- Payments, refunds and settlement legs
- The audit log, including the record of the erasure itself

**Refused, with the reason, when:**

- There is work in flight — an upcoming consultation, an order out for delivery,
  a lab booking in progress. Erasing mid-delivery strands a parcel with a rider
  and an address nobody can reconcile.
- The account is a provider. A doctor's registration number and a pharmacy's
  drug licence appear on records other parties rely on. Closing a provider is an
  offboarding process with a payout reconciliation in it, and the code says so
  rather than half-doing it.

It is one-way. There is no un-erase.

## 4. Access and portability

`GET /api/v1/patients/me/export` returns everything held about the caller:
profile, addresses, consultations, prescriptions with their items, orders, lab
orders, payments, emergency records, and document *metadata*.

Document bytes are deliberately not inlined. They are fetched through the
documents API, which authorises each one — a bulk export is not a reason to
bypass an access check.

---

## 5. Data minimisation, in the places it is easy to get wrong

These are implemented, and worth stating because each was a decision:

- **The admin patient view carries no clinical data.** No diagnosis, no
  prescribed drugs, no lab results. Someone resolving "my order never arrived"
  has no business reading why the patient saw a doctor, and the screen is built
  without those fields because that is the only reliable way to keep them out.
- **Reading a patient's file is audited.** `patient.record_read` and
  `patient.searched`. Administrative writes were always logged; reads are the
  more common and more sensitive act.
- **Phone numbers are masked in logs.** Logs are the likeliest thing to be
  shipped to a third-party aggregator, and the phone number is the account
  identifier.
- **Error reports carry ids, never identities.** See `utils/errorReporter.ts` —
  the route pattern and a user id, never a name, a number, or a query string.
- **Uploads are private by storage key.** Never a public URL; reads are
  authorised per request and served over short-lived signed links.
- **The rider job pool exposes a pincode, not a patient.** A rider sees who they
  are delivering to only once they have claimed the parcel.

---

## 6. Consent

Recorded per purpose, versioned, and append-only — see `consentService.ts`.

| Purpose | Required? | Withdrawal |
| --- | --- | --- |
| `TERMS_OF_SERVICE` | Yes | Allowed; the account stops being usable |
| `PRIVACY_POLICY` | Yes | Allowed; the account stops being usable |
| `TELECONSULTATION` | For video/chat care | Allowed; in-person routes remain |
| `MARKETING_MESSAGES` | No | Allowed; changes nothing about care |

Three properties are load-bearing:

- **Separable.** Willingness to be treated is not willingness to be marketed at.
  A single bundled "I agree" is not consent to either.
- **Versioned.** `POLICY_VERSIONS` pins the wording each person saw. Changing
  the text materially means bumping the version, which makes existing consent
  stale and re-prompts — an intentional cost, and the reason not to bump it for
  a typo.
- **Append-only.** Withdrawal stamps `withdrawnAt`; granting again writes a new
  row. The history reads forwards and cannot be rewritten to say somebody always
  agreed.

Every consent can be withdrawn, including the essential ones. A consent that
cannot be taken back is not consent — what the essential ones get is a plain
statement of the consequence, not a refusal.

**Known gap:** consent routes are currently mounted under `/patients` and so are
reachable by patient accounts only. Providers are data subjects too; the
handlers are already role-agnostic, so this is a change of mount point rather
than of logic.

---

## 7. Still to do before a real patient

These need decisions or accounts rather than code:

- [ ] A lawyer's review of this document and of the customer-facing privacy
      notice, against the DPDP Act and the Telemedicine Practice Guidelines
- [ ] A named Data Protection Officer and a published contact route for rights
      requests, as the DPDP Act requires. The slot for this is in
      [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) §0
- [x] ~~A breach-notification runbook.~~ Drafted in
      [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) — containment steps, the audit
      queries that establish scope, and the notification obligations. **It has
      blanks in it**: the incident lead, the DPO and the provider contacts are
      named nowhere yet, and a runbook that names no one is not a runbook
- [x] ~~A **scheduled job** enforcing the periods in §2.~~ Implemented in
      `services/retentionService.ts`. Run it nightly:
      `npm run retention -- --apply`, or from the admin panel's retention
      endpoint. It sweeps only the short-retention categories; anything under a
      statutory floor is **counted and reported, never deleted automatically** —
      a job that erases medical records on a timer is one wrong constant away
      from a catastrophe nobody can undo. **Still to do:** point your scheduler
      at it, and decide who reviews the reported counts
- [ ] Data-processing agreements with each processor actually used: the SMS
      provider, the payment aggregator, the object store, the push service and
      the error tracker
- [x] ~~A restore test.~~ `npm run restore:drill` takes a dump, restores it into
      a scratch database and compares row counts across every critical table.
      **Run and passing** against the development database — 1.29 MB dumped and
      restored, all 14 critical tables matching. Still to do: run it against a
      real *nightly* backup (`--dump <file>`), which is the one that matters,
      and schedule it weekly — see [deploy/README.md](deploy/README.md)
