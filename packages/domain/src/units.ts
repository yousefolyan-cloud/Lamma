// Money is integer fils (1 JOD = 1000 fils); weight is integer grams. No floating point for either.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[٫,]/g, '.');

/** "18.25" | "١٨٫٢٥" → 18250 (grams) / fils. Returns null when the text is not a valid non-negative number with ≤ 3 decimals. */
export function parseThousandths(input: string): number | null {
  const s = toLatinDigits(input.trim());
  const m = /^(\d{1,7})(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
}

/** 12950 → "12.950" — always three decimals, exact. */
export function formatThousandths(value: number | bigint | string): string {
  const v = BigInt(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  return `${neg ? '-' : ''}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, '0')}`;
}
export const formatJod = formatThousandths;
export const formatKg = formatThousandths;
export const parseKgToGrams = parseThousandths;
export const parseJodToFils = parseThousandths;

/** value in fils of `grams` at `priceFilsPerKg`, rounded half-up. Mirrors the SQL in submit_station_receipt. */
export function materialValueFils(grams: number, priceFilsPerKg: number | bigint): bigint {
  if (!Number.isInteger(grams) || grams < 0) throw new RangeError('grams must be a non-negative integer');
  return (BigInt(grams) * BigInt(priceFilsPerKg) + 500n) / 1000n;
}

export function netFromGrossTare(grossG: number, tareG: number): number {
  if (![grossG, tareG].every(Number.isInteger) || tareG < 0 || grossG <= tareG) throw new RangeError('invalid_weight');
  return grossG - tareG;
}

/** difference between the station scale and the signed field weights, and whether it is inside the APPROVED tolerance.
 *  With no approved policy the tolerance is zero: any difference goes to review. */
export function compareWeights(signedG: number, stationG: number, policy: { toleranceG?: number | null; toleranceBps?: number | null } | null) {
  const diffG = stationG - signedG;
  const tol = policy ? Math.max(policy.toleranceG ?? 0, Math.floor((signedG * (policy.toleranceBps ?? 0)) / 10000)) : 0;
  return { diffG, toleranceG: tol, within: Math.abs(diffG) <= tol, diffBps: signedG > 0 ? Math.round((diffG * 10000) / signedG) : null };
}
