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
const EXTERNAL_PATH_REDACTION = "[redacted-external-path]";

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

export function repoRelativeArtifactPath(repoRoot: string, artifactPath: string): string {
  const cleaned = sanitizeText(artifactPath).replaceAll("\\", "/");
  if (!cleaned.trim()) return cleaned;
  if (!looksLikeAbsolutePath(cleaned)) return cleaned;

  const root = normalizePathForCompare(repoRoot);
  const candidate = normalizePathForCompare(cleaned);
  if (candidate === root) return ".";
  if (candidate.startsWith(`${root}/`)) {
    return candidate.slice(root.length + 1);
  }

  return `${EXTERNAL_PATH_REDACTION}/${safeBasename(cleaned)}`;
}

export function sanitizeArtifactPathForIssue(repoRoot: string, artifactPath: string): string {
  return repoRelativeArtifactPath(repoRoot, artifactPath);
}

export function sanitizeArtifactPathsForMarkdown(repoRoot: string, markdown: string): string {
  const windowsAbsolutePath = /[A-Za-z]:[\\/][^\s)\],`'"]+/g;
  const userPosixPath = /\/(?:Users|home)\/[^\s)\],`'"]+/g;
  return sanitizeText(markdown)
    .replace(windowsAbsolutePath, (match) => sanitizeArtifactPathForIssue(repoRoot, match))
    .replace(userPosixPath, (match) => sanitizeArtifactPathForIssue(repoRoot, match));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value) || value.startsWith("/");
}

function normalizePathForCompare(value: string): string {
  let normalized = value.replaceAll("\\", "/");
  normalized = normalized.replace(/^file:\/+/i, "");
  normalized = normalized.replace(/\/+/g, "/");
  normalized = normalized.replace(/\/$/g, "");
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function safeBasename(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/g, "");
  const basename = normalized.split("/").filter(Boolean).pop() ?? "artifact";
  return sanitizeText(basename).replace(/[^A-Za-z0-9_.-]+/g, "-") || "artifact";
}
