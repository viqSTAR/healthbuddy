import { api, API_BASE_URL } from './client';

export type Role = 'PATIENT' | 'DOCTOR' | 'LAB_PARTNER' | 'PHARMACY' | 'ADMIN';
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

export const refreshSession = async (refreshToken: string) =>
  (
    await api.post<{
      user: { id: string; phoneNumber: string; role: Role; fullName: string | null };
      tokens: { accessToken: string; refreshToken: string };
    }>('/auth/refresh', { refreshToken })
  ).data;

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
