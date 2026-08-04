import type { EmergencyServiceType, Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { notFound } from '../utils/AppError.js';

/**
 * Ambulance, hospital and blood bank numbers, resolved by where the patient is.
 *
 * Deliberately a directory, not a dispatch integration. Calling an ambulance is
 * a phone call — the useful thing an app can do in an emergency is put the
 * right number one tap away, immediately, rather than pretend to send a
 * vehicle it has no ability to send.
 *
 * National numbers (108, 102, 112) always appear, so the screen is never empty
 * even somewhere with no local listings.
 */

const EARTH_RADIUS_KM = 6371;

const distanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export interface NearbyQuery {
  latitude?: number;
  longitude?: number;
  city?: string;
  type?: EmergencyServiceType;
  radiusKm?: number;
}

/**
 * Local services nearest first, with national numbers always appended.
 *
 * Distance is computed in the application rather than in SQL: the directory is
 * small (hundreds of rows, not millions) and this keeps it portable. If it ever
 * grows, move to PostGIS rather than paginating this.
 */
export const findNearbyServicesService = async (query: NearbyQuery) => {
  const radius = query.radiusKm ?? 25;

  const where: Prisma.EmergencyServiceWhereInput = {
    isActive: true,
    isNational: false,
    ...(query.type ? { type: query.type } : {}),
    ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
  };

  const [local, national] = await Promise.all([
    prisma.emergencyService.findMany({ where, take: 200 }),
    prisma.emergencyService.findMany({
      where: { isActive: true, isNational: true, ...(query.type ? { type: query.type } : {}) },
      orderBy: { name: 'asc' },
    }),
  ]);

  const hasCoords = query.latitude !== undefined && query.longitude !== undefined;

  const ranked = local
    .map((service) => {
      const km =
        hasCoords && service.latitude !== null && service.longitude !== null
          ? distanceKm(query.latitude!, query.longitude!, service.latitude, service.longitude)
          : null;
      return { ...service, distanceKm: km === null ? null : Number(km.toFixed(1)) };
    })
    // Only filter by radius when we actually know where both ends are; a
    // listing with no coordinates should still be reachable.
    .filter((s) => s.distanceKm === null || s.distanceKm <= radius)
    .sort((a, b) => {
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });

  return {
    nearby: ranked,
    national: national.map((s) => ({ ...s, distanceKm: null })),
  };
};

/* ---------- Admin management ---------- */

export const listServicesService = async (params: {
  page: number;
  limit: number;
  type?: EmergencyServiceType;
  city?: string;
}) => {
  const where: Prisma.EmergencyServiceWhereInput = {
    ...(params.type ? { type: params.type } : {}),
    ...(params.city ? { city: { contains: params.city, mode: 'insensitive' } } : {}),
  };

  const [total, services] = await Promise.all([
    prisma.emergencyService.count({ where }),
    prisma.emergencyService.findMany({
      where,
      orderBy: [{ isNational: 'desc' }, { city: 'asc' }, { name: 'asc' }],
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
  ]);

  return { total, page: params.page, limit: params.limit, services };
};

export const upsertServiceService = (
  data: Prisma.EmergencyServiceUncheckedCreateInput & { id?: string }
) => {
  const { id, ...rest } = data;
  return id
    ? prisma.emergencyService.update({ where: { id }, data: rest })
    : prisma.emergencyService.create({ data: rest });
};

export const deleteServiceService = async (id: string) => {
  const deleted = await prisma.emergencyService.deleteMany({ where: { id } });
  if (deleted.count === 0) throw notFound('Emergency service');
  return { removed: true };
};
