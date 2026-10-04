// Real providers, real keys from .env. One short run (~12 × 5s of audio) plus two
// single-model checks. Opt-in: `npm run e2e:live`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ALL_MODEL_IDS, cardSummary, record, selectOnly, waitAllSettled } from "../helpers";

test("every real model transcribes the Hindi clip", async ({ page }) => {
  const health = await (await page.request.get("/api/health")).json();
  expect(health.mockUpstreams).toBe(false);
  expect(Object.values(health.providers).every(Boolean)).toBe(true);

  await page.goto("/");
  await selectOnly(page, ALL_MODEL_IDS);
  await record(page, 5);
  await waitAllSettled(page, 90_000);
  const cards = await cardSummary(page);

  mkdirSync(join(process.cwd(), ".context"), { recursive: true });
  writeFileSync(
    join(process.cwd(), ".context/e2e-live-report.json"),
    JSON.stringify({ at: new Date().toISOString(), audio: "fixtures/audio/hi-4s.wav", cards }, null, 2),
  );

  for (const c of cards) {
    expect.soft(c.status, `${c.id}: ${c.error}`).toBe("done");
    expect.soft(c.text, c.id).not.toBe("");
    expect.soft(c.script, c.id).toMatch(/Devanagari/);
  }
});

test("re-run (REST) and upload (streaming) work against real providers", async ({ page }) => {
  await page.goto("/");
  await selectOnly(page, ["gemini/transcribe"]);
  await record(page, 5);
  await waitAllSettled(page);
  await page.getByTestId("rerun").click();
  await waitAllSettled(page);
  let [card] = await cardSummary(page);
  expect(card.status).toBe("done");
  expect(card.text).toMatch(/नमस्ते/);

  await selectOnly(page, ["gemini/transcribe-live"]);
  await page.getByTestId("upload-input").setInputFiles(join(process.cwd(), "fixtures/audio/hi-4s.wav"));
  await waitAllSettled(page);
  [card] = await cardSummary(page);
  expect(card.status).toBe("done");
  expect(card.text).toMatch(/नमस्ते/);
});
