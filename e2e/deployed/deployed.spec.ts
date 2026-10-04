// Checks what only a real Vercel deployment can show: the gate, region, the WebSocket
// relay on Vercel, token sockets, and unbuffered NDJSON. 3 models × ~5s of real audio.
//   BASE_URL=https://… npm run e2e:deployed
import { expect, test } from "@playwright/test";
import { cardSummary, record, selectOnly, waitAllSettled } from "../helpers";

const PROVIDER_MODELS = ["sarvam/saaras-v3-realtime", "gemini/transcribe-live", "openai/gpt-transcribe"];

test.beforeAll(() => {
  if (!process.env.BASE_URL) throw new Error("Set BASE_URL to the deployment to test");
});

test("health reports every provider configured, password auth, Mumbai region", async ({ request }) => {
  const health = await (await request.get("/api/health")).json();
  expect(health.providers).toEqual({ sarvam: true, gemini: true, openai: true, elevenlabs: true });
  expect(health.auth).toBe("password");
  expect(health.region).toBe("bom1");
  expect(health.mockUpstreams).toBe(false);
});

test("signed-out access is refused", async ({ page, request }) => {
  expect((await request.post("/api/realtime-token", { data: {} })).status()).toBe(401);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("relay, token socket and streamed REST all transcribe", async ({ page }, testInfo) => {
  const password = testInfo.project.metadata.password as string | undefined;
  if (!password) throw new Error("APP_PASSWORD missing from .env.local");
  await page.goto(`/?key=${encodeURIComponent(password)}`);
  await expect(page.getByTestId("record-button")).toBeVisible();

  await selectOnly(page, PROVIDER_MODELS);
  await record(page, 5);
  await waitAllSettled(page, 60_000);
  for (const c of await cardSummary(page)) {
    expect.soft(c.status, `${c.id}: ${c.error}`).toBe("done");
    expect.soft(c.text, c.id).toMatch(/नमस्ते|मौसम|बाज/);
  }
});
