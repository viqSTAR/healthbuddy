import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, loginAs, cleanupTestUsers } from './helpers.js';
import { cacheStore } from '../src/config/redis.js';
import { enforceRetentionService, RETENTION_DAYS } from '../src/services/retentionService.js';

/**
 * A retention policy the system does not enforce is a claim that would not
 * survive being checked. These pin both halves of the behaviour: that expired
 * short-lived data actually goes, and that records under a statutory floor
 * emphatically do not.
 */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('the sweep removes what it should', () => {
  test('a notification past its window goes; a recent one stays', async () => {
    const patient = await login();

    const old = await prisma.notification.create({
      data: {
        userId: patient.userId,
        title: 'Old',
        body: 'Long past',
        createdAt: daysAgo(RETENTION_DAYS.notifications + 5),
      },
    });
    const recent = await prisma.notification.create({
      data: { userId: patient.userId, title: 'Recent', body: 'Yesterday', createdAt: daysAgo(1) },
    });

    await enforceRetentionService({ dryRun: false });

    assert.equal(await prisma.notification.findUnique({ where: { id: old.id } }), null);
    assert.ok(
      await prisma.notification.findUnique({ where: { id: recent.id } }),
      'a notification inside its window must survive'
    );
  });

  test('a device nothing has used in months is dropped', async () => {
    const patient = await login();

    const stale = await prisma.deviceToken.create({
      data: {
        userId: patient.userId,
        token: `ExponentPushToken[stale-${Date.now()}]`,
        appId: 'PATIENT',
        platform: 'android',
        lastSeenAt: daysAgo(RETENTION_DAYS.staleDeviceTokens + 10),
      },
    });
    const live = await prisma.deviceToken.create({
      data: {
        userId: patient.userId,
        token: `ExponentPushToken[live-${Date.now()}]`,
        appId: 'PATIENT',
        platform: 'android',
        lastSeenAt: daysAgo(2),
      },
    });

    await enforceRetentionService({ dryRun: false });

    assert.equal(await prisma.deviceToken.findUnique({ where: { id: stale.id } }), null);
    assert.ok(await prisma.deviceToken.findUnique({ where: { id: live.id } }));
  });

  test('an UNprocessed webhook is never aged out, however old', async () => {
    const unprocessed = await prisma.paymentWebhookEvent.create({
      data: {
        gateway: 'mock',
        eventId: `evt_retention_${Date.now()}`,
        eventType: 'payment.captured',
        payload: {},
        processedAt: null,
        createdAt: daysAgo(RETENTION_DAYS.processedWebhookEvents + 100),
      },
    });

    await enforceRetentionService({ dryRun: false });

    assert.ok(
      await prisma.paymentWebhookEvent.findUnique({ where: { id: unprocessed.id } }),
      'money moved at the gateway and not here — that is a bug to investigate, not a row to expire'
    );

    await prisma.paymentWebhookEvent.delete({ where: { id: unprocessed.id } });
  });
});

describe('the sweep never touches records under a statutory floor', () => {
  test('an old consultation and prescription are counted, not deleted', async () => {
    const patient = await login();
    const doctor = await loginAs('DOCTOR');

    const patientRow = await prisma.patient.findUniqueOrThrow({
      where: { userId: patient.userId },
    });
    const doctorRow = await prisma.doctor.findUniqueOrThrow({ where: { userId: doctor.userId } });

    const slot = await prisma.doctorSlot.create({
      data: {
        doctorId: doctorRow.id,
        date: '2019-01-01',
        startTime: '10:00',
        endTime: '10:15',
        status: 'BOOKED',
      },
      select: { id: true },
    });
    const appointment = await prisma.appointment.create({
      data: {
        patientId: patientRow.id,
        doctorId: doctorRow.id,
        slotId: slot.id,
        type: 'VIDEO',
        status: 'COMPLETED',
        createdAt: daysAgo(5 * 365),
      },
      select: { id: true },
    });
    const rx = await prisma.prescription.create({
      data: {
        appointmentId: appointment.id,
        patientId: patientRow.id,
        doctorId: doctorRow.id,
        diagnosis: 'Historic',
        medicines: [],
        createdAt: daysAgo(5 * 365),
      },
      select: { id: true },
    });

    const report = await enforceRetentionService({ dryRun: false });

    assert.ok(
      await prisma.appointment.findUnique({ where: { id: appointment.id } }),
      'a medical record must never be deleted by a timer'
    );
    assert.ok(await prisma.prescription.findUnique({ where: { id: rx.id } }));

    assert.ok(report.awaitingReview.consultations >= 1, 'but it must be reported for review');
    assert.ok(report.awaitingReview.prescriptions >= 1);
  });
});

describe('a dry run is genuinely dry', () => {
  test('nothing is deleted, and the counts still tell you what would be', async () => {
    const patient = await login();
    const old = await prisma.notification.create({
      data: {
        userId: patient.userId,
        title: 'Old',
        body: 'Long past',
        createdAt: daysAgo(RETENTION_DAYS.notifications + 5),
      },
    });

    const report = await enforceRetentionService();

    assert.equal(report.dryRun, true, 'the default must be the safe one');
    assert.ok(report.swept.notifications >= 1);
    assert.ok(
      await prisma.notification.findUnique({ where: { id: old.id } }),
      'a dry run that deletes is not a dry run'
    );

    await prisma.notification.delete({ where: { id: old.id } });
  });
});

describe('the admin endpoints', () => {
  test('an admin can read the report', async () => {
    const admin = await loginAs('ADMIN');
    const res = await request(app).get('/api/v1/admin/retention').set(bearer(admin.accessToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.dryRun, true, 'a GET must never delete');
    assert.ok(res.body.awaitingReview);
  });

  test('running without apply is still a dry run', async () => {
    const admin = await loginAs('ADMIN');
    const res = await request(app)
      .post('/api/v1/admin/retention/run')
      .set(bearer(admin.accessToken))
      .send({});

    assert.equal(res.status, 200);
    assert.equal(res.body.dryRun, true);
  });

  test('a patient cannot run it', async () => {
    const patient = await login();
    assert.equal(
      (await request(app).get('/api/v1/admin/retention').set(bearer(patient.accessToken))).status,
      403
    );
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/retention/run')
          .set(bearer(patient.accessToken))
          .send({ apply: true })
      ).status,
      403
    );
  });

  test('applying is audited', async () => {
    const admin = await loginAs('ADMIN');
    await request(app)
      .post('/api/v1/admin/retention/run')
      .set(bearer(admin.accessToken))
      .send({ apply: true });

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'retention.swept' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(entry, 'a job that deletes data has to leave a record that it ran');
    assert.equal(entry!.actorUserId, admin.userId);
  });
});

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});
