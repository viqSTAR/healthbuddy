import type { AddressLabel } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound } from '../utils/AppError.js';

/**
 * Where a patient is, and what the platform can do for them there.
 *
 * Two things live here because they are the same question asked twice: the
 * address book is how a patient tells us where they are, and serviceability is
 * our answer about what that means. Splitting them would put the pincode rules
 * in one file and the only source of pincodes in another.
 */

/** Six digits, first never zero — the India Post format. */
const PINCODE = /^[1-9][0-9]{5}$/;

const addressView = {
  id: true,
  label: true,
  receiverName: true,
  receiverPhone: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  pincode: true,
  landmark: true,
  latitude: true,
  longitude: true,
  isDefault: true,
  createdAt: true,
} as const;

/* ---------- The address book ---------- */

export const listAddressesService = (patientId: string) =>
  prisma.address.findMany({
    where: { patientId },
    select: addressView,
    // The default first, then newest — the order the picker shows them in.
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });

export interface AddressInput {
  label?: AddressLabel;
  receiverName?: string | null;
  receiverPhone?: string | null;
  line1: string;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode: string;
  landmark?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
}

/**
 * Exactly one address is the default.
 *
 * Enforced in a transaction rather than by a constraint: Postgres cannot express
 * "at most one row per patient where isDefault" without a partial unique index,
 * which Prisma's schema language has no syntax for. Clearing the others inside
 * the same transaction as the write is what actually holds the invariant.
 */
const clearOtherDefaults = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  patientId: string,
  keepId?: string
) => {
  await tx.address.updateMany({
    where: { patientId, isDefault: true, ...(keepId ? { NOT: { id: keepId } } : {}) },
    data: { isDefault: false },
  });
};

/**
 * Who to put on a new address when the patient did not say.
 *
 * Almost every address belongs to the account holder, so asking for a name and
 * number that the platform already knows is friction for the common case. They
 * are still stored per-address rather than read from the account at delivery
 * time: once someone edits them for their parent's flat, that edit has to
 * survive, and it must not rewrite the account holder's own details.
 */
const accountHolder = async (patientId: string) => {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { fullName: true, user: { select: { phoneNumber: true } } },
  });
  return {
    name: patient?.fullName?.trim() || null,
    phone: patient?.user.phoneNumber ?? null,
  };
};

export const createAddressService = async (patientId: string, input: AddressInput) => {
  const [existing, holder] = await Promise.all([
    prisma.address.count({ where: { patientId } }),
    accountHolder(patientId),
  ]);

  // The first address a patient saves is their default whether they asked or
  // not; an address book where nothing is selected has no useful state.
  const shouldDefault = input.isDefault === true || existing === 0;

  return prisma.$transaction(async (tx) => {
    if (shouldDefault) await clearOtherDefaults(tx, patientId);

    return tx.address.create({
      data: {
        patientId,
        label: input.label ?? 'HOME',
        receiverName: input.receiverName?.trim() || holder.name,
        receiverPhone: input.receiverPhone?.trim() || holder.phone,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        pincode: input.pincode,
        landmark: input.landmark ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        isDefault: shouldDefault,
      },
      select: addressView,
    });
  });
};

export const updateAddressService = async (
  patientId: string,
  id: string,
  input: Partial<AddressInput>
) => {
  const existing = await prisma.address.findFirst({
    where: { id, patientId },
    select: { id: true, isDefault: true },
  });
  if (!existing) throw notFound('Address');

  const makeDefault = input.isDefault === true;

  return prisma.$transaction(async (tx) => {
    if (makeDefault) await clearOtherDefaults(tx, patientId, id);

    return tx.address.update({
      where: { id },
      data: {
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.line1 === undefined ? {} : { line1: input.line1 }),
        ...(input.line2 === undefined ? {} : { line2: input.line2 }),
        ...(input.city === undefined ? {} : { city: input.city }),
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.pincode === undefined ? {} : { pincode: input.pincode }),
        ...(input.landmark === undefined ? {} : { landmark: input.landmark }),
        ...(input.latitude === undefined ? {} : { latitude: input.latitude }),
        ...(input.longitude === undefined ? {} : { longitude: input.longitude }),
        // Only ever set to true here. Turning off the last default would leave
        // the patient with no selected address, so unsetting is done by making
        // a different one default instead.
        ...(makeDefault ? { isDefault: true } : {}),
      },
      select: addressView,
    });
  });
};

/**
 * Deleting the default promotes the next most recent address, so the book is
 * never left with entries but nothing selected.
 */
export const deleteAddressService = async (patientId: string, id: string) => {
  const existing = await prisma.address.findFirst({
    where: { id, patientId },
    select: { id: true, isDefault: true },
  });
  if (!existing) throw notFound('Address');

  await prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id } });

    if (!existing.isDefault) return;

    const next = await tx.address.findFirst({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
  });

  return { deleted: true };
};

export const setDefaultAddressService = async (patientId: string, id: string) => {
  const existing = await prisma.address.findFirst({ where: { id, patientId }, select: { id: true } });
  if (!existing) throw notFound('Address');

  return prisma.$transaction(async (tx) => {
    await clearOtherDefaults(tx, patientId, id);
    return tx.address.update({ where: { id }, data: { isDefault: true }, select: addressView });
  });
};

/** The address an order defaults to when the client doesn't name one. */
export const getDefaultAddressService = (patientId: string) =>
  prisma.address.findFirst({ where: { patientId, isDefault: true }, select: addressView });

/* ---------- Serviceability ---------- */

export const assertValidPincode = (pincode: string) => {
  if (!PINCODE.test(pincode)) {
    throw new AppError('Enter a valid 6-digit pincode.', 400);
  }
};

/** The active pharmacies that have committed to delivering to a pincode. */
export const pharmaciesServingService = (pincode: string) =>
  prisma.pharmacy.findMany({
    where: {
      isActive: true,
      verifiedAt: { not: null },
      serviceAreas: { some: { pincode } },
    },
    select: { id: true, name: true, city: true, state: true, latitude: true, longitude: true },
  });

/**
 * Whether the store should open for this pincode at all.
 *
 * The answer is deliberately a hard yes/no rather than a filtered catalogue.
 * Showing medicines that cannot be bought teaches people to distrust the whole
 * listing, and the disappointment lands at checkout instead of at the door.
 */
export const checkServiceabilityService = async (pincode: string) => {
  assertValidPincode(pincode);

  const pharmacies = await pharmaciesServingService(pincode);

  if (pharmacies.length === 0) {
    return {
      pincode,
      serviceable: false,
      pharmacyCount: 0,
      city: null as string | null,
      state: null as string | null,
      /// Whether anything at all can arrive quickly here.
      expressAvailable: false,
    };
  }

  // Express needs a shop nearby that actually stocks an express line, not just
  // any shop that delivers here.
  const expressLines = await prisma.pharmacyInventory.count({
    where: {
      pharmacyId: { in: pharmacies.map((p) => p.id) },
      isActive: true,
      stock: { gt: 0 },
      medicine: { deliverySpeed: 'EXPRESS' },
    },
  });

  const first = pharmacies[0];

  return {
    pincode,
    serviceable: true,
    pharmacyCount: pharmacies.length,
    city: first?.city ?? null,
    state: first?.state ?? null,
    expressAvailable: expressLines > 0,
  };
};
