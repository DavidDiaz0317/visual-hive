import { z } from "zod";

export const CostSchema = z.enum(["cheap", "medium", "expensive"]);
export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export const ProjectTypeSchema = z.enum(["react-vite", "nextjs", "static", "dashboard", "custom"]);
export const SetupProfileSchema = z.enum(["free-local", "hosted-review", "component-storybook", "enterprise-visual-ai", "complex-app"]);
export const ProviderIdSchema = z.enum(["playwright", "argos", "percy", "chromatic", "applitools", "storybook", "github-checks"]);
export const ProviderModeSchema = z.enum(["mock", "external"]);
export const MutationOperatorSchema = z.enum([
  "hide-critical-button",
  "force-login-on-demo",
  "remove-demo-badge",
  "api-500",
  "empty-data",
  "mobile-overflow",
  "route-guard-bypass",
  "hidden-error-banner",
  "broken-image",
  "removed-accessible-name",
  "theme-token-drift",
  "stale-loading-state"
]);

export const VisualConfigSchema = z
  .object({
    maxDiffPixelRatio: z.number().min(0).max(1).default(0.01),
    maxDiffPixels: z.number().int().nonnegative().optional(),
    updateSnapshots: z.boolean().default(false),
    failOnMissingBaselineInCI: z.boolean().default(true),
    snapshotDir: relativeArtifactPathSchema(".visual-hive/snapshots"),
    artifactDir: relativeArtifactPathSchema(".visual-hive/artifacts")
  })
  .default({
    maxDiffPixelRatio: 0.01,
    updateSnapshots: false,
    failOnMissingBaselineInCI: true,
    snapshotDir: ".visual-hive/snapshots",
    artifactDir: ".visual-hive/artifacts"
  });

const ProviderUploadConfigSchema = z
  .object({
    buildName: z.string().min(1).optional(),
    includeActualScreenshots: z.boolean().default(true),
    includeDiffScreenshots: z.boolean().default(true),
    includeTextArtifacts: z.boolean().default(false),
    extraFiles: z.array(relativeArtifactPathItemSchema()).default([])
  })
  .default({
    includeActualScreenshots: true,
    includeDiffScreenshots: true,
    includeTextArtifacts: false,
    extraFiles: []
  });

function providerConfig(defaults: { enabled: boolean; mode?: z.infer<typeof ProviderModeSchema>; requiredEnv?: string[] }) {
  return z
    .object({
      enabled: z.boolean().default(defaults.enabled),
      mode: ProviderModeSchema.default(defaults.mode ?? "external"),
      requiredEnv: z.array(z.string().min(1)).default(defaults.requiredEnv ?? []),
      projectId: z.string().min(1).optional(),
      failOnProviderFailure: z.boolean().default(false),
      upload: ProviderUploadConfigSchema
    })
    .default({
      enabled: defaults.enabled,
      mode: defaults.mode ?? "external",
      requiredEnv: defaults.requiredEnv ?? [],
      failOnProviderFailure: false,
      upload: {
        includeActualScreenshots: true,
        includeDiffScreenshots: true,
        includeTextArtifacts: false,
        extraFiles: []
      }
    });
}

export const ProvidersConfigSchema = z
  .object({
    playwright: providerConfig({ enabled: true, requiredEnv: [] }),
    argos: providerConfig({ enabled: false, requiredEnv: ["ARGOS_TOKEN"] }),
    percy: providerConfig({ enabled: false, requiredEnv: ["PERCY_TOKEN"] }),
    chromatic: providerConfig({ enabled: false, requiredEnv: ["CHROMATIC_PROJECT_TOKEN"] }),
    applitools: providerConfig({ enabled: false, requiredEnv: ["APPLITOOLS_API_KEY"] }),
    storybook: providerConfig({ enabled: false, mode: "mock", requiredEnv: [] }),
    "github-checks": providerConfig({ enabled: false, requiredEnv: ["GITHUB_TOKEN"] })
  })
  .optional()
  .default({
    playwright: { enabled: true, mode: "external", requiredEnv: [], failOnProviderFailure: false },
    argos: { enabled: false, mode: "external", requiredEnv: ["ARGOS_TOKEN"], failOnProviderFailure: false },
    percy: { enabled: false, mode: "external", requiredEnv: ["PERCY_TOKEN"], failOnProviderFailure: false },
    chromatic: { enabled: false, mode: "external", requiredEnv: ["CHROMATIC_PROJECT_TOKEN"], failOnProviderFailure: false },
    applitools: { enabled: false, mode: "external", requiredEnv: ["APPLITOOLS_API_KEY"], failOnProviderFailure: false },
    storybook: { enabled: false, mode: "mock", requiredEnv: [], failOnProviderFailure: false },
    "github-checks": { enabled: false, mode: "external", requiredEnv: ["GITHUB_TOKEN"], failOnProviderFailure: false }
  });

const ExternalUploadPolicySchema = z
  .object({
    pullRequest: z.boolean().default(false),
    schedule: z.boolean().default(true),
    manual: z.boolean().default(true),
    canary: z.boolean().default(false),
    mutation: z.boolean().default(false),
    full: z.boolean().default(true),
    onFailureOnly: z.boolean().default(true),
    criticalContractsOnly: z.boolean().default(true)
  })
  .default({
    pullRequest: false,
    schedule: true,
    manual: true,
    canary: false,
    mutation: false,
    full: true,
    onFailureOnly: true,
    criticalContractsOnly: true
  });

export const CostPolicySchema = z
  .object({
    maxExternalScreenshotsPerRun: z.number().int().nonnegative().default(0),
    maxMonthlyExternalScreenshots: z.number().int().nonnegative().default(5000),
    externalUpload: ExternalUploadPolicySchema
  })
  .default({
    maxExternalScreenshotsPerRun: 0,
    maxMonthlyExternalScreenshots: 5000,
    externalUpload: {
      pullRequest: false,
      schedule: true,
      manual: true,
      canary: false,
      mutation: false,
      full: true,
      onFailureOnly: true,
      criticalContractsOnly: true
    }
  });

const RunOnSchema = z
  .object({
    pullRequest: z.boolean().optional().default(false),
    schedule: z.boolean().optional().default(false)
  })
  .default({});

const BaseTargetFields = {
  prSafe: z.boolean().optional().default(false),
  schedule: z.string().optional(),
  cost: CostSchema.optional().default("medium")
};

const BaseTargetSchema = z.object({
  ...BaseTargetFields,
  url: z.string().url()
});

const CommandTargetSchema = BaseTargetSchema.extend({
  kind: z.literal("command"),
  install: z.string().optional(),
  build: z.string().optional(),
  serve: z.string()
});

const UrlTargetSchema = BaseTargetSchema.extend({
  kind: z.literal("url")
});

const DeployPreviewTargetSchema = z
  .object({
    kind: z.literal("deployPreview"),
    provider: z.enum(["vercel", "netlify", "github-pages", "custom"]).default("custom"),
    url: z.string().url().optional(),
    urlEnv: z.string().min(1).optional(),
    urlTemplate: z.string().min(1).optional(),
    fallbackUrl: z.string().url().optional(),
    prSafe: z.boolean().optional().default(true),
    schedule: z.string().optional(),
    cost: CostSchema.optional().default("cheap")
  })
  .refine((target) => Boolean(target.url || target.urlEnv || target.fallbackUrl), {
    message: "Deploy-preview targets require url, urlEnv, or fallbackUrl",
    path: ["url"]
  });

const StorybookTargetSchema = z.object({
  kind: z.literal("storybook"),
  url: z.string().url(),
  install: z.string().optional(),
  build: z.string().optional(),
  serve: z.string().optional(),
  stories: z.array(z.string().min(1)).optional().default([]),
  components: z.array(z.string().min(1)).optional().default([]),
  prSafe: z.boolean().optional().default(true),
  schedule: z.string().optional(),
  cost: CostSchema.optional().default("cheap")
});

const CommandGroupServiceSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  url: z.string().url(),
  healthPath: z.string().optional(),
  readinessTimeoutMs: z.number().int().positive().optional()
});

const CommandGroupTargetSchema = BaseTargetSchema.extend({
  kind: z.literal("commandGroup"),
  setup: z.array(z.string().min(1)).optional().default([]),
  services: z.array(CommandGroupServiceSchema).min(1),
  teardown: z.array(z.string().min(1)).optional().default([])
});

const ProtectedTargetSchema = z
  .object({
    ...BaseTargetFields,
    kind: z.literal("protected"),
    url: z.string().url().optional(),
    prSafe: z.boolean().optional().default(false),
    cost: CostSchema.optional().default("expensive"),
    setup: z.array(z.string().min(1)).optional().default([]),
    services: z.array(CommandGroupServiceSchema).optional().default([]),
    teardown: z.array(z.string().min(1)).optional().default([]),
    requiresSecrets: z.array(z.string().min(1)).optional().default([])
  })
  .refine((target) => Boolean(target.url) || target.services.length > 0, {
    message: "Protected targets require url unless at least one service is configured",
    path: ["url"]
  });

export const TargetSchema = z.union([
  CommandTargetSchema,
  UrlTargetSchema,
  DeployPreviewTargetSchema,
  StorybookTargetSchema,
  CommandGroupTargetSchema,
  ProtectedTargetSchema
]);

export const ViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export const ScreenshotSchema = z.object({
  name: z.string().min(1),
  route: z.string().default("/"),
  viewport: z.string().min(1),
  fullPage: z.boolean().optional().default(true),
  mask: z.array(z.string()).optional().default([])
});

export const WaitForSchema = z.object({
  selector: z.string().min(1),
  state: z.enum(["visible", "attached", "hidden"]).default("visible"),
  timeoutMs: z.number().int().positive().default(5000)
});

export const FlowStepSchema = z
  .object({
    action: z.enum(["goto", "click", "fill", "press", "waitFor", "assertVisible", "assertHidden", "assertText", "assertUrl"]),
    description: z.string().optional(),
    selector: z.string().optional(),
    route: z.string().optional(),
    value: z.string().optional(),
    key: z.string().optional(),
    text: z.string().optional(),
    state: z.enum(["visible", "attached", "hidden"]).optional().default("visible"),
    timeoutMs: z.number().int().positive().optional().default(5000)
  })
  .superRefine((step, context) => {
    const needsSelector = ["click", "fill", "press", "waitFor", "assertVisible", "assertHidden", "assertText"].includes(step.action);
    if (needsSelector && !step.selector) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `${step.action} steps require selector`, path: ["selector"] });
    }
    if (step.action === "goto" && !step.route) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "goto steps require route", path: ["route"] });
    }
    if (step.action === "fill" && step.value === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "fill steps require value", path: ["value"] });
    }
    if (step.action === "press" && !step.key) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "press steps require key", path: ["key"] });
    }
    if (step.action === "assertText" && !step.text) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "assertText steps require text", path: ["text"] });
    }
    if (step.action === "assertUrl" && !step.value) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "assertUrl steps require value", path: ["value"] });
    }
  });

export const SelectorContractSchema = z
  .object({
    mustExist: z.array(z.string()).optional().default([]),
    mustNotExist: z.array(z.string()).optional().default([]),
    textMustExist: z.array(z.string()).optional().default([]),
    textMustNotExist: z.array(z.string()).optional().default([])
  })
  .optional()
  .default({});

export const ContractSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  target: z.string().min(1),
  severity: SeveritySchema.default("medium"),
  runOn: RunOnSchema,
  timeoutMs: z.number().int().positive().optional(),
  waitFor: z.array(WaitForSchema).optional().default([]),
  steps: z.array(FlowStepSchema).optional().default([]),
  failOnConsoleError: z.boolean().optional().default(false),
  expectedConsoleErrors: z.array(z.string()).optional().default([]),
  selectors: SelectorContractSchema,
  screenshots: z.array(ScreenshotSchema).optional().default([])
});

export const SelectionRuleSchema = z.object({
  pattern: z.string().min(1),
  contracts: z.array(z.string().min(1)).default([]),
  risk: SeveritySchema.default("medium")
});

export const IgnoredChangedFileRuleSchema = z.object({
  pattern: z.string().min(1),
  reason: z.string().min(1).default("changed file is ignored for visual planning")
});

export const VisualHiveConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    type: ProjectTypeSchema.default("custom"),
    defaultBranch: z.string().min(1).default("main"),
    setupProfile: SetupProfileSchema.default("free-local")
  }),
  targets: z.record(TargetSchema).refine((targets) => Object.keys(targets).length > 0, {
    message: "At least one target is required"
  }),
  contracts: z.array(ContractSchema).min(1),
  viewports: z.record(ViewportSchema).default({
    desktop: { width: 1440, height: 900 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 390, height: 844 }
  }),
  visual: VisualConfigSchema,
  selection: z
    .object({
      changedFiles: z.array(SelectionRuleSchema).optional().default([]),
      ignoreChangedFiles: z.array(IgnoredChangedFileRuleSchema).optional().default([])
    })
    .optional()
    .default({ changedFiles: [], ignoreChangedFiles: [] }),
  mutation: z
    .object({
      enabled: z.boolean().default(false),
      runOn: RunOnSchema,
      minScore: z.number().min(0).max(1).default(0.7),
      operators: z
        .array(
          z.union([
            MutationOperatorSchema,
            z.object({
              id: MutationOperatorSchema,
              contracts: z.array(z.string().min(1)).optional().default([])
            })
          ])
        )
        .default([])
    })
    .optional()
    .default({ enabled: false, runOn: { pullRequest: false, schedule: false }, minScore: 0.7, operators: [] }),
  ai: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.string().default("none"),
      model: z.string().default("offline-heuristics"),
      neverSoleOracle: z.literal(true).default(true),
      createIssuePrompt: z.boolean().default(true),
      maxDailyRuns: z.number().int().positive().default(5),
      maxPromptTokens: z.number().int().positive().default(50000),
      maxEstimatedCostUsd: z.number().nonnegative().default(0)
    })
    .optional()
    .default({
      enabled: false,
      provider: "none",
      model: "offline-heuristics",
      neverSoleOracle: true,
      createIssuePrompt: true,
      maxDailyRuns: 5,
      maxPromptTokens: 50000,
      maxEstimatedCostUsd: 0
    }),
  providers: ProvidersConfigSchema,
  costPolicy: CostPolicySchema,
  github: z
    .object({
      enabled: z.boolean().default(false),
      issueLabels: z.array(z.string()).default(["visual-hive", "test-failure"]),
      commentMarker: z.string().default("<!-- visual-hive-report -->")
    })
    .optional()
    .default({
      enabled: false,
      issueLabels: ["visual-hive", "test-failure"],
      commentMarker: "<!-- visual-hive-report -->"
    })
});

export type VisualHiveConfig = z.infer<typeof VisualHiveConfigSchema>;
export type TargetConfig = z.infer<typeof TargetSchema>;
export type ContractConfig = z.infer<typeof ContractSchema>;
export type MutationOperator = z.infer<typeof MutationOperatorSchema>;
export type MutationOperatorConfig = VisualHiveConfig["mutation"]["operators"][number];
export type ProviderId = z.infer<typeof ProviderIdSchema>;
export type ProviderConfig = VisualHiveConfig["providers"][ProviderId];

function relativeArtifactPathSchema(defaultValue: string): z.ZodDefault<z.ZodEffects<z.ZodString, string, string>> {
  return relativeArtifactPathItemSchema().default(defaultValue);
}

function relativeArtifactPathItemSchema(): z.ZodEffects<z.ZodString, string, string> {
  return z
    .string()
    .min(1)
    .refine((value) => isSafeRepoRelativePath(value), {
      message: "Path must be repo-relative and must not contain parent-directory traversal"
    });
}

function isSafeRepoRelativePath(value: string): boolean {
  if (!value.trim()) {
    return false;
  }
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\")) {
    return false;
  }
  return value
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .every((segment) => segment !== "..");
}
