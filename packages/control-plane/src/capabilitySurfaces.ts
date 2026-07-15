export interface ControlPlaneCapabilitySurface {
  method: "GET" | "POST";
  path: string;
  runtimeStatus: "supported" | "blocked";
  blockedReason?: string;
}

export const CONTROL_PLANE_CAPABILITY_SURFACES: ControlPlaneCapabilitySurface[] = ([
  { method: "GET", path: "/", runtimeStatus: "supported" },
  { method: "GET", path: "/assets/*", runtimeStatus: "supported" },
  { method: "GET", path: "/api/file", runtimeStatus: "supported" },
  { method: "GET", path: "/api/image", runtimeStatus: "supported" },
  { method: "GET", path: "/api/snapshot", runtimeStatus: "supported" },
  { method: "GET", path: "/healthz", runtimeStatus: "supported" },
  { method: "POST", path: "/api/baseline/approve", runtimeStatus: "supported" },
  { method: "POST", path: "/api/baseline/reject", runtimeStatus: "supported" },
  { method: "POST", path: "/api/config/save", runtimeStatus: "supported" },
  { method: "POST", path: "/api/config/validate", runtimeStatus: "supported" },
  { method: "POST", path: "/api/connections/add", runtimeStatus: "supported" },
  { method: "POST", path: "/api/connections/remove", runtimeStatus: "supported" },
  { method: "POST", path: "/api/coverage/apply-recommendation", runtimeStatus: "supported" },
  { method: "POST", path: "/api/llm/decision", runtimeStatus: "supported" },
  { method: "POST", path: "/api/providers/decision", runtimeStatus: "supported" },
  { method: "POST", path: "/api/providers/setup-plan", runtimeStatus: "supported" },
  { method: "POST", path: "/api/runbook/execute", runtimeStatus: "supported" },
  { method: "POST", path: "/api/runbook/profile", runtimeStatus: "supported" },
  { method: "POST", path: "/api/setup/recommend", runtimeStatus: "supported" },
  { method: "POST", path: "/api/setup/write-bundle", runtimeStatus: "supported" },
  { method: "POST", path: "/api/setup/write-config", runtimeStatus: "supported" },
  { method: "POST", path: "/api/setup/write-docs", runtimeStatus: "supported" },
  { method: "POST", path: "/api/workflows/write-templates", runtimeStatus: "supported" }
] as ControlPlaneCapabilitySurface[]).sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`));
