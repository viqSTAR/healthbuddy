import { Prisma } from '@prisma/client';

/**
 * Money crossing the boundary between the database and everything else.
 *
 * Amounts are stored as `Decimal(12,2)` rather than `Float`, because a float
 * cannot hold 0.1 exactly and a balance that is added to repeatedly drifts —
 * `refundedAmount` is incremented on every partial refund, and after enough of
 * them "fully refunded" stops being true at exactly the moment it matters. The
 * database now holds the number the invoice says.
 *
 * The API still speaks plain numbers. Prisma hands back `Decimal` objects, and
 * serialising those to JSON gives clients an object where they expect a number,
 * so every read that leaves the server converts here. That conversion is safe:
 * two decimal places of rupees is far inside what a double represents exactly.
 * It is the *accumulation* that was unsafe, and that now happens in Decimal.
 */

export type Money = Prisma.Decimal;

/** A Decimal from anything the code has to hand. */
export const dec = (value: Prisma.Decimal | number | string): Prisma.Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

/**
 * For a response body or a display string. Never for a running total — sum in
 * Decimal and convert once at the end, or the drift comes straight back.
 */
export const toNum = (value: Prisma.Decimal | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : value.toNumber();
};

/** Nullable passthrough, for optional columns a client renders as "not set". */
export const toNumOrNull = (
  value: Prisma.Decimal | number | null | undefined
): number | null => {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : value.toNumber();
};

/** Exact addition. `sum([])` is zero, not NaN. */
export const sum = (values: (Prisma.Decimal | number)[]): Prisma.Decimal =>
  values.reduce<Prisma.Decimal>((total, v) => total.add(dec(v)), new Prisma.Decimal(0));

/** Rupees to integer paise, which is what a gateway is told to charge. */
export const toPaise = (value: Prisma.Decimal | number): number =>
  dec(value).mul(100).toDecimalPlaces(0).toNumber();
