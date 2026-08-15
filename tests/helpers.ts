import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/config/db.js';
import { platformNow } from '../src/utils/clock.js';

export { app, prisma, request };

/**
 * Phone numbers are namespaced per worker so concurrent runs don't collide.
 *
 * This was `Date.now()`, which is not unique enough: the test runner starts each
 * file in its own process, and two of them launching in the same millisecond got
 * identical prefixes. Both then issued an OTP for the same number, the second
 * send overwrote the first's hash in Redis, and the first verify failed with
 * "Incorrect verification code" — a failure with nothing to do with the code
 * under test. The pid separates concurrent workers; the random suffix covers pid
 * reuse across runs. Six digits, so the prefix contract `cleanupTestUsers`
 * relies on is unchanged.
 */
const RUN_ID =
  String(process.pid % 1000).padStart(3, '0') +
  String(Math.floor(Math.random() * 1000)).padStart(3, '0');
let seq = 0;
export const uniquePhone = () => `+1999${RUN_ID}${String(seq++).padStart(2, '0')}`;

export interface Session {
  phone: string;
  userId: string;
  role: string;
  accessToken: string;
  refreshToken: string;
}

/** Runs the full OTP flow and returns a usable session. */
export const login = async (phone = uniquePhone()): Promise<Session> => {
  const sent = await request(app).post('/api/v1/auth/send-otp').send({ phoneNumber: phone });
  if (sent.status !== 200) {
    throw new Error(`send-otp failed (${sent.status}): ${JSON.stringify(sent.body)}`);
  }

  const otp = sent.body.devOtp;
  if (!otp) throw new Error('devOtp missing — set EXPOSE_DEV_OTP=true for the test env.');

  const verified = await request(app)
    .post('/api/v1/auth/verify-otp')
    .send({ phoneNumber: phone, otp });

  if (verified.status !== 200) {
    throw new Error(`verify-otp failed (${verified.status}): ${JSON.stringify(verified.body)}`);
  }

  return {
    phone,
    userId: verified.body.user.id,
    role: verified.body.user.role,
    accessToken: verified.body.tokens.accessToken,
    refreshToken: verified.body.tokens.refreshToken,
  };
};

/** Logs in, then elevates the account directly in the DB and re-issues tokens. */
export const loginAs = async (role: 'DOCTOR' | 'PHARMACY' | 'LAB_PARTNER' | 'ADMIN'): Promise<Session> => {
  const phone = uniquePhone();
  const session = await login(phone);

  await prisma.user.update({ where: { id: session.userId }, data: { role } });

  switch (role) {
    case 'DOCTOR':
      await prisma.doctor.create({
        data: { userId: session.userId, name: 'Test Doctor', specialty: 'General Physician', consultationFee: 50 },
      });
      break;
    case 'PHARMACY':
      await prisma.pharmacy.create({
        data: { userId: session.userId, name: 'Test Pharmacy', address: '1 Test St' },
      });
      break;
    case 'LAB_PARTNER':
      await prisma.labPartner.create({
        data: { userId: session.userId, name: 'Test Lab', location: '2 Test St' },
      });
      break;
    case 'ADMIN':
      break;
  }

  // Re-mint so the token carries the new role and profile id.
  const refreshed = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: session.refreshToken });

  return {
    ...session,
    role: refreshed.body.user.role,
    accessToken: refreshed.body.tokens.accessToken,
    refreshToken: refreshed.body.tokens.refreshToken,
  };
};

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const sessions = new Map<string, Promise<Session>>();

/**
 * Signs in as a fixed, seeded account — reusing the session if this run already
 * has one.
 *
 * OTP requests are rate limited to one per minute per number, which is correct
 * behaviour and must not be relaxed for tests. But several tests legitimately
 * need to act as the same seeded pharmacy or doctor, and back-to-back logins
 * inside that window fail with a 429 that has nothing to do with what is being
 * tested. Caching the promise (not the result) also means two tests starting
 * together share one login rather than racing into the same limit.
 *
 * Only for accounts that exist before the run. Use `login()` for throwaway
 * patients — those want a fresh number each time.
 */
export const loginOnce = (phone: string): Promise<Session> => {
  const existing = sessions.get(phone);
  if (existing) return existing;

  const pending = login(phone).catch((err: unknown) => {
    // Don't cache a failure: the next caller should get a real attempt.
    sessions.delete(phone);
    throw err;
  });

  sessions.set(phone, pending);
  return pending;
};

/** Removes every user created by this run, cascading to their profiles. */
export const cleanupTestUsers = async () => {
  const users = await prisma.user.findMany({
    where: { phoneNumber: { startsWith: `+1999${RUN_ID}` } },
    select: { id: true, patient: { select: { id: true } } },
  });
  const userIds = users.map((u) => u.id);
  const patientIds = users.flatMap((u) => (u.patient ? [u.patient.id] : []));

  if (patientIds.length) {
    // Free any slots these tests booked so reruns aren't starved.
    const appts = await prisma.appointment.findMany({
      where: { patientId: { in: patientIds } },
      select: { slotId: true },
    });
    await prisma.prescription.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.appointment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.doctorSlot.updateMany({
      where: { id: { in: appts.map((a) => a.slotId) } },
      data: { status: 'AVAILABLE' },
    });
    // Payments reference orders, so they have to go first.
    await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.medicineOrder.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.labOrder.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.emergencySOS.deleteMany({ where: { patientId: { in: patientIds } } });
  }

  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
};

/**
 * A medicine that can actually be bought right now.
 *
 * `findFirst()` with no filter returns rows in arbitrary order and can land on
 * a controlled drug or one whose stock earlier runs already consumed — which
 * fails the order with a 409 that has nothing to do with what is under test.
 */
export const anOrderableMedicine = async () => {
  const medicine = await prisma.medicine.findFirst({
    where: { stock: { gte: 5 }, schedule: 'OTC' },
    orderBy: { stock: 'desc' },
  });
  if (!medicine) throw new Error('No OTC medicine in stock — run `npm run seed`.');
  return medicine;
};

/**
 * Grabs a seeded doctor plus one slot a patient could actually book.
 *
 * "Available" is not enough: a slot whose start has gone by is still AVAILABLE
 * in the table, and booking one is refused. Seeded days accumulate past slots as
 * the day wears on, so a test picking the first AVAILABLE row starts failing at
 * whatever hour the earliest seeded slot lapses.
 */
export const anAvailableSlot = async () => {
  const now = platformNow();

  const slot = await prisma.doctorSlot.findFirst({
    where: {
      status: 'AVAILABLE',
      OR: [{ date: { gt: now.date } }, { date: now.date, startTime: { gt: now.time } }],
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    include: { doctor: true },
  });

  if (!slot) throw new Error('No future slot available — run `npm run seed`.');
  return slot;
};
