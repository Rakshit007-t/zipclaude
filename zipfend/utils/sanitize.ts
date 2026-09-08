/**
 * ZipRIGHT Input & URL Security Sanitization
 * Protects against Stored/Reflected XSS, Reverse Tabnabbing, and protocol injection.
 */

/**
 * Strips HTML tags, script constructs, control characters, and enforces optional max length.
 */
export function sanitizeText(input: unknown, maxLength?: number): string {
  if (typeof input !== 'string') return '';

  // 1. Remove null bytes and non-printable control characters (except newline/tab)
  let clean = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 2. Strip HTML tags and script-like tokens
  clean = clean.replace(/<[^>]*>?/gm, '');

  // 3. Trim excessive whitespace
  clean = clean.trim();

  // 4. Enforce max length constraint if specified
  if (maxLength && maxLength > 0 && clean.length > maxLength) {
    clean = clean.slice(0, maxLength);
  }

  return clean;
}

/**
 * Validates that a URL is strictly an HTTP or HTTPS scheme.
 * Rejects javascript:, data:, vbscript:, and file: schemes.
 */
export function sanitizeUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === '#') return null;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    // Strictly permit only http: and https: protocols
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return null;
  } catch {
    // Relative paths that don't throw are permitted if they start with '/'
    if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('\\')) {
      return trimmed;
    }
    return null;
  }
}

/**
 * Safely opens an external or outbound URL in a new window/tab.
 * Always applies 'noopener,noreferrer' to prevent Reverse Tabnabbing attacks,
 * and validates the protocol to prevent script execution.
 */
export function safeOpenUrl(rawUrl: string | null | undefined, target = '_blank'): void {
  const safe = sanitizeUrl(rawUrl);
  if (!safe) return;

  if (target === '_blank') {
    window.open(safe, '_blank', 'noopener,noreferrer');
  } else {
    window.location.href = safe;
  }
}
