import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { VisualHiveConfigSchema } from "../src/config/schema.js";
import { buildTestCreationPlan } from "../src/testCreation/build.js";

describe("test creation recommendation grounding", () => {
  it("leaves a neutral repository gap unresolved without inventing product concepts", async () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "neutral-repository" },
      targets: { site: { kind: "url", url: "http://127.0.0.1:4173" } },
      contracts: [{ id: "known-surface", description: "Known surface", target: "site" }]
    });
    const plan = await buildTestCreationPlan({
      project: "neutral-repository",
      config,
      now: new Date("2026-07-15T00:00:00.000Z"),
      coverageRecommendations: {
        recommendations: [{
          id: "coverage:unmapped-surface",
          kind: "add_selector_assertion",
          severity: "high",
          title: "Add coverage for an unmapped surface",
          rationale: ["Coverage evidence has no exact repository mapping."],
          contractId: "absent-contract",
          suggestedTests: ["Placeholder guidance must not survive grounding."],
          suggestedConfigYaml: "selectors:\n  mustExist:\n    - '[data-testid=made-up]'"
        }]
      }
    });

    const recommendation = plan.recommendations[0]!;
    expect(plan.schemaVersion).toBe("visual-hive.test-creation-plan.v2");
    expect(recommendation.grounding.status).toBe("unresolved");
    expect(recommendation.grounding.evidence).toEqual([]);
    expect(recommendation.grounding.unresolvedReasons).toEqual(["Contract absent-contract is not present in the loaded Visual Hive config or repository map."]);
    expect(recommendation.affected).toEqual({});
    expect(recommendation.suggestedContract).toEqual({
      id: "absent-contract",
      description: "Add coverage for an unmapped surface",
      selectors: [],
      mustNotExistSelectors: [],
      textMustExist: [],
      textMustNotExist: [],
      maskSelectors: []
    });
    expect(recommendation.suggestedMutation).toBe("not_applicable");
    expect(recommendation.suggestedConfigYaml).toBeUndefined();
    expect(recommendation.suggestedTests).toEqual(["Resolve this gap to an exact configured contract or repository-map node before authoring a test."]);
    expect(JSON.stringify(recommendation)).not.toMatch(/dashboard|auth-boundary|critical-route-shell|data-testid/iu);
  });

  it("copies exact contract facts and exact mutation mapping from loaded config", async () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "grounded-repository" },
      targets: { web: { kind: "url", url: "http://127.0.0.1:4173" } },
      viewports: { compact: { width: 800, height: 600 } },
      contracts: [{
        id: "account-card",
        description: "Account card remains usable",
        target: "web",
        selectors: {
          mustExist: [".account-card"],
          textMustExist: ["Account status"]
        },
        waitFor: [{ selector: "[data-account-state='ready']" }],
        screenshots: [{ name: "account-card", route: "/account", viewport: "compact", mask: [".timestamp"] }]
      }],
      mutation: {
        enabled: true,
        operators: [{ id: "api-500", contracts: ["account-card"] }]
      }
    });
    const plan = await buildTestCreationPlan({
      project: "grounded-repository",
      config,
      now: new Date("2026-07-15T00:00:00.000Z"),
      coverageRecommendations: {
        recommendations: [{
          id: "coverage:account-card",
          kind: "add_selector_assertion",
          severity: "high",
          title: "Strengthen account-card coverage",
          rationale: ["The exact contract needs stronger coverage."],
          contractId: "account-card",
          targetId: "web",
          suggestedTests: ["Upstream placeholder guidance."]
        }]
      }
    });

    const recommendation = plan.recommendations[0]!;
    expect(recommendation.grounding).toMatchObject({ status: "grounded", unresolvedReasons: [] });
    expect(recommendation.grounding.evidence).toEqual(expect.arrayContaining([
      "config.contract:account-card",
      "config-or-repo.target:web",
      "config-or-repo.route:/account",
      "config-or-repo.viewport:compact",
      "config-or-repo.selector:.account-card",
      "config.mutation:api-500->account-card"
    ]));
    expect(recommendation.affected).toEqual({ route: "/account", viewport: "compact" });
    expect(recommendation.suggestedContract).toEqual({
      id: "account-card",
      description: "Account card remains usable",
      targetId: "web",
      route: "/account",
      viewport: "compact",
      selectors: [".account-card", "[data-account-state='ready']"],
      mustNotExistSelectors: [],
      textMustExist: ["Account status"],
      textMustNotExist: [],
      maskSelectors: [".timestamp"]
    });
    expect(recommendation.suggestedMutation).toBe("api-500");
    expect(recommendation.suggestedTests.join(" ")).toContain("account-card");
    expect(recommendation.suggestedTests.join(" ")).toContain("/account");
    expect(recommendation.suggestedTests.join(" ")).not.toContain("placeholder");

    const schema = JSON.parse(await readFile(new URL("../../../schemas/visual-hive.test-creation-plan.schema.json", import.meta.url), "utf8")) as object;
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(plan), JSON.stringify(validate.errors)).toBe(true);
  });

  it("ignores malformed or stale repository-map nodes instead of treating them as grounding", async () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "stale-map" },
      targets: { web: { kind: "url", url: "http://127.0.0.1:4173" } },
      contracts: [{ id: "known-contract", description: "Known contract", target: "web" }]
    });
    const malformedPlan = await buildTestCreationPlan({
      project: "stale-map",
      config,
      repoMap: { schemaVersion: 1 } as never,
      coverageRecommendations: {
        recommendations: [{
          id: "coverage:unknown",
          kind: "add_selector_assertion",
          severity: "high",
          title: "Unknown surface",
          rationale: ["No exact mapping exists."],
          contractId: "unknown-contract",
          suggestedTests: []
        }]
      }
    });
    expect(malformedPlan.recommendations[0]?.grounding.status).toBe("unresolved");

    const stalePlan = await buildTestCreationPlan({
      project: "stale-map",
      config,
      repoMap: {
        visualMap: {
          nodes: [{
            id: "unknown-contract",
            status: "stale",
            contractIds: ["unknown-contract"],
            targetIds: ["web"],
            routes: ["/invented"],
            viewports: [],
            selectors: [".invented"],
            states: []
          }]
        }
      } as never,
      coverageRecommendations: {
        recommendations: [{
          id: "coverage:unknown",
          kind: "add_selector_assertion",
          severity: "high",
          title: "Unknown surface",
          rationale: ["No exact mapping exists."],
          contractId: "unknown-contract",
          suggestedTests: []
        }]
      }
    });
    expect(stalePlan.recommendations[0]?.grounding.status).toBe("unresolved");
    expect(stalePlan.recommendations[0]?.suggestedContract.route).toBeUndefined();
    expect(stalePlan.recommendations[0]?.suggestedContract.selectors).toEqual([]);
  });

  it("preserves every exact contract mapping for a multi-contract mutation survivor", async () => {
    const config = VisualHiveConfigSchema.parse({
      project: { name: "multi-contract-mutation" },
      targets: { web: { kind: "url", url: "http://127.0.0.1:4173" } },
      contracts: [
        { id: "account-card", description: "Account card", target: "web" },
        { id: "billing-card", description: "Billing card", target: "web" }
      ]
    });
    const plan = await buildTestCreationPlan({
      project: "multi-contract-mutation",
      config,
      evidencePacket: {
        testingLayers: [],
        mutation: {
          survivedOperators: [{ operator: "api-500", contractIds: ["billing-card", "account-card"], artifacts: [] }]
        }
      }
    });

    expect(plan.recommendations.map((recommendation) => recommendation.contractId).sort()).toEqual(["account-card", "billing-card"]);
    expect(plan.recommendations.every((recommendation) => recommendation.suggestedMutation === "api-500")).toBe(true);
  });
});
