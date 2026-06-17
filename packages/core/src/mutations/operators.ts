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
  },
  "route-guard-bypass": {
    id: "route-guard-bypass",
    description: "Expose protected-route UI inside a public or unauthenticated surface.",
    relevantSelectors: ["[data-testid='protected-route']", "[data-testid='admin-page']", "auth", "guard"],
    recommendedContracts: ["contracts that forbid protected routes or validate auth boundaries"],
    expectedFailureKinds: ["unexpected_element", "login_regression", "visual_diff"],
    defaultHeuristic: "Select contracts that mention auth/route guards or forbid protected-route/admin selectors."
  },
  "hidden-error-banner": {
    id: "hidden-error-banner",
    description: "Hide visible error banners and alert regions.",
    relevantSelectors: ["[data-testid='error-banner']", "[role='alert']", ".error-banner"],
    recommendedContracts: ["contracts that require visible error states"],
    expectedFailureKinds: ["missing_element", "api_contract_regression", "visual_diff"],
    defaultHeuristic: "Select contracts that mention error banners, alerts, API failures, or error-state coverage."
  },
  "broken-image": {
    id: "broken-image",
    description: "Break image rendering so visual contracts catch missing assets.",
    relevantSelectors: ["img", "[data-testid*='image']", "[data-testid*='logo']", "[data-testid*='avatar']"],
    recommendedContracts: ["visual contracts that cover image, logo, avatar, or media surfaces"],
    expectedFailureKinds: ["visual_diff", "missing_element"],
    defaultHeuristic: "Select contracts with image/logo/avatar selectors or screenshot coverage."
  },
  "removed-accessible-name": {
    id: "removed-accessible-name",
    description: "Remove accessible names and visible labels from important controls.",
    relevantSelectors: ["button", "[aria-label]", "[alt]", "[title]"],
    recommendedContracts: ["contracts with button/control text or accessibility-name assertions"],
    expectedFailureKinds: ["missing_element", "visual_diff"],
    defaultHeuristic: "Select contracts that mention buttons, accessible names, aria labels, alt text, or text assertions."
  },
  "theme-token-drift": {
    id: "theme-token-drift",
    description: "Change theme tokens and key colors to simulate design-system drift.",
    relevantSelectors: [":root", "body", "[data-theme]"],
    recommendedContracts: ["visual contracts that cover themed layouts"],
    expectedFailureKinds: ["visual_diff"],
    defaultHeuristic: "Select contracts with screenshots or theme/design-token selectors."
  },
  "stale-loading-state": {
    id: "stale-loading-state",
    description: "Leave a persistent loading state over the page.",
    relevantSelectors: ["[data-testid='loading-state']", "[data-testid='spinner']", "[aria-busy='true']"],
    recommendedContracts: ["contracts that forbid stale loading indicators or verify loaded data"],
    expectedFailureKinds: ["unexpected_element", "missing_element", "visual_diff"],
    defaultHeuristic: "Select contracts that mention loading/spinner/skeleton states or capture screenshots after load."
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
  if (operator === "route-guard-bypass") {
    return (
      lower.includes("protected-route") ||
      lower.includes("admin-page") ||
      lower.includes("route guard") ||
      lower.includes("route-guard") ||
      lower.includes("auth") ||
      lower.includes("login")
    );
  }
  if (operator === "hidden-error-banner") {
    return lower.includes("error-banner") || lower.includes("role='alert'") || lower.includes('role="alert"') || lower.includes("alert") || lower.includes("error");
  }
  if (operator === "broken-image") {
    return lower.includes("img") || lower.includes("image") || lower.includes("logo") || lower.includes("avatar") || contract.screenshots.length > 0;
  }
  if (operator === "removed-accessible-name") {
    return (
      lower.includes("aria-label") ||
      lower.includes("accessible") ||
      lower.includes("alt") ||
      lower.includes("button") ||
      lower.includes("critical-action-button") ||
      contract.selectors.textMustExist.length > 0 ||
      contract.selectors.textMustNotExist.length > 0
    );
  }
  if (operator === "theme-token-drift") {
    return lower.includes("theme") || lower.includes("token") || lower.includes("color") || contract.screenshots.length > 0;
  }
  if (operator === "stale-loading-state") {
    return lower.includes("loading") || lower.includes("spinner") || lower.includes("skeleton") || lower.includes("aria-busy") || contract.screenshots.length > 0;
  }
  return false;
}
