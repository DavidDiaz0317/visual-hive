const SECRET_KEYS = [
  "access_token",
  "id_token",
  "refresh_token",
  "authorization",
  "password",
  "secret",
  "token",
  "bearer",
  "cookie",
  "code",
  "key"
];

const REDACTION = "[REDACTED]";

export function sanitizeText(input: string): string {
  let value = input;
  for (const key of SECRET_KEYS) {
    const keyPattern = escapeRegExp(key);
    value = value.replace(new RegExp(`(${keyPattern})(\\s*[:=]\\s*)([^\\s,&;\\]\\)}]+)`, "gi"), `$1$2${REDACTION}`);
    value = value.replace(new RegExp(`([?&]${keyPattern}=)([^&#\\s]+)`, "gi"), `$1${REDACTION}`);
  }
  value = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTION}`);
  value = value.replace(/\bAuthorization:\s*[^\n\r]+/gi, `Authorization: ${REDACTION}`);
  value = value.replace(/\bCookie:\s*[^\n\r]+/gi, `Cookie: ${REDACTION}`);
  value = value.replace(/\bSet-Cookie:\s*[^\n\r]+/gi, `Set-Cookie: ${REDACTION}`);
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
