import { startControlPlaneServer } from "../packages/control-plane/dist/index.js";

const server = await startControlPlaneServer({
  config: "examples/demo-react-app/visual-hive.config.yaml",
  port: 0,
  readOnly: true
});

try {
  const snapshotResponse = await fetch(`${server.url}/api/snapshot`);
  if (!snapshotResponse.ok) {
    throw new Error(`snapshot endpoint returned ${snapshotResponse.status}`);
  }
  const snapshot = await snapshotResponse.json();
  if (snapshot.schemaVersion !== 1) {
    throw new Error(`unexpected snapshot schemaVersion: ${snapshot.schemaVersion}`);
  }
  if (!snapshot.config?.project?.name) {
    throw new Error("snapshot did not include a loaded project config");
  }

  const pageResponse = await fetch(server.url);
  if (!pageResponse.ok) {
    throw new Error(`ui page returned ${pageResponse.status}`);
  }
  const page = await pageResponse.text();
  if (!page.includes("Visual Hive Control Plane")) {
    throw new Error("ui page did not include expected title");
  }
  console.log(`Visual Hive UI smoke passed at ${server.url}`);
} finally {
  await server.close();
}
