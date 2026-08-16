// ═══════════════════════════════════════════════════════════════
// Shared input sanitization & validation helpers
// ═══════════════════════════════════════════════════════════════

/** Strip HTML tags and trim whitespace from a string. */
export function sanitizeString(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(/<[^>]*>/g, "").trim();
}

/** Validate UUID v4 format. */
export function isValidUUID(input: unknown): boolean {
  if (typeof input !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    input
  );
}

/** Validate email format (RFC-lite). */
export function isValidEmail(input: unknown): boolean {
  if (typeof input !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

/** Validate phone number (digits, plus sign, dashes, spaces, parens). */
export function isValidPhone(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const cleaned = input.trim();
  if (cleaned.length < 7 || cleaned.length > 20) return false;
  return /^[+]?[\d\s\-().]+$/.test(cleaned);
}

/** Clamp a number to a safe range. */
export function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Ensure input is an array of strings (UUIDs). Returns sanitized array. */
export function sanitizeUUIDArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item) => isValidUUID(item));
}
