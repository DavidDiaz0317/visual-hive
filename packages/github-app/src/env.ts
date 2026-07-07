export interface GitHubAppEnvironmentReadiness {
  mode: "mock_or_plan" | "live_guard_blocked" | "live_ready";
  mockModeEnabled: boolean;
  liveModeRequested: boolean;
  webhookSecretConfigured: boolean;
  appIdConfigured: boolean;
  privateKeyConfigured: boolean;
  privateKeySource?: "GITHUB_APP_PRIVATE_KEY" | "GITHUB_APP_PRIVATE_KEY_PATH";
  installationIdConfigured: boolean;
  requiredForLive: string[];
  missingForLive: string[];
  externalCallsMade: 0;
  networkCallsMade: 0;
}

export function getGitHubAppEnvironmentReadiness(env: NodeJS.ProcessEnv = process.env): GitHubAppEnvironmentReadiness {
  const liveModeRequested = env.VISUAL_HIVE_GITHUB_APP_LIVE === "true";
  const appIdConfigured = Boolean(env.GITHUB_APP_ID?.trim());
  const inlinePrivateKeyConfigured = Boolean(env.GITHUB_APP_PRIVATE_KEY?.trim());
  const pathPrivateKeyConfigured = Boolean(env.GITHUB_APP_PRIVATE_KEY_PATH?.trim());
  const privateKeyConfigured = inlinePrivateKeyConfigured || pathPrivateKeyConfigured;
  const installationIdConfigured = Boolean(env.GITHUB_APP_INSTALLATION_ID?.trim());
  const webhookSecretConfigured = Boolean(env.GITHUB_WEBHOOK_SECRET?.trim());
  const missingForLive = [
    appIdConfigured ? undefined : "GITHUB_APP_ID",
    privateKeyConfigured ? undefined : "GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH",
    installationIdConfigured ? undefined : "GITHUB_APP_INSTALLATION_ID",
    webhookSecretConfigured ? undefined : "GITHUB_WEBHOOK_SECRET"
  ].filter((value): value is string => Boolean(value));

  return {
    mode: liveModeRequested ? (missingForLive.length ? "live_guard_blocked" : "live_ready") : "mock_or_plan",
    mockModeEnabled: env.VISUAL_HIVE_GITHUB_APP_ALLOW_UNSIGNED_MOCKS === "true",
    liveModeRequested,
    webhookSecretConfigured,
    appIdConfigured,
    privateKeyConfigured,
    privateKeySource: inlinePrivateKeyConfigured ? "GITHUB_APP_PRIVATE_KEY" : pathPrivateKeyConfigured ? "GITHUB_APP_PRIVATE_KEY_PATH" : undefined,
    installationIdConfigured,
    requiredForLive: ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH", "GITHUB_APP_INSTALLATION_ID", "GITHUB_WEBHOOK_SECRET"],
    missingForLive,
    externalCallsMade: 0,
    networkCallsMade: 0
  };
}
