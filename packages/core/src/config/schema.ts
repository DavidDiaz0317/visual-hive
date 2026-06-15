import { z } from "zod";

export const CostSchema = z.enum(["cheap", "medium", "expensive"]);
export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export const ProjectTypeSchema = z.enum(["react-vite", "nextjs", "static", "dashboard", "custom"]);
export const MutationOperatorSchema = z.enum([
  "hide-critical-button",
  "force-login-on-demo",
  "remove-demo-badge",
  "api-500",
  "empty-data",
  "mobile-overflow"
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

export const TargetSchema = z.union([CommandTargetSchema, UrlTargetSchema, CommandGroupTargetSchema, ProtectedTargetSchema]);

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

export const VisualHiveConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    type: ProjectTypeSchema.default("custom"),
    defaultBranch: z.string().min(1).default("main")
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
      changedFiles: z.array(SelectionRuleSchema).optional().default([])
    })
    .optional()
    .default({ changedFiles: [] }),
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
      neverSoleOracle: z.boolean().default(true),
      createIssuePrompt: z.boolean().default(true),
      maxDailyRuns: z.number().int().positive().default(5)
    })
    .optional()
    .default({
      enabled: false,
      provider: "none",
      neverSoleOracle: true,
      createIssuePrompt: true,
      maxDailyRuns: 5
    }),
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

function relativeArtifactPathSchema(defaultValue: string): z.ZodDefault<z.ZodEffects<z.ZodString, string, string>> {
  return z
    .string()
    .min(1)
    .refine((value) => isSafeRepoRelativePath(value), {
      message: "Path must be repo-relative and must not contain parent-directory traversal"
    })
    .default(defaultValue);
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
