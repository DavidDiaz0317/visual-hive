import path from "node:path";
import {
  canonicalJson,
  parseHiveRepairSession,
  type HiveRepairSession,
  type HiveRepairValidationRequestSpec,
  type VisualHiveTaskContext
} from "@visual-hive/core";
import type { PlaywrightRepairCaptureFinding } from "@visual-hive/playwright-adapter";
import { readBoundedJsonFile } from "./repairFileIo.js";

const MAX_HIVE_REPAIR_SESSION_BYTES = 32 * 1024 * 1024;

export async function loadHiveRepairSessionSnapshot(sessionPath: string): Promise<HiveRepairSession> {
  return parseHiveRepairSession(await readBoundedJsonFile(
    path.resolve(sessionPath),
    MAX_HIVE_REPAIR_SESSION_BYTES,
    "Hive repair session snapshot"
  ));
}

export function assertHiveRepairSessionMatchesTask(session: HiveRepairSession, task: VisualHiveTaskContext): void {
  if (session.effectiveMode !== "visual_hive" || !session.authorization) {
    throw new Error("Visual Hive repair tools require an authorized visual_hive Hive session.");
  }
  if (session.task.taskId !== task.taskId || session.task.taskContextDigest !== task.contextDigest) {
    throw new Error("Hive repair session does not bind the exact Visual Hive task context.");
  }
  if (
    session.repository.name !== task.repository.name ||
    session.repository.repositoryId !== task.repository.repositoryId ||
    session.repository.repositoryFingerprint !== task.repository.repositoryFingerprint ||
    session.repository.baseSha !== task.repository.baseSha
  ) {
    throw new Error("Hive repair session does not bind the exact task repository and base commit.");
  }
  if (
    session.task.issueSource !== task.issue.source ||
    session.task.issueExternalId !== task.issue.externalId ||
    session.task.problemStatementDigest !== task.issue.problemStatementSha256
  ) {
    throw new Error("Hive repair session issue projection does not match the Visual Hive task issue.");
  }
  const expectedAttachments = task.imageReferences.map((reference) => {
    const asset = task.assets.find((candidate) => candidate.assetId === reference.assetId);
    if (!asset) throw new Error(`Visual Hive task image reference names missing asset ${reference.assetId}.`);
    return {
      position: reference.position,
      assetId: asset.assetId,
      role: reference.role,
      sha256: asset.sha256,
      mediaType: asset.mediaType,
      size: asset.size
    };
  });
  if (canonicalJson(session.task.imageAttachments) !== canonicalJson(expectedAttachments)) {
    throw new Error("Hive repair session image attachments do not match the exact Visual Hive task images.");
  }
  if (session.sourceContext.digest !== task.sourceContext.digest || canonicalJson(session.sourceContext.files) !== canonicalJson(task.sourceContext.files) || session.sourceContext.omittedPaths !== task.sourceContext.omittedPaths || session.sourceContext.truncated !== task.sourceContext.truncated) {
    throw new Error("Hive repair session source context does not match the Visual Hive task source context.");
  }
  if (canonicalJson(session.validationProfiles) !== canonicalJson(task.profiles)) {
    throw new Error("Hive repair session validation profiles do not match the Visual Hive task profiles.");
  }
  const authorization = session.authorization;
  if (
    authorization.repositoryFingerprint !== task.repository.repositoryFingerprint ||
    authorization.taskContextDigest !== task.contextDigest ||
    authorization.baseSha !== task.repository.baseSha
  ) {
    throw new Error("Hive repair authorization does not bind the exact Visual Hive task and repository.");
  }
}

export function assertHiveRepairSessionMatchesFinding(
  session: HiveRepairSession,
  finding: Pick<PlaywrightRepairCaptureFinding, "fingerprint" | "repositoryFingerprint" | "publicationRole" | "rootCauseKey">
): void {
  if (
    session.finding.fingerprint !== finding.fingerprint ||
    session.finding.repositoryFingerprint !== finding.repositoryFingerprint ||
    session.finding.publicationRole !== finding.publicationRole ||
    session.finding.rootCauseKey !== finding.rootCauseKey
  ) {
    throw new Error("Hive repair session does not bind the exact Visual Hive finding.");
  }
}

export function assertHiveRepairSessionContainsRequest(
  session: HiveRepairSession,
  request: HiveRepairValidationRequestSpec
): void {
  const matching = session.validationRequests.filter((candidate) =>
    candidate.requestId === request.requestId &&
    candidate.idempotencyKey === request.idempotencyKey &&
    candidate.sessionId === request.sessionId &&
    candidate.attemptId === request.attemptId &&
    candidate.kind === request.kind &&
    candidate.commitRole === request.commitRole &&
    candidate.profileId === request.profileId &&
    candidate.profileDigest === request.profileDigest &&
    candidate.commitSha === request.commitSha &&
    candidate.authorizationDigest === request.authorizationDigest &&
    candidate.requestDigest === request.requestDigest
  );
  if (matching.length !== 1) {
    throw new Error("Hive repair validation request is not the exact request declared by its session snapshot.");
  }
}
