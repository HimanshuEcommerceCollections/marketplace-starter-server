/**
 * THE single definition of what a ZIP code is in this system.
 *
 * Every layer must agree: the admin validator that accepts a ZIP into the
 * database, the bulk importer, and the coverage resolver that decides whether a
 * customer can book. When these disagree, a string the admin cannot save is one
 * the resolver happily allows (or vice versa), and the two screens tell the
 * customer different things about the same address.
 *
 * Canonical form is exactly 5 ASCII digits, stored as TEXT — never a number.
 * "07001" must never become 7001, which is why nothing here goes near Number()
 * or parseInt().
 *
 * Accepted inputs: "27601", " 27601 ", "27601-1234", "276011234" (ZIP+4 is
 * truncated to its 5-digit prefix). Everything else is rejected — deliberately
 * including "27601x" and "2-7-6-0-1", because silently salvaging digits out of
 * arbitrary text turns a typo into a confident wrong answer.
 */
const ZIP_RE = /^(\d{5})(?:-?\d{4})?$/;

/** Canonical 5-digit ZIP, or null if the input is not a valid US ZIP / ZIP+4. */
export function normalizeZip(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = ZIP_RE.exec(raw.trim());
  return match === null ? null : match[1];
}
