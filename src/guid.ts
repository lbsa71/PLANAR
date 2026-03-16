/**
 * Dot-path ↔ GUID conversion.
 *
 * Each path segment maps to a two-byte hex pair, zero-padded into
 * the standard GUID layout.
 *
 * Examples:
 *   "1"       → "01000000-0000-0000-0000-000000000000"
 *   "2.3.1"   → "02030100-0000-0000-0000-000000000000"
 *   "3.1.4.1" → "03010401-0000-0000-0000-000000000000"
 */

const GUID_BYTE_COUNT = 16;

/** Convert a dot-path (e.g. "2.3.1") to a deterministic GUID string. */
export function dotPathToGuid(dotPath: string): string {
  const segments = dotPath.split(".").map(Number);
  if (segments.some((s) => isNaN(s) || s < 0 || s > 255)) {
    throw new Error(
      `Invalid dot-path "${dotPath}": each segment must be 0-255`
    );
  }
  if (segments.length > GUID_BYTE_COUNT) {
    throw new Error(
      `Dot-path "${dotPath}" exceeds maximum depth of ${GUID_BYTE_COUNT}`
    );
  }

  const bytes = new Uint8Array(GUID_BYTE_COUNT);
  for (let i = 0; i < segments.length; i++) {
    bytes[i] = segments[i];
  }

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Format as GUID: 8-4-4-4-12
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Convert a GUID back to a dot-path, stripping trailing zeros. */
export function guidToDotPath(guid: string): string {
  const hex = guid.replace(/-/g, "");
  if (hex.length !== 32) {
    throw new Error(`Invalid GUID "${guid}": expected 32 hex characters`);
  }

  const bytes: number[] = [];
  for (let i = 0; i < 32; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }

  // Find the last non-zero byte
  let lastNonZero = -1;
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] !== 0) {
      lastNonZero = i;
      break;
    }
  }

  if (lastNonZero === -1) {
    throw new Error(`Invalid GUID "${guid}": all zeros`);
  }

  return bytes
    .slice(0, lastNonZero + 1)
    .map(String)
    .join(".");
}
