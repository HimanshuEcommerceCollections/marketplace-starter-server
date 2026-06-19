/**
 * Convert a display name into a URL-safe slug: lowercase, hyphen-separated,
 * alphanumeric only. Diacritics are stripped (e.g. "Café" -> "cafe").
 *
 * Returns an empty string when the input has no alphanumeric content; callers
 * should treat that as "could not derive a slug" and require an explicit one.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // strip combining diacritical marks (NFKD-decomposed)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric runs -> single hyphen
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
}
