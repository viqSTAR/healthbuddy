import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { prisma } from '../config/db.js';
import { storage } from '../utils/storage.js';
import { notFound, AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/**
 * The printable prescription, and the code that proves it is genuine.
 *
 * Two rules shape this file.
 *
 * The doctor owns the letterhead and the platform owns the body. A doctor may
 * put their clinic's name, address and logo at the top; they cannot move or
 * remove the registration number, the date, the drug list or the issuing
 * doctor's name, because those are what make the document valid under the
 * Telemedicine Practice Guidelines. Full customisation would let a prescription
 * be styled into something that is no longer one.
 *
 * And verification reveals authenticity, never content. Anyone holding the
 * printed sheet can check the code — that is the point — so the public endpoint
 * answers "issued by Dr X, registration Y, on date Z" and stops there. Putting
 * the diagnosis behind a six-character code would be handing out medical
 * records to whoever finds the paper.
 */

/**
 * Crockford-style alphabet: no I, L, O or U, so a code read off paper cannot be
 * mistyped as a different valid one, and no accidental words appear.
 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

export const generateVerificationCode = (): string => {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
};

/**
 * Backfills a code for a prescription issued before codes existed.
 *
 * Retried on collision rather than assumed unique: 32^8 is a large space, but
 * "large" is not "guaranteed", and the column is unique so a clash would surface
 * as a failed print rather than a duplicate.
 */
const ensureVerificationCode = async (prescriptionId: string, existing: string | null) => {
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateVerificationCode();
    try {
      await prisma.prescription.update({ where: { id: prescriptionId }, data: { verificationCode: code } });
      return code;
    } catch {
      // Unique violation — try another.
    }
  }
  throw new AppError('Could not allocate a verification code.', 500);
};

const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
};

/**
 * Inlines a letterhead image as a data URI.
 *
 * The bucket is private and its links expire, so a printed sheet that referenced
 * one would show a broken image the day after it was made. Embedding costs a
 * few kilobytes and makes the document self-contained — which is what "print"
 * has to mean.
 */
const inlineImage = async (documentId: string | null): Promise<string | null> => {
  if (!documentId) return null;

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { storageKey: true, mimeType: true },
  });
  if (!doc) return null;

  // A letterhead image is decoration. If it cannot be read the prescription must
  // still print — the legally required content does not depend on it.
  try {
    const buffer = await streamToBuffer(await storage.read(doc.storageKey));
    return `data:${doc.mimeType};base64,${buffer.toString('base64')}`;
  } catch (err) {
    logger.warn(`[prescription] letterhead image ${documentId} unreadable`, err);
    return null;
  }
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatDate = (date: Date) =>
  date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Renders one prescription as a self-contained, printable page.
 *
 * Authorised to the patient it was written for and the doctor who wrote it —
 * checked here rather than by role, because every doctor holds the DOCTOR role
 * but only one of them wrote this.
 */
export const renderPrescriptionService = async (
  prescriptionId: string,
  requester: { patientId?: string; doctorId?: string },
  verifyBaseUrl: string
) => {
  const rx = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      patient: { select: { id: true, fullName: true, age: true, gender: true } },
      doctor: {
        select: {
          id: true,
          name: true,
          qualification: true,
          specialty: true,
          clinicName: true,
          clinicAddress: true,
          clinicPhone: true,
          clinicCity: true,
          clinicState: true,
          clinicPincode: true,
          logoDocumentId: true,
          signatureDocumentId: true,
        },
      },
      items: true,
      labTests: true,
      appointment: { select: { slot: { select: { date: true } } } },
    },
  });

  if (!rx) throw notFound('Prescription');

  const isPatient = requester.patientId && rx.patientId === requester.patientId;
  const isAuthor = requester.doctorId && rx.doctorId === requester.doctorId;
  // 404 rather than 403 so prescription ids cannot be probed.
  if (!isPatient && !isAuthor) throw notFound('Prescription');

  const code = await ensureVerificationCode(rx.id, rx.verificationCode);
  const [logo, signature] = await Promise.all([
    inlineImage(rx.doctor.logoDocumentId),
    inlineImage(rx.doctor.signatureDocumentId),
  ]);

  const verifyUrl = `${verifyBaseUrl.replace(/\/+$/, '')}/verify/${code}`;
  const clinicLines = [
    rx.doctor.clinicAddress,
    [rx.doctor.clinicCity, rx.doctor.clinicState, rx.doctor.clinicPincode].filter(Boolean).join(' '),
    rx.doctor.clinicPhone,
  ].filter((line): line is string => Boolean(line && line.trim()));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prescription ${escapeHtml(code)}</title>
<style>
  :root { --ink:#10231B; --muted:#6F8278; --rule:#cde9db; --brand:#006949; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--ink); background: #fff; line-height: 1.5;
  }
  .sheet { max-width: 760px; margin: 0 auto; }
  header { display: flex; gap: 16px; align-items: flex-start;
           border-bottom: 2px solid var(--brand); padding-bottom: 16px; }
  header img.logo { height: 56px; width: auto; }
  .clinic { flex: 1; }
  .clinic h1 { margin: 0; font-size: 20px; color: var(--brand); }
  .clinic p { margin: 2px 0; font-size: 12px; color: var(--muted); }
  .doctor { text-align: right; font-size: 12px; }
  .doctor strong { display: block; font-size: 14px; color: var(--ink); }
  .meta { display: flex; justify-content: space-between; gap: 16px;
          margin: 16px 0; font-size: 13px; }
  .meta div { flex: 1; }
  .label { color: var(--muted); font-size: 11px; text-transform: uppercase;
           letter-spacing: .04em; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em;
       color: var(--muted); margin: 20px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase;
       letter-spacing: .04em; color: var(--muted); border-bottom: 1px solid var(--rule);
       padding: 6px 8px 6px 0; }
  td { padding: 8px 8px 8px 0; border-bottom: 1px solid #eef6f1; vertical-align: top; }
  td.name { font-weight: 600; }
  .note { font-size: 13px; white-space: pre-wrap; }
  footer { margin-top: 32px; display: flex; justify-content: space-between;
           align-items: flex-end; gap: 24px; }
  .verify { font-size: 11px; color: var(--muted); max-width: 320px; }
  .verify .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                  font-size: 16px; letter-spacing: .12em; color: var(--ink); }
  .sign { text-align: center; }
  .sign img { height: 48px; display: block; margin: 0 auto 4px; }
  .sign .rule { border-top: 1px solid var(--ink); padding-top: 4px;
                min-width: 200px; font-size: 12px; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style>
</head>
<body>
<div class="sheet">
  <header>
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
    <div class="clinic">
      <h1>${escapeHtml(rx.doctor.clinicName ?? rx.doctor.name)}</h1>
      ${clinicLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
    </div>
    <div class="doctor">
      <strong>${escapeHtml(rx.doctor.name)}</strong>
      ${rx.doctor.qualification ? `${escapeHtml(rx.doctor.qualification)}<br>` : ''}
      ${escapeHtml(rx.doctor.specialty)}<br>
      Reg. ${escapeHtml(rx.doctorRegistrationNumber ?? '—')}
    </div>
  </header>

  <div class="meta">
    <div>
      <div class="label">Patient</div>
      ${escapeHtml(rx.patient.fullName)}${
        rx.patient.age ? `, ${rx.patient.age}` : ''
      }${rx.patient.gender ? ` · ${escapeHtml(rx.patient.gender)}` : ''}
    </div>
    <div>
      <div class="label">Date</div>
      ${escapeHtml(formatDate(rx.createdAt))}
    </div>
    <div>
      <div class="label">Consultation</div>
      ${rx.consultationMode === 'VIDEO' ? 'Video' : 'In person'}${
        rx.wasFollowUp ? ' · follow-up' : ''
      }
    </div>
  </div>

  <h2>Diagnosis</h2>
  <div class="note">${escapeHtml(rx.diagnosis)}</div>

  <h2>Rx</h2>
  <table>
    <thead>
      <tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th></tr>
    </thead>
    <tbody>
      ${rx.items
        .map(
          (item) => `<tr>
        <td class="name">${escapeHtml(item.name)}${
          item.instructions ? `<br><span style="font-weight:400;color:var(--muted)">${escapeHtml(item.instructions)}</span>` : ''
        }</td>
        <td>${escapeHtml(item.dosage)}</td>
        <td>${escapeHtml(item.frequency)}</td>
        <td>${item.durationDays ? `${item.durationDays} days` : '—'}</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>

  ${
    rx.labTests.length > 0
      ? `<h2>Tests advised</h2><table><tbody>${rx.labTests
          .map(
            (t) => `<tr><td class="name">${escapeHtml(t.testName)}${
              t.urgent ? ' <strong style="color:#ba1a1a">urgent</strong>' : ''
            }</td><td>${escapeHtml(t.instructions ?? '')}</td></tr>`
          )
          .join('')}</tbody></table>`
      : ''
  }

  ${rx.advice ? `<h2>Advice</h2><div class="note">${escapeHtml(rx.advice)}</div>` : ''}
  ${rx.followUpDate ? `<h2>Follow up</h2><div class="note">${escapeHtml(rx.followUpDate)}</div>` : ''}

  <footer>
    <div class="verify">
      Verify this prescription at<br>
      ${escapeHtml(verifyUrl)}<br>
      <span class="code">${escapeHtml(code)}</span>
    </div>
    <div class="sign">
      ${signature ? `<img src="${signature}" alt="">` : ''}
      <div class="rule">${escapeHtml(rx.doctor.name)}</div>
    </div>
  </footer>
</div>
</body>
</html>`;

  return { html, code };
};

/**
 * The public check.
 *
 * Deliberately thin: it confirms the document exists, who issued it and when.
 * It does not say what was prescribed, because the code travels on a piece of
 * paper that anyone might pick up.
 */
export const verifyPrescriptionService = async (code: string) => {
  const rx = await prisma.prescription.findUnique({
    where: { verificationCode: code.trim().toUpperCase() },
    select: {
      createdAt: true,
      doctorRegistrationNumber: true,
      consultationMode: true,
      doctor: { select: { name: true, specialty: true, clinicName: true } },
    },
  });

  if (!rx) return { valid: false as const };

  return {
    valid: true as const,
    issuedOn: rx.createdAt,
    doctorName: rx.doctor.name,
    specialty: rx.doctor.specialty,
    clinic: rx.doctor.clinicName,
    registrationNumber: rx.doctorRegistrationNumber,
    consultationMode: rx.consultationMode,
  };
};
