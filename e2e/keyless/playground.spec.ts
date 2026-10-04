import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { parseWav } from "@/lib/audio/wav";
import { MODELS, isStreaming } from "@/lib/models/registry";
import { ALL_MODEL_IDS, cardSummary, login, mockControl, record, selectOnly, silentWav, waitAllSettled } from "../helpers";

const STREAMING = new Set(MODELS.filter(isStreaming).map((m) => m.id));

test.beforeEach(async ({ page, request }) => {
  await mockControl(request);
  await login(page, "e2e-password");
});

test("a provider without a key is disabled and says which env var to set", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "stt_e2e_disable", value: "elevenlabs", url: baseURL! }]);
  await page.reload();
  await expect(page.getByTestId("missing-elevenlabs")).toHaveText("set ELEVENLABS_API_KEY");
  await expect(page.getByTestId("model-elevenlabs/scribe-v2")).toHaveAttribute("data-disabled", "");
  await expect(page.getByTestId("missing-sarvam")).toHaveCount(0);
});

test("model selection survives a reload", async ({ page }) => {
  await selectOnly(page, ["gemini/transcribe", "openai/gpt-live-transcribe"]);
  await page.reload();
  await expect(page.getByTestId("model-gemini/transcribe")).toHaveAttribute("data-checked", "");
  await expect(page.getByTestId("model-openai/gpt-live-transcribe")).toHaveAttribute("data-checked", "");
  await expect(page.getByTestId("model-sarvam/saaras-v4")).not.toHaveAttribute("data-checked", "");
});

test("live run: every model transcribes the same recording", async ({ page }) => {
  await selectOnly(page, ALL_MODEL_IDS);
  const { maxLevel } = await record(page, 5.5);
  expect(maxLevel).toBeGreaterThan(0.01);

  // Streaming cards show text while recording would be live; after Stop all settle.
  await waitAllSettled(page);
  const cards = await cardSummary(page);
  expect(cards).toHaveLength(ALL_MODEL_IDS.length);
  for (const c of cards) {
    expect.soft(c.status, c.id).toBe("done");
    expect.soft(c.text, c.id).toMatch(/नमस्ते/);
    expect.soft(c.script, c.id).toMatch(/Devanagari/);
  }
  for (const c of cards.filter((x) => STREAMING.has(x.id))) expect.soft(c.metrics, c.id).toMatch(/connect/);

  // The downloadable recording is 16 kHz mono with roughly the recorded length.
  const download = page.waitForEvent("download");
  await page.getByTestId("download").click();
  const wav = parseWav(new Uint8Array(readFileSync(await (await download).path())));
  expect(wav.sampleRate).toBe(16000);
  expect(wav.channels).toBe(1);
  expect(wav.pcm.length / 16000).toBeGreaterThan(4.5);
  expect(wav.pcm.length / 16000).toBeLessThan(7);
});

test("upload: a clip runs through every model; clips over 60s are refused", async ({ page }) => {
  await selectOnly(page, ALL_MODEL_IDS);
  await page.getByTestId("upload-input").setInputFiles(join(process.cwd(), "fixtures/audio/hi-4s.wav"));
  await expect(page.getByTestId("record-button")).toHaveAttribute("aria-label", /Playing clip/);
  await waitAllSettled(page);
  for (const c of await cardSummary(page)) {
    expect.soft(c.status, c.id).toBe("done");
    expect.soft(c.text, c.id).toMatch(/नमस्ते/);
  }

  await page.getByTestId("upload-input").setInputFiles({ name: "long.wav", mimeType: "audio/wav", buffer: silentWav(61) });
  await expect(page.getByTestId("run-error")).toContainText("limit is 60s");
});

test("re-run replays the last recording as a fresh run", async ({ page }) => {
  await selectOnly(page, ["gemini/transcribe", "sarvam/saaras-v3-realtime"]);
  await record(page, 5);
  await waitAllSettled(page);
  await page.getByTestId("rerun").click();
  await expect(page.getByTestId("card-gemini/transcribe")).toHaveAttribute("data-status", /queued|transcribing/);
  await waitAllSettled(page);
  for (const c of await cardSummary(page)) {
    expect.soft(c.status, c.id).toBe("done");
    expect.soft(c.text, c.id).toMatch(/नमस्ते/);
  }
});

test("an upstream failure is contained to its own card", async ({ page, request }) => {
  await mockControl(request, { fail: { "elevenlabs/scribe-v2": 403, "sarvam/saaras-v4-realtime": 403 } });
  await selectOnly(page, ["elevenlabs/scribe-v2", "gemini/transcribe", "sarvam/saaras-v4-realtime", "openai/gpt-live-transcribe"]);
  await record(page, 5);
  await waitAllSettled(page);
  const byId = Object.fromEntries((await cardSummary(page)).map((c) => [c.id, c]));
  expect(byId["elevenlabs/scribe-v2"].status).toBe("error");
  expect(byId["elevenlabs/scribe-v2"].error).toMatch(/403/);
  expect(byId["sarvam/saaras-v4-realtime"].status).toBe("error");
  expect(byId["sarvam/saaras-v4-realtime"].error).toMatch(/403/);
  expect(byId["gemini/transcribe"].status).toBe("done");
  expect(byId["openai/gpt-live-transcribe"].status).toBe("done");
});

test("a provider that never finalizes times out but keeps its partial text", async ({ page, request }) => {
  await mockControl(request, { stall: ["openai/gpt-live-transcribe"] });
  await selectOnly(page, ["openai/gpt-live-transcribe"]);
  await record(page, 5);
  await waitAllSettled(page, 30_000);
  const [card] = await cardSummary(page);
  expect(card.status).toBe("error");
  expect(card.error).toMatch(/Timed out/);
  expect(card.partial + card.text).toMatch(/नमस्ते/);
});

test("blocked microphone shows a helpful message", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await page.reload();
  await selectOnly(page, ["gemini/transcribe"]);
  await page.getByTestId("record-button").click();
  await expect(page.getByTestId("run-error")).toContainText("Microphone access was blocked");
});

test("recording stops by itself at 60 seconds @slow", async ({ page }) => {
  test.setTimeout(120_000);
  await selectOnly(page, ["gemini/transcribe"]);
  await page.getByTestId("record-button").click();
  await expect(page.getByTestId("record-button")).toHaveAttribute("aria-label", "Stop");
  await expect(page.getByTestId("record-button")).not.toHaveAttribute("aria-label", "Stop", { timeout: 75_000 });
  await expect(page.getByTestId("timer")).toContainText("1:00");
  await waitAllSettled(page);
  const download = page.waitForEvent("download");
  await page.getByTestId("download").click();
  const wav = parseWav(new Uint8Array(readFileSync(await (await download).path())));
  expect(wav.pcm.length / 16000).toBeCloseTo(60, 0);
});
