/**
 * Formatting shared by every app, so a number means the same thing wherever a
 * user reads it.
 */

/**
 * Indian digit grouping: the last three digits, then pairs.
 *
 * Written out rather than delegated to `toLocaleString('en-IN')` because Hermes
 * does not carry a full ICU on every platform — it accepts the locale argument
 * and quietly ignores it, so the same build would group as ₹1,20,000 in one
 * place and ₹120000 in another. A price that renders differently depending on
 * the JS engine is worse than one that is always plain.
 */
const groupIndian = (whole: string): string => {
  if (whole.length <= 3) return whole;
  const head = whole.slice(0, -3);
  const tail = whole.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
};

/**
 * Money, the way this platform bills it: rupees and paise, always both.
 *
 * Every amount here is rupees — the gateway settles in paise, partners are paid
 * in rupees, the admin console reads ₹. Anything showing a different symbol is
 * telling the user the wrong price, not merely styling it differently.
 *
 * The paise are never dropped, even when they are '.00'. A column where some
 * rows carry decimals and others don't is one a person cannot scan for a
 * rounding error, and ₹499.50 shown as ₹499 is simply a different price from
 * the one being charged. Screens too tight for four more pixels should lose
 * something else.
 */
export const rupees = (amount: number | null | undefined): string => {
  const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const [whole = '0', fraction = '00'] = Math.abs(value).toFixed(2).split('.');
  const sign = value < 0 ? '-' : '';
  return `${sign}₹${groupIndian(whole)}.${fraction}`;
};
