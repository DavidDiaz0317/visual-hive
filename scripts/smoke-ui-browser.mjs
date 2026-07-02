import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { startControlPlaneServer } from "../packages/control-plane/dist/index.js";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "visual-hive-ui-browser-"));
const screenshotPath = path.join(tempRoot, "control-plane.png");
const consoleProblems = [];

const server = await startControlPlaneServer({
  config: "examples/demo-react-app/visual-hive.config.yaml",
  port: 0,
  readOnly: true
});

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    consoleProblems.push(`pageerror: ${error.message}`);
  });

  await page.goto(server.url, { waitUntil: "domcontentloaded" });
  await expectText(page, "Quality cockpit");
  await expectText(page, "What should I do next?");
  await expectText(page, "Visual Hive verdict");
  await expectText(page, "Why Visual Hive reached this verdict");
  await expectText(page, "Expert console");
  await page.screenshot({ path: screenshotPath, fullPage: false });

  await clickUnique(page.locator("nav button").filter({ hasText: "ReviewResults and evidence" }), "Review navigation");
  await expectText(page, "Failures");
  await expectText(page, "Failure queue");
  await expectText(page, "Baselines");
  await expectText(page, "Visual Hive verdict");

  await clickUnique(page.getByRole("button", { name: "Expert", exact: true }), "Expert mode toggle");
  await expectText(page, "Expert mode");
  await expectText(page, "Review raw evidence");

  if (consoleProblems.length) {
    throw new Error(`Control Plane emitted browser errors:\n${consoleProblems.join("\n")}`);
  }

  console.log(`Visual Hive browser UI smoke passed at ${server.url}`);
} finally {
  if (browser) {
    await browser.close();
  }
  await server.close();
  await rm(tempRoot, { recursive: true, force: true });
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 10_000 });
}

async function clickUnique(locator, label) {
  const count = await locator.count();
  if (count !== 1) {
    throw new Error(`${label} expected exactly one match, found ${count}`);
  }
  await locator.click();
}
