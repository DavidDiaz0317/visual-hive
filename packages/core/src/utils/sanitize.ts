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
const LOCAL_PATH_SLUG_REDACTION = "[redacted-local-path-slug]";

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

export function repoRelativeArtifactPath(rootDir: string, artifactPath: string): string | undefined {
  const root = normalizePathForIssue(rootDir).replace(/\/+$/g, "");
  const candidate = normalizePathForIssue(artifactPath);
  const rootKey = lowerDrivePath(root);
  const candidateKey = lowerDrivePath(candidate);

  if (candidateKey === rootKey) {
    return ".";
  }

  if (candidateKey.startsWith(`${rootKey}/`)) {
    return candidate.slice(root.length + 1);
  }

  return undefined;
}

export function sanitizeArtifactPathForIssue(rootDir: string, artifactPath: string | undefined): string {
  if (!artifactPath) {
    return "";
  }

  const sanitized = sanitizeText(artifactPath);
  const normalized = normalizePathForIssue(sanitized);
  if (!isLikelyAbsolutePath(normalized)) {
    return normalized;
  }

  const relative = repoRelativeArtifactPath(rootDir, normalized);
  if (relative) {
    return relative;
  }

  const basename = normalized.split("/").filter(Boolean).at(-1) ?? "artifact";
  return `${EXTERNAL_PATH_REDACTION}/${basename}`;
}

export function sanitizeArtifactPathsForMarkdown(rootDir: string, markdown: string): string {
  let value = sanitizeText(markdown);
  value = value.replace(/[A-Za-z]:[\\/][^\s`)\]}",']+/g, (match) => sanitizeArtifactPathForIssue(rootDir, trimPathMatch(match)));
  value = value.replace(/(^|[\s(["'])(\/(?:Users|home)\/[^\s`)\]}",']+)/g, (_match, prefix: string, absolutePath: string) => {
    return `${prefix}${sanitizeArtifactPathForIssue(rootDir, trimPathMatch(absolutePath))}`;
  });
  value = value.replace(/\b[A-Za-z]__Users_[A-Za-z0-9._-]+(?:_OneDrive)?(?:_[A-Za-z0-9._-]+){2,}/g, LOCAL_PATH_SLUG_REDACTION);
  value = value.replace(/\b(?:Users|home)_[A-Za-z0-9._-]+(?:_[A-Za-z0-9._-]+){2,}/g, LOCAL_PATH_SLUG_REDACTION);
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePathForIssue(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function lowerDrivePath(value: string): string {
  return /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value;
}

function isLikelyAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value) || value.startsWith("/Users/") || value.startsWith("/home/") || value.startsWith("/");
}

function trimPathMatch(value: string): string {
  return value.replace(/[.,;:]+$/g, "");
}
