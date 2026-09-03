/**
 * Bounds on list reads.
 *
 * A `findMany` with no `take` returns whatever has accumulated. That is fine on
 * the day it is written and quietly stops being fine: a patient's history, a
 * follow-up thread and an order list all grow for as long as someone uses the
 * platform, and the query that returned nine rows in testing returns nine
 * hundred to the person who has been here two years — the one whose experience
 * matters most. The cost lands in three places at once: the database reads rows
 * nobody will look at, the response carries them over a mobile connection, and
 * the app renders them.
 *
 * So every list that grows takes a window. The important property is that the
 * *default* is bounded — an endpoint should be safe for a caller who passes
 * nothing, because that is what every existing client does.
 *
 * Deliberately offset-based rather than cursor-based. Offsets drift when rows
 * are inserted mid-page, which matters for a feed and does not matter for
 * history ordered by a timestamp that does not change. Cursors are the right
 * answer for the former and needless machinery for the latter.
 */

/** What a caller may ask for. Both optional; both clamped. */
export interface PageRequest {
  page?: number;
  limit?: number;
}

export interface Window {
  take: number;
  skip: number;
  page: number;
  limit: number;
}

/**
 * The ceiling, applied whatever the caller asks for.
 *
 * A client that sends `?limit=100000` is either mistaken or probing; neither is
 * a reason to read the table.
 */
export const MAX_PAGE_SIZE = 100;

/** Enough that the first page is the whole story for almost everybody. */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * How far into a list a caller may skip.
 *
 * There has to be a ceiling, and not only to stop the database counting past a
 * million rows to return nothing: without one, `?page=Infinity` produces
 * `skip: Infinity`, which is not an integer and which the query layer rejects
 * outright — a 500 handed to anyone who sends a malformed page number. Deep
 * offsets are also the wrong tool; anyone who genuinely needs to reach row
 * 100,000 wants a filter, not page 2,000.
 */
const MAX_PAGE = 1_000;

/**
 * Coerces anything at all to an integer inside [min, max].
 *
 * Query strings arrive as text and clients send what they send. `Number('abc')`
 * is NaN, `Number('1e400')` is Infinity, and both have to come out of here as
 * something a query can use.
 */
const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < min) return Math.min(Math.max(fallback, min), max);
  return Math.min(n, max);
};

export const windowFor = (req: PageRequest = {}, defaultLimit = DEFAULT_PAGE_SIZE): Window => {
  const limit = clampInt(req.limit ?? defaultLimit, defaultLimit, 1, MAX_PAGE_SIZE);
  const page = clampInt(req.page ?? 1, 1, 1, MAX_PAGE);

  return { take: limit, skip: (page - 1) * limit, page, limit };
};

/**
 * Adds `hasMore` without a second COUNT query.
 *
 * Reading one row past the window answers "is there another page?" for the cost
 * of one row, where a `count()` costs a second full scan of the same predicate.
 * The extra row is dropped before the caller sees it.
 *
 * Use with `take: window.take + 1`.
 */
export const trim = <T>(rows: T[], window: Window): { items: T[]; hasMore: boolean } => {
  const hasMore = rows.length > window.take;
  return { items: hasMore ? rows.slice(0, window.take) : rows, hasMore };
};
