import crypto from "node:crypto";
import { sanitizeText, type VisualHiveIssueCandidate } from "@visual-hive/core";
import { buildIssuePayloadFromArtifactSummary, buildSetupIssuePayload, type GitHubIssuePayload, type GitHubRepositoryRef } from "./payloads.js";

export type VisualHiveGitHubAppEventName = "installation" | "repository" | "workflow_run" | "issues";

export interface VisualHiveGitHubAppWebhookInput {
  eventName: VisualHiveGitHubAppEventName;
  payload: Record<string, unknown>;
  deliveryId?: string;
  receivedAt?: Date;
}

export interface VisualHiveGitHubAppAction {
  action: "create_setup_issue" | "create_or_update_visual_hive_issue" | "record_issue_event" | "ignore";
  repository?: string;
  reason: string;
  issuePayload?: GitHubIssuePayload;
}

export interface VisualHiveGitHubAppWebhookResult {
  schemaVersion: "visual-hive.github-app.webhook-result.v1";
  eventName: VisualHiveGitHubAppEventName;
  deliveryId?: string;
  generatedAt: string;
  actions: VisualHiveGitHubAppAction[];
  externalCallsMade: 0;
  networkCallsMade: 0;
  checkoutPerformed: false;
  repoCodeExecuted: false;
}

export function verifyGitHubWebhookSignature(secret: string, payload: string | Buffer, signatureHeader: string | undefined): boolean {
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export function handleVisualHiveGitHubAppWebhook(input: VisualHiveGitHubAppWebhookInput): VisualHiveGitHubAppWebhookResult {
  const generatedAt = (input.receivedAt ?? new Date()).toISOString();
  const actions = actionsForEvent(input.eventName, input.payload);
  return {
    schemaVersion: "visual-hive.github-app.webhook-result.v1",
    eventName: input.eventName,
    deliveryId: input.deliveryId ? sanitizeText(input.deliveryId) : undefined,
    generatedAt,
    actions,
    externalCallsMade: 0,
    networkCallsMade: 0,
    checkoutPerformed: false,
    repoCodeExecuted: false
  };
}

function actionsForEvent(eventName: VisualHiveGitHubAppEventName, payload: Record<string, unknown>): VisualHiveGitHubAppAction[] {
  if (eventName === "installation" || eventName === "repository") {
    const repositories = repositoriesFromPayload(payload);
    return repositories.map((repository) => ({
      action: "create_setup_issue",
      repository: repository.fullName,
      reason: "Repository installation should start with an issue-centric Visual Hive setup workflow.",
      issuePayload: buildSetupIssuePayload({ repository })
    }));
  }

  if (eventName === "workflow_run") {
    const repository = repositoryFromPayload(payload);
    const conclusion = readNestedString(payload, ["workflow_run", "conclusion"]);
    const artifactIssue = firstIssueCandidate(payload);
    if (!repository || !artifactIssue) {
      return [{ action: "ignore", reason: "workflow_run event did not include a repository and Visual Hive issue artifact summary." }];
    }
    if (artifactLifecycleOwner(payload) === "hive") {
      return [{
        action: "ignore",
        repository: repository.fullName,
        reason: "managed_by_hive: Hive is the configured lifecycle owner; the Visual Hive GitHub App must not publish concurrently."
      }];
    }
    return [
      {
        action: "create_or_update_visual_hive_issue",
        repository: repository.fullName,
        reason: `Trusted workflow_run completed with conclusion ${conclusion ?? "unknown"}; route sanitized Visual Hive issue artifact.`,
        issuePayload: buildIssuePayloadFromArtifactSummary({ repository, candidate: artifactIssue })
      }
    ];
  }

  if (eventName === "issues") {
    const repository = repositoryFromPayload(payload);
    const title = readNestedString(payload, ["issue", "title"]);
    return [
      {
        action: "record_issue_event",
        repository: repository?.fullName,
        reason: `Issue event observed for ${title ? sanitizeText(title) : "unknown issue"}; app does not execute code from issue events.`
      }
    ];
  }

  return [{ action: "ignore", reason: "Event is not handled by the Visual Hive GitHub App prototype." }];
}

function repositoriesFromPayload(payload: Record<string, unknown>): GitHubRepositoryRef[] {
  const repos = arrayOfObjects(payload.repositories_added) ?? arrayOfObjects(payload.repositories) ?? [];
  const single = repositoryFromPayload(payload);
  const refs = repos.map(repositoryRefFromObject).filter((repo): repo is GitHubRepositoryRef => Boolean(repo));
  if (!refs.length && single) refs.push(single);
  return refs;
}

function repositoryFromPayload(payload: Record<string, unknown>): GitHubRepositoryRef | undefined {
  const repository = objectValue(payload.repository);
  return repository ? repositoryRefFromObject(repository) : undefined;
}

function repositoryRefFromObject(value: Record<string, unknown>): GitHubRepositoryRef | undefined {
  const fullName = stringValue(value.full_name) ?? stringValue(value.fullName);
  if (!fullName) return undefined;
  return {
    fullName: sanitizeText(fullName),
    defaultBranch: stringValue(value.default_branch),
    htmlUrl: stringValue(value.html_url)
  };
}

function firstIssueCandidate(payload: Record<string, unknown>): VisualHiveIssueCandidate | undefined {
  const artifactSummary = objectValue(payload.visual_hive_artifact_summary) ?? objectValue(payload.artifactSummary);
  const candidate = objectValue(artifactSummary?.issueCandidate) ?? objectValue(artifactSummary?.candidate);
  return candidate as VisualHiveIssueCandidate | undefined;
}

function artifactLifecycleOwner(payload: Record<string, unknown>): string | undefined {
  const artifactSummary = objectValue(payload.visual_hive_artifact_summary) ?? objectValue(payload.artifactSummary);
  return stringValue(objectValue(artifactSummary?.lifecycle)?.owner);
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  let cursor: unknown = value;
  for (const segment of path) {
    cursor = objectValue(cursor)?.[segment];
  }
  return stringValue(cursor);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function arrayOfObjects(value: unknown): Record<string, unknown>[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(objectValue(item))) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? sanitizeText(value) : undefined;
}
