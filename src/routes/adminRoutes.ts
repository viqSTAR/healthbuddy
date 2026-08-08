import { Router } from 'express';
import { z } from 'zod';
import {
  getAdminStatsHandler,
  listUsersHandler,
  setUserSuspendedHandler,
  listAuditLogsHandler,
} from '../controllers/adminController.js';
import {
  getOverviewHandler,
  listPatientsHandler,
  getPatientHandler,
  listDoctorsHandler,
  getDoctorHandler,
  updateDoctorHandler,
  listPharmaciesHandler,
  getPharmacyHandler,
  updatePharmacyHandler,
  getPharmacyInventoryHandler,
  listLabsHandler,
  getLabHandler,
  updateLabHandler,
  setLabOfferingHandler,
  listAppointmentsHandler,
  listOrdersHandler,
  getOrderHandler,
  cancelOrderHandler,
  listLabOrdersHandler,
  getDeliveryBoardHandler,
  assignAgentHandler,
  listAgentsHandler,
  listPaymentsHandler,
  getPaymentDetailHandler,
  listWebhookEventsHandler,
  listMedicinesHandler,
  upsertMedicineHandler,
  listLabPackagesHandler,
  upsertLabPackageHandler,
} from '../controllers/adminOpsController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, paginationSchema, uuidSchema } from '../middlewares/validate.js';

const router = Router();

// authorizeRoles was previously imported here but never applied, leaving these
// endpoints open to every authenticated user. Every route in this file — read
// or write — sits behind it.
router.use(authenticateJwt, authorizeRoles('ADMIN'));

/* ---------- Shared shapes ---------- */

const idParam = z.object({ id: uuidSchema });
const search = z.string().trim().min(1).max(120).optional();
const listQuery = paginationSchema.extend({ search });
const isoDate = z.string().datetime().optional();

/**
 * Cast toggles arrive as query strings. `'true'` is the only truthy spelling
 * accepted, so a stray `?unassigned=0` cannot silently turn a filter on.
 */
const boolFlag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

/** A short note attached to the audit line — who did what, and why. */
const reason = z.string().trim().min(1).max(500).optional();

/** Commission is a percentage; null clears the override back to the default. */
const commission = z.number().min(0).max(60).nullable().optional();

const payoutAccount = z.string().trim().max(120).nullable().optional();

/* ---------- Overview & existing endpoints ---------- */

router.get('/overview', getOverviewHandler);
router.get('/stats', getAdminStatsHandler);

router.get(
  '/users',
  validate({
    query: paginationSchema.extend({
      role: z.enum(['PATIENT', 'DOCTOR', 'LAB_PARTNER', 'PHARMACY', 'ADMIN']).optional(),
    }),
  }),
  listUsersHandler
);

router.patch(
  '/users/:id/suspension',
  validate({
    params: idParam,
    body: z.object({ suspended: z.boolean(), reason }),
  }),
  setUserSuspendedHandler
);

/** The privileged-action log — role grants, application decisions, PHI reads. */
router.get(
  '/audit',
  validate({
    query: paginationSchema.extend({
      entityType: z.string().trim().max(60).optional(),
      entityId: z.string().trim().max(60).optional(),
      action: z.string().trim().max(60).optional(),
    }),
  }),
  listAuditLogsHandler
);

/* ---------- Patients ---------- */

router.get('/patients', validate({ query: listQuery }), listPatientsHandler);
router.get('/patients/:id', validate({ params: idParam }), getPatientHandler);

/* ---------- Doctors ---------- */

router.get(
  '/doctors',
  validate({
    query: listQuery.extend({
      specialty: z.string().trim().max(80).optional(),
      state: z.enum(['AVAILABLE', 'OFFLINE', 'SUSPENDED', 'UNVERIFIED']).optional(),
    }),
  }),
  listDoctorsHandler
);

router.get('/doctors/:id', validate({ params: idParam }), getDoctorHandler);

router.patch(
  '/doctors/:id',
  validate({
    params: idParam,
    body: z
      .object({
        isAvailable: z.boolean().optional(),
        consultationFee: z.number().min(0).max(100_000).optional(),
        commissionPercent: commission,
        verified: z.boolean().optional(),
        payoutAccountId: payoutAccount,
        reason,
      })
      // An empty body is a mistake, not a no-op: it usually means the form
      // serialised nothing and the operator thinks they saved a change.
      .refine((b) => Object.keys(b).some((k) => k !== 'reason'), {
        message: 'Send at least one field to change.',
      }),
  }),
  updateDoctorHandler
);

/* ---------- Pharmacies ---------- */

router.get(
  '/pharmacies',
  validate({
    query: listQuery.extend({
      state: z.enum(['ACTIVE', 'INACTIVE', 'LICENCE_EXPIRING', 'UNVERIFIED']).optional(),
    }),
  }),
  listPharmaciesHandler
);

router.get('/pharmacies/:id', validate({ params: idParam }), getPharmacyHandler);

router.patch(
  '/pharmacies/:id',
  validate({
    params: idParam,
    body: z
      .object({
        isActive: z.boolean().optional(),
        deliveryRadiusKm: z.number().min(0).max(200).optional(),
        commissionPercent: commission,
        verified: z.boolean().optional(),
        payoutAccountId: payoutAccount,
        drugLicenceNumber: z.string().trim().max(80).nullable().optional(),
        drugLicenceExpiry: z.string().datetime().nullable().optional(),
        reason,
      })
      .refine((b) => Object.keys(b).some((k) => k !== 'reason'), {
        message: 'Send at least one field to change.',
      }),
  }),
  updatePharmacyHandler
);

router.get(
  '/pharmacies/:id/inventory',
  validate({
    params: idParam,
    query: listQuery.extend({ only: z.enum(['LOW', 'EXPIRING', 'OUT']).optional() }),
  }),
  getPharmacyInventoryHandler
);

/* ---------- Labs ---------- */

router.get(
  '/labs',
  validate({
    query: listQuery.extend({
      state: z.enum(['ACTIVE', 'INACTIVE', 'NABL', 'UNVERIFIED']).optional(),
    }),
  }),
  listLabsHandler
);

router.get('/labs/:id', validate({ params: idParam }), getLabHandler);

router.patch(
  '/labs/:id',
  validate({
    params: idParam,
    body: z
      .object({
        isActive: z.boolean().optional(),
        homeCollection: z.boolean().optional(),
        commissionPercent: commission,
        verified: z.boolean().optional(),
        payoutAccountId: payoutAccount,
        nablAccredited: z.boolean().optional(),
        nablCertNumber: z.string().trim().max(80).nullable().optional(),
        nablExpiry: z.string().datetime().nullable().optional(),
        reason,
      })
      .refine((b) => Object.keys(b).some((k) => k !== 'reason'), {
        message: 'Send at least one field to change.',
      }),
  }),
  updateLabHandler
);

router.patch(
  '/lab-offerings/:offeringId',
  validate({
    params: z.object({ offeringId: uuidSchema }),
    body: z.object({ isActive: z.boolean(), reason }),
  }),
  setLabOfferingHandler
);

/* ---------- Appointments ---------- */

router.get(
  '/appointments',
  validate({
    query: listQuery.extend({
      status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
      type: z.enum(['VIDEO', 'IN_PERSON']).optional(),
      doctorId: uuidSchema.optional(),
      patientId: uuidSchema.optional(),
      from: isoDate,
      to: isoDate,
    }),
  }),
  listAppointmentsHandler
);

/* ---------- Medicine orders ---------- */

router.get(
  '/orders',
  validate({
    query: listQuery.extend({
      status: z
        .enum([
          'PENDING_PAYMENT',
          'PLACED',
          'ACCEPTED',
          'PROCESSING',
          'DISPATCHED',
          'DELIVERED',
          'CANCELLED',
        ])
        .optional(),
      pharmacyId: uuidSchema.optional(),
      patientId: uuidSchema.optional(),
      unassigned: boolFlag,
    }),
  }),
  listOrdersHandler
);

router.get('/orders/:id', validate({ params: idParam }), getOrderHandler);

router.post(
  '/orders/:id/cancel',
  validate({
    params: idParam,
    // A reason is required, not optional: this refunds the customer and
    // releases stock, and "cancelled by admin" with no note is unauditable.
    body: z.object({ reason: z.string().trim().min(3).max(500) }),
  }),
  cancelOrderHandler
);

router.post(
  '/orders/:id/agent',
  validate({
    params: idParam,
    body: z.object({ agentUserId: uuidSchema.nullable() }),
  }),
  assignAgentHandler
);

/* ---------- Lab orders ---------- */

router.get(
  '/lab-orders',
  validate({
    query: listQuery.extend({
      status: z
        .enum([
          'PENDING_PAYMENT',
          'BOOKED',
          'ACCEPTED',
          'SAMPLE_COLLECTED',
          'PROCESSING',
          'COMPLETED',
          'CANCELLED',
        ])
        .optional(),
      labPartnerId: uuidSchema.optional(),
      patientId: uuidSchema.optional(),
      unassigned: boolFlag,
    }),
  }),
  listLabOrdersHandler
);

/* ---------- Deliveries ---------- */

router.get(
  '/deliveries',
  validate({
    query: z.object({
      pharmacyId: uuidSchema.optional(),
      agentUserId: uuidSchema.optional(),
    }),
  }),
  getDeliveryBoardHandler
);

router.get('/agents', validate({ query: z.object({ search }) }), listAgentsHandler);

/* ---------- Payments ---------- */

router.get(
  '/payments',
  validate({
    query: listQuery.extend({
      status: z.enum(['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional(),
      purpose: z
        .enum(['APPOINTMENT', 'MEDICINE_ORDER', 'LAB_ORDER', 'PRESCRIPTION_BASKET'])
        .optional(),
      method: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD']).optional(),
      from: isoDate,
      to: isoDate,
    }),
  }),
  listPaymentsHandler
);

router.get('/payments/:id', validate({ params: idParam }), getPaymentDetailHandler);

router.get(
  '/webhooks',
  validate({ query: paginationSchema.extend({ onlyFailed: boolFlag }) }),
  listWebhookEventsHandler
);

/* ---------- Catalogue ---------- */

const medicineBody = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  price: z.number().min(0).max(1_000_000),
  composition: z.string().trim().max(400).nullable().optional(),
  manufacturer: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  schedule: z.enum(['OTC', 'SCHEDULE_H', 'SCHEDULE_H1', 'SCHEDULE_X', 'NARCOTIC']),
  teleList: z.enum(['LIST_O', 'LIST_A', 'LIST_B', 'PROHIBITED']),
  requiresPrescription: z.boolean(),
});

router.get(
  '/medicines',
  validate({
    query: listQuery.extend({
      schedule: z.enum(['OTC', 'SCHEDULE_H', 'SCHEDULE_H1', 'SCHEDULE_X', 'NARCOTIC']).optional(),
      category: z.string().trim().max(80).optional(),
    }),
  }),
  listMedicinesHandler
);

router.post('/medicines', validate({ body: medicineBody }), upsertMedicineHandler);
router.put(
  '/medicines/:id',
  validate({ params: idParam, body: medicineBody }),
  upsertMedicineHandler
);

const labPackageBody = z.object({
  testName: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  price: z.number().min(0).max(1_000_000),
  sampleType: z.string().trim().min(2).max(80),
  fastingReq: z.boolean(),
  description: z.string().trim().max(2000).nullable().optional(),
});

router.get('/lab-packages', validate({ query: listQuery }), listLabPackagesHandler);
router.post('/lab-packages', validate({ body: labPackageBody }), upsertLabPackageHandler);
router.put(
  '/lab-packages/:id',
  validate({ params: idParam, body: labPackageBody }),
  upsertLabPackageHandler
);

export default router;
