import type { Response } from 'express';
import {
  getPatientProfileService,
  updatePatientProfileService,
  getPatientMedicalRecordService,
  type PatientProfileUpdate,
} from '../services/patientService.js';
import { listVisitsService, getVisitService } from '../services/visitService.js';
import {
  eraseAccountService,
  exportAccountDataService,
} from '../services/userLifecycleService.js';
import { recordAudit } from '../services/auditService.js';
import {
  listConsentsService,
  grantConsentService,
  withdrawConsentService,
} from '../services/consentService.js';
import type { ConsentPurpose } from '@prisma/client';
import {
  asyncHandler,
  requirePatientId,
  requireUser,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';
import { clearRefreshCookie } from '../utils/authCookies.js';
import { normalisePhone } from '../utils/otp.js';
import { AppError } from '../utils/AppError.js';

/**
 * Optional `?page=&limit=` off the query string.
 *
 * Every one of these endpoints answers safely with no parameters at all — the
 * service clamps to a default window — so existing clients keep working
 * unchanged and only a client that wants a second page has to ask for one.
 */
const pageOf = (req: AuthenticatedRequest) => {
  const q = req.query as { page?: unknown; limit?: unknown };
  return {
    ...(q.page !== undefined ? { page: Number(q.page) } : {}),
    ...(q.limit !== undefined ? { limit: Number(q.limit) } : {}),
  };
};


export const getPatientProfileHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const patient = await getPatientProfileService(requirePatientId(req));
  res.status(200).json({ success: true, patient });
});

export const updatePatientProfileHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const patient = await updatePatientProfileService(
    requirePatientId(req),
    req.body as PatientProfileUpdate
  );
  res.status(200).json({ success: true, patient });
});

export const getMedicalRecordHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const record = await getPatientMedicalRecordService(requirePatientId(req), pageOf(req));
  res.status(200).json({ success: true, ...record });
});

export const listVisitsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const visits = await listVisitsService(requirePatientId(req), pageOf(req));
  res.status(200).json({ success: true, count: visits.length, visits });
});

export const getVisitHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const visit = await getVisitService(requirePatientId(req), (req.params as { id: string }).id);
  res.status(200).json({ success: true, visit });
});

/* ---------- Account lifecycle ---------- */

/**
 * Everything the platform holds about the caller.
 *
 * The companion to closing an account: nobody should have to decide about
 * erasure blind, and "what do you have on me" is a question the platform should
 * be able to answer without a support ticket.
 */
export const exportMyDataHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const data = await exportAccountDataService(user.userId);

    await recordAudit({
      actorUserId: user.userId,
      action: 'user.data_exported',
      entityType: 'User',
      entityId: user.userId,
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ success: true, data });
  }
);

/**
 * Closing your own account.
 *
 * Guarded by re-typing the phone number rather than by a confirmation flag. A
 * boolean is one mis-tap and one careless client away from an irreversible
 * action; typing the number is a deliberate act, and it is the one piece of
 * information a person closing their own account certainly has.
 */
export const closeMyAccountHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { confirmPhoneNumber, reason } = req.body as {
      confirmPhoneNumber: string;
      reason?: string;
    };

    if (normalisePhone(confirmPhoneNumber) !== normalisePhone(user.phoneNumber)) {
      throw new AppError(
        'Enter the phone number this account signs in with to confirm.',
        400
      );
    }

    const result = await eraseAccountService({
      userId: user.userId,
      actorUserId: user.userId,
      ...(reason ? { reason } : {}),
      ipAddress: req.ip ?? null,
    });

    clearRefreshCookie(res);
    res.status(200).json({
      success: true,
      message: 'Your account is closed. You have been signed out on every device.',
      ...result,
    });
  }
);

/* ---------- Consent ---------- */

export const listConsentsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const consents = await listConsentsService(requireUser(req).userId);
    res.status(200).json({ success: true, count: consents.length, consents });
  }
);

export const grantConsentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { purpose, policyVersion } = req.body as {
      purpose: ConsentPurpose;
      policyVersion?: string;
    };

    const record = await grantConsentService({
      userId: user.userId,
      purpose,
      ...(policyVersion ? { policyVersion } : {}),
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ success: true, consent: record });
  }
);

export const withdrawConsentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { purpose } = req.params as { purpose: ConsentPurpose };

    const result = await withdrawConsentService({
      userId: user.userId,
      purpose,
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ success: true, ...result });
  }
);
