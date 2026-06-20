/**
 * Lightweight file-integrity checks with zero native dependencies.
 *
 * We can't trust a client-declared mimetype or file extension, so for raster
 * uploads we sniff the leading "magic bytes" and confirm they match the claimed
 * type; for SVG we confirm the bytes parse as text containing a real <svg> root
 * (and reject script-bearing SVGs, which are an XSS vector). This is enough to
 * reject corrupted files and type spoofing without pulling in sharp/file-type.
 */

export type RasterImageType = "png" | "jpeg" | "webp";

/** Detect a raster image type from its magic bytes, or null if unrecognized. */
export function sniffRasterImage(buffer: Buffer): RasterImageType | null {
  if (buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

/** The image/* mimetype corresponding to a sniffed raster type. */
export function rasterMimeType(type: RasterImageType): string {
  return type === "jpeg" ? "image/jpeg" : `image/${type}`;
}

/**
 * Heuristic SVG integrity check: the bytes must decode as UTF-8 text with a
 * single well-formed <svg> root element. A NUL byte means the payload is binary
 * (not text), so it cannot be a real SVG. Script/event-handler content is
 * rejected separately by svgHasScript().
 */
export function isValidSvg(buffer: Buffer): boolean {
  let text: string;
  try {
    text = buffer.toString("utf8");
  } catch {
    return false;
  }
  if (text.includes("\0")) return false; // NUL byte => binary, not SVG text

  const lower = text.toLowerCase();
  const open = lower.indexOf("<svg");
  if (open === -1) return false;
  // Must close, either explicitly or self-closed within the root tag.
  if (!lower.includes("</svg>")) {
    const firstTagEnd = lower.indexOf(">", open);
    if (firstTagEnd === -1 || lower[firstTagEnd - 1] !== "/") return false;
  }
  return true;
}

/**
 * True if an SVG carries scripts or inline event handlers (XSS risk). The
 * handler pattern allows the attribute to be preceded by whitespace, a quote,
 * a slash, or a namespace colon so obfuscated forms (e.g. xmlns:onload=) are
 * still caught.
 */
export function svgHasScript(buffer: Buffer): boolean {
  const lower = buffer.toString("utf8").toLowerCase();
  return (
    lower.includes("<script") ||
    lower.includes("javascript:") ||
    /[\s:"'/]on\w+\s*=/.test(lower) // onload=, onclick=, xmlns:onload=, ...
  );
}

/** Lowercased file extension including the dot, e.g. ".webp" (or "" if none). */
export function extname(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}
