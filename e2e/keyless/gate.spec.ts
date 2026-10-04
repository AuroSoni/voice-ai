import { expect, test } from "@playwright/test";
import WebSocket from "ws";
import { KEYLESS_PORT } from "../../playwright.config";
import { login } from "../helpers";

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("API routes answer 401 when signed out", async ({ request }) => {
  const transcribe = await request.post("/api/transcribe", { multipart: { language: "hi" } });
  expect(transcribe.status()).toBe(401);
  const token = await request.post("/api/realtime-token", { data: { modelId: "openai/gpt-live-transcribe", language: "hi" } });
  expect(token.status()).toBe(401);
});

test("the relay refuses signed-out sockets in-band", async () => {
  const ws = new WebSocket(`ws://localhost:${KEYLESS_PORT}/api/relay/sarvam?modelId=sarvam/saaras-v3-realtime&language=hi&mode=transcribe`);
  const result = await new Promise<{ message?: string; code: number }>((resolve) => {
    let message: string | undefined;
    ws.on("message", (d) => (message = d.toString()));
    ws.on("close", (code) => resolve({ message, code }));
    ws.on("unexpected-response", (_q, r) => resolve({ code: r.statusCode ?? 0 }));
  });
  expect(result.code).toBe(4401);
  expect(JSON.parse(result.message!)).toMatchObject({ event: "relay_error", status: 401 });
});

test("a wrong password is rejected and the right one signs in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("nope");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("That password didn't work.")).toBeVisible();
  await login(page, "e2e-password");
});

test("a share link signs the visitor in and drops the key from the URL", async ({ page }) => {
  await page.goto("/?key=e2e-password");
  await expect(page.getByTestId("record-button")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});
