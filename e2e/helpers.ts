import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { MODELS } from "@/lib/models/registry";

export const ALL_MODEL_IDS = MODELS.map((m) => m.id);
export const MOCK = "http://127.0.0.1:4010";

export async function mockControl(request: APIRequestContext, body: { fail?: Record<string, number>; stall?: string[] } = {}) {
  const res = await request.post(`${MOCK}/__control`, { data: body });
  expect(res.ok()).toBe(true);
}

export async function login(page: Page, password: string) {
  await page.goto("/login");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("record-button")).toBeVisible();
}

/** Selects exactly these models in the picker. */
export async function selectOnly(page: Page, ids: string[]) {
  await page.getByRole("button", { name: "None", exact: true }).click();
  for (const id of ids) await page.getByTestId(`model-${id}`).click();
  for (const id of ids) await expect(page.getByTestId(`model-${id}`)).toHaveAttribute("data-checked", "");
}

/** Records from the fake mic (fixtures/audio/hi-4s.wav) for `seconds`, then presses Stop. */
export async function record(page: Page, seconds = 5.5): Promise<{ maxLevel: number }> {
  await page.getByTestId("record-button").click();
  await expect(page.getByTestId("record-button")).toHaveAttribute("aria-label", "Stop");
  let maxLevel = 0;
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const level = Number(await page.getByTestId("level-meter").getAttribute("data-level"));
    maxLevel = Math.max(maxLevel, level);
    await page.waitForTimeout(250);
  }
  await page.getByTestId("record-button").click();
  return { maxLevel };
}

export async function waitAllSettled(page: Page, timeout = 45_000) {
  await expect
    .poll(
      async () => {
        const statuses = await page.locator('[data-testid^="card-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
        return statuses.length > 0 && statuses.every((s) => s === "done" || s === "error");
      },
      { timeout, intervals: [250] },
    )
    .toBe(true);
}

export async function cardSummary(page: Page) {
  return page.locator('[data-testid^="card-"]').evaluateAll((els) =>
    els.map((e) => ({
      id: e.getAttribute("data-testid")!.replace(/^card-/, ""),
      status: e.getAttribute("data-status"),
      text: (e.querySelector('[data-testid="final-text"]') as HTMLElement | null)?.innerText ?? "",
      partial: (e.querySelector('[data-testid="partial-text"]') as HTMLElement | null)?.innerText ?? "",
      script: (e.querySelector('[data-testid="script"]') as HTMLElement | null)?.innerText ?? "",
      error: (e.querySelector('[data-testid="error"]') as HTMLElement | null)?.innerText ?? "",
      metrics: (e.querySelector('[data-testid="metrics"]') as HTMLElement | null)?.innerText ?? "",
    })),
  );
}

/** Builds a silent 16 kHz mono WAV of the given length (for the over-limit upload test). */
export function silentWav(seconds: number): Buffer {
  const samples = Math.round(16000 * seconds);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}
