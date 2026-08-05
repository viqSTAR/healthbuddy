import { api, API_BASE_URL } from './api';

/* ---------- Shared shapes (mirror the backend response contracts) ---------- */

export type Role = 'PATIENT' | 'DOCTOR' | 'LAB_PARTNER' | 'PHARMACY' | 'ADMIN';
export type AppId = 'PATIENT' | 'DOCTOR' | 'PARTNER' | 'ADMIN';

export type DrugSchedule = 'OTC' | 'SCHEDULE_H' | 'SCHEDULE_H1' | 'SCHEDULE_X' | 'NARCOTIC';
export type TeleDrugList = 'LIST_O' | 'LIST_A' | 'LIST_B' | 'PROHIBITED';

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  qualification?: string | null;
  experienceYears: number;
  consultationFee: number;
  rating: number;
  about?: string | null;
  languages?: string | null;
  clinicAddress: string | null;
  isAvailable: boolean;
  councilRegistrationNumber?: string | null;
  councilName?: string | null;
  verifiedAt?: string | null;
  user?: { id: string; phoneNumber: string };
}

export interface Slot {
  id: string;
  doctorId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'AVAILABLE' | 'LOCKED' | 'BOOKED';
}

/** A slot as the doctor sees it — with whoever booked it attached. */
export interface ScheduleSlot extends Slot {
  appointment: {
    id: string;
    status: Appointment['status'];
    type: Appointment['type'];
    symptoms: string | null;
    isFollowUp: boolean;
    patient: { id: string; fullName: string; age: number | null; gender: string | null };
  } | null;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  slotId: string;
  type: 'VIDEO' | 'IN_PERSON';
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  symptoms: string | null;
  meetingRoomId: string | null;
  isFollowUp: boolean;
  createdAt: string;
  slot?: { date: string; startTime: string; endTime: string };
  doctor?: { id: string; name: string; specialty: string; consultationFee: number };
  patient?: { id: string; fullName: string };
  /** Condition photos the patient attached when booking. */
  documents?: DocumentRef[];
}

export interface Medicine {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  description: string | null;
  composition?: string | null;
  schedule: DrugSchedule;
  teleList: TeleDrugList;
  requiresPrescription: boolean;
}

/** A catalogue entry annotated for one appointment's telemedicine context. */
export interface PrescribableMedicine {
  id: string;
  name: string;
  category: string;
  composition: string | null;
  schedule: DrugSchedule;
  teleList: TeleDrugList;
  requiresPrescription: boolean;
  prescribable: boolean;
  reason?: string;
}

export interface InventoryItem {
  id: string;
  pharmacyId: string;
  medicineId: string;
  price: number;
  stock: number;
  reorderLevel: number;
  isActive: boolean;
  updatedAt: string;
  medicine: Medicine;
}

export interface LabOfferingItem {
  id: string;
  labPartnerId: string;
  labPackageId: string;
  price: number;
  homeCollectionFee: number;
  turnaroundHours: number;
  isActive: boolean;
  updatedAt: string;
  labPackage: LabPackage;
}

export interface OrderItem {
  medicineId: string;
  name: string;
  price: number;
  quantity: number;
  itemTotal: number;
}

export type OrderStatus =
  /** Held until the money arrives. Never appears in a partner queue. */
  | 'PENDING_PAYMENT'
  | 'PLACED'
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface MedicineOrder {
  id: string;
  patientId: string;
  pharmacyId: string | null;
  items: OrderItem[];
  totalAmount: number;
  deliveryFee: number;
  status: OrderStatus;
  address: string;
  prescriptionId: string | null;
  assignedAgentUserId: string | null;
  acceptedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  patient?: { id: string; fullName: string; emergencyContact?: string | null };
  assignedAgent?: { id: string; phoneNumber: string } | null;
  /**
   * Present on the partner queue. A rider needs to know whether to collect cash
   * before they leave, not after.
   */
  payment?: { method: PaymentMethod; status: PaymentStatus; amount: number } | null;
}

export interface LabPackage {
  id: string;
  testName: string;
  category: string;
  price: number;
  sampleType: string;
  fastingReq: boolean;
  description?: string | null;
}

export type LabOrderStatus =
  | 'PENDING_PAYMENT'
  | 'BOOKED'
  | 'ACCEPTED'
  | 'SAMPLE_COLLECTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED';

export interface LabOrder {
  id: string;
  patientId: string;
  labPartnerId: string | null;
  testName: string;
  price: number;
  status: LabOrderStatus;
  address: string | null;
  reportUrl: string | null;
  scheduledAt: string | null;
  collectedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  patient?: {
    id: string;
    fullName: string;
    age?: number | null;
    gender?: string | null;
    emergencyContact?: string | null;
  };
  documents?: DocumentRef[];
  assignedAgent?: { id: string; phoneNumber: string } | null;
}

export interface PatientProfile {
  id: string;
  fullName: string;
  email: string | null;
  age: number | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  bloodGroup: string | null;
  emergencyContact: string | null;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  allergies?: string | null;
  chronicConditions?: string | null;
  createdAt: string;
  user?: { phoneNumber: string; role: string };
}

export interface PrescriptionItem {
  id: string;
  medicineId: string | null;
  name: string;
  dosage: string;
  frequency: string;
  durationDays: number | null;
  instructions: string | null;
}

export interface Prescription {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  diagnosis: string;
  medicines: { name: string; dosage: string; frequency: string; durationDays?: number }[];
  items?: PrescriptionItem[];
  notes: string | null;
  advice: string | null;
  followUpDate: string | null;
  doctorRegistrationNumber: string | null;
  consultationMode: 'VIDEO' | 'IN_PERSON';
  wasFollowUp: boolean;
  createdAt: string;
  doctor?: { name: string; specialty: string; qualification?: string | null };
  patient?: { fullName: string; age: number | null; gender: string | null };
}

export interface EmergencySOS {
  id: string;
  patientId: string;
  latitude: number;
  longitude: number;
  status: 'RAISED' | 'DISPATCHED' | 'EN_ROUTE' | 'ARRIVED' | 'RESOLVED' | 'CANCELLED';
  createdAt: string;
  ambulanceControlContact?: string;
  patient?: {
    id: string;
    fullName: string;
    bloodGroup: string | null;
    emergencyContact: string | null;
  };
}

/* ---------- Onboarding & verification ---------- */

export type ApplicationType = 'DOCTOR' | 'PHARMACY' | 'LAB';
export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

export type DocumentKind =
  | 'DOCTOR_REGISTRATION_CERT'
  | 'DOCTOR_QUALIFICATION'
  | 'DRUG_LICENCE'
  | 'PHARMACIST_CERT'
  | 'LAB_REGISTRATION'
  | 'NABL_CERTIFICATE'
  | 'GST_CERTIFICATE'
  | 'SHOP_ESTABLISHMENT'
  | 'ID_PROOF'
  | 'PREMISES_PHOTO'
  | 'LAB_REPORT'
  | 'PRESCRIPTION_IMAGE'
  /** Photo of a visible complaint, attached to an appointment. */
  | 'CONDITION_PHOTO'
  | 'PROFILE_PHOTO';

export interface DocumentRef {
  id: string;
  kind: DocumentKind;
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
  latitude: number | null;
  longitude: number | null;
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

export type ApplicationDraft = Partial<
  Omit<ProviderApplication, 'id' | 'userId' | 'documents' | 'status' | 'createdAt' | 'updatedAt'>
> & { type: ApplicationType; displayName: string; address: string };

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
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

/* ---------- Doctors: public catalogue ---------- */

export const fetchDoctors = async (params?: { specialty?: string; query?: string }) =>
  (await api.get<{ doctors: Doctor[]; total: number }>('/doctors', { params })).data;

export const fetchDoctor = async (id: string) =>
  (await api.get<{ doctor: Doctor }>(`/doctors/${id}`)).data.doctor;

export const fetchDoctorSlots = async (id: string, date: string) =>
  (await api.get<{ slots: Slot[] }>(`/doctors/${id}/slots`, { params: { date } })).data.slots;

/* ---------- Doctors: own practice ---------- */

export const fetchMyDoctorProfile = async () =>
  (await api.get<{ doctor: Doctor }>('/doctors/me')).data.doctor;

export const updateMyDoctorProfile = async (payload: Partial<Doctor>) =>
  (await api.put<{ doctor: Doctor }>('/doctors/me', payload)).data.doctor;

export const fetchMySchedule = async (from?: string, to?: string) =>
  (await api.get<{ slots: ScheduleSlot[] }>('/doctors/me/schedule', { params: { from, to } })).data
    .slots;

export const createSlots = async (payload: {
  date: string;
  startTime: string;
  endTime: string;
  slotMinutes: number;
}) =>
  (
    await api.post<{ created: number; skipped: number; slots: Slot[] }>(
      '/doctors/me/slots',
      payload
    )
  ).data;

export const deleteSlot = async (slotId: string) =>
  (await api.delete(`/doctors/me/slots/${slotId}`)).data;

/* ---------- Appointments ---------- */

export const bookAppointment = async (payload: {
  doctorId: string;
  slotId: string;
  type: 'VIDEO' | 'IN_PERSON';
  symptoms?: string;
}) => (await api.post<{ appointment: Appointment }>('/appointments/book', payload)).data.appointment;

export const fetchMyAppointments = async () =>
  (await api.get<{ appointments: Appointment[] }>('/appointments/my-appointments')).data
    .appointments;

export const cancelAppointment = async (id: string) =>
  (await api.patch<{ appointment: Appointment }>(`/appointments/${id}/cancel`)).data.appointment;

export const fetchDoctorQueue = async () =>
  (await api.get<{ appointments: Appointment[] }>('/appointments/doctor-queue')).data.appointments;

/* ---------- Pharmacy: catalogue & patient orders ---------- */

export const fetchMedicines = async (params?: { category?: string; query?: string }) =>
  (await api.get<{ medicines: Medicine[]; total: number }>('/pharmacy/medicines', { params })).data;

export const placeMedicineOrder = async (payload: {
  items: { medicineId: string; quantity: number }[];
  address: string;
}) => (await api.post<{ order: MedicineOrder }>('/pharmacy/orders', payload)).data.order;

export const fetchMyMedicineOrders = async () =>
  (await api.get<{ orders: MedicineOrder[] }>('/pharmacy/my-orders')).data.orders;

export const fetchMedicineOrder = async (id: string) =>
  (await api.get<{ order: MedicineOrder }>(`/pharmacy/my-orders/${id}`)).data.order;

/* ---------- Pharmacy: partner side ---------- */

export const fetchPharmacyQueue = async (status?: OrderStatus) =>
  (await api.get<{ orders: MedicineOrder[] }>('/pharmacy/pharmacy-queue', { params: { status } }))
    .data.orders;

export const acceptMedicineOrder = async (id: string) =>
  (await api.post<{ order: MedicineOrder }>(`/pharmacy/orders/${id}/accept`)).data.order;

export const assignOrderAgent = async (id: string, agentUserId: string | null) =>
  (await api.patch<{ order: MedicineOrder }>(`/pharmacy/orders/${id}/agent`, { agentUserId })).data
    .order;

export const updateMedicineOrderStatus = async (
  id: string,
  status: OrderStatus,
  cancelReason?: string
) =>
  (
    await api.patch<{ order: MedicineOrder }>(`/pharmacy/orders/${id}/status`, {
      status,
      cancelReason,
    })
  ).data.order;

/* ---------- Inventory (per partner) ---------- */

export const fetchInventory = async (params?: {
  search?: string;
  lowStockOnly?: boolean;
  page?: number;
  limit?: number;
}) =>
  (
    await api.get<{ items: InventoryItem[]; total: number }>('/inventory/pharmacy', {
      params: { ...params, lowStockOnly: params?.lowStockOnly ? 'true' : undefined },
    })
  ).data;

export const upsertInventoryItem = async (payload: {
  medicineId: string;
  price: number;
  stock: number;
  reorderLevel?: number;
  isActive?: boolean;
}) => (await api.put<{ item: InventoryItem }>('/inventory/pharmacy', payload)).data.item;

export const adjustStock = async (medicineId: string, delta: number) =>
  (await api.patch<{ item: InventoryItem }>(`/inventory/pharmacy/${medicineId}/stock`, { delta }))
    .data.item;

export const removeInventoryItem = async (medicineId: string) =>
  (await api.delete(`/inventory/pharmacy/${medicineId}`)).data;

export const fetchLabOfferings = async (params?: {
  search?: string;
  page?: number;
  limit?: number;
}) =>
  (await api.get<{ items: LabOfferingItem[]; total: number }>('/inventory/lab', { params })).data;

export const upsertLabOffering = async (payload: {
  labPackageId: string;
  price: number;
  homeCollectionFee?: number;
  turnaroundHours?: number;
  isActive?: boolean;
}) => (await api.put<{ offering: LabOfferingItem }>('/inventory/lab', payload)).data.offering;

export const removeLabOffering = async (labPackageId: string) =>
  (await api.delete(`/inventory/lab/${labPackageId}`)).data;

/** Which pharmacies stock a medicine, cheapest first. */
export const fetchMedicineOffers = async (medicineId: string) =>
  (
    await api.get<{
      offers: {
        price: number;
        stock: number;
        pharmacy: { id: string; name: string; city: string | null; deliveryRadiusKm: number };
      }[];
    }>(`/inventory/offers/medicine/${medicineId}`)
  ).data.offers;

export const fetchLabOffers = async (labPackageId: string) =>
  (
    await api.get<{
      offers: {
        price: number;
        homeCollectionFee: number;
        turnaroundHours: number;
        labPartner: {
          id: string;
          name: string;
          city: string | null;
          homeCollection: boolean;
          nablAccredited: boolean;
        };
      }[];
    }>(`/inventory/offers/lab/${labPackageId}`)
  ).data.offers;

/* ---------- Labs ---------- */

export const fetchLabPackages = async (params?: { category?: string }) =>
  (await api.get<{ packages: LabPackage[]; total: number }>('/labs/packages', { params })).data;

export const bookLabTest = async (payload: { testId: string; address?: string }) =>
  (await api.post<{ order: LabOrder }>('/labs/book', payload)).data.order;

export const fetchMyLabOrders = async () =>
  (await api.get<{ orders: LabOrder[] }>('/labs/my-orders')).data.orders;

export const fetchLabQueue = async (status?: LabOrderStatus) =>
  (await api.get<{ queue: LabOrder[] }>('/labs/queue', { params: { status } })).data.queue;

export const acceptLabOrder = async (id: string) =>
  (await api.post<{ order: LabOrder }>(`/labs/orders/${id}/accept`)).data.order;

export const assignLabAgent = async (
  id: string,
  agentUserId: string | null,
  scheduledAt?: string
) =>
  (await api.patch<{ order: LabOrder }>(`/labs/orders/${id}/agent`, { agentUserId, scheduledAt }))
    .data.order;

/** The report is a Document already uploaded against this order. */
export const attachLabReport = async (orderId: string, documentId: string) =>
  (await api.post<{ order: LabOrder }>('/labs/attach-report', { orderId, documentId })).data.order;

export const updateLabOrderStatus = async (id: string, status: LabOrderStatus) =>
  (await api.patch<{ order: LabOrder }>(`/labs/orders/${id}/status`, { status })).data.order;

/* ---------- Patient ---------- */

export const fetchMyProfile = async () =>
  (await api.get<{ patient: PatientProfile }>('/patients/me')).data.patient;

export const updateMyProfile = async (payload: Partial<PatientProfile>) =>
  (await api.put<{ patient: PatientProfile }>('/patients/me', payload)).data.patient;

export const fetchMedicalRecords = async () =>
  (
    await api.get<{
      appointments: Appointment[];
      prescriptions: Prescription[];
      labOrders: LabOrder[];
    }>('/patients/me/records')
  ).data;

/* ---------- Prescriptions ---------- */

export const fetchMyPrescriptions = async () =>
  (await api.get<{ prescriptions: Prescription[] }>('/prescriptions/mine')).data.prescriptions;

export const fetchPrescription = async (id: string) =>
  (await api.get<{ prescription: Prescription }>(`/prescriptions/${id}`)).data.prescription;

/**
 * The catalogue filtered for one appointment. Entries the telemedicine rules
 * refuse come back with `prescribable: false` and a reason, so the picker can
 * explain rather than silently hide them.
 */
export const fetchPrescribableMedicines = async (appointmentId: string, search?: string) =>
  (
    await api.get<{
      consultationMode: 'VIDEO' | 'IN_PERSON';
      isFollowUp: boolean;
      medicines: PrescribableMedicine[];
    }>(`/prescriptions/prescribable/${appointmentId}`, { params: { search } })
  ).data;

export const createPrescription = async (payload: {
  appointmentId: string;
  diagnosis: string;
  medicines: {
    medicineId?: string;
    name: string;
    dosage: string;
    frequency: string;
    durationDays?: number;
    instructions?: string;
  }[];
  /** A catalogue id makes a test auto-bookable through the consent flow. */
  labTests?: {
    labPackageId?: string;
    testName: string;
    instructions?: string;
    urgent?: boolean;
  }[];
  notes?: string;
  advice?: string;
  followUpDate?: string;
}) => (await api.post<{ prescription: Prescription }>('/prescriptions', payload)).data.prescription;

/* ---------- Emergency ---------- */

export const triggerSOS = async (latitude: number, longitude: number) =>
  (await api.post<{ sos: EmergencySOS }>('/emergency/sos', { latitude, longitude })).data.sos;

export const fetchMyEmergencyHistory = async () =>
  (await api.get<{ history: EmergencySOS[] }>('/emergency/my-history')).data.history;

export const fetchEmergencyQueue = async () =>
  (await api.get<{ queue: EmergencySOS[] }>('/emergency/queue')).data.queue;

export const updateEmergencyStatus = async (id: string, status: EmergencySOS['status']) =>
  (await api.patch<{ sos: EmergencySOS }>(`/emergency/${id}/status`, { status })).data.sos;

/* ---------- Applications (provider onboarding) ---------- */

export const fetchMyApplications = async () =>
  (await api.get<{ applications: ProviderApplication[] }>('/applications/mine')).data.applications;

export const saveApplication = async (draft: ApplicationDraft) =>
  (await api.put<{ application: ProviderApplication }>('/applications', draft)).data.application;

export const submitApplication = async (type: ApplicationType) =>
  (await api.post<{ application: ProviderApplication }>('/applications/submit', { type })).data
    .application;

export const fetchApplication = async (id: string) =>
  (await api.get<{ application: ProviderApplication }>(`/applications/${id}`)).data.application;

/* ---------- Applications: admin review ---------- */

export const fetchApplicationQueue = async (params?: {
  status?: ApplicationStatus;
  type?: ApplicationType;
  page?: number;
  limit?: number;
}) =>
  (
    await api.get<{ applications: ProviderApplication[]; total: number }>('/applications', {
      params,
    })
  ).data;

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

export const fetchExpiringLicences = async (withinDays = 30) =>
  (
    await api.get<{
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
    }>('/applications/licences/expiring', { params: { withinDays } })
  ).data;

/* ---------- Documents ---------- */

export interface UploadTarget {
  uri: string;
  name: string;
  mimeType: string;
}

/**
 * Uploads a file as multipart. React Native's FormData takes a
 * `{ uri, name, type }` object rather than a Blob.
 */
export const uploadDocument = async (
  file: UploadTarget,
  kind: DocumentKind,
  link?: { applicationId?: string; labOrderId?: string; appointmentId?: string }
) => {
  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
  form.append('kind', kind);
  if (link?.applicationId) form.append('applicationId', link.applicationId);
  if (link?.labOrderId) form.append('labOrderId', link.labOrderId);
  if (link?.appointmentId) form.append('appointmentId', link.appointmentId);

  const res = await api.post<{ document: DocumentRef }>('/files', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  return res.data.document;
};

export const deleteDocument = async (id: string) => (await api.delete(`/files/${id}`)).data;

/**
 * Mints a short-lived signed link. Use this where a bare URL is unavoidable
 * (an <Image> source, a PDF viewer); everything else should stream through the
 * authenticated endpoint.
 */
export const createDocumentLink = async (id: string) => {
  const { link } = (
    await api.post<{ link: { documentId: string; token: string; expiresAt: number; url: string } }>(
      `/files/${id}/link`
    )
  ).data;
  // The API returns a path; callers need an absolute URL.
  return { ...link, absoluteUrl: `${API_BASE_URL.replace(/\/api\/v1$/, '')}${link.url}` };
};

/* ---------- Notifications ---------- */

export const registerDevice = async (payload: {
  token: string;
  appId: AppId;
  platform: 'ios' | 'android' | 'web';
}) => (await api.post('/notifications/devices', payload)).data;

export const unregisterDevice = async (token: string) =>
  (await api.delete('/notifications/devices', { data: { token } })).data;

export const fetchNotifications = async (params?: { unreadOnly?: boolean; page?: number }) =>
  (
    await api.get<{ notifications: AppNotification[]; total: number; unread: number }>(
      '/notifications',
      { params: { ...params, unreadOnly: params?.unreadOnly ? 'true' : undefined } }
    )
  ).data;

export const markNotificationRead = async (id: string) =>
  (await api.post(`/notifications/${id}/read`)).data;

export const markAllNotificationsRead = async () =>
  (await api.post('/notifications/read-all')).data;

/* ---------- Prescription fulfilment (the consent flow) ---------- */

export type FulfilmentStatus = 'PENDING_CONSENT' | 'CONSENTED' | 'DECLINED' | 'EXPIRED';

export interface MedicineQuoteLine {
  medicineId: string;
  name: string;
  dosage: string;
  frequency: string;
  durationDays: number | null;
  quantity: number;
  unitPrice: number;
  itemTotal: number;
  pharmacyId: string;
  pharmacyName: string;
  requiresPrescription: boolean;
  /** Present when the item cannot be ordered — shown, never silently dropped. */
  unavailableReason?: string;
}

export interface LabQuoteLine {
  labPackageId: string | null;
  testName: string;
  instructions: string | null;
  urgent: boolean;
  price: number | null;
  homeCollectionFee: number;
  labPartnerId: string | null;
  labPartnerName: string | null;
  unavailableReason?: string;
}

export interface Fulfilment {
  id: string;
  prescriptionId: string;
  status: FulfilmentStatus;
  medicines: MedicineQuoteLine[];
  labTests: LabQuoteLine[];
  medicineTotal: number;
  labTotal: number;
  deliveryFee: number;
  grandTotal: number;
  expiresAt: string;
  consentedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  createdAt: string;
  diagnosis: string;
  doctorName: string;
}

export const fetchMyFulfilments = async () =>
  (await api.get<{ fulfilments: Fulfilment[] }>('/fulfilment/mine')).data.fulfilments;

export const fetchFulfilment = async (id: string) =>
  (await api.get<{ fulfilment: Fulfilment }>(`/fulfilment/${id}`)).data.fulfilment;

/**
 * Approve a prescription order.
 *
 * No prices are sent — the server charges from the stored quote, so what the
 * patient approved is exactly what they pay.
 */
export const consentToFulfilment = async (
  id: string,
  payload: {
    acceptMedicineIds?: string[];
    acceptLabPackageIds?: string[];
    deliveryAddress: string;
    latitude?: number;
    longitude?: number;
    paymentMethod: PaymentMethod;
  }
) =>
  (
    await api.post<{
      medicineOrderId: string | null;
      labOrderIds: string[];
      checkout: Checkout | null;
      message: string;
    }>(`/fulfilment/${id}/consent`, payload)
  ).data;

export const declineFulfilment = async (id: string, reason?: string) =>
  (await api.post(`/fulfilment/${id}/decline`, { reason })).data;

/* ---------- Payments ---------- */

export type PaymentMethod = 'UPI' | 'CARD' | 'NETBANKING' | 'WALLET' | 'COD';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type PaymentPurpose =
  | 'APPOINTMENT'
  | 'MEDICINE_ORDER'
  | 'LAB_ORDER'
  | 'PRESCRIPTION_BASKET';

/**
 * What the server hands back to open a payment.
 *
 * `gatewayOrderId` is null for cash on delivery — there is nothing to open, the
 * order is already confirmed.
 */
export interface Checkout {
  paymentId: string;
  method: PaymentMethod;
  amount: number;
  currency: string;
  status: string;
  gatewayOrderId: string | null;
  publicKey: string | null;
  message: string;
}

export interface PaymentRecord {
  id: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paidAt: string | null;
  refundedAmount: number;
  refundedAt: string | null;
  createdAt: string;
  medicineOrderId: string | null;
  labOrderId: string | null;
  appointmentId: string | null;
  fulfilmentId: string | null;
}

/** Amounts are never sent — the server prices from the order it already holds. */
export const startCheckout = async (payload: {
  purpose: PaymentPurpose;
  targetId: string;
  method: PaymentMethod;
}) => (await api.post<Checkout>('/payments/checkout', payload)).data;

/** Hands the gateway's signed result back for verification. */
export const confirmPayment = async (payload: {
  orderId: string;
  paymentId: string;
  signature: string;
}) => (await api.post<{ paymentId: string; status: string; message: string }>(
  '/payments/confirm',
  payload
)).data;

/**
 * Stands in for the gateway's checkout sheet while PAYMENT_PROVIDER=mock, so
 * the flow can be exercised end to end without a gateway account. The server
 * 404s this when a real provider is configured.
 */
export const simulatePayment = async (paymentId: string) =>
  (await api.post<{ status: string; message: string }>(`/payments/${paymentId}/simulate`)).data;

export const fetchMyPayments = async () =>
  (await api.get<{ payments: PaymentRecord[] }>('/payments/mine')).data.payments;

export interface EarningsLine {
  id: string;
  amount: number;
  status: 'PENDING' | 'SETTLED' | 'REVERSED';
  settledAt: string | null;
  createdAt: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  paymentStatus: PaymentStatus;
}

/** A partner's own settlement statement. */
export const fetchMyEarnings = async () =>
  (
    await api.get<{ settledTotal: number; pendingTotal: number; lines: EarningsLine[] }>(
      '/payments/earnings'
    )
  ).data;

/** The pharmacy or delivery agent confirms cash actually changed hands. */
export const markCodCollected = async (orderId: string) =>
  (await api.post<{ amount: number }>(`/payments/cod/${orderId}/collected`)).data;

/* ---------- Video consultation ---------- */

export interface VideoSession {
  provider: string;
  roomId: string;
  /** Open this. Null when no transport is configured. */
  url: string | null;
  displayName: string;
  role: 'PATIENT' | 'DOCTOR';
  expiresAt: string;
  notice?: string;
}

/**
 * Asks for a join grant. The server checks that the caller is actually on this
 * appointment and that the slot is open before it hands back a room.
 */
export const joinConsultation = async (appointmentId: string) =>
  (await api.post<{ session: VideoSession }>(`/video/${appointmentId}/join`)).data.session;

export const endConsultation = async (appointmentId: string) =>
  (await api.post<{ status: string }>(`/video/${appointmentId}/end`)).data;

/* ---------- Health content & emergency directory ---------- */

export type EmergencyServiceType =
  | 'AMBULANCE'
  | 'HOSPITAL'
  | 'BLOOD_BANK'
  | 'POISON_CONTROL'
  | 'MENTAL_HEALTH';

export interface EmergencyServiceEntry {
  id: string;
  name: string;
  type: EmergencyServiceType;
  phone: string;
  altPhone: string | null;
  address: string | null;
  city: string | null;
  isNational: boolean;
  is24x7: boolean;
  notes: string | null;
  distanceKm: number | null;
}

/** Deliberately unauthenticated — an emergency number behind a login is useless. */
export const fetchEmergencyServices = async (params?: {
  latitude?: number;
  longitude?: number;
  city?: string;
  type?: EmergencyServiceType;
}) =>
  (
    await api.get<{ nearby: EmergencyServiceEntry[]; national: EmergencyServiceEntry[] }>(
      '/health-content/emergency-services',
      { params }
    )
  ).data;

export interface HealthTipEntry {
  id: string;
  title: string;
  body: string;
  category: string;
  receivedAt: string;
}

export const fetchMyHealthTips = async () =>
  (await api.get<{ tips: HealthTipEntry[] }>('/health-content/tips/mine')).data.tips;

export const refreshHealthTips = async () =>
  (await api.post<{ delivered: number }>('/health-content/tips/refresh')).data;

/* ---------- Admin ---------- */

export const fetchAdminStats = async () =>
  (await api.get<{ stats: AdminStats }>('/admin/stats')).data.stats;

export interface AdminUser {
  id: string;
  phoneNumber: string;
  role: Role;
  isVerified: boolean;
  isSuspended?: boolean;
  createdAt: string;
}

export const fetchUsers = async (params?: { role?: string; page?: number; limit?: number }) =>
  (await api.get<{ users: AdminUser[]; total: number }>('/admin/users', { params })).data;
