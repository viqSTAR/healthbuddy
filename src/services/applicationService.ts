import type { ApplicationType, DocumentKind, Prisma, Role } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';
import { toPublicDocument } from './documentService.js';
import { recordAudit } from './auditService.js';
import { notify, notifyAdmins } from './notificationService.js';
import { logger } from '../utils/logger.js';

/**
 * Provider onboarding.
 *
 * The invariant this file exists to protect: an applicant describes what they
 * want to become, and NOTHING they send grants it. `ProviderApplication.type`
 * chooses a form and a review checklist. Only `reviewApplicationService`, which
 * is mounted ADMIN-only, creates a provider profile and changes `User.role`.
 *
 * This is the same boundary that was previously broken by trusting a `role`
 * field in the verify-otp body; self-registration reintroduces the temptation,
 * so the grant stays in exactly one place.
 */

/** Documents that must be present before an application can be submitted. */
const REQUIRED_DOCUMENTS: Record<ApplicationType, DocumentKind[]> = {
  DOCTOR: ['DOCTOR_REGISTRATION_CERT'],
  PHARMACY: ['DRUG_LICENCE'],
  LAB: ['LAB_REGISTRATION'],
};

/** Fields that must be filled in before review, beyond the shared ones. */
const REQUIRED_FIELDS: Record<ApplicationType, (keyof ApplicationDraft)[]> = {
  DOCTOR: ['councilRegistrationNumber', 'qualification', 'specialty', 'consultationFee'],
  PHARMACY: ['drugLicenceNumber', 'drugLicenceExpiry'],
  LAB: ['labRegistrationNumber'],
};

const ROLE_FOR_TYPE: Record<ApplicationType, Role> = {
  DOCTOR: 'DOCTOR',
  PHARMACY: 'PHARMACY',
  LAB: 'LAB_PARTNER',
};

export interface ApplicationDraft {
  displayName: string;
  contactEmail?: string;
  address: string;
  city?: string;
  state?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;

  hprId?: string;
  hfrId?: string;

  councilRegistrationNumber?: string;
  councilName?: string;
  qualification?: string;
  specialty?: string;
  experienceYears?: number;
  consultationFee?: number;

  drugLicenceNumber?: string;
  drugLicenceExpiry?: string;
  gstin?: string;
  pharmacistName?: string;
  pharmacistRegNumber?: string;

  labRegistrationNumber?: string;
  nablAccredited?: boolean;
  nablCertNumber?: string;
  nablExpiry?: string;
  homeCollection?: boolean;
}

const toDate = (value: string | undefined): Date | undefined =>
  value ? new Date(value) : undefined;

const buildData = (draft: ApplicationDraft) => ({
  displayName: draft.displayName,
  contactEmail: draft.contactEmail ?? null,
  address: draft.address,
  city: draft.city ?? null,
  state: draft.state ?? null,
  pincode: draft.pincode ?? null,
  latitude: draft.latitude ?? null,
  longitude: draft.longitude ?? null,
  hprId: draft.hprId ?? null,
  hfrId: draft.hfrId ?? null,
  councilRegistrationNumber: draft.councilRegistrationNumber ?? null,
  councilName: draft.councilName ?? null,
  qualification: draft.qualification ?? null,
  specialty: draft.specialty ?? null,
  experienceYears: draft.experienceYears ?? null,
  consultationFee: draft.consultationFee ?? null,
  drugLicenceNumber: draft.drugLicenceNumber ?? null,
  drugLicenceExpiry: toDate(draft.drugLicenceExpiry) ?? null,
  gstin: draft.gstin ?? null,
  pharmacistName: draft.pharmacistName ?? null,
  pharmacistRegNumber: draft.pharmacistRegNumber ?? null,
  labRegistrationNumber: draft.labRegistrationNumber ?? null,
  nablAccredited: draft.nablAccredited ?? false,
  nablCertNumber: draft.nablCertNumber ?? null,
  nablExpiry: toDate(draft.nablExpiry) ?? null,
  homeCollection: draft.homeCollection ?? true,
});

const publicApplication = (app: Prisma.ProviderApplicationGetPayload<{
  include: { documents: true };
}>) => ({
  ...app,
  documents: app.documents.map(toPublicDocument),
});

/**
 * Creates or updates the caller's application for a type. Stays in DRAFT so
 * documents can be attached before it enters the review queue.
 */
export const saveApplicationService = async (
  userId: string,
  type: ApplicationType,
  draft: ApplicationDraft
) => {
  const existing = await prisma.providerApplication.findUnique({
    where: { userId_type: { userId, type } },
    select: { id: true, status: true },
  });

  if (existing?.status === 'APPROVED') {
    throw conflict('This application has already been approved.');
  }
  if (existing?.status === 'UNDER_REVIEW') {
    throw conflict('This application is being reviewed and cannot be edited right now.');
  }

  const data = buildData(draft);

  const application = await prisma.providerApplication.upsert({
    where: { userId_type: { userId, type } },
    // A rejected application returns to DRAFT on edit so the applicant can fix
    // what was wrong and resubmit rather than starting over.
    update: { ...data, status: 'DRAFT', rejectionReason: null },
    create: { ...data, userId, type, status: 'DRAFT' },
    include: { documents: true },
  });

  return publicApplication(application);
};

/** Moves a draft into the admin queue after checking it is actually complete. */
export const submitApplicationService = async (userId: string, type: ApplicationType) => {
  const application = await prisma.providerApplication.findUnique({
    where: { userId_type: { userId, type } },
    include: { documents: true },
  });

  if (!application) throw notFound('Application');
  if (application.status === 'APPROVED') throw conflict('This application is already approved.');
  if (application.status === 'SUBMITTED' || application.status === 'UNDER_REVIEW') {
    throw conflict('This application has already been submitted.');
  }

  const missingFields = (REQUIRED_FIELDS[type] ?? []).filter((field) => {
    const value = (application as Record<string, unknown>)[field];
    return value === null || value === undefined || value === '';
  });

  const held = new Set(application.documents.map((d) => d.kind));
  const missingDocuments = (REQUIRED_DOCUMENTS[type] ?? []).filter((kind) => !held.has(kind));

  if (missingFields.length || missingDocuments.length) {
    throw new AppError(
      `This application is incomplete. Missing: ${[...missingFields, ...missingDocuments].join(', ')}.`,
      400
    );
  }

  const updated = await prisma.providerApplication.update({
    where: { id: application.id },
    data: { status: 'SUBMITTED', submittedAt: new Date(), rejectionReason: null },
    include: { documents: true },
  });

  await recordAudit({
    actorUserId: userId,
    action: 'application.submitted',
    entityType: 'ProviderApplication',
    entityId: updated.id,
    metadata: { type },
  });

  await notifyAdmins({
    type: 'APPLICATION_SUBMITTED',
    title: 'New partner application',
    body: `${updated.displayName} applied to join as ${type.toLowerCase()}.`,
    data: { applicationId: updated.id, type },
  });

  return publicApplication(updated);
};

export const getMyApplicationsService = async (userId: string) => {
  const applications = await prisma.providerApplication.findMany({
    where: { userId },
    include: { documents: true },
    orderBy: { updatedAt: 'desc' },
  });
  return applications.map(publicApplication);
};

/** Applicants see their own; admins see any. Others get a 404, not a 403. */
export const getApplicationService = async (
  applicationId: string,
  viewer: { userId: string; role: Role }
) => {
  const application = await prisma.providerApplication.findUnique({
    where: { id: applicationId },
    include: {
      documents: true,
      user: { select: { id: true, phoneNumber: true, role: true } },
    },
  });

  if (!application) throw notFound('Application');
  if (viewer.role !== 'ADMIN' && application.userId !== viewer.userId) {
    throw notFound('Application');
  }

  return { ...application, documents: application.documents.map(toPublicDocument) };
};

export const listApplicationsService = async (params: {
  page: number;
  limit: number;
  status?: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
  type?: ApplicationType;
}) => {
  const where: Prisma.ProviderApplicationWhereInput = {
    // Drafts are the applicant's private workspace and never enter the queue.
    ...(params.status ? { status: params.status } : { status: { not: 'DRAFT' } }),
    ...(params.type ? { type: params.type } : {}),
  };

  const [total, applications] = await Promise.all([
    prisma.providerApplication.count({ where }),
    prisma.providerApplication.findMany({
      where,
      orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }],
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      include: {
        documents: true,
        user: { select: { id: true, phoneNumber: true, role: true } },
      },
    }),
  ]);

  return {
    total,
    page: params.page,
    limit: params.limit,
    applications: applications.map((a) => ({
      ...a,
      documents: a.documents.map(toPublicDocument),
    })),
  };
};

/** Claims an application for review so two admins don't duplicate the work. */
export const claimApplicationService = async (applicationId: string, adminUserId: string) => {
  const claimed = await prisma.providerApplication.updateMany({
    where: { id: applicationId, status: 'SUBMITTED' },
    data: { status: 'UNDER_REVIEW', reviewedByUserId: adminUserId },
  });

  if (claimed.count === 0) {
    throw conflict('This application is not awaiting review.');
  }

  return getApplicationService(applicationId, { userId: adminUserId, role: 'ADMIN' });
};

/**
 * The single place a provider role is granted.
 *
 * Runs in one transaction: create the profile row, flip the user's role. If
 * either half fails, neither lands — a user is never left holding a DOCTOR role
 * with no Doctor profile (which would produce a token with no doctorId and a
 * broken session).
 */
export const reviewApplicationService = async (params: {
  applicationId: string;
  adminUserId: string;
  decision: 'APPROVE' | 'REJECT';
  reason?: string;
  ipAddress?: string | null;
}) => {
  const application = await prisma.providerApplication.findUnique({
    where: { id: params.applicationId },
  });

  if (!application) throw notFound('Application');
  if (application.status === 'APPROVED') {
    throw conflict('This application has already been approved.');
  }
  if (application.status === 'DRAFT') {
    throw conflict('This application has not been submitted yet.');
  }

  if (params.decision === 'REJECT') {
    const reason = params.reason?.trim();
    // A rejection without a reason leaves the applicant with no way forward.
    if (!reason) throw new AppError('A rejection reason is required.', 400);

    const rejected = await prisma.providerApplication.update({
      where: { id: application.id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
        reviewedByUserId: params.adminUserId,
        reviewedAt: new Date(),
      },
      include: { documents: true },
    });

    await recordAudit({
      actorUserId: params.adminUserId,
      action: 'application.rejected',
      entityType: 'ProviderApplication',
      entityId: application.id,
      metadata: { type: application.type, reason },
      ipAddress: params.ipAddress ?? null,
    });

    await notify({
      userId: application.userId,
      type: 'APPLICATION_REJECTED',
      title: 'Application needs changes',
      body: reason,
      data: { applicationId: application.id, type: application.type },
    });

    return publicApplication(rejected);
  }

  const role = ROLE_FOR_TYPE[application.type];

  const approved = await prisma.$transaction(async (tx) => {
    switch (application.type) {
      case 'DOCTOR':
        await tx.doctor.upsert({
          where: { userId: application.userId },
          update: {
            name: application.displayName,
            specialty: application.specialty ?? 'General Physician',
            qualification: application.qualification,
            experienceYears: application.experienceYears ?? 0,
            consultationFee: application.consultationFee ?? 0,
            clinicAddress: application.address,
            councilRegistrationNumber: application.councilRegistrationNumber,
            councilName: application.councilName,
            hprId: application.hprId,
            verifiedAt: new Date(),
          },
          create: {
            userId: application.userId,
            name: application.displayName,
            specialty: application.specialty ?? 'General Physician',
            qualification: application.qualification,
            experienceYears: application.experienceYears ?? 0,
            consultationFee: application.consultationFee ?? 0,
            clinicAddress: application.address,
            councilRegistrationNumber: application.councilRegistrationNumber,
            councilName: application.councilName,
            hprId: application.hprId,
            verifiedAt: new Date(),
          },
        });
        break;

      case 'PHARMACY':
        await tx.pharmacy.upsert({
          where: { userId: application.userId },
          update: {
            name: application.displayName,
            address: application.address,
            city: application.city,
            state: application.state,
            pincode: application.pincode,
            latitude: application.latitude,
            longitude: application.longitude,
            drugLicenceNumber: application.drugLicenceNumber,
            drugLicenceExpiry: application.drugLicenceExpiry,
            gstin: application.gstin,
            pharmacistName: application.pharmacistName,
            hfrId: application.hfrId,
            isActive: true,
            verifiedAt: new Date(),
          },
          create: {
            userId: application.userId,
            name: application.displayName,
            address: application.address,
            city: application.city,
            state: application.state,
            pincode: application.pincode,
            latitude: application.latitude,
            longitude: application.longitude,
            drugLicenceNumber: application.drugLicenceNumber,
            drugLicenceExpiry: application.drugLicenceExpiry,
            gstin: application.gstin,
            pharmacistName: application.pharmacistName,
            hfrId: application.hfrId,
            verifiedAt: new Date(),
          },
        });
        break;

      case 'LAB':
        await tx.labPartner.upsert({
          where: { userId: application.userId },
          update: {
            name: application.displayName,
            location: application.city ?? application.address,
            address: application.address,
            city: application.city,
            state: application.state,
            pincode: application.pincode,
            latitude: application.latitude,
            longitude: application.longitude,
            labRegistrationNumber: application.labRegistrationNumber,
            nablAccredited: application.nablAccredited,
            nablCertNumber: application.nablCertNumber,
            nablExpiry: application.nablExpiry,
            homeCollection: application.homeCollection,
            hfrId: application.hfrId,
            isActive: true,
            verifiedAt: new Date(),
          },
          create: {
            userId: application.userId,
            name: application.displayName,
            location: application.city ?? application.address,
            address: application.address,
            city: application.city,
            state: application.state,
            pincode: application.pincode,
            latitude: application.latitude,
            longitude: application.longitude,
            labRegistrationNumber: application.labRegistrationNumber,
            nablAccredited: application.nablAccredited,
            nablCertNumber: application.nablCertNumber,
            nablExpiry: application.nablExpiry,
            homeCollection: application.homeCollection,
            hfrId: application.hfrId,
            verifiedAt: new Date(),
          },
        });
        break;
    }

    await tx.user.update({ where: { id: application.userId }, data: { role } });

    return tx.providerApplication.update({
      where: { id: application.id },
      data: {
        status: 'APPROVED',
        reviewedByUserId: params.adminUserId,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
      include: { documents: true },
    });
  });

  await recordAudit({
    actorUserId: params.adminUserId,
    action: 'application.approved',
    entityType: 'ProviderApplication',
    entityId: application.id,
    metadata: { type: application.type, grantedRole: role, subjectUserId: application.userId },
    ipAddress: params.ipAddress ?? null,
  });

  logger.info(
    `[applications] ${params.adminUserId} granted ${role} to user ${application.userId} via application ${application.id}`
  );

  await notify({
    userId: application.userId,
    type: 'APPLICATION_APPROVED',
    title: 'You are verified',
    body: `${application.displayName} has been approved. Sign in again to access your dashboard.`,
    data: { applicationId: application.id, type: application.type, role },
  });

  return publicApplication(approved);
};

/**
 * Licences that have lapsed. An expired drug licence means the partner is no
 * longer legally permitted to dispense, so this drives both an admin warning
 * and automatic suspension.
 */
export const findExpiringLicencesService = async (withinDays = 30) => {
  const threshold = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);

  const [pharmacies, labs] = await Promise.all([
    prisma.pharmacy.findMany({
      where: { drugLicenceExpiry: { not: null, lte: threshold } },
      select: {
        id: true,
        name: true,
        isActive: true,
        drugLicenceNumber: true,
        drugLicenceExpiry: true,
        user: { select: { id: true, phoneNumber: true } },
      },
      orderBy: { drugLicenceExpiry: 'asc' },
    }),
    prisma.labPartner.findMany({
      where: { nablExpiry: { not: null, lte: threshold } },
      select: {
        id: true,
        name: true,
        isActive: true,
        nablCertNumber: true,
        nablExpiry: true,
        user: { select: { id: true, phoneNumber: true } },
      },
      orderBy: { nablExpiry: 'asc' },
    }),
  ]);

  const now = new Date();
  return {
    pharmacies: pharmacies.map((p) => ({
      ...p,
      expired: p.drugLicenceExpiry ? p.drugLicenceExpiry < now : false,
    })),
    labs: labs.map((l) => ({ ...l, expired: l.nablExpiry ? l.nablExpiry < now : false })),
  };
};

/** Suspends every partner whose licence has lapsed. Safe to run repeatedly. */
export const suspendExpiredLicencesService = async () => {
  const now = new Date();
  const suspended = await prisma.pharmacy.updateMany({
    where: { isActive: true, drugLicenceExpiry: { not: null, lt: now } },
    data: { isActive: false },
  });

  if (suspended.count > 0) {
    logger.warn(`[licences] suspended ${suspended.count} pharmacy account(s) with expired licences`);
  }
  return { suspendedPharmacies: suspended.count };
};
