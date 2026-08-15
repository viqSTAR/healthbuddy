import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { notFound } from '../utils/AppError.js';
import { minutesUntilSlot } from '../utils/clock.js';

/**
 * A patient's history, organised the way they remember it.
 *
 * The database keeps consultations, prescriptions, medicine orders and lab
 * bookings in four tables that share a patient id, and the app used to show
 * them as four flat lists. But nobody thinks "my third prescription" — they
 * think "that time I saw Dr Sharma about my chest, and the antibiotics she put
 * me on". The consultation is the event; everything else hangs off it.
 *
 * So a visit is an Appointment with its artefacts gathered: what was found,
 * what was prescribed, what was ordered as a result, and what the patient
 * attached themselves.
 */

/**
 * The join window comes from the same configuration the join endpoint enforces.
 *
 * These were briefly hardcoded here, which meant raising VIDEO_JOIN_LEAD_MINUTES
 * would leave the button saying "Join now" while the server answered 425. A
 * control that offers an action the API then refuses is worse than one that is
 * simply disabled — so there is one source of truth, not two that agree today.
 */
const JOIN_OPENS_MINUTES_BEFORE = env.VIDEO_JOIN_LEAD_MINUTES;
const JOIN_CLOSES_MINUTES_AFTER = env.VIDEO_JOIN_GRACE_MINUTES;

type JoinState = {
  available: boolean;
  /** Minutes until the button becomes live; null once it is, or never will be. */
  opensInMinutes: number | null;
  /** Why it is not available, for the button's own label. Null when it is. */
  reason: string | null;
};

const joinState = (visit: {
  type: string;
  status: string;
  slot: { date: string; startTime: string };
}): JoinState => {
  if (visit.type !== 'VIDEO') {
    return { available: false, opensInMinutes: null, reason: 'This is an in-person visit' };
  }
  if (visit.status === 'CANCELLED') {
    return { available: false, opensInMinutes: null, reason: 'Cancelled' };
  }
  if (visit.status === 'COMPLETED') {
    return { available: false, opensInMinutes: null, reason: 'This consultation has ended' };
  }

  const minutes = minutesUntilSlot(visit.slot.date, visit.slot.startTime);

  // A consultation already under way is joinable regardless of the clock — the
  // doctor has started it, which is a stronger signal than the scheduled time.
  if (visit.status === 'IN_PROGRESS') {
    return { available: true, opensInMinutes: null, reason: null };
  }

  if (minutes > JOIN_OPENS_MINUTES_BEFORE) {
    return { available: false, opensInMinutes: Math.ceil(minutes - JOIN_OPENS_MINUTES_BEFORE), reason: null };
  }
  if (minutes < -JOIN_CLOSES_MINUTES_AFTER) {
    return { available: false, opensInMinutes: null, reason: 'This slot has passed' };
  }

  return { available: true, opensInMinutes: null, reason: null };
};

const visitCore = {
  id: true,
  type: true,
  status: true,
  symptoms: true,
  isFollowUp: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  doctor: { select: { id: true, name: true, specialty: true, clinicAddress: true } },
  slot: { select: { date: true, startTime: true, endTime: true } },
} as const;

/**
 * The visit list.
 *
 * Deliberately does not carry the diagnosis or the prescribed medicines. Not
 * for privacy — this is the patient's own record — but because a list of
 * diagnoses is a wall of clinical text nobody scans. The counts say what is
 * there; opening the visit says what it was.
 */
export const listVisitsService = async (patientId: string) => {
  const appointments = await prisma.appointment.findMany({
    where: { patientId },
    orderBy: [{ slot: { date: 'desc' } }, { slot: { startTime: 'desc' } }],
    select: {
      ...visitCore,
      meetingRoomId: true,
      prescription: {
        select: {
          id: true,
          createdAt: true,
          _count: { select: { items: true, labTests: true } },
          fulfilment: {
            select: {
              _count: { select: { medicineOrders: true, labOrders: true } },
            },
          },
        },
      },
      _count: { select: { documents: true } },
    },
  });

  return appointments.map(({ prescription, meetingRoomId, _count, ...visit }) => ({
    ...visit,
    join: joinState(visit),
    /**
     * Whether a room exists, never the room id. That identifier is a bearer
     * credential — anyone holding it can walk into the consultation — so it is
     * handed out only by the join endpoint, which checks who is asking.
     */
    hasRoom: meetingRoomId !== null,
    prescription: prescription
      ? {
          id: prescription.id,
          issuedAt: prescription.createdAt,
          medicineCount: prescription._count.items,
          labTestCount: prescription._count.labTests,
        }
      : null,
    counts: {
      medicineOrders: prescription?.fulfilment?._count.medicineOrders ?? 0,
      labOrders: prescription?.fulfilment?._count.labOrders ?? 0,
      attachments: _count.documents,
    },
  }));
};

/**
 * One visit, with everything that came out of it.
 *
 * The orders are reached through the prescription's fulfilment rather than by
 * matching on patient and date: an order belongs to a consultation because a
 * prescription from that consultation produced it, and nothing else is a
 * reliable link.
 */
export const getVisitService = async (patientId: string, appointmentId: string) => {
  const visit = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      ...visitCore,
      patientId: true,
      meetingRoomId: true,
      prescription: {
        select: {
          id: true,
          diagnosis: true,
          notes: true,
          advice: true,
          followUpDate: true,
          doctorRegistrationNumber: true,
          consultationMode: true,
          wasFollowUp: true,
          createdAt: true,
          items: {
            select: {
              id: true,
              medicineId: true,
              name: true,
              dosage: true,
              frequency: true,
              durationDays: true,
              instructions: true,
            },
          },
          labTests: {
            select: {
              id: true,
              labPackageId: true,
              testName: true,
              instructions: true,
              urgent: true,
            },
          },
          fulfilment: {
            select: {
              id: true,
              status: true,
              expiresAt: true,
              medicineOrders: {
                select: {
                  id: true,
                  status: true,
                  totalAmount: true,
                  createdAt: true,
                  shipments: {
                    select: {
                      id: true,
                      status: true,
                      speed: true,
                      pharmacy: { select: { id: true, name: true } },
                    },
                  },
                },
              },
              labOrders: {
                select: {
                  id: true,
                  testName: true,
                  status: true,
                  price: true,
                  scheduledAt: true,
                  completedAt: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      },
      documents: {
        select: { id: true, kind: true, fileName: true, mimeType: true, createdAt: true },
      },
    },
  });

  // 404 rather than 403 so appointment ids cannot be probed across patients.
  if (!visit || visit.patientId !== patientId) throw notFound('Visit');

  const { patientId: _owner, meetingRoomId, prescription, ...rest } = visit;

  return {
    ...rest,
    join: joinState(rest),
    hasRoom: meetingRoomId !== null,
    prescription,
    medicineOrders: prescription?.fulfilment?.medicineOrders ?? [],
    labOrders: prescription?.fulfilment?.labOrders ?? [],
  };
};
