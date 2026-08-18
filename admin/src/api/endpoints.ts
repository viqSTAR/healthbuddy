import { api, API_BASE_URL } from './client';

export type Role = 'PATIENT' | 'DOCTOR' | 'LAB_PARTNER' | 'PHARMACY' | 'DELIVERY_AGENT' | 'ADMIN';
export type ApplicationType = 'DOCTOR' | 'PHARMACY' | 'LAB';
export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

export interface DocumentRef {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ProviderApplication {
  id: string;
  userId: string;
  type: ApplicationType;
  status: ApplicationStatus;
  displayName: string;
  contactEmail: string | null;
  address: string;
  city: string | null;
  state: string | null;
  pincode: string | null;
  hprId: string | null;
  hfrId: string | null;
  registryVerified: boolean;

  councilRegistrationNumber: string | null;
  councilName: string | null;
  qualification: string | null;
  specialty: string | null;
  experienceYears: number | null;
  consultationFee: number | null;

  drugLicenceNumber: string | null;
  drugLicenceExpiry: string | null;
  gstin: string | null;
  pharmacistName: string | null;
  pharmacistRegNumber: string | null;

  labRegistrationNumber: string | null;
  nablAccredited: boolean;
  nablCertNumber: string | null;
  nablExpiry: string | null;
  homeCollection: boolean;

  documents: DocumentRef[];
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; phoneNumber: string; role: Role };
}

export interface AdminStats {
  totalPatients: number;
  totalDoctors: number;
  totalPharmacies: number;
  totalLabs: number;
  appointmentsToday: number;
  completedThisMonth: number;
  activeEmergencies: number;
  pendingMedicineOrders: number;
  pendingLabOrders: number;
  medicineRevenue: number;
  generatedAt: string;
}

export interface AdminUser {
  id: string;
  phoneNumber: string;
  role: Role;
  isVerified: boolean;
  isSuspended: boolean;
  createdAt: string;
  patient?: { fullName: string } | null;
  doctor?: { name: string; specialty: string } | null;
  pharmacy?: { name: string; isActive: boolean; drugLicenceExpiry: string | null } | null;
  labPartner?: { name: string; isActive: boolean } | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  actor: { id: string; phoneNumber: string; role: Role } | null;
}

export interface ExpiringLicences {
  pharmacies: {
    id: string;
    name: string;
    isActive: boolean;
    drugLicenceNumber: string | null;
    drugLicenceExpiry: string | null;
    expired: boolean;
    user: { id: string; phoneNumber: string };
  }[];
  labs: {
    id: string;
    name: string;
    isActive: boolean;
    nablCertNumber: string | null;
    nablExpiry: string | null;
    expired: boolean;
    user: { id: string; phoneNumber: string };
  }[];
}

/* ---------- Auth ---------- */

export const sendOtp = async (phoneNumber: string) =>
  (await api.post<{ phoneNumber: string; devOtp?: string }>('/auth/send-otp', { phoneNumber })).data;

export const verifyOtp = async (phoneNumber: string, otp: string) =>
  (
    await api.post<{
      user: { id: string; phoneNumber: string; role: Role; fullName: string | null };
      tokens: { accessToken: string; refreshToken: string };
    }>('/auth/verify-otp', { phoneNumber, otp })
  ).data;

/** No argument: the browser sends the httpOnly refresh cookie itself. */
export const refreshSession = async () =>
  (
    await api.post<{
      user: { id: string; phoneNumber: string; role: Role; fullName: string | null };
      tokens: { accessToken: string; refreshToken: string };
    }>('/auth/refresh', {})
  ).data;

/** Drops the refresh cookie server-side; the access token is discarded locally. */
export const endSession = async () => (await api.post('/auth/logout', {})).data;

/* ---------- Stats ---------- */

export const fetchStats = async () =>
  (await api.get<{ stats: AdminStats }>('/admin/stats')).data.stats;

/* ---------- Applications ---------- */

export const fetchApplications = async (params?: {
  status?: ApplicationStatus;
  type?: ApplicationType;
  page?: number;
  limit?: number;
}) =>
  (await api.get<{ applications: ProviderApplication[]; total: number }>('/applications', { params }))
    .data;

export const fetchApplication = async (id: string) =>
  (await api.get<{ application: ProviderApplication }>(`/applications/${id}`)).data.application;

export const claimApplication = async (id: string) =>
  (await api.post<{ application: ProviderApplication }>(`/applications/${id}/claim`)).data
    .application;

export const reviewApplication = async (
  id: string,
  decision: 'APPROVE' | 'REJECT',
  reason?: string
) =>
  (
    await api.post<{ application: ProviderApplication }>(`/applications/${id}/review`, {
      decision,
      reason,
    })
  ).data.application;

export const fetchExpiringLicences = async (withinDays = 60) =>
  (await api.get<ExpiringLicences>('/applications/licences/expiring', { params: { withinDays } }))
    .data;

/* ---------- Users ---------- */

export const fetchUsers = async (params?: { role?: Role; page?: number; limit?: number }) =>
  (await api.get<{ users: AdminUser[]; total: number }>('/admin/users', { params })).data;

export const setUserSuspended = async (id: string, suspended: boolean, reason?: string) =>
  (await api.patch<{ user: AdminUser }>(`/admin/users/${id}/suspension`, { suspended, reason })).data
    .user;

/* ---------- Audit ---------- */

/** Action kinds actually present in the log, with how many of each. */
export const fetchAuditActions = async () =>
  (await api.get<{ actions: { action: string; count: number }[] }>('/admin/audit/actions')).data
    .actions;

export const fetchAuditLogs = async (params?: {
  entityType?: string;
  action?: string;
  page?: number;
  limit?: number;
}) => (await api.get<{ logs: AuditEntry[]; total: number }>('/admin/audit', { params })).data;

/* ---------- Documents ---------- */

/**
 * Documents are private: the API serves them only after an authorisation check.
 * A short-lived signed link is minted here because an <img> tag cannot send an
 * Authorization header.
 */
export const documentUrl = async (documentId: string): Promise<string> => {
  const { link } = (
    await api.post<{ link: { url: string; token: string; expiresAt: number } }>(
      `/files/${documentId}/link`
    )
  ).data;

  const origin = API_BASE_URL.replace(/\/api\/v1$/, '');
  return `${origin}${link.url}`;
};

/* ---------- Lab pricing by area ---------- */

export interface LabPackageRow {
  id: string;
  testName: string;
  category: string;
  price: number;
  sampleType: string;
}

export const fetchLabPackages = async () =>
  (await api.get<{ packages: LabPackageRow[] }>('/labs/packages', { params: { limit: 100 } })).data
    .packages;

export interface TestPriceBand {
  id: string;
  labPackageId: string;
  testName: string;
  category: string;
  cataloguePrice: number;
  state: string;
  city: string;
  /** Human-readable scope, e.g. "Mumbai, Maharashtra" or "All of India". */
  scope: string;
  price: number;
  homeCollectionFee: number;
  isActive: boolean;
  note: string | null;
  updatedAt: string;
}

export const fetchTestPrices = async (labPackageId?: string) =>
  (
    await api.get<{ prices: TestPriceBand[] }>('/inventory/test-prices', {
      params: labPackageId ? { labPackageId } : undefined,
    })
  ).data.prices;

export const upsertTestPrice = async (payload: {
  labPackageId: string;
  state?: string;
  city?: string;
  price: number;
  homeCollectionFee?: number;
  isActive?: boolean;
  note?: string;
}) => (await api.put<{ price: TestPriceBand }>('/inventory/test-prices', payload)).data.price;

export const removeTestPrice = async (id: string) =>
  (await api.delete(`/inventory/test-prices/${id}`)).data;

/* ---------- Stock oversight ---------- */

export type StockMovementReason =
  | 'PURCHASE'
  | 'CORRECTION'
  | 'SALE_ONLINE'
  | 'SALE_OFFLINE'
  | 'RETURN'
  | 'EXPIRED'
  | 'DAMAGED'
  | 'ORDER_CANCELLED';

export interface StockMovement {
  id: string;
  medicineId: string;
  medicineName: string;
  pharmacyId: string;
  pharmacyName: string;
  delta: number;
  reason: StockMovementReason;
  balanceAfter: number;
  note: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
  medicineOrderId: string | null;
  createdAt: string;
}

/** Every write-off across every pharmacy — the point is that they are visible. */
export const fetchStockMovements = async (params?: {
  pharmacyId?: string;
  reason?: StockMovementReason;
  page?: number;
  limit?: number;
}) =>
  (
    await api.get<{ movements: StockMovement[]; total: number }>('/inventory/admin/movements', {
      params,
    })
  ).data;

/* =================================================================== *
 * Operations
 *
 * One binding per admin endpoint. Types are written out rather than
 * inferred so a field the server stops sending becomes a compile error
 * here instead of `undefined` rendering as a blank cell.
 * =================================================================== */

export interface Paged {
  total: number;
  page: number;
  limit: number;
}

export interface Overview {
  attention: {
    activeEmergencies: number;
    pendingApplications: number;
    failedWebhooks: number;
    expiringLicences: number;
    expiredFulfilments: number;
    abandonedCheckouts: number;
    lowStockLines: number;
    expiringStockLines: number;
    unverifiedRiders: number;
    parcelsAwaitingRider: number;
    consultsUnpaid: number;
  };
  people: {
    patients: number;
    doctors: number;
    pharmacies: number;
    labs: number;
    riders: number;
    ridersOnShift: number;
    suspended: number;
    signupsThisWeek: number;
  };
  operations: {
    appointmentsToday: number;
    consultsInProgress: number;
    consultsThisMonth: number;
    ordersAwaitingPharmacy: number;
    ordersInDelivery: number;
    labOrdersOpen: number;
  };
  money: {
    grossPaidThisMonth: number;
    platformFeeThisMonth: number;
    partnerShareThisMonth: number;
    paidCountThisMonth: number;
    codOutstanding: number;
    codOutstandingCount: number;
    refundedThisMonth: number;
    unsettledSplitAmount: number;
    unsettledSplitCount: number;
  };
  generatedAt: string;
}

export const fetchOverview = async () =>
  (await api.get<{ overview: Overview }>('/admin/overview')).data.overview;

/* ---------- Patients ---------- */

export interface PatientRow {
  id: string;
  fullName: string;
  age: number | null;
  gender: string | null;
  bloodGroup: string | null;
  address: string | null;
  createdAt: string;
  user: { id: string; phoneNumber: string; isSuspended: boolean; createdAt: string };
  _count: { appointments: number; medicineOrders: number; labOrders: number };
}

export const fetchPatients = async (params?: { search?: string; page?: number; limit?: number }) =>
  (await api.get<{ patients: PatientRow[] } & Paged>('/admin/patients', { params })).data;

export interface PatientDetail {
  patient: PatientRow & {
    userId: string;
    email: string | null;
    emergencyContact: string | null;
    allergies: string | null;
    chronicConditions: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  appointments: {
    id: string;
    type: string;
    status: string;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
    doctor: { id: string; name: string; specialty: string };
    slot: { date: string; startTime: string };
  }[];
  medicineOrders: {
    id: string;
    status: string;
    totalAmount: number;
    deliveryFee: number;
    createdAt: string;
    deliveredAt: string | null;
    pharmacy: { id: string; name: string } | null;
  }[];
  labOrders: {
    id: string;
    testName: string;
    status: string;
    price: number;
    createdAt: string;
    completedAt: string | null;
    labPartner: { id: string; name: string } | null;
  }[];
  payments: {
    id: string;
    purpose: string;
    method: string;
    amount: number;
    status: string;
    refundedAmount: number;
    paidAt: string | null;
    createdAt: string;
  }[];
  emergencies: {
    id: string;
    status: string;
    note: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }[];
  totals: { lifetimeValue: number };
}

export const fetchPatient = async (id: string) =>
  (await api.get<PatientDetail>(`/admin/patients/${id}`)).data;

/* ---------- Doctors ---------- */

export interface DoctorRow {
  id: string;
  name: string;
  specialty: string;
  qualification: string | null;
  experienceYears: number;
  consultationFee: number;
  commissionPercent: number | null;
  rating: number;
  isAvailable: boolean;
  verifiedAt: string | null;
  councilRegistrationNumber: string | null;
  payoutAccountId: string | null;
  createdAt: string;
  user: { id: string; phoneNumber: string; isSuspended: boolean };
  _count: { appointments: number; prescriptions: number; slots: number };
}

export const fetchDoctors = async (params?: {
  search?: string;
  specialty?: string;
  state?: 'AVAILABLE' | 'OFFLINE' | 'SUSPENDED' | 'UNVERIFIED';
  page?: number;
  limit?: number;
}) => (await api.get<{ doctors: DoctorRow[] } & Paged>('/admin/doctors', { params })).data;

export interface DoctorDetail {
  doctor: DoctorRow & { userId: string; about: string | null; clinicAddress: string | null; hprId: string | null; councilName: string | null };
  application: { id: string; status: string; submittedAt: string | null; reviewedAt: string | null } | null;
  upcomingSlots: number;
  appointmentsByStatus: Record<string, number>;
  recentAppointments: {
    id: string;
    type: string;
    status: string;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
    patient: { id: string; fullName: string };
    slot: { date: string; startTime: string };
  }[];
  earnings: { total: number; legs: number };
}

export const fetchDoctor = async (id: string) =>
  (await api.get<DoctorDetail>(`/admin/doctors/${id}`)).data;

export const updateDoctor = async (
  id: string,
  patch: {
    isAvailable?: boolean;
    consultationFee?: number;
    commissionPercent?: number | null;
    verified?: boolean;
    payoutAccountId?: string | null;
    reason?: string;
  }
) => (await api.patch<{ doctor: DoctorRow }>(`/admin/doctors/${id}`, patch)).data.doctor;

/* ---------- Pharmacies ---------- */

export interface PharmacyRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  pincode: string | null;
  address: string;
  isActive: boolean;
  verifiedAt: string | null;
  deliveryRadiusKm: number;
  commissionPercent: number | null;
  payoutAccountId: string | null;
  drugLicenceNumber: string | null;
  drugLicenceExpiry: string | null;
  gstin: string | null;
  createdAt: string;
  user: { id: string; phoneNumber: string; isSuspended: boolean };
  _count: { orders: number; inventory: number };
}

export const fetchPharmacies = async (params?: {
  search?: string;
  state?: 'ACTIVE' | 'INACTIVE' | 'LICENCE_EXPIRING' | 'UNVERIFIED';
  page?: number;
  limit?: number;
}) => (await api.get<{ pharmacies: PharmacyRow[] } & Paged>('/admin/pharmacies', { params })).data;

export interface PharmacyDetail {
  pharmacy: PharmacyRow & { userId: string; pharmacistName: string | null; hfrId: string | null };
  ordersByStatus: { status: string; count: number; amount: number }[];
  lifetimeRevenue: number;
  earnings: { total: number; legs: number };
  inventory: { lowStockLines: number; expiringLines: number };
  recentOrders: {
    id: string;
    status: string;
    totalAmount: number;
    createdAt: string;
    deliveredAt: string | null;
    patient: { id: string; fullName: string };
  }[];
  writeOffs: { reason: StockMovementReason; count: number; units: number }[];
}

export const fetchPharmacy = async (id: string) =>
  (await api.get<PharmacyDetail>(`/admin/pharmacies/${id}`)).data;

export const updatePharmacy = async (
  id: string,
  patch: {
    isActive?: boolean;
    deliveryRadiusKm?: number;
    commissionPercent?: number | null;
    verified?: boolean;
    payoutAccountId?: string | null;
    drugLicenceNumber?: string | null;
    drugLicenceExpiry?: string | null;
    reason?: string;
  }
) => (await api.patch<{ pharmacy: PharmacyRow }>(`/admin/pharmacies/${id}`, patch)).data.pharmacy;

export interface InventoryLine {
  id: string;
  price: number;
  stock: number;
  reserved: number;
  available: number;
  reorderLevel: number;
  isActive: boolean;
  batchNumber: string | null;
  expiryDate: string | null;
  updatedAt: string;
  medicine: {
    id: string;
    name: string;
    category: string;
    schedule: string;
    requiresPrescription: boolean;
  };
}

export const fetchPharmacyInventory = async (
  id: string,
  params?: { search?: string; only?: 'LOW' | 'EXPIRING' | 'OUT'; page?: number; limit?: number }
) =>
  (await api.get<{ lines: InventoryLine[] } & Paged>(`/admin/pharmacies/${id}/inventory`, { params }))
    .data;

/* ---------- Labs ---------- */

export interface LabRow {
  id: string;
  name: string;
  location: string;
  city: string | null;
  state: string | null;
  pincode: string | null;
  isActive: boolean;
  verifiedAt: string | null;
  homeCollection: boolean;
  nablAccredited: boolean;
  nablCertNumber: string | null;
  nablExpiry: string | null;
  labRegistrationNumber: string | null;
  commissionPercent: number | null;
  payoutAccountId: string | null;
  createdAt: string;
  user: { id: string; phoneNumber: string; isSuspended: boolean };
  _count: { labOrders: number; offerings: number };
}

export const fetchLabs = async (params?: {
  search?: string;
  state?: 'ACTIVE' | 'INACTIVE' | 'NABL' | 'UNVERIFIED';
  page?: number;
  limit?: number;
}) => (await api.get<{ labs: LabRow[] } & Paged>('/admin/labs', { params })).data;

export interface LabDetail {
  lab: LabRow & { userId: string; address: string | null; hfrId: string | null };
  ordersByStatus: { status: string; count: number; amount: number }[];
  lifetimeRevenue: number;
  earnings: { total: number; legs: number };
  offerings: {
    id: string;
    turnaroundHours: number;
    isActive: boolean;
    updatedAt: string;
    labPackage: { id: string; testName: string; category: string; price: number; sampleType: string };
  }[];
  recentOrders: {
    id: string;
    testName: string;
    status: string;
    price: number;
    createdAt: string;
    completedAt: string | null;
    patient: { id: string; fullName: string };
  }[];
}

export const fetchLab = async (id: string) => (await api.get<LabDetail>(`/admin/labs/${id}`)).data;

export const updateLab = async (
  id: string,
  patch: {
    isActive?: boolean;
    homeCollection?: boolean;
    commissionPercent?: number | null;
    verified?: boolean;
    payoutAccountId?: string | null;
    nablAccredited?: boolean;
    nablCertNumber?: string | null;
    nablExpiry?: string | null;
    reason?: string;
  }
) => (await api.patch<{ lab: LabRow }>(`/admin/labs/${id}`, patch)).data.lab;

export const setLabOffering = async (offeringId: string, isActive: boolean, reason?: string) =>
  (await api.patch(`/admin/lab-offerings/${offeringId}`, { isActive, ...(reason ? { reason } : {}) }))
    .data;

/* ---------- Appointments ---------- */

export interface AppointmentRow {
  id: string;
  type: 'VIDEO' | 'IN_PERSON';
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  isFollowUp: boolean;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  hasRoom: boolean;
  patient: { id: string; fullName: string; user: { phoneNumber: string } };
  doctor: { id: string; name: string; specialty: string; consultationFee: number };
  slot: { date: string; startTime: string; endTime: string };
  payment: { id: string; status: string; amount: number; method: string } | null;
  prescription: { id: string; createdAt: string } | null;
}

export const fetchAppointments = async (params?: {
  status?: string;
  type?: string;
  doctorId?: string;
  patientId?: string;
  search?: string;
  page?: number;
  limit?: number;
}) => (await api.get<{ appointments: AppointmentRow[] } & Paged>('/admin/appointments', { params })).data;

/* ---------- Medicine orders ---------- */

/** A rider as the panel shows them: a name first, a number to ring second. */
export interface Rider {
  /** The USER id — what an assignment stores. */
  id: string;
  name: string | null;
  phoneNumber: string;
  vehicleNumber: string | null;
  parcels: number;
}

/** Where a rider was last seen. Coordinates are operations-only, by design. */
export interface LastSeen {
  latitude: number;
  longitude: number;
  at: string | null;
  /** The name their phone resolved for those coordinates, when it could. */
  place: string | null;
  street: string | null;
}

/** One shop's part of an order — the unit a rider actually carries. */
export interface Parcel {
  id: string;
  status: string;
  pharmacy: string;
  rider: Omit<Rider, 'parcels'> | null;
  lastSeen: LastSeen | null;
  trail: { place: string; street: string | null; latitude: number; longitude: number; at: string }[];
  nearlyThere: boolean;
}

export interface PaymentBrief {
  id: string;
  status: string;
  method: string;
  amount: number;
  paidAt: string | null;
}

export interface OrderRow {
  id: string;
  status: string;
  totalAmount: number;
  deliveryFee: number;
  address: string;
  createdAt: string;
  acceptedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancelReason: string | null;
  patient: { id: string; fullName: string; user: { phoneNumber: string } };
  pharmacy: { id: string; name: string; city: string | null } | null;
  payment: PaymentBrief | null;
  /** True when the payment covers a whole prescription basket, not this order. */
  paidAsBasket: boolean;
  /**
   * Who is carrying it, read off the parcels — an order filled by two shops has
   * two riders, so there is no single answer and the API does not pretend one.
   */
  riders: Rider[];
  shipments: Parcel[];
}

export const fetchOrders = async (params?: {
  status?: string;
  pharmacyId?: string;
  patientId?: string;
  unassigned?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}) =>
  (
    await api.get<{ orders: OrderRow[]; matchedValue: number } & Paged>('/admin/orders', {
      params: { ...params, ...(params?.unassigned ? { unassigned: 'true' } : {}) },
    })
  ).data;

export interface OrderDetail {
  order: OrderRow & {
    items: { medicineId?: string; name?: string; quantity: number; price?: number }[];
    latitude: number | null;
    longitude: number | null;
    prescriptionId: string | null;
    updatedAt: string;
    payment:
      | (PaymentBrief & {
          platformFee: number;
          refundedAmount: number;
          refundReason: string | null;
          gateway: string | null;
          splits: {
            id: string;
            payeeType: string;
            payeeId: string | null;
            amount: number;
            status: string;
            settledAt: string | null;
          }[];
        })
      | null;
  };
  stockMovements: {
    id: string;
    delta: number;
    reason: StockMovementReason;
    balanceAfter: number;
    medicineId: string;
    createdAt: string;
  }[];
}

export const fetchOrder = async (id: string) =>
  (await api.get<OrderDetail>(`/admin/orders/${id}`)).data;

export const cancelOrder = async (id: string, reason: string) =>
  (await api.post<{ order: OrderRow }>(`/admin/orders/${id}/cancel`, { reason })).data.order;

/**
 * Hands over the parcels, not the order.
 *
 * Without `shipmentId` every open parcel goes to that rider, which is what an
 * operator means for a single-shop order; pass one to split an order between
 * two riders.
 */
export const assignOrderAgent = async (
  id: string,
  agentUserId: string | null,
  shipmentId?: string
) =>
  (
    await api.post<{ order: OrderRow }>(`/admin/orders/${id}/agent`, {
      agentUserId,
      ...(shipmentId ? { shipmentId } : {}),
    })
  ).data.order;

/* ---------- Lab orders ---------- */

export interface LabOrderRow {
  id: string;
  testName: string;
  status: string;
  price: number;
  address: string | null;
  scheduledAt: string | null;
  collectedAt: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  patient: { id: string; fullName: string; user: { phoneNumber: string } };
  labPartner: { id: string; name: string; city: string | null } | null;
  assignedAgent: { id: string; phoneNumber: string; role: Role } | null;
  payment: PaymentBrief | null;
  _count: { documents: number };
}

export const fetchLabOrders = async (params?: {
  status?: string;
  labPartnerId?: string;
  patientId?: string;
  unassigned?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}) =>
  (
    await api.get<{ labOrders: LabOrderRow[] } & Paged>('/admin/lab-orders', {
      params: { ...params, ...(params?.unassigned ? { unassigned: 'true' } : {}) },
    })
  ).data;

/* ---------- Deliveries ---------- */

export type DeliveryStage = 'PLACED' | 'ACCEPTED' | 'PROCESSING' | 'DISPATCHED';

export interface DeliveryJob extends OrderRow {
  minutesInStage: number;
  stalled: boolean;
  /** Each parcel with its own rider and its own last known position. */
  parcels: Parcel[];
  /** Packed parcels nobody has taken. */
  awaitingRider: number;
}

export interface DeliveryBoard {
  lanes: Record<DeliveryStage, DeliveryJob[]>;
  sampleRuns: {
    id: string;
    testName: string;
    status: string;
    address: string | null;
    scheduledAt: string | null;
    createdAt: string;
    patient: { id: string; fullName: string; user: { phoneNumber: string } };
    labPartner: { id: string; name: string } | null;
    assignedAgent: { id: string; phoneNumber: string } | null;
  }[];
  /** Riders on shift or holding a parcel, and where each of them is. */
  fleet: {
    id: string;
    name: string;
    phoneNumber: string;
    vehicleNumber: string | null;
    onShift: boolean;
    parcels: number;
    carrying: number;
    oldestMinutes: number;
    lastSeen: LastSeen | null;
  }[];
  unassigned: number;
  stalled: number;
  idleRiders: number;
}

export const fetchDeliveryBoard = async (params?: { pharmacyId?: string; agentUserId?: string }) =>
  (await api.get<{ board: DeliveryBoard }>('/admin/deliveries', { params })).data.board;

/** A rider the dispatch board may hand an order to. Verified and active only. */
export interface AssignableAgent {
  /** The USER id, which is what an assignment stores. */
  id: string;
  phoneNumber: string;
  name: string;
  vehicleNumber: string | null;
  onShift: boolean;
  /** Set when this rider may also collect samples, and for which lab. */
  collectsFor: { id: string; name: string } | null;
  openWork: number;
}

export const fetchAgents = async (search?: string) =>
  (
    await api.get<{ agents: AssignableAgent[] }>('/admin/agents/assignable', {
      params: search ? { search } : undefined,
    })
  ).data.agents;

/* ---------- Delivery agent roster ---------- */

/**
 * Agents sign themselves up and cannot take a single job until verified —
 * taking one is what discloses a patient's address — so this list is a work
 * queue before it is a directory.
 */
export interface AgentRow {
  id: string;
  name: string;
  vehicleNumber: string | null;
  isActive: boolean;
  isAvailable: boolean;
  verifiedAt: string | null;
  createdAt: string;
  user: { id: string; phoneNumber: string; isSuspended: boolean };
  labPartner: { id: string; name: string } | null;
  serviceAreas: string[];
}

export const fetchAgentRoster = async (params?: {
  page?: number;
  limit?: number;
  search?: string;
  state?: 'UNVERIFIED' | 'ACTIVE' | 'INACTIVE' | 'ON_SHIFT';
}) => (await api.get<{ agents: AgentRow[] } & Paged>('/admin/agents', { params })).data;

export const updateAgent = async (
  id: string,
  patch: { verified?: boolean; isActive?: boolean; labPartnerId?: string | null; reason?: string }
) => (await api.patch<{ agent: AgentRow }>(`/admin/agents/${id}`, patch)).data.agent;

/* ---------- Payments ---------- */

export interface PaymentRow {
  id: string;
  purpose: string;
  method: string;
  amount: number;
  platformFee: number;
  status: string;
  gateway: string | null;
  gatewayPaymentId: string | null;
  refundedAmount: number;
  paidAt: string | null;
  createdAt: string;
  user: { id: string; phoneNumber: string; role: Role };
  _count: { splits: number };
}

export const fetchPayments = async (params?: {
  status?: string;
  purpose?: string;
  method?: string;
  search?: string;
  page?: number;
  limit?: number;
}) =>
  (
    await api.get<
      { payments: PaymentRow[]; totals: { collected: number; platformFee: number; refunded: number } } & Paged
    >('/admin/payments', { params })
  ).data;

export interface PaymentDetail {
  payment: PaymentRow & {
    currency: string;
    gatewayOrderId: string | null;
    gatewayTransferId: string | null;
    failureReason: string | null;
    refundedAt: string | null;
    refundReason: string | null;
    idempotencyKey: string | null;
    splits: {
      id: string;
      payeeType: string;
      payeeId: string | null;
      payeeName: string | null;
      payoutAccountId: string | null;
      amount: number;
      status: string;
      gatewayTransferId: string | null;
      settledAt: string | null;
    }[];
    appointment: { id: string; status: string; doctor: { id: string; name: string }; patient: { id: string; fullName: string } } | null;
    medicineOrder: { id: string; status: string; totalAmount: number; pharmacy: { id: string; name: string } | null } | null;
    labOrder: { id: string; status: string; testName: string; labPartner: { id: string; name: string } | null } | null;
    fulfilment: {
      id: string;
      status: string;
      medicineTotal: number;
      labTotal: number;
      deliveryFee: number;
      medicineOrders: { id: string; status: string }[];
      labOrders: { id: string; status: string; testName: string }[];
    } | null;
  };
  reconciliation: { charged: number; legTotal: number; difference: number; balanced: boolean };
}

export const fetchPayment = async (id: string) =>
  (await api.get<PaymentDetail>(`/admin/payments/${id}`)).data;

export interface WebhookEvent {
  id: string;
  gateway: string;
  eventId: string;
  eventType: string;
  processedAt: string | null;
  error: string | null;
  createdAt: string;
}

export const fetchWebhookEvents = async (params?: {
  onlyFailed?: boolean;
  page?: number;
  limit?: number;
}) =>
  (
    await api.get<{ events: WebhookEvent[] } & Paged>('/admin/webhooks', {
      params: { ...params, ...(params?.onlyFailed ? { onlyFailed: 'true' } : {}) },
    })
  ).data;

/* ---------- Catalogue ---------- */

export type DrugSchedule = 'OTC' | 'SCHEDULE_H' | 'SCHEDULE_H1' | 'SCHEDULE_X' | 'NARCOTIC';
export type TeleDrugList = 'LIST_O' | 'LIST_A' | 'LIST_B' | 'PROHIBITED';

export interface MedicineRow {
  id: string;
  name: string;
  category: string;
  price: number;
  composition: string | null;
  manufacturer: string | null;
  schedule: DrugSchedule;
  teleList: TeleDrugList;
  requiresPrescription: boolean;
  createdAt: string;
  _count: { inventory: number };
}

export const fetchMedicines = async (params?: {
  search?: string;
  schedule?: DrugSchedule;
  category?: string;
  page?: number;
  limit?: number;
}) => (await api.get<{ medicines: MedicineRow[] } & Paged>('/admin/medicines', { params })).data;

export interface MedicineInput {
  name: string;
  category: string;
  price: number;
  composition?: string | null;
  manufacturer?: string | null;
  description?: string | null;
  schedule: DrugSchedule;
  teleList: TeleDrugList;
  requiresPrescription: boolean;
}

export const saveMedicine = async (input: MedicineInput, id?: string) =>
  (
    await (id
      ? api.put<{ medicine: MedicineRow }>(`/admin/medicines/${id}`, input)
      : api.post<{ medicine: MedicineRow }>('/admin/medicines', input))
  ).data.medicine;

export interface LabPackageAdminRow {
  id: string;
  testName: string;
  category: string;
  price: number;
  sampleType: string;
  fastingReq: boolean;
  description: string | null;
  _count: { offerings: number; prices: number };
}

export const fetchLabPackagesAdmin = async (params?: {
  search?: string;
  page?: number;
  limit?: number;
}) =>
  (await api.get<{ packages: LabPackageAdminRow[] } & Paged>('/admin/lab-packages', { params })).data;

export interface LabPackageInput {
  testName: string;
  category: string;
  price: number;
  sampleType: string;
  fastingReq: boolean;
  description?: string | null;
}

export const saveLabPackage = async (input: LabPackageInput, id?: string) =>
  (
    await (id
      ? api.put<{ labPackage: LabPackageAdminRow }>(`/admin/lab-packages/${id}`, input)
      : api.post<{ labPackage: LabPackageAdminRow }>('/admin/lab-packages', input))
  ).data.labPackage;
