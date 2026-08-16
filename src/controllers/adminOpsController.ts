import type { Response } from 'express';
import {
  getAdminOverviewService,
  listPatientsService,
  getPatientService,
  listDoctorsService,
  getDoctorService,
  updateDoctorService,
  listPharmaciesService,
  getPharmacyService,
  updatePharmacyService,
  listAgentsService,
  updateAgentService,
  getPharmacyInventoryService,
  listLabsService,
  getLabService,
  updateLabService,
  setLabOfferingActiveService,
  listAppointmentsService,
  listMedicineOrdersService,
  getMedicineOrderService,
  cancelMedicineOrderService,
  listLabOrdersService,
  getDeliveryBoardService,
  assignDeliveryAgentService,
  listAssignableAgentsService,
  listPaymentsService,
  getPaymentService,
  listWebhookEventsService,
  listMedicinesService,
  upsertMedicineService,
  listLabPackagesAdminService,
  upsertLabPackageService,
} from '../services/adminOpsService.js';
import { asyncHandler, requireUser, type AuthenticatedRequest } from '../middlewares/auth.js';

/**
 * Thin handlers: every one of these validates through zod in the route, so the
 * casts below describe what validation already guaranteed rather than trusting
 * the client.
 */

type Q = Record<string, string | undefined> & { page: number; limit: number };

const q = (req: AuthenticatedRequest) => req.query as unknown as Q;

const ok = (res: Response, body: Record<string, unknown>) =>
  res.status(200).json({ success: true, ...body });

/** Optional query params are omitted rather than passed as undefined. */
const pick = <T extends Record<string, unknown>>(source: T, keys: (keyof T)[]) =>
  Object.fromEntries(keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));

/* ---------- Overview ---------- */

export const getOverviewHandler = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  ok(res, { overview: await getAdminOverviewService() });
});

/* ---------- Patients ---------- */

export const listPatientsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = q(req);
  ok(
    res,
    await listPatientsService({
      page: query.page,
      limit: query.limit,
      ...pick(query, ['search']),
    })
  );
});

export const getPatientHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await getPatientService(id));
});

/* ---------- Doctors ---------- */

export const listDoctorsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = q(req);
  ok(
    res,
    await listDoctorsService({
      page: query.page,
      limit: query.limit,
      ...(pick(query, ['search', 'specialty', 'state']) as { search?: string; specialty?: string }),
    })
  );
});

export const getDoctorHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await getDoctorService(id));
});

export const updateDoctorHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = requireUser(req);
  const { id } = req.params as { id: string };
  const { reason, ...patch } = req.body as { reason?: string } & Record<string, unknown>;

  const doctor = await updateDoctorService({
    actorUserId: actor.userId,
    id,
    patch,
    ...(reason ? { reason } : {}),
    ipAddress: req.ip ?? null,
  });

  ok(res, { doctor });
});

/* ---------- Pharmacies ---------- */

export const listPharmaciesHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = q(req);
    ok(
      res,
      await listPharmaciesService({
        page: query.page,
        limit: query.limit,
        ...(pick(query, ['search', 'state']) as { search?: string }),
      })
    );
  }
);

export const getPharmacyHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await getPharmacyService(id));
});

export const updatePharmacyHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const actor = requireUser(req);
    const { id } = req.params as { id: string };
    const { reason, ...patch } = req.body as { reason?: string } & Record<string, unknown>;

    const pharmacy = await updatePharmacyService({
      actorUserId: actor.userId,
      id,
      patch,
      ...(reason ? { reason } : {}),
      ipAddress: req.ip ?? null,
    });

    ok(res, { pharmacy });
  }
);

export const getPharmacyInventoryHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    const query = q(req);
    ok(
      res,
      await getPharmacyInventoryService({
        pharmacyId: id,
        page: query.page,
        limit: query.limit,
        ...(pick(query, ['search', 'only']) as { search?: string }),
      })
    );
  }
);

/* ---------- Labs ---------- */

export const listLabsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = q(req);
  ok(
    res,
    await listLabsService({
      page: query.page,
      limit: query.limit,
      ...(pick(query, ['search', 'state']) as { search?: string }),
    })
  );
});

export const getLabHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await getLabService(id));
});

export const updateLabHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = requireUser(req);
  const { id } = req.params as { id: string };
  const { reason, ...patch } = req.body as { reason?: string } & Record<string, unknown>;

  const lab = await updateLabService({
    actorUserId: actor.userId,
    id,
    patch,
    ...(reason ? { reason } : {}),
    ipAddress: req.ip ?? null,
  });

  ok(res, { lab });
});

export const setLabOfferingHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const actor = requireUser(req);
    const { offeringId } = req.params as { offeringId: string };
    const { isActive, reason } = req.body as { isActive: boolean; reason?: string };

    const offering = await setLabOfferingActiveService({
      actorUserId: actor.userId,
      offeringId,
      isActive,
      ...(reason ? { reason } : {}),
      ipAddress: req.ip ?? null,
    });

    ok(res, { offering });
  }
);

/* ---------- Appointments ---------- */

export const listAppointmentsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = q(req);
    ok(
      res,
      await listAppointmentsService({
        page: query.page,
        limit: query.limit,
        ...(pick(query, [
          'status',
          'type',
          'doctorId',
          'patientId',
          'search',
          'from',
          'to',
        ]) as Record<string, string>),
      })
    );
  }
);

/* ---------- Orders ---------- */

export const listOrdersHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = q(req) as unknown as Q & { unassigned?: boolean };
  ok(
    res,
    await listMedicineOrdersService({
      page: query.page,
      limit: query.limit,
      ...(query.unassigned ? { unassigned: true } : {}),
      ...(pick(query, ['status', 'pharmacyId', 'patientId', 'search']) as Record<string, string>),
    })
  );
});

export const getOrderHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  ok(res, await getMedicineOrderService(id));
});

export const cancelOrderHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = requireUser(req);
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason: string };

  const order = await cancelMedicineOrderService({
    actorUserId: actor.userId,
    id,
    reason,
    ipAddress: req.ip ?? null,
  });

  ok(res, { order });
});

export const listLabOrdersHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = q(req) as unknown as Q & { unassigned?: boolean };
    ok(
      res,
      await listLabOrdersService({
        page: query.page,
        limit: query.limit,
        ...(query.unassigned ? { unassigned: true } : {}),
        ...(pick(query, ['status', 'labPartnerId', 'patientId', 'search']) as Record<string, string>),
      })
    );
  }
);

/* ---------- Deliveries ---------- */

export const getDeliveryBoardHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = q(req);
    ok(res, {
      board: await getDeliveryBoardService(
        pick(query, ['pharmacyId', 'agentUserId']) as { pharmacyId?: string }
      ),
    });
  }
);

export const assignAgentHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = requireUser(req);
  const { id } = req.params as { id: string };
  const { agentUserId } = req.body as { agentUserId: string | null };

  const order = await assignDeliveryAgentService({
    actorUserId: actor.userId,
    orderId: id,
    agentUserId,
    ipAddress: req.ip ?? null,
  });

  ok(res, { order });
});

export const listAgentsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { search } = req.query as { search?: string };
  ok(res, { agents: await listAssignableAgentsService(search) });
});

/* ---------- Payments ---------- */

export const listPaymentsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = q(req);
  ok(
    res,
    await listPaymentsService({
      page: query.page,
      limit: query.limit,
      ...(pick(query, ['status', 'purpose', 'method', 'search', 'from', 'to']) as Record<
        string,
        string
      >),
    })
  );
});

export const getPaymentDetailHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    ok(res, await getPaymentService(id));
  }
);

export const listWebhookEventsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = q(req) as unknown as Q & { onlyFailed?: boolean };
    ok(
      res,
      await listWebhookEventsService({
        page: query.page,
        limit: query.limit,
        ...(query.onlyFailed ? { onlyFailed: true } : {}),
      })
    );
  }
);

/* ---------- Catalogue ---------- */

export const listMedicinesHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = q(req);
    ok(
      res,
      await listMedicinesService({
        page: query.page,
        limit: query.limit,
        ...(pick(query, ['search', 'schedule', 'category']) as Record<string, string>),
      })
    );
  }
);

export const upsertMedicineHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const actor = requireUser(req);
    const { id } = req.params as { id?: string };

    const medicine = await upsertMedicineService({
      actorUserId: actor.userId,
      ...(id ? { id } : {}),
      data: req.body as Parameters<typeof upsertMedicineService>[0]['data'],
      ipAddress: req.ip ?? null,
    });

    res.status(id ? 200 : 201).json({ success: true, medicine });
  }
);

export const listLabPackagesHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const query = q(req);
    ok(
      res,
      await listLabPackagesAdminService({
        page: query.page,
        limit: query.limit,
        ...pick(query, ['search']),
      })
    );
  }
);

export const upsertLabPackageHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const actor = requireUser(req);
    const { id } = req.params as { id?: string };

    const labPackage = await upsertLabPackageService({
      actorUserId: actor.userId,
      ...(id ? { id } : {}),
      data: req.body as Parameters<typeof upsertLabPackageService>[0]['data'],
      ipAddress: req.ip ?? null,
    });

    res.status(id ? 200 : 201).json({ success: true, labPackage });
  }
);

/* ---------- Delivery agents ---------- */

export const listAgentRosterHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = q(req);
  ok(
    res,
    await listAgentsService({
      page: query.page,
      limit: query.limit,
      ...(pick(query, ['search', 'state']) as { search?: string }),
    })
  );
});

export const updateAgentHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = requireUser(req);
  const { id } = req.params as { id: string };
  const { reason, ...patch } = req.body as { reason?: string } & Record<string, unknown>;

  const agent = await updateAgentService({
    actorUserId: actor.userId,
    id,
    patch,
    ...(reason ? { reason } : {}),
    ipAddress: req.ip ?? null,
  });

  ok(res, { agent });
});
