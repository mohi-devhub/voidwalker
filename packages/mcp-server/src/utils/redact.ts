// Sensitive key pattern matching and value redaction.
// Applied to all storage read outputs to prevent accidental credential exposure.

const SENSITIVE_PATTERNS = [
  /token/i,
  /apikey/i,
  /api_key/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /session/i,
  /\bauth\b/i,
  /credential/i,
  /private.?key/i,
  /refresh/i,
  /access.?key/i,
  /\bjwt\b/i,
  /bearer/i,
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(key));
}

export function redactValue(key: string, value: string): string {
  if (!isSensitiveKey(key)) return value;
  return "[REDACTED]";
}

export function redactEntries(entries: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    out[k] = redactValue(k, v);
  }
  return out;
}
