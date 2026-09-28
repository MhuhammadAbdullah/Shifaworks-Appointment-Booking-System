const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGIT = "23456789";

/** A random index in [0, max) using the Web Crypto API (available in all supported browsers). */
function randomIndex(max: number): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! % max;
}

/** A random password meeting passwordSchema's rules (10+ chars, upper/lower/digit). Ambiguous characters (0/O, 1/l/I) are excluded for readability. */
export function generatePassword(length = 12): string {
  const pick = (s: string) => s[randomIndex(s.length)]!;
  const all = LOWER + UPPER + DIGIT;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT)];
  for (let i = chars.length; i < length; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}
