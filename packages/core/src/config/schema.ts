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

const RunOnSchema = z
  .object({
    pullRequest: z.boolean().optional().default(false),
    schedule: z.boolean().optional().default(false)
  })
  .default({});

const BaseTargetSchema = z.object({
  url: z.string().url(),
  prSafe: z.boolean().optional().default(false),
  schedule: z.string().optional(),
  cost: CostSchema.optional().default("medium")
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

export const TargetSchema = z.discriminatedUnion("kind", [CommandTargetSchema, UrlTargetSchema]);

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
      operators: z.array(MutationOperatorSchema).default([])
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
