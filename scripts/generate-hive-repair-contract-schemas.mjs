import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const schemaBase = "https://visual-hive.dev/schemas/";
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const array = (items, options = {}) => ({ type: "array", items, ...options });
const object = (required, properties, options = {}) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
  ...options
});
const integer = (minimum = 0, maximum) => ({
  type: "integer",
  minimum,
  ...(maximum === undefined ? {} : { maximum })
});

const visualTools = [
  "visual_hive_get_task_context",
  "visual_hive_get_issue_context",
  "visual_hive_search_surface",
  "visual_hive_get_visual_asset",
  "visual_hive_get_screenshot_set",
  "visual_hive_get_browser_evidence",
  "visual_hive_compare_assets",
  "visual_hive_get_repair_validation"
];

const common = {
  sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  gitCommit: { type: "string", pattern: "^[a-f0-9]{40}$" },
  boundedId: { type: "string", minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9][A-Za-z0-9._:@+~-]*$" },
  repositoryName: { type: "string", minLength: 3, maxLength: 512, pattern: "^(?!\\.\\.?/)(?![^/]+/\\.\\.?$)[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" },
  relativePath: { type: "string", minLength: 1, maxLength: 1024, pattern: "^(?!/)(?![A-Za-z]:)(?!.*[:\\\\\\u0000-\\u001f\\u007f])(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)(?!.*[. ](?:/|$))(?!(?:.*/)?(?:[cC][oO][nN]|[pP][rR][nN]|[aA][uU][xX]|[nN][uU][lL]|[cC][oO][mM][1-9]|[lL][pP][tT][1-9])(?:\\.|/|$)).+$" },
  timestamp: { type: "string", format: "date-time" },
  shortText: { type: "string", minLength: 1, maxLength: 4096, pattern: "\\S" },
  providerText: { type: "string", minLength: 1, maxLength: 512, pattern: "\\S" },
  viewport: object(
    ["viewportId", "width", "height", "deviceScaleFactor"],
    {
      viewportId: ref("boundedId"),
      width: integer(1, 16384),
      height: integer(1, 16384),
      deviceScaleFactor: { type: "number", exclusiveMinimum: 0, maximum: 8 }
    }
  ),
  profile: object(
    ["profileId", "profileDigest", "targetId", "requestKinds", "contractIds", "routes", "scenarioIds", "viewports", "validationCommandId"],
    {
      profileId: ref("boundedId"),
      profileDigest: ref("sha256"),
      targetId: ref("boundedId"),
      requestKinds: array({ enum: ["reproduction", "capture", "patch_validation"] }, { minItems: 1, maxItems: 3, uniqueItems: true }),
      contractIds: array(ref("boundedId"), { maxItems: 256, uniqueItems: true }),
      routes: array({ type: "string", minLength: 1, maxLength: 2048 }, { maxItems: 128, uniqueItems: true }),
      scenarioIds: array(ref("boundedId"), { maxItems: 128, uniqueItems: true }),
      viewports: array(ref("viewport"), { minItems: 1, maxItems: 32 }),
      validationCommandId: ref("boundedId")
    }
  ),
  finding: object(
    ["fingerprint", "repositoryFingerprint", "publicationRole", "rootCauseKey", "recurrenceKey"],
    {
      fingerprint: { type: "string", minLength: 1, maxLength: 2048, pattern: "\\S" },
      repositoryFingerprint: ref("sha256"),
      publicationRole: { enum: ["canonical", "derivative", "aggregate"] },
      rootCauseKey: { type: "string", minLength: 1, maxLength: 2048, pattern: "\\S" },
      recurrenceKey: { type: "string", minLength: 1, maxLength: 2048, pattern: "\\S" }
    }
  ),
  provider: object(
    ["providerId", "providerKind", "model", "executableIdentityDigest", "capabilityDigest", "modelConfigurationDigest"],
    {
      providerId: ref("boundedId"),
      providerKind: ref("providerText"),
      model: ref("providerText"),
      executableIdentityDigest: ref("sha256"),
      capabilityDigest: ref("sha256"),
      modelConfigurationDigest: ref("sha256")
    }
  ),
  providerUsage: object(
    ["inputBytes", "imageBytes", "modelInputTokens", "modelOutputTokens", "providerCostUsdMicros", "wallMilliseconds"],
    {
      inputBytes: integer(), imageBytes: integer(), modelInputTokens: integer(), modelOutputTokens: integer(),
      providerCostUsdMicros: integer(0, Number.MAX_SAFE_INTEGER), wallMilliseconds: integer()
    }
  ),
  toolReceipt: object(
    ["callId", "turnId", "sequence", "toolName", "argumentsDigest", "status", "startedAt", "textBytes", "imageBytes"],
    {
      callId: ref("sha256"),
      turnId: ref("sha256"),
      sequence: integer(),
      toolName: { enum: visualTools },
      argumentsDigest: ref("sha256"),
      resultDigest: ref("sha256"),
      status: { enum: ["started", "passed", "failed", "blocked", "lost"] },
      startedAt: ref("timestamp"),
      completedAt: ref("timestamp"),
      textBytes: integer(0, 16 * 1024 * 1024),
      imageBytes: integer(0, 64 * 1024 * 1024),
      errorCode: ref("boundedId"),
      outcomeDigest: ref("sha256")
    },
    {
      allOf: [
        { if: { properties: { status: { const: "started" } }, required: ["status"] }, then: { not: { anyOf: [{ required: ["completedAt"] }, { required: ["errorCode"] }, { required: ["outcomeDigest"] }] } }, else: { required: ["completedAt", "outcomeDigest"] } },
        { if: { properties: { status: { const: "passed" } }, required: ["status"] }, then: { required: ["resultDigest"], not: { required: ["errorCode"] } } },
        { if: { properties: { status: { enum: ["failed", "blocked", "lost"] } }, required: ["status"] }, then: { required: ["errorCode"] } }
      ]
    }
  ),
  validationRequestSpec: object(
    ["requestId", "idempotencyKey", "sessionId", "attemptId", "kind", "commitRole", "profileId", "profileDigest", "commitSha", "requestDigest"],
    {
      requestId: ref("boundedId"),
      idempotencyKey: ref("sha256"),
      sessionId: ref("sha256"),
      attemptId: ref("boundedId"),
      kind: { enum: ["reproduction", "capture", "patch_validation"] },
      commitRole: { enum: ["base", "candidate"] },
      profileId: ref("boundedId"),
      profileDigest: ref("sha256"),
      commitSha: ref("gitCommit"),
      authorizationDigest: ref("sha256"),
      requestDigest: ref("sha256")
    }
  )
};

const sessionDefs = {
  ...common,
  repository: object(
    ["name", "repositoryFingerprint", "baseSha", "baseTreeSha"],
    {
      name: ref("repositoryName"),
      repositoryId: { type: "string", minLength: 1, maxLength: 128 },
      repositoryFingerprint: ref("sha256"),
      baseSha: ref("gitCommit"),
      baseTreeSha: ref("gitCommit")
    }
  ),
  task: object(
    ["taskId", "taskContextDigest", "issueSource", "issueExternalId", "problemStatementDigest", "imageAttachments"],
    {
      taskId: ref("boundedId"),
      taskContextDigest: ref("sha256"),
      issueSource: { enum: ["swebench_multimodal", "github", "fixture", "other"] },
      issueExternalId: { type: "string", minLength: 1, maxLength: 512, pattern: "\\S" },
      problemStatementDigest: ref("sha256"),
      imageAttachments: array(object(
        ["position", "assetId", "role", "sha256", "mediaType", "size"],
        {
          position: integer(0, 63),
          assetId: ref("boundedId"),
          role: { enum: ["problem", "expected", "current", "reference"] },
          sha256: ref("sha256"),
          mediaType: { enum: ["image/png", "image/jpeg", "image/webp", "image/gif"] },
          size: integer(1, 32 * 1024 * 1024)
        }
      ), { maxItems: 64 })
    }
  ),
  sourceContext: object(
    ["digest", "maxBytes", "totalBytes", "files", "omittedPaths", "truncated"],
    {
      digest: ref("sha256"),
      maxBytes: integer(1, 64 * 1024 * 1024),
      totalBytes: integer(0, 64 * 1024 * 1024),
      files: array(object(
        ["path", "sha256", "size", "classification"],
        {
          path: ref("relativePath"),
          sha256: ref("sha256"),
          size: integer(0, 8 * 1024 * 1024),
          classification: { enum: ["source", "test", "config", "documentation"] }
        }
      ), { maxItems: 512 }),
      omittedPaths: integer(),
      truncated: { type: "boolean" }
    }
  ),
  budgetLimits: object(
    ["maxTurns", "maxToolCalls", "maxInputBytes", "maxImageBytes", "maxModelInputTokens", "maxModelOutputTokens", "maxProviderCostUsdMicros", "maxWallSeconds", "maxRepairAttempts"],
    {
      maxTurns: integer(1, 128),
      maxToolCalls: integer(1, 128),
      maxInputBytes: integer(1, 64 * 1024 * 1024),
      maxImageBytes: integer(0, 256 * 1024 * 1024),
      maxModelInputTokens: integer(1, 10_000_000),
      maxModelOutputTokens: integer(1, 10_000_000),
      maxProviderCostUsdMicros: integer(0, Number.MAX_SAFE_INTEGER),
      maxWallSeconds: integer(1, 86400),
      maxRepairAttempts: integer(1, 32)
    }
  ),
  budgetUsage: object(
    ["turnsConsumed", "toolCallsConsumed", "inputBytesConsumed", "imageBytesConsumed", "modelInputTokensConsumed", "modelOutputTokensConsumed", "providerCostUsdMicrosConsumed", "wallMillisecondsConsumed"],
    {
      turnsConsumed: integer(),
      toolCallsConsumed: integer(),
      inputBytesConsumed: integer(),
      imageBytesConsumed: integer(),
      modelInputTokensConsumed: integer(),
      modelOutputTokensConsumed: integer(),
      providerCostUsdMicrosConsumed: integer(0, Number.MAX_SAFE_INTEGER),
      wallMillisecondsConsumed: integer()
    }
  ),
  authorization: object(
    ["authorizationId", "issuedAt", "expiresAt", "repositoryFingerprint", "taskContextDigest", "baseSha", "profile", "toolNames", "assetIds", "budgetDigest", "configDigest", "toolRegistryDigest", "promptSchemaDigest", "authorizationDigest"],
    {
      authorizationId: ref("boundedId"),
      issuedAt: ref("timestamp"),
      expiresAt: ref("timestamp"),
      repositoryFingerprint: ref("sha256"),
      taskContextDigest: ref("sha256"),
      baseSha: ref("gitCommit"),
      profile: ref("profile"),
      toolNames: array({ enum: visualTools }, { minItems: visualTools.length, maxItems: visualTools.length, uniqueItems: true }),
      assetIds: array(ref("boundedId"), { maxItems: 128, uniqueItems: true }),
      budgetDigest: ref("sha256"),
      configDigest: ref("sha256"),
      toolRegistryDigest: ref("sha256"),
      promptSchemaDigest: ref("sha256"),
      visualHiveManifestSha256: ref("sha256"),
      visualHiveEntrypointSha256: ref("sha256"),
      authorizationDigest: ref("sha256")
    },
    {
      dependentRequired: {
        visualHiveManifestSha256: ["visualHiveEntrypointSha256"],
        visualHiveEntrypointSha256: ["visualHiveManifestSha256"]
      }
    }
  ),
  attempt: object(
    ["attemptId", "ordinal", "state", "startedAt", "promptDigest", "turnIds", "validationRequestIds"],
    {
      attemptId: ref("boundedId"),
      ordinal: integer(),
      state: { enum: ["started", "candidate", "failed", "blocked", "exhausted"] },
      startedAt: ref("timestamp"),
      completedAt: ref("timestamp"),
      promptDigest: ref("sha256"),
      turnIds: array(ref("sha256"), { maxItems: 128, uniqueItems: true }),
      candidatePatchDigest: ref("sha256"),
      candidateHeadSha: ref("gitCommit"),
      candidateHeadTreeSha: ref("gitCommit"),
      validationRequestIds: array(ref("boundedId"), { maxItems: 128, uniqueItems: true })
    },
    {
      allOf: [
        { if: { properties: { state: { const: "started" } }, required: ["state"] }, then: { not: { required: ["completedAt"] } } },
        { if: { properties: { state: { const: "candidate" } }, required: ["state"] }, then: { required: ["completedAt", "candidatePatchDigest", "candidateHeadSha", "candidateHeadTreeSha"] } },
        { if: { properties: { state: { enum: ["failed", "blocked", "exhausted"] } }, required: ["state"] }, then: { required: ["completedAt"] } },
        { if: { anyOf: [{ required: ["candidatePatchDigest"] }, { required: ["candidateHeadSha"] }, { required: ["candidateHeadTreeSha"] }] }, then: { required: ["candidatePatchDigest", "candidateHeadSha", "candidateHeadTreeSha"] } }
      ]
    }
  ),
  turn: object(
    ["turnId", "attemptId", "ordinal", "state", "startedAt", "inputDigest", "providerInputDigest", "consumedToolOutcomeDigests", "providerIdentityDigest"],
    {
      turnId: ref("sha256"),
      attemptId: ref("boundedId"),
      ordinal: integer(),
      state: { enum: ["started", "completed", "failed", "blocked", "lost"] },
      startedAt: ref("timestamp"),
      completedAt: ref("timestamp"),
      inputDigest: ref("sha256"),
      providerInputDigest: ref("sha256"),
      previousTurnOutputDigest: ref("sha256"),
      consumedToolOutcomeDigests: array(ref("sha256"), { maxItems: 128, uniqueItems: true }),
      providerIdentityDigest: ref("sha256"),
      usage: ref("providerUsage"),
      providerReceiptDigest: ref("sha256"),
      outputKind: { enum: ["tool_request", "final_result", "error"] },
      outputDigest: ref("sha256"),
      toolCallId: ref("sha256"),
      errorCode: ref("boundedId")
    },
    {
      allOf: [
        { if: { properties: { state: { const: "started" } }, required: ["state"] }, then: { not: { anyOf: [{ required: ["completedAt"] }, { required: ["outputKind"] }, { required: ["outputDigest"] }, { required: ["toolCallId"] }, { required: ["errorCode"] }, { required: ["usage"] }, { required: ["providerReceiptDigest"] }] } } },
        { if: { properties: { state: { const: "completed" } }, required: ["state"] }, then: { required: ["completedAt", "outputKind", "outputDigest", "usage", "providerReceiptDigest"] } },
        { if: { properties: { state: { enum: ["failed", "blocked"] } }, required: ["state"] }, then: { required: ["completedAt", "errorCode", "usage", "providerReceiptDigest"] } },
        { if: { properties: { state: { const: "lost" } }, required: ["state"] }, then: { required: ["completedAt", "errorCode", "usage"] } },
        { if: { properties: { outputKind: { const: "tool_request" } }, required: ["outputKind"] }, then: { required: ["toolCallId"] }, else: { not: { required: ["toolCallId"] } } }
      ]
    }
  ),
  validationRequest: object(
    ["requestId", "idempotencyKey", "sessionId", "attemptId", "kind", "commitRole", "profileId", "profileDigest", "commitSha", "requestDigest", "state", "requestedAt"],
    {
      ...common.validationRequestSpec.properties,
      state: { enum: ["requested", "started", "completed", "failed", "blocked", "lost"] },
      requestedAt: ref("timestamp"),
      startedAt: ref("timestamp"),
      completedAt: ref("timestamp"),
      receiptDigest: ref("sha256"),
      errorCode: ref("boundedId")
    },
    {
      allOf: [
        { if: { properties: { state: { const: "requested" } }, required: ["state"] }, then: { not: { anyOf: [{ required: ["startedAt"] }, { required: ["completedAt"] }, { required: ["receiptDigest"] }, { required: ["errorCode"] }] } } },
        { if: { properties: { state: { const: "started" } }, required: ["state"] }, then: { required: ["startedAt"], not: { anyOf: [{ required: ["completedAt"] }, { required: ["receiptDigest"] }, { required: ["errorCode"] }] } } },
        { if: { properties: { state: { const: "completed" } }, required: ["state"] }, then: { required: ["startedAt", "completedAt", "receiptDigest"], not: { required: ["errorCode"] } } },
        { if: { properties: { state: { enum: ["failed", "blocked", "lost"] } }, required: ["state"] }, then: { required: ["completedAt", "errorCode"] } }
      ]
    }
  )
};

const sessionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${schemaBase}visual-hive.hive-repair-session.schema.json`,
  title: "Hive Repair Session v1",
  ...object(
    ["schemaVersion", "digestAlgorithm", "createdAt", "updatedAt", "deadlineAt", "requestedMode", "effectiveMode", "state", "repository", "finding", "task", "capability", "sourceContext", "validationProfiles", "promptIdentities", "executionIdentities", "provider", "budgets", "attempts", "turns", "toolReceipts", "validationRequests", "sessionId", "transcriptDigest", "sessionDigest"],
    {
      schemaVersion: { const: "hive.repair-session.v1" },
      digestAlgorithm: { const: "hive.canonical-json.sha256.v1" },
      createdAt: ref("timestamp"), updatedAt: ref("timestamp"), deadlineAt: ref("timestamp"),
      requestedMode: { enum: ["off", "auto", "on", "required"] },
      effectiveMode: { enum: ["standard", "visual_hive"] },
      state: { enum: ["planned", "active", "awaiting_validation", "candidate", "completed", "failed", "blocked", "exhausted"] },
      terminal: object(
        ["code", "message", "retryable"],
        {
          code: { enum: ["completed", "provider_failed", "provider_identity_mismatch", "tool_failed", "validation_failed", "authorization_expired", "budget_exhausted", "blocked", "internal_error"] },
          message: ref("shortText"), retryable: { type: "boolean" },
          exhaustedLimit: { enum: ["turns", "tool_calls", "input_bytes", "image_bytes", "model_input_tokens", "model_output_tokens", "provider_cost", "wall_time", "repair_attempts"] }
        }
      ),
      repository: ref("repository"),
      finding: ref("finding"),
      task: ref("task"),
      capability: object(
        ["selectionReasons"],
        {
          selectionReasons: array(ref("shortText"), { maxItems: 64, uniqueItems: true }),
          visualHiveVersion: ref("providerText"), visualHiveCommit: ref("gitCommit"), visualHiveManifestSha256: ref("sha256"), visualHiveEntrypointSha256: ref("sha256"), toolProtocolDigest: ref("sha256"), validationToolRegistryDigest: ref("sha256")
        },
        {
          dependentRequired: {
            visualHiveManifestSha256: ["visualHiveEntrypointSha256"],
            visualHiveEntrypointSha256: ["visualHiveManifestSha256"]
          }
        }
      ),
      sourceContext: ref("sourceContext"),
      validationProfiles: array(ref("profile"), { maxItems: 64 }),
      promptIdentities: object(
        ["systemPromptDigest", "repairPromptDigest", "toolSchemaDigest", "taskSchemaDigest", "modelConfigurationDigest"],
        { systemPromptDigest: ref("sha256"), repairPromptDigest: ref("sha256"), toolSchemaDigest: ref("sha256"), taskSchemaDigest: ref("sha256"), modelConfigurationDigest: ref("sha256") }
      ),
      executionIdentities: object(
        ["configDigest", "toolRegistryDigest", "promptSchemaDigest"],
        { configDigest: ref("sha256"), toolRegistryDigest: ref("sha256"), promptSchemaDigest: ref("sha256") }
      ),
      provider: ref("provider"),
      budgets: object(["limits", "usage"], { limits: ref("budgetLimits"), usage: ref("budgetUsage") }),
      attempts: array(ref("attempt"), { maxItems: 32 }),
      turns: array(ref("turn"), { maxItems: 4096 }),
      toolReceipts: array(ref("toolReceipt"), { maxItems: 4096 }),
      validationRequests: array(ref("validationRequest"), { maxItems: 4096 }),
      sessionId: ref("sha256"), authorization: ref("authorization"), transcriptDigest: ref("sha256"), sessionDigest: ref("sha256")
    },
    {
      allOf: [
        { if: { properties: { requestedMode: { const: "off" } }, required: ["requestedMode"] }, then: { properties: { effectiveMode: { const: "standard" } } } },
        { if: { properties: { requestedMode: { enum: ["on", "required"] } }, required: ["requestedMode"] }, then: { properties: { effectiveMode: { const: "visual_hive" } } } },
        {
          if: { properties: { effectiveMode: { const: "standard" } }, required: ["effectiveMode"] },
          then: {
            not: { required: ["authorization"] },
            properties: {
              toolReceipts: { maxItems: 0 },
              validationRequests: { items: { not: { required: ["authorizationDigest"] } } }
            }
          }
        },
        {
          if: { properties: { effectiveMode: { const: "visual_hive" } }, required: ["effectiveMode"] },
          then: {
            required: ["authorization"],
            properties: {
              capability: { required: ["selectionReasons", "visualHiveVersion", "visualHiveCommit", "toolProtocolDigest", "validationToolRegistryDigest"] },
              validationRequests: { items: { required: ["authorizationDigest"] } }
            }
          }
        },
        { if: { properties: { state: { enum: ["completed", "failed", "blocked", "exhausted"] } }, required: ["state"] }, then: { required: ["terminal"] }, else: { not: { required: ["terminal"] } } }
      ]
    }
  ),
  $defs: sessionDefs
};

const resultDefs = {
  ...common,
  resultRepository: object(
    ["name", "repositoryFingerprint"],
    { name: ref("repositoryName"), repositoryId: { type: "string", minLength: 1, maxLength: 128 }, repositoryFingerprint: ref("sha256") }
  ),
  changedFile: object(
    ["path", "status"],
    {
      path: ref("relativePath"), status: { enum: ["added", "modified", "deleted", "renamed"] }, previousPath: ref("relativePath"),
      beforeSha256: ref("sha256"), afterSha256: ref("sha256"), beforeMode: { type: "string", pattern: "^[0-7]{6}$" }, afterMode: { type: "string", pattern: "^[0-7]{6}$" }
    },
    {
      allOf: [
        { if: { properties: { status: { const: "added" } }, required: ["status"] }, then: { required: ["afterSha256", "afterMode"], not: { anyOf: [{ required: ["beforeSha256"] }, { required: ["beforeMode"] }, { required: ["previousPath"] }] } } },
        { if: { properties: { status: { const: "deleted" } }, required: ["status"] }, then: { required: ["beforeSha256", "beforeMode"], not: { anyOf: [{ required: ["afterSha256"] }, { required: ["afterMode"] }, { required: ["previousPath"] }] } } },
        { if: { properties: { status: { const: "modified" } }, required: ["status"] }, then: { required: ["beforeSha256", "afterSha256", "beforeMode", "afterMode"], not: { required: ["previousPath"] } } },
        { if: { properties: { status: { const: "renamed" } }, required: ["status"] }, then: { required: ["previousPath", "beforeSha256", "afterSha256", "beforeMode", "afterMode"] } }
      ]
    }
  ),
  resultAttempt: object(
    ["attemptId", "ordinal", "state", "promptDigest", "startedAt", "completedAt", "turnCount", "toolCallCount"],
    {
      attemptId: ref("boundedId"), ordinal: integer(), state: { enum: ["candidate", "failed", "blocked", "exhausted"] }, promptDigest: ref("sha256"),
      startedAt: ref("timestamp"), completedAt: ref("timestamp"), turnCount: integer(), toolCallCount: integer()
    }
  )
};

const resultSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${schemaBase}visual-hive.hive-repair-result.schema.json`,
  title: "Hive Repair Result v1",
  ...object(
    ["schemaVersion", "digestAlgorithm", "generatedAt", "sessionId", "sessionDigest", "transcriptDigest", "effectiveMode", "taskId", "taskContextDigest", "repository", "finding", "baseSha", "baseTreeSha", "headSha", "headTreeSha", "diff", "provider", "attempts", "toolReceipts", "validationRequests", "status", "resultDigest"],
    {
      schemaVersion: { const: "hive.repair-result.v1" }, digestAlgorithm: { const: "hive.canonical-json.sha256.v1" }, generatedAt: ref("timestamp"),
      sessionId: ref("sha256"), sessionDigest: ref("sha256"), transcriptDigest: ref("sha256"), effectiveMode: { enum: ["standard", "visual_hive"] },
      taskId: ref("boundedId"), taskContextDigest: ref("sha256"), repository: ref("resultRepository"), finding: ref("finding"),
      baseSha: ref("gitCommit"), baseTreeSha: ref("gitCommit"), headSha: ref("gitCommit"), headTreeSha: ref("gitCommit"),
      diff: object(
        ["algorithm", "sha256", "changedFiles"],
        { algorithm: { const: "git.diff.binary.sha256.v1" }, sha256: ref("sha256"), changedFiles: array(ref("changedFile"), { minItems: 1, maxItems: 4096 }) }
      ),
      provider: ref("provider"), attempts: array(ref("resultAttempt"), { minItems: 1, maxItems: 32 }), toolReceipts: array(ref("toolReceipt"), { maxItems: 4096 }),
      authorizationDigest: ref("sha256"), validationRequests: array(ref("validationRequestSpec"), { minItems: 1, maxItems: 256 }),
      claimedOutcome: object(["summary", "advisory"], { summary: ref("shortText"), advisory: { const: true } }),
      status: { const: "candidate" }, resultDigest: ref("sha256")
    },
    {
      allOf: [
        {
          if: { properties: { effectiveMode: { const: "standard" } }, required: ["effectiveMode"] },
          then: {
            not: { required: ["authorizationDigest"] },
            properties: {
              toolReceipts: { maxItems: 0 },
              validationRequests: { items: { not: { required: ["authorizationDigest"] } } }
            }
          }
        },
        {
          if: { properties: { effectiveMode: { const: "visual_hive" } }, required: ["effectiveMode"] },
          then: {
            required: ["authorizationDigest"],
            properties: { validationRequests: { items: { required: ["authorizationDigest"] } } }
          }
        }
      ]
    }
  ),
  $defs: resultDefs
};

for (const [file, schema] of [
  ["visual-hive.hive-repair-session.schema.json", sessionSchema],
  ["visual-hive.hive-repair-result.schema.json", resultSchema]
]) {
  await writeFile(path.join(root, "schemas", file), `${JSON.stringify(schema, null, 2)}\n`, "utf8");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))).map((key) => [key, canonicalValue(value[key])]));
  }
  return Object.is(value, -0) ? 0 : value;
}

function vector(name, projection) {
  const canonical = JSON.stringify(canonicalValue(projection));
  return { name, projection, canonical, sha256: createHash("sha256").update(canonical, "utf8").digest("hex") };
}

const profileProjection = {
  profileId: "profile.repair",
  targetId: "target.app",
  requestKinds: ["capture", "patch_validation", "reproduction"],
  contractIds: ["contract.card", "contract.secondary"],
  routes: ["/", "/settings"],
  scenarioIds: ["default"],
  viewports: [{ viewportId: "desktop", width: 1280, height: 720, deviceScaleFactor: 1 }],
  validationCommandId: "command.playwright"
};
const profileVector = vector("validation-profile", profileProjection);
const providerVector = vector("provider-identity", {
  providerId: "provider.fixture",
  providerKind: "fixture",
  model: "fixture-model",
  executableIdentityDigest: "2".repeat(64),
  capabilityDigest: "3".repeat(64),
  modelConfigurationDigest: "1".repeat(64)
});
const sourceProjection = {
  files: [{ path: "src/App.tsx", sha256: "8".repeat(64), size: 200, classification: "source" }],
  omittedPaths: 0,
  truncated: false
};
const repositoryFingerprint = vector("repository-fingerprint", { repository: "owner/repo", repositoryId: "42" }).sha256;
const sessionProjection = {
  schemaVersion: "hive.repair-session-id.v1",
  repository: { name: "owner/repo", repositoryId: "42", repositoryFingerprint },
  finding: { repositoryFingerprint: "9".repeat(64), recurrenceKey: "recurrence/visual_regression/card" },
  task: { taskId: "task.card-layout", issueSource: "fixture", issueExternalId: "fixture-1", problemStatementDigest: "2".repeat(64) },
  baseSha: "a".repeat(40)
};
const sessionVector = vector("repair-session-id", sessionProjection);
const attemptProjection = { schemaVersion: "hive.repair-attempt-id.v1", sessionId: sessionVector.sha256, ordinal: 0, promptDigest: "4".repeat(64) };
const attemptVector = vector("repair-attempt-id", attemptProjection);
const turnInputProjection = { schemaVersion: "hive.repair-turn-input.v1", sessionId: sessionVector.sha256, attemptId: attemptVector.sha256, ordinal: 0, providerInputDigest: "5".repeat(64), previousTurnOutputDigest: null, consumedToolOutcomeDigests: [] };
const turnInputVector = vector("repair-turn-input", turnInputProjection);
const turnProjection = { schemaVersion: "hive.repair-turn-id.v1", sessionId: sessionVector.sha256, attemptId: attemptVector.sha256, ordinal: 0, inputDigest: turnInputVector.sha256 };
const turnVector = vector("repair-turn-id", turnProjection);
const callProjection = { schemaVersion: "hive.repair-tool-call-id.v1", sessionId: sessionVector.sha256, turnId: turnVector.sha256, sequence: 0, toolName: "visual_hive_get_task_context", argumentsDigest: "6".repeat(64) };
const callVector = vector("repair-tool-call-id", callProjection);
const toolOutcomeProjection = { schemaVersion: "hive.repair-tool-outcome.v1", callId: callVector.sha256, toolName: "visual_hive_get_task_context", argumentsDigest: "6".repeat(64), resultDigest: "b".repeat(64), status: "passed", textBytes: 256, imageBytes: 128, errorCode: null };
const authorizationContent = {
  authorizationId: "authorization.fixture",
  issuedAt: "2026-07-14T10:55:00.000Z",
  expiresAt: "2026-07-14T13:00:00.000Z",
  repositoryFingerprint,
  taskContextDigest: "1".repeat(64),
  baseSha: "a".repeat(40),
  profile: { ...profileProjection, profileDigest: profileVector.sha256 },
  toolNames: [...visualTools].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
  assetIds: ["asset.reference"],
  budgetDigest: "b".repeat(64),
  configDigest: "c".repeat(64),
  toolRegistryDigest: "d".repeat(64),
  promptSchemaDigest: "e".repeat(64),
  visualHiveManifestSha256: "f".repeat(64),
  visualHiveEntrypointSha256: "0".repeat(64)
};
const authorizationVector = vector("execution-authorization", authorizationContent);
const requestIdentityProjection = {
  schemaVersion: "hive.repair-validation-request-identity.v1",
  sessionId: sessionVector.sha256,
  attemptId: attemptVector.sha256,
  kind: "patch_validation",
  commitRole: "candidate",
  profileId: "profile.repair",
  profileDigest: profileVector.sha256,
  commitSha: "b".repeat(40),
  authorizationDigest: authorizationVector.sha256
};
const requestIdentityVector = vector("validation-request-idempotency", requestIdentityProjection);
const requestIdProjection = { ...requestIdentityProjection, schemaVersion: "hive.repair-validation-request-id.v1" };
const requestIdVector = vector("validation-request-id", requestIdProjection);
const requestDigestProjection = {
  schemaVersion: "hive.repair-validation-request.v1",
  requestId: requestIdVector.sha256,
  idempotencyKey: requestIdentityVector.sha256,
  sessionId: sessionVector.sha256,
  attemptId: attemptVector.sha256,
  kind: "patch_validation",
  commitRole: "candidate",
  profileId: "profile.repair",
  profileDigest: profileVector.sha256,
  commitSha: "b".repeat(40),
  authorizationDigest: authorizationVector.sha256
};

const repeatSha = (character) => character.repeat(64);
const repeatCommit = (character) => character.repeat(40);
const digest = (value) => vector("digest", value).sha256;

function buildFullContractVectors(mode) {
  const visual = mode === "visual_hive";
  const repository = {
    name: "owner/repo",
    repositoryId: "42",
    repositoryFingerprint,
    baseSha: repeatCommit("a"),
    baseTreeSha: repeatCommit("c")
  };
  const rootCauseKey = "finding/visual_regression/card";
  const finding = {
    fingerprint: "visual-hive:fixture:card-layout",
    repositoryFingerprint: createHash("sha256").update(`owner/repo\0${rootCauseKey}`, "utf8").digest("hex"),
    publicationRole: "canonical",
    rootCauseKey,
    recurrenceKey: "recurrence/visual_regression/card"
  };
  const task = {
    taskId: "task.card-layout",
    taskContextDigest: repeatSha("1"),
    issueSource: "fixture",
    issueExternalId: "fixture-1",
    problemStatementDigest: repeatSha("2"),
    imageAttachments: [{ position: 0, assetId: "asset.reference", role: "reference", sha256: repeatSha("3"), mediaType: "image/png", size: 128 }]
  };
  const profile = { ...profileProjection, profileDigest: profileVector.sha256 };
  const limits = {
    maxTurns: 8,
    maxToolCalls: 8,
    maxInputBytes: 1_000_000,
    maxImageBytes: 1_000_000,
    maxModelInputTokens: 20_000,
    maxModelOutputTokens: 10_000,
    maxProviderCostUsdMicros: 5_000_000,
    maxWallSeconds: 1800,
    maxRepairAttempts: 2
  };
  const provider = { ...providerVector.projection };
  const sessionId = digest({
    schemaVersion: "hive.repair-session-id.v1",
    repository: {
      name: repository.name,
      repositoryId: repository.repositoryId,
      repositoryFingerprint: repository.repositoryFingerprint
    },
    finding: { repositoryFingerprint: finding.repositoryFingerprint, recurrenceKey: finding.recurrenceKey },
    task: {
      taskId: task.taskId,
      issueSource: task.issueSource,
      issueExternalId: task.issueExternalId,
      problemStatementDigest: task.problemStatementDigest
    },
    baseSha: repository.baseSha
  });
  const promptDigest = repeatSha("4");
  const attemptId = digest({ schemaVersion: "hive.repair-attempt-id.v1", sessionId, ordinal: 0, promptDigest });
  const providerIdentityDigest = providerVector.sha256;
  const firstTurnInput = {
    schemaVersion: "hive.repair-turn-input.v1",
    sessionId,
    attemptId,
    ordinal: 0,
    providerInputDigest: repeatSha("5"),
    previousTurnOutputDigest: null,
    consumedToolOutcomeDigests: []
  };
  const firstTurnInputDigest = digest(firstTurnInput);
  const firstTurnId = digest({ schemaVersion: "hive.repair-turn-id.v1", sessionId, attemptId, ordinal: 0, inputDigest: firstTurnInputDigest });
  const receiptIdentity = {
    turnId: firstTurnId,
    sequence: 0,
    toolName: "visual_hive_get_task_context",
    argumentsDigest: repeatSha("6")
  };
  const callId = digest({ schemaVersion: "hive.repair-tool-call-id.v1", sessionId, ...receiptIdentity });
  const receiptOutcome = {
    schemaVersion: "hive.repair-tool-outcome.v1",
    callId,
    toolName: receiptIdentity.toolName,
    argumentsDigest: receiptIdentity.argumentsDigest,
    resultDigest: repeatSha("b"),
    status: "passed",
    textBytes: 256,
    imageBytes: 128,
    errorCode: null
  };
  const receipt = {
    ...receiptIdentity,
    callId,
    resultDigest: receiptOutcome.resultDigest,
    status: "passed",
    startedAt: "2026-07-14T11:12:00.000Z",
    completedAt: "2026-07-14T11:13:00.000Z",
    textBytes: receiptOutcome.textBytes,
    imageBytes: receiptOutcome.imageBytes,
    outcomeDigest: digest(receiptOutcome)
  };
  const firstTurn = {
    turnId: firstTurnId,
    attemptId,
    ordinal: 0,
    state: "completed",
    startedAt: "2026-07-14T11:10:00.000Z",
    completedAt: "2026-07-14T11:11:00.000Z",
    inputDigest: firstTurnInputDigest,
    providerInputDigest: firstTurnInput.providerInputDigest,
    consumedToolOutcomeDigests: [],
    providerIdentityDigest,
    usage: { inputBytes: 500, imageBytes: 0, modelInputTokens: 500, modelOutputTokens: 100, providerCostUsdMicros: 50_000, wallMilliseconds: 60_000 },
    providerReceiptDigest: repeatSha("c"),
    outputKind: "tool_request",
    outputDigest: repeatSha("9"),
    toolCallId: callId
  };
  const finalOrdinal = visual ? 1 : 0;
  const finalInput = {
    schemaVersion: "hive.repair-turn-input.v1",
    sessionId,
    attemptId,
    ordinal: finalOrdinal,
    providerInputDigest: repeatSha("7"),
    previousTurnOutputDigest: visual ? firstTurn.outputDigest : null,
    consumedToolOutcomeDigests: visual ? [receipt.outcomeDigest] : []
  };
  const finalInputDigest = digest(finalInput);
  const finalTurnId = digest({ schemaVersion: "hive.repair-turn-id.v1", sessionId, attemptId, ordinal: finalOrdinal, inputDigest: finalInputDigest });
  const finalTurn = {
    turnId: finalTurnId,
    attemptId,
    ordinal: finalOrdinal,
    state: "completed",
    startedAt: "2026-07-14T11:30:00.000Z",
    completedAt: "2026-07-14T11:40:00.000Z",
    inputDigest: finalInputDigest,
    providerInputDigest: finalInput.providerInputDigest,
    ...(visual ? { previousTurnOutputDigest: firstTurn.outputDigest } : {}),
    consumedToolOutcomeDigests: finalInput.consumedToolOutcomeDigests,
    providerIdentityDigest,
    usage: visual
      ? { inputBytes: 524, imageBytes: 128, modelInputTokens: 500, modelOutputTokens: 400, providerCostUsdMicros: 50_000, wallMilliseconds: 600_000 }
      : { inputBytes: 512, imageBytes: 0, modelInputTokens: 1000, modelOutputTokens: 500, providerCostUsdMicros: 100_000, wallMilliseconds: 600_000 },
    providerReceiptDigest: repeatSha("d"),
    outputKind: "final_result",
    outputDigest: repeatSha("a")
  };
  const authorizationInput = {
    authorizationId: "authorization.fixture",
    issuedAt: "2026-07-14T10:55:00.000Z",
    expiresAt: "2026-07-14T13:00:00.000Z",
    repositoryFingerprint,
    taskContextDigest: task.taskContextDigest,
    baseSha: repository.baseSha,
    profile,
    toolNames: [...visualTools].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
    assetIds: ["asset.reference"],
    budgetDigest: digest(limits),
    configDigest: repeatSha("a"),
    toolRegistryDigest: repeatSha("c"),
    promptSchemaDigest: repeatSha("e"),
    visualHiveManifestSha256: repeatSha("6"),
    visualHiveEntrypointSha256: repeatSha("7")
  };
  const authorization = { ...authorizationInput, authorizationDigest: digest(authorizationInput) };
  const requestIdentity = {
    sessionId,
    attemptId,
    kind: "patch_validation",
    commitRole: "candidate",
    profileId: profile.profileId,
    profileDigest: profile.profileDigest,
    commitSha: repeatCommit("b"),
    authorizationDigest: visual ? authorization.authorizationDigest : null
  };
  const requestId = digest({ schemaVersion: "hive.repair-validation-request-id.v1", ...requestIdentity });
  const idempotencyKey = digest({ schemaVersion: "hive.repair-validation-request-identity.v1", ...requestIdentity });
  const requestDigest = digest({ schemaVersion: "hive.repair-validation-request.v1", requestId, idempotencyKey, ...requestIdentity });
  const requestSpec = {
    requestId,
    idempotencyKey,
    sessionId,
    attemptId,
    kind: requestIdentity.kind,
    commitRole: requestIdentity.commitRole,
    profileId: profile.profileId,
    profileDigest: profile.profileDigest,
    commitSha: requestIdentity.commitSha,
    ...(visual ? { authorizationDigest: authorization.authorizationDigest } : {}),
    requestDigest
  };
  const turns = visual ? [firstTurn, finalTurn] : [finalTurn];
  const toolReceipts = visual ? [receipt] : [];
  const attempt = {
    attemptId,
    ordinal: 0,
    state: "candidate",
    startedAt: "2026-07-14T11:05:00.000Z",
    completedAt: "2026-07-14T11:50:00.000Z",
    promptDigest,
    turnIds: turns.map((turn) => turn.turnId),
    candidatePatchDigest: repeatSha("4"),
    candidateHeadSha: repeatCommit("b"),
    candidateHeadTreeSha: repeatCommit("d"),
    validationRequestIds: [requestId]
  };
  const transcriptDigest = digest({ turns, toolReceipts });
  const sessionContent = {
    schemaVersion: "hive.repair-session.v1",
    digestAlgorithm: "hive.canonical-json.sha256.v1",
    createdAt: "2026-07-14T11:00:00.000Z",
    updatedAt: "2026-07-14T12:00:00.000Z",
    deadlineAt: "2026-07-14T12:30:00.000Z",
    requestedMode: visual ? "on" : "off",
    effectiveMode: mode,
    state: "awaiting_validation",
    repository,
    finding,
    task,
    capability: visual ? {
      selectionReasons: ["Task includes a reference image."],
      visualHiveVersion: "0.3.2",
      visualHiveCommit: repeatCommit("d"),
      visualHiveManifestSha256: authorization.visualHiveManifestSha256,
      visualHiveEntrypointSha256: authorization.visualHiveEntrypointSha256,
      toolProtocolDigest: repeatSha("c"),
      validationToolRegistryDigest: repeatSha("d")
    } : { selectionReasons: ["Visual Hive was disabled."] },
    sourceContext: {
      digest: digest(sourceProjection),
      maxBytes: 4096,
      totalBytes: 200,
      ...sourceProjection
    },
    validationProfiles: [profile],
    promptIdentities: {
      systemPromptDigest: repeatSha("d"),
      repairPromptDigest: repeatSha("e"),
      toolSchemaDigest: repeatSha("f"),
      taskSchemaDigest: repeatSha("0"),
      modelConfigurationDigest: repeatSha("1")
    },
    executionIdentities: { configDigest: repeatSha("a"), toolRegistryDigest: repeatSha("c"), promptSchemaDigest: repeatSha("e") },
    provider,
    budgets: {
      limits,
      usage: {
        turnsConsumed: turns.length,
        toolCallsConsumed: toolReceipts.length,
        inputBytesConsumed: visual ? 1024 : 512,
        imageBytesConsumed: visual ? 128 : 0,
        modelInputTokensConsumed: 1000,
        modelOutputTokensConsumed: 500,
        providerCostUsdMicrosConsumed: 100_000,
        wallMillisecondsConsumed: visual ? 720_000 : 600_000
      }
    },
    attempts: [attempt],
    turns,
    toolReceipts,
    validationRequests: [{ ...requestSpec, state: "requested", requestedAt: "2026-07-14T11:45:00.000Z" }],
    sessionId,
    ...(visual ? { authorization } : {}),
    transcriptDigest
  };
  const sessionDigestVector = vector(`${visual ? "visual-hive" : "standard"}-session-digest`, sessionContent);
  const resultContent = {
    schemaVersion: "hive.repair-result.v1",
    digestAlgorithm: "hive.canonical-json.sha256.v1",
    generatedAt: "2026-07-14T12:01:00.000Z",
    sessionId,
    sessionDigest: sessionDigestVector.sha256,
    transcriptDigest,
    effectiveMode: mode,
    taskId: task.taskId,
    taskContextDigest: task.taskContextDigest,
    repository: { name: repository.name, repositoryId: repository.repositoryId, repositoryFingerprint },
    finding,
    baseSha: repository.baseSha,
    baseTreeSha: repository.baseTreeSha,
    headSha: repeatCommit("b"),
    headTreeSha: repeatCommit("d"),
    diff: {
      algorithm: "git.diff.binary.sha256.v1",
      sha256: repeatSha("4"),
      changedFiles: [{ path: "src/App.tsx", status: "modified", beforeSha256: repeatSha("5"), afterSha256: repeatSha("6"), beforeMode: "100644", afterMode: "100644" }]
    },
    provider,
    attempts: [{
      attemptId,
      ordinal: 0,
      state: "candidate",
      promptDigest,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      turnCount: turns.length,
      toolCallCount: toolReceipts.length
    }],
    toolReceipts,
    ...(visual ? { authorizationDigest: authorization.authorizationDigest } : {}),
    validationRequests: [requestSpec],
    claimedOutcome: { summary: "Updated the card layout without changing visual policy.", advisory: true },
    status: "candidate"
  };
  return {
    session: sessionDigestVector,
    result: vector(`${visual ? "visual-hive" : "standard"}-result-digest`, resultContent)
  };
}

const standardContractVectors = buildFullContractVectors("standard");
const visualHiveContractVectors = buildFullContractVectors("visual_hive");

const contractVectors = {
  schemaVersion: "hive.repair-contract-vectors.v1",
  digestAlgorithm: "hive.canonical-json.sha256.v1",
  vectors: [
    profileVector,
    providerVector,
    vector("source-context", sourceProjection),
    vector("repository-fingerprint", { repository: "owner/repo", repositoryId: "42" }),
    sessionVector,
    attemptVector,
    turnInputVector,
    turnVector,
    callVector,
    vector("repair-tool-outcome", toolOutcomeProjection),
    authorizationVector,
    requestIdVector,
    requestIdentityVector,
    vector("validation-request-digest", requestDigestProjection),
    standardContractVectors.session,
    standardContractVectors.result,
    visualHiveContractVectors.session,
    visualHiveContractVectors.result
  ]
};
await writeFile(path.join(root, "schemas", "fixtures", "hive.repair-contract-vectors.v1.json"), `${JSON.stringify(contractVectors, null, 2)}\n`, "utf8");
