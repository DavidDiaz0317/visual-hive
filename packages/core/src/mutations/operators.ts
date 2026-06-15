import type { ContractConfig, MutationOperator, MutationOperatorConfig } from "../config/schema.js";

export interface MutationOperatorMetadata {
  id: MutationOperator;
  description: string;
  relevantSelectors: string[];
  recommendedContracts: string[];
  expectedFailureKinds: string[];
  defaultHeuristic: string;
}

export const MUTATION_OPERATOR_METADATA: Record<MutationOperator, MutationOperatorMetadata> = {
  "hide-critical-button": {
    id: "hide-critical-button",
    description: "Hide the primary critical action button.",
    relevantSelectors: ["[data-testid='critical-action-button']"],
    recommendedContracts: ["contracts that require the critical action button"],
    expectedFailureKinds: ["missing_element", "visual_diff"],
    defaultHeuristic: "Select contracts that require [data-testid='critical-action-button']."
  },
  "force-login-on-demo": {
    id: "force-login-on-demo",
    description: "Force login UI into a public demo surface.",
    relevantSelectors: ["[data-testid='login-page']", "[data-testid='github-login-button']"],
    recommendedContracts: ["public demo contracts that forbid login controls"],
    expectedFailureKinds: ["unexpected_element", "login_regression"],
    defaultHeuristic: "Select contracts that forbid login-page or github-login-button selectors."
  },
  "remove-demo-badge": {
    id: "remove-demo-badge",
    description: "Remove visible demo badges from cards.",
    relevantSelectors: ["[data-testid='demo-badge']"],
    recommendedContracts: ["contracts that require demo badges"],
    expectedFailureKinds: ["missing_element", "visual_diff"],
    defaultHeuristic: "Select contracts that require [data-testid='demo-badge']."
  },
  "api-500": {
    id: "api-500",
    description: "Return HTTP 500 for API routes.",
    relevantSelectors: ["api", "data"],
    recommendedContracts: ["contracts with API-driven data or screenshots"],
    expectedFailureKinds: ["api_contract_regression", "visual_diff"],
    defaultHeuristic: "Select contracts that mention API/data/card selectors or capture screenshots."
  },
  "empty-data": {
    id: "empty-data",
    description: "Return an empty API payload.",
    relevantSelectors: ["api", "data", "card"],
    recommendedContracts: ["contracts that require API-driven records"],
    expectedFailureKinds: ["api_contract_regression", "missing_element"],
    defaultHeuristic: "Select contracts that mention API/data/card selectors or capture screenshots."
  },
  "mobile-overflow": {
    id: "mobile-overflow",
    description: "Introduce horizontal overflow on mobile viewports.",
    relevantSelectors: ["mobile"],
    recommendedContracts: ["contracts with mobile screenshots"],
    expectedFailureKinds: ["visual_diff"],
    defaultHeuristic: "Select contracts that capture a mobile viewport screenshot."
  }
};

export function mutationOperatorId(operator: MutationOperatorConfig): MutationOperator {
  return typeof operator === "string" ? operator : operator.id;
}

export function mutationOperatorContracts(operator: MutationOperatorConfig): string[] {
  return typeof operator === "string" ? [] : operator.contracts;
}

export function selectContractsForMutation(operator: MutationOperatorConfig, contracts: ContractConfig[]): {
  operatorId: MutationOperator;
  contractIds: string[];
  applicable: boolean;
  reason: string;
} {
  const operatorId = mutationOperatorId(operator);
  const explicit = mutationOperatorContracts(operator);
  if (explicit.length > 0) {
    return {
      operatorId,
      contractIds: explicit,
      applicable: explicit.length > 0,
      reason: "explicit mutation contract mapping"
    };
  }

  const selected = contracts.filter((contract) => matchesHeuristic(operatorId, contract)).map((contract) => contract.id);
  return {
    operatorId,
    contractIds: selected,
    applicable: selected.length > 0,
    reason: selected.length > 0 ? "heuristic mutation contract mapping" : "no heuristic match"
  };
}

function matchesHeuristic(operator: MutationOperator, contract: ContractConfig): boolean {
  const selectors = [
    ...contract.selectors.mustExist,
    ...contract.selectors.mustNotExist,
    ...contract.selectors.textMustExist,
    ...contract.selectors.textMustNotExist
  ].join(" ");
  const lower = `${contract.id} ${contract.description} ${selectors}`.toLowerCase();

  if (operator === "hide-critical-button") {
    return lower.includes("critical-action-button");
  }
  if (operator === "force-login-on-demo") {
    return lower.includes("login-page") || lower.includes("github-login-button");
  }
  if (operator === "remove-demo-badge") {
    return lower.includes("demo-badge");
  }
  if (operator === "api-500" || operator === "empty-data") {
    return lower.includes("api") || lower.includes("data") || lower.includes("dashboard-card") || contract.screenshots.length > 0;
  }
  if (operator === "mobile-overflow") {
    return contract.screenshots.some((shot) => shot.viewport.toLowerCase().includes("mobile"));
  }
  return false;
}
