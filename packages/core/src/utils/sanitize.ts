const SECRET_KEYS = [
  "access_token",
  "id_token",
  "refresh_token",
  "authorization",
  "client_secret",
  "password",
  "secret",
  "token",
  "bearer",
  "cookie",
  "set-cookie",
  "code",
  "key"
];

const REDACTION = "[REDACTED]";

export function sanitizeText(input: string): string {
  let value = input;
  value = value.replace(
    /\b(authorization|bearer)(\s*[:=]\s*)Bearer[ \t]+([^\s,&;\])}"']+)(?:[ \t]+([^\s,&;\])}"']+))?/gi,
    `$1$2${REDACTION}`
  );
  for (const key of SECRET_KEYS) {
    const keyPattern = escapeRegExp(key);
    const flagPatterns = [...new Set([key, key.replaceAll("_", "-"), key.replaceAll("-", "_")])].map(escapeRegExp);
    value = value.replace(new RegExp(`(${keyPattern})(\\s*[:=]\\s*)([^\\s,&;\\]\\)}"']+)`, "gi"), `$1$2${REDACTION}`);
    value = value.replace(new RegExp(`(["']${keyPattern}["']\\s*:\\s*["'])([^"']+)(["'])`, "gi"), `$1${REDACTION}$3`);
    value = value.replace(new RegExp(`([?&]${keyPattern}=)([^&#\\s"']+)`, "gi"), `$1${REDACTION}`);
    for (const flagPattern of flagPatterns) {
      value = value.replace(new RegExp(`(--${flagPattern})(\\s+)([^\\s"']+)`, "gi"), `$1$2${REDACTION}`);
      value = value.replace(new RegExp(`(--${flagPattern}=)([^\\s"']+)`, "gi"), `$1${REDACTION}`);
    }
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
