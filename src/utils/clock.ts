/**
 * The platform's wall clock.
 *
 * `DoctorSlot` stores `date` as 'YYYY-MM-DD' and `startTime` as 'HH:mm' — plain
 * strings with no offset. A doctor who publishes a 09:00 slot means 09:00 where
 * their clinic is, so "has this slot passed?" can only be answered against a
 * specific zone, never against the server's own. A container that happens to run
 * in UTC would otherwise think it is still mid-morning in India and keep
 * offering slots that lapsed hours ago.
 *
 * The platform serves one country, so the zone is a constant rather than a
 * setting. If that ever stops being true the fix is per-clinic zones on the
 * doctor record, not an environment variable — a single global zone would just
 * be wrong somewhere else instead.
 */
const PLATFORM_TIMEZONE = 'Asia/Kolkata';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLATFORM_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Now, in the same shape slots are stored in — so comparison is a string
 * compare against the exact values in the table, with no parsing in between.
 * 'en-CA' is chosen because it formats dates as YYYY-MM-DD natively.
 */
export const platformNow = (): { date: string; time: string } => {
  const parts = formatter.formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  // Midnight can format as '24' rather than '00' under hour12: false.
  const hour = get('hour') === '24' ? '00' : get('hour');

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`,
  };
};

/** Whether a stored slot's start has already passed. */
export const slotHasPassed = (date: string, startTime: string): boolean => {
  const now = platformNow();
  return date < now.date || (date === now.date && startTime <= now.time);
};

const toMinutes = (time: string) => {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * Minutes from now until a slot starts — negative once it has begun.
 *
 * Whole days are converted through UTC midnights so the arithmetic is not
 * thrown by a daylight-saving shift between the two dates. India does not
 * observe one, but the calculation should not be the reason that stays true.
 */
export const minutesUntilSlot = (date: string, startTime: string): number => {
  const now = platformNow();
  const dayDelta =
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${now.date}T00:00:00Z`)) / 60_000;
  return dayDelta + toMinutes(startTime) - toMinutes(now.time);
};
