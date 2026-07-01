import type {
  ControlPlaneArtifact,
  ControlPlaneFailure,
  ControlPlaneRunbookCommand,
  ControlPlaneRunProfile,
  ControlPlaneScreenshot,
  ControlPlaneSnapshot
} from "../../../src/types";

export type Snapshot = ControlPlaneSnapshot;
export type Screenshot = ControlPlaneScreenshot;
export type Failure = ControlPlaneFailure;
export type Artifact = ControlPlaneArtifact;
export type RunbookCommand = ControlPlaneRunbookCommand;
export type RunProfile = ControlPlaneRunProfile;

export interface ApiResult<T = unknown> {
  ok?: boolean;
  error?: string;
  [key: string]: T | string | boolean | undefined;
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "amber";
