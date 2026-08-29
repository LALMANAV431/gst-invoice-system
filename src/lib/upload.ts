/**
 * Upload validation.
 *
 * The application accepted files with no MIME allow-list, no size cap and no
 * filename sanitisation. Three separate problems:
 *
 *   - an unbounded upload is a denial-of-service vector;
 *   - a trusted `Content-Type` header lets an attacker upload HTML or SVG that
 *     executes script when served back;
 *   - a filename taken from the client enables path traversal (`../../etc/...`)
 *     and, on Windows, reserved device names.
 *
 * Validation is by MAGIC BYTES, not the declared MIME type, because the client
 * controls the header and does not control the file's actual contents.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB, enough for a bill photo

export type AllowedKind = "image" | "document";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const DOCUMENT_TYPES = [...IMAGE_TYPES, "application/pdf"] as const;

export type UploadValidationResult =
  | { ok: true; mimeType: string; extension: string; bytes: number }
  | { ok: false; error: string };

/**
 * Detect the real type from the leading bytes.
 *
 * SVG is deliberately absent: it is XML, can carry `<script>`, and is a
 * well-known stored-XSS vector when served from the same origin.
 */
function sniffMimeType(bytes: Uint8Array): { mimeType: string; extension: string } | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);

  // JPEG: FF D8 FF
  if (startsWith(0xff, 0xd8, 0xff)) return { mimeType: "image/jpeg", extension: "jpg" };

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { mimeType: "image/png", extension: "png" };
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }

  // PDF: "%PDF-"
  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) {
    return { mimeType: "application/pdf", extension: "pdf" };
  }

  return null;
}

/** Validate size and true type. */
export function validateUpload(
  bytes: Uint8Array,
  kind: AllowedKind,
  declaredMimeType?: string
): UploadValidationResult {
  const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_UPLOAD_BYTES;

  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > limit) {
    return {
      ok: false,
      error: `File is too large. The maximum is ${Math.round(limit / 1024 / 1024)} MB.`,
    };
  }

  const sniffed = sniffMimeType(bytes);
  if (!sniffed) {
    return {
      ok: false,
      error: "Unsupported file type. Upload a JPEG, PNG, WebP or PDF.",
    };
  }

  const allowed: readonly string[] = kind === "image" ? IMAGE_TYPES : DOCUMENT_TYPES;
  if (!allowed.includes(sniffed.mimeType)) {
    return {
      ok: false,
      error:
        kind === "image"
          ? "Upload an image (JPEG, PNG or WebP)."
          : "Unsupported file type. Upload a JPEG, PNG, WebP or PDF.",
    };
  }

  // A mismatch between the declared and actual type is a signal worth rejecting:
  // legitimate clients do not misdeclare.
  if (declaredMimeType && declaredMimeType !== sniffed.mimeType) {
    return {
      ok: false,
      error: `File contents do not match the declared type (${declaredMimeType}).`,
    };
  }

  return {
    ok: true,
    mimeType: sniffed.mimeType,
    extension: sniffed.extension,
    bytes: bytes.length,
  };
}

/**
 * Produce a safe storage name.
 *
 * The original filename is never used as a path. A generated name plus the
 * sniffed extension removes traversal, reserved Windows device names, unicode
 * trickery and duplicate collisions in one step.
 */
export function safeStorageName(extension: string): string {
  const random = Array.from({ length: 16 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
  ).join("");
  return `${Date.now().toString(36)}-${random}.${extension}`;
}

/**
 * Sanitise a user-supplied filename for DISPLAY only.
 *
 * Never use the result as a filesystem path — use `safeStorageName()` for that.
 */
export function sanitiseDisplayName(name: string): string {
  return (
    name
      .replace(/[\r\n\t\0]/g, "")
      .replace(/[/\\]/g, "-")
      .replace(/\.{2,}/g, ".")
      .trim()
      .slice(0, 120) || "file"
  );
}
