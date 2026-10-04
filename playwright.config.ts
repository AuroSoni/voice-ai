import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

/**
 * Three suites, picked by E2E_MODE (set by the npm scripts):
 *   keyless  (npm run e2e)          app under `vercel dev` against e2e/mock-upstream.ts — no provider is called
 *   live     (npm run e2e:live)     app under `vercel dev` with the real keys in .env — one short run (~1 min audio)
 *   deployed (npm run e2e:deployed) BASE_URL=<deployment>; 3 models × 4s against the real providers
 * Key-using suites never retry, so a failure can't multiply spend.
 */
const mode = process.env.E2E_MODE ?? "keyless";
const root = __dirname;
export const KEYLESS_PORT = 3211;
export const LIVE_PORT = 3212;
export const MOCK_PORT = 4010;

const fakeMic = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${join(root, "fixtures/audio/hi-4s.wav")}%noloop`,
  "--autoplay-policy=no-user-gesture-required",
];

/** Reads KEY=value from .env.local (for the deployed suite's password and bypass secret). */
function envLocal(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(join(root, ".env.local"), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).replace(/^"|"$/g, "");
  } catch {
    return undefined;
  }
}

const mockEnv = {
  STT_E2E: "1",
  APP_PASSWORD: "e2e-password",
  SARVAM_API_KEY: "mock-sarvam",
  GEMINI_API_KEY: "mock-gemini",
  OPENAI_API_KEY: "mock-openai",
  ELEVENLABS_API_KEY: "mock-elevenlabs",
  STT_UPSTREAM_SARVAM: `http://127.0.0.1:${MOCK_PORT}/sarvam`,
  STT_UPSTREAM_GEMINI: `http://127.0.0.1:${MOCK_PORT}/gemini`,
  STT_UPSTREAM_OPENAI: `http://127.0.0.1:${MOCK_PORT}/openai`,
  STT_UPSTREAM_ELEVENLABS: `http://127.0.0.1:${MOCK_PORT}/elevenlabs`,
};

const webServer: PlaywrightTestConfig["webServer"] =
  mode === "keyless"
    ? [
        {
          command: "npx tsx --conditions=react-server e2e/mock-upstream.ts",
          url: `http://127.0.0.1:${MOCK_PORT}/__health`,
          env: { MOCK_PORT: String(MOCK_PORT) },
          reuseExistingServer: false,
        },
        {
          command: `vercel dev --listen ${KEYLESS_PORT}`,
          url: `http://localhost:${KEYLESS_PORT}/api/health`,
          env: mockEnv,
          reuseExistingServer: false,
          timeout: 180_000,
        },
      ]
    : mode === "live"
      ? {
          command: `vercel dev --listen ${LIVE_PORT}`,
          url: `http://localhost:${LIVE_PORT}/api/health`,
          env: { APP_PASSWORD: "", STT_E2E: "" },
          reuseExistingServer: false,
          timeout: 180_000,
        }
      : undefined;

const bypass = envLocal("VERCEL_AUTOMATION_BYPASS_SECRET");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    launchOptions: { args: fakeMic },
    permissions: ["microphone"],
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer,
  projects: [
    { name: "keyless", testDir: "e2e/keyless", use: { baseURL: `http://localhost:${KEYLESS_PORT}` } },
    { name: "live", testDir: "e2e/live", use: { baseURL: `http://localhost:${LIVE_PORT}` }, timeout: 180_000 },
    {
      name: "deployed",
      testDir: "e2e/deployed",
      timeout: 120_000,
      use: {
        baseURL: process.env.BASE_URL,
        extraHTTPHeaders: bypass
          ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "samesitenone" }
          : undefined,
      },
      metadata: { password: envLocal("APP_PASSWORD") },
    },
  ],
});
