import { startControlPlaneServer, type StartedControlPlane } from "@visual-hive/control-plane";

export interface UiCommandOptions {
  repo?: string;
  config?: string;
  port?: string | number;
  open?: boolean;
  readOnly?: boolean;
  demo?: boolean;
}

export async function runUiCommand(options: UiCommandOptions): Promise<StartedControlPlane> {
  const port = parsePort(options.port);
  return startControlPlaneServer({
    repo: options.repo,
    config: options.config,
    port,
    open: options.open,
    readOnly: options.readOnly,
    demo: options.demo
  });
}

function parsePort(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid --port value "${value}". Expected an integer from 0 to 65535.`);
  }
  return parsed;
}
